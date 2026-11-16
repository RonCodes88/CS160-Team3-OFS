import type { SupabaseClient } from "@supabase/supabase-js";
import { finalizePayment, type FinalizationResult } from "./finalize";
import { finalizationDependencies } from "./finalize-backend";
import { PaymentError, type PaymentAttempt } from "./service";
import { createStripeClient } from "./stripe";

export type RecoveryAttempt = Pick<PaymentAttempt, "id" | "customer_id" | "provider_payment_id"> & {
  recovery_token: string;
  recovery_attempts: number;
};

export type RecoveryDependencies = {
  claim(limit: number): Promise<RecoveryAttempt[]>;
  recoverProviderLink(attempt: RecoveryAttempt): Promise<void>;
  finalize(id: string, customerId: string): Promise<FinalizationResult>;
  finish(attempt: RecoveryAttempt, result: "COMPLETED" | "WAITING" | "FAILED", error: string | null): Promise<void>;
};

/** Never creates a provider intent. Unknown outcomes stay retryable or visible for an operator. */
export async function reconcilePayments(deps: RecoveryDependencies, limit = 20) {
  const result = {
    completed: 0,
    waiting: 0,
    failed: 0
  };
  for (const attempt of await deps.claim(limit)) {
    try {
      if (!attempt.provider_payment_id) {
        await deps.recoverProviderLink(attempt);
      }
      const finalized = await deps.finalize(attempt.id, attempt.customer_id);
      const waiting = finalized.status === "PENDING";
      await deps.finish(attempt, waiting ? "WAITING" : "COMPLETED", null);
      if (waiting) {
        result.waiting++;
      } else {
        result.completed++;
      }
    } catch (error) {
      const code = error instanceof PaymentError && /^[A-Z_]{1,100}$/.test(error.code) ? error.code : "RECOVERY_UNAVAILABLE";
      // A failed acknowledgement leaves the lease to expire; continue with other rows.
      await deps.finish(attempt, "FAILED", code).catch(() => { });
      result.failed++;
    }
  }
  return result;
}

export function createRecoveryDependencies(db: SupabaseClient): RecoveryDependencies {
  const stripe = createStripeClient(process.env.STRIPE_SECRET_KEY);
  const finalizer = finalizationDependencies(db);
  return {
    async claim(limit) {
      const { data, error } = await db.rpc("checkout_claim_recovery", { p_limit: limit });
      if (error) {
        throw new Error("Payment recovery queue unavailable");
      }
      return data;
    },
    async recoverProviderLink(attempt) {
      const { data: payment, error } = await db.from("payment_attempts").select("total_cents").eq("id", attempt.id).single();
      if (error || !payment) {
        throw new Error("Payment unavailable");
      }
      // Search is eventually consistent. An empty result never authorizes a new
      // charge or marks the payment failed; retry, then require operator review.
      const matches = await stripe.paymentIntents.search({
        query: `metadata['attemptId']:'${attempt.id}'`,
        limit: 2
      });
      if (matches.has_more || matches.data.length > 1) {
        throw new PaymentError(409, "PAYMENT_RECONCILIATION_REQUIRED", "Ambiguous provider matches.");
      }
      const intent = matches.data[0];
      if (!intent) {
        throw new PaymentError(503, "PAYMENT_NOT_LINKED", "Provider intent not located yet.");
      }
      if (intent.livemode || intent.currency !== "usd" || intent.capture_method !== "manual"
        || intent.amount !== payment.total_cents || intent.metadata.attemptId !== attempt.id) {
        throw new PaymentError(502, "PAYMENT_PROVIDER_MISMATCH", "Provider verification failed.");
      }
      const linked = await db.rpc("checkout_attach_payment_intent", {
        p_customer_id: attempt.customer_id,
        p_attempt_id: attempt.id,
        p_provider_id: intent.id
      });
      if (linked.error) {
        throw new Error("Payment provider link unavailable");
      }
    },
    finalize: (id, customer) => finalizePayment(id, customer, finalizer),
    async finish(attempt, result, errorCode) {
      const { error } = await db.rpc("checkout_finish_recovery", {
        p_id: attempt.id,
        p_token: attempt.recovery_token,
        p_result: result,
        p_error: errorCode
      });
      if (error) {
        throw new Error("Payment recovery acknowledgement unavailable");
      }
    }
  };
}
