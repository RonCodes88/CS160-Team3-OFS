import { randomUUID } from "node:crypto";
import { PaymentError, type PaymentAttempt } from "./service";

export type FinalizationStep = "READY" | "CAPTURE_PENDING" | "ORDER_PENDING" | "VOID_PENDING" | "REFUND_PENDING" | "DONE";
export type FinalizationAttempt = PaymentAttempt & {
  finalize_step: FinalizationStep; order_id: string | null; failure_code: string | null;
};
export type FinalizationIntent = {
  id: string; amount: number; amount_received: number; amount_capturable: number;
  currency: string; livemode: boolean; capture_method: string; status: string;
  metadata: Record<string, string>; last_payment_error?: { code?: string } | null;
};
export type FinalizationDependencies = {
  claim(id: string, customerId: string, token: string): Promise<FinalizationAttempt>;
  release(id: string, token: string): Promise<void>;
  advance(id: string, token: string, step: FinalizationStep,
    details?: { status?: string; failureCode?: string; refundId?: string }): Promise<FinalizationAttempt>;
  verifyQuote(attempt: FinalizationAttempt): Promise<void>;
  retrieve(providerId: string): Promise<FinalizationIntent>;
  capture(attempt: FinalizationAttempt): Promise<FinalizationIntent>;
  cancel(attempt: FinalizationAttempt): Promise<void>;
  refund(attempt: FinalizationAttempt): Promise<string>;
  createOrder(attemptId: string, token: string): Promise<string>;
};
export type FinalizationResult = {
  attemptId: string; status: string; orderId?: string; providerStatus?: string; failureCode?: string;
};
const businessRejection = (error: unknown): error is PaymentError => error instanceof PaymentError
  && ["CHECKOUT_CHANGED", "TOTALS_MISMATCH", "CART_UNAVAILABLE", "CART_EMPTY", "INVALID_CART", "INVALID_QUANTITY",
    "ADDRESS_INVALID", "PRODUCT_UNAVAILABLE", "INSUFFICIENT_STOCK", "CART_OVERWEIGHT"].includes(error.code);

function verifyIntent(intent: FinalizationIntent, attempt: FinalizationAttempt) {
  if (intent.id !== attempt.provider_payment_id || intent.amount !== attempt.total_cents
    || intent.currency !== "usd" || intent.livemode || intent.capture_method !== "manual"
    || intent.metadata.attemptId !== attempt.id) {
    throw new PaymentError(502, "PAYMENT_PROVIDER_MISMATCH", "Payment verification failed.");
  }
}

/** Browser and webhook callers share this durable, attempt-scoped workflow. */
export async function finalizePayment(id: string, customerId: string, deps: FinalizationDependencies): Promise<FinalizationResult> {
  const token = randomUUID();
  let attempt = await deps.claim(id, customerId, token);
  const result = (): FinalizationResult => ({ attemptId: id, status: attempt.status,
    ...(attempt.order_id ? { orderId: attempt.order_id } : {}),
    ...(attempt.failure_code ? { failureCode: attempt.failure_code } : {}) });
  const advance = async (step: FinalizationStep, details?: Parameters<FinalizationDependencies["advance"]>[3]) => {
    attempt = await deps.advance(id, token, step, details);
  };
  try {
    if (attempt.finalize_step === "DONE") return result();
    if (!attempt.provider_payment_id) throw new PaymentError(409, "PAYMENT_NOT_READY", "Prepare the payment before confirming it.");
    let intent = await deps.retrieve(attempt.provider_payment_id);
    verifyIntent(intent, attempt);
    if (intent.status === "canceled" && !["ORDER_PENDING", "REFUND_PENDING"].includes(attempt.finalize_step)) {
      await advance("DONE", { status: "VOIDED", failureCode: attempt.failure_code ?? "PAYMENT_CANCELED" });
      return result();
    }
    if (attempt.finalize_step === "READY") {
      if (!["requires_capture", "succeeded"].includes(intent.status)) {
        return { attemptId: id, status: "PENDING", providerStatus: intent.status,
          ...(intent.last_payment_error ? { failureCode: "PAYMENT_DECLINED" } : {}) };
      }
      if (intent.status === "requires_capture") {
        if (intent.amount_capturable !== attempt.total_cents) throw new PaymentError(409, "PAYMENT_NOT_AUTHORIZED", "The full payment amount has not been authorized.");
        try { await deps.verifyQuote(attempt); }
        catch (error) {
          if (!businessRejection(error)) throw error;
          await advance("VOID_PENDING", { failureCode: error.code });
        }
      }
      if (attempt.finalize_step === "READY") await advance("CAPTURE_PENDING");
    }
    if (attempt.finalize_step === "VOID_PENDING") {
      await deps.cancel(attempt);
      await advance("DONE", { status: "VOIDED" });
      return result();
    }
    if (attempt.finalize_step === "CAPTURE_PENDING") {
      if (intent.status === "requires_capture") intent = await deps.capture(attempt);
      verifyIntent(intent, attempt);
      if (intent.status !== "succeeded" || intent.amount_received !== attempt.total_cents) {
        throw new PaymentError(503, "PAYMENT_NOT_CAPTURED", "Payment capture is not complete. Retry confirmation.");
      }
      await advance("ORDER_PENDING");
    }
    if (attempt.finalize_step === "ORDER_PENDING") {
      if (intent.status !== "succeeded" || intent.amount_received !== attempt.total_cents) {
        throw new PaymentError(503, "PAYMENT_NOT_CAPTURED", "Payment capture must be verified before creating an order.");
      }
      // The DB transaction checks stock and prices again under row locks.
      try {
        const orderId = await deps.createOrder(id, token);
        return { attemptId: id, status: "CAPTURED", orderId };
      } catch (error) {
        // A timeout may mean the transaction committed. Only a definite business
        // rejection may enter refund recovery; unknown outcomes retry the transaction.
        if (!businessRejection(error)) throw error;
        await advance("REFUND_PENDING", { failureCode: error.code });
      }
    }
    if (attempt.finalize_step === "REFUND_PENDING") {
      const refundId = await deps.refund(attempt);
      await advance("DONE", { status: "REFUNDED", refundId });
      return result();
    }
    throw new PaymentError(503, "PAYMENT_RECOVERY_REQUIRED", "Payment recovery is still in progress.");
  } finally {
    // A lost connection must not mask the original error; abandoned claims expire.
    await deps.release(id, token).catch(() => {});
  }
}
