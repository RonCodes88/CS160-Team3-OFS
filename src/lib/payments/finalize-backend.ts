import type { SupabaseClient } from "@supabase/supabase-js";
import { createOrderFromPayment } from "@/lib/orders/service";
import { canonical, PaymentError, scopePaymentKey } from "./service";
import { finalizePayment, type FinalizationAttempt, type FinalizationDependencies } from "./finalize";
import { loadPaymentQuote } from "./quote";
import { createStripeClient } from "./stripe";

export function finalizationDependencies(db: SupabaseClient): FinalizationDependencies {
  let stripe;
  try { stripe = createStripeClient(process.env.STRIPE_SECRET_KEY); }
  catch { throw new PaymentError(503, "PAYMENT_NOT_CONFIGURED", "Test payments are not configured."); }
  const rpc = async (name: string, args: Record<string, unknown>) => {
    const { data, error } = await db.rpc(name, args);
    if (error?.code === "P0021") throw new PaymentError(404, "PAYMENT_NOT_FOUND", "Payment not found.");
    if (error?.code === "P0020") throw new PaymentError(503, "PAYMENT_BUSY", "Payment is processing. Retry shortly.");
    if (error) throw new PaymentError(503, "PAYMENT_RECOVERY_REQUIRED", "Payment processing is incomplete. Retry shortly.");
    return data;
  };
  return {
    claim: async (id, customerId, token) => await rpc("checkout_claim_finalization", {
      p_attempt_id: id, p_customer_id: customerId, p_token: token,
    }) as FinalizationAttempt,
    release: async (id, token) => { await rpc("checkout_release_finalization", { p_attempt_id: id, p_token: token }); },
    advance: async (id, token, step, details) => await rpc("checkout_advance_finalization", {
      p_attempt_id: id, p_token: token, p_step: step, p_status: details?.status ?? null,
      p_failure_code: details?.failureCode ?? null, p_refund_id: details?.refundId ?? null,
    }) as FinalizationAttempt,
    verifyQuote: async (attempt) => {
      const quote = await loadPaymentQuote(db, attempt.customer_id, {
        addressId: attempt.address_id, expected: attempt.checkout_snapshot.totals,
      });
      if (canonical(quote) !== canonical(attempt.checkout_snapshot)) {
        throw new PaymentError(409, "CHECKOUT_CHANGED", "Your checkout changed before payment was captured.");
      }
    },
    retrieve: (id) => stripe.paymentIntents.retrieve(id),
    capture: (attempt) => stripe.paymentIntents.capture(attempt.provider_payment_id!, {}, { idempotencyKey: `ofs:capture:${attempt.id}` }),
    cancel: async (attempt) => {
      const intent = await stripe.paymentIntents.cancel(attempt.provider_payment_id!, {}, { idempotencyKey: `ofs:void:${attempt.id}` });
      if (intent.status !== "canceled") throw new PaymentError(503, "PAYMENT_RECOVERY_REQUIRED", "Payment cancellation is incomplete.");
    },
    refund: async (attempt) => {
      // Check for a prior refund before retrying, even after Stripe prunes old keys.
      const refunds = await stripe.refunds.list({ payment_intent: attempt.provider_payment_id!, limit: 100 });
      const existing = refunds.data.find((refund) => refund.metadata?.attemptId === attempt.id);
      const refund = existing ?? await stripe.refunds.create({ payment_intent: attempt.provider_payment_id!,
        amount: attempt.total_cents, metadata: { attemptId: attempt.id } }, { idempotencyKey: `ofs:refund:${attempt.id}` });
      if (refund.status !== "succeeded" || refund.amount !== attempt.total_cents || refund.currency !== "usd") {
        throw new PaymentError(503, "REFUND_RECOVERY_REQUIRED", "Payment refund is incomplete. Retry confirmation.");
      }
      return refund.id;
    },
    createOrder: (id, token) => createOrderFromPayment(db, id, token),
  };
}

export async function confirmCustomerPayment(db: SupabaseClient, customerId: string, attemptId: string, key: string) {
  const { data, error } = await db.from("payment_attempts").select("id")
    .eq("id", attemptId).eq("customer_id", customerId).eq("idempotency_key", scopePaymentKey(customerId, key)).maybeSingle();
  if (error) throw new PaymentError(503, "PAYMENT_UNAVAILABLE", "Payment lookup is unavailable.");
  if (!data) throw new PaymentError(404, "PAYMENT_NOT_FOUND", "Payment not found for this customer and key.");
  return finalizePayment(attemptId, customerId, finalizationDependencies(db));
}

/** Called only after signature verification. Event metadata never supplies identity. */
export async function finalizeWebhookPayment(db: SupabaseClient, providerId: string) {
  const { data, error } = await db.from("payment_attempts").select("id,customer_id")
    .eq("provider_payment_id", providerId).maybeSingle();
  // Creation may still be saving the provider ID. Request a retry instead of losing the event.
  if (error || !data) throw new PaymentError(503, "PAYMENT_NOT_LINKED", "Payment is not ready for webhook processing.");
  return finalizePayment(data.id, data.customer_id, finalizationDependencies(db));
}
