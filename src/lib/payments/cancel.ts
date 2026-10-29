import { PaymentError } from "./service";

/** Stripe states where the customer has not authorized any money yet. */
const UNAUTHORIZED_STATES = ["requires_payment_method", "requires_confirmation", "requires_action"];

export type PendingAttempt = { id: string; provider_payment_id: string | null };
export type CancelDependencies = {
  /** PENDING attempts of this customer only. */
  listPending(customerId: string): Promise<PendingAttempt[]>;
  retrieve(providerId: string): Promise<{ status: string }>;
  cancel(attempt: PendingAttempt & { provider_payment_id: string }): Promise<void>;
  /** The shared finalizer, which records a canceled intent as VOIDED. */
  finalize(attemptId: string, customerId: string): Promise<{ status: string }>;
};

/**
 * Abandons the customer's unpaid checkout so they can change their address or
 * cart and start again: the server blocks a second payment for a cart while
 * one is PENDING. Payments the customer already authorized are never canceled
 * here; those must finish through confirmation, which voids or refunds them if
 * the checkout no longer matches. customerId must come from a verified session.
 */
export async function cancelPendingPayments(customerId: string, deps: CancelDependencies): Promise<{ canceled: number }> {
  if (!customerId) throw new Error("A verified customer identity is required.");
  let canceled = 0;
  for (const attempt of await deps.listPending(customerId)) {
    if (!attempt.provider_payment_id) {
      throw new PaymentError(409, "PAYMENT_RECONCILIATION_REQUIRED", "This payment needs reconciliation before it can be canceled.");
    }
    const intent = await deps.retrieve(attempt.provider_payment_id);
    if (intent.status !== "canceled") {
      if (!UNAUTHORIZED_STATES.includes(intent.status)) {
        throw new PaymentError(409, "PAYMENT_ALREADY_AUTHORIZED", "This payment was already authorized. Finish confirming it instead.");
      }
      await deps.cancel({ ...attempt, provider_payment_id: attempt.provider_payment_id });
    }
    const result = await deps.finalize(attempt.id, customerId);
    if (result.status !== "VOIDED") {
      throw new PaymentError(503, "PAYMENT_RECOVERY_REQUIRED", "Payment cancellation is incomplete. Try again.");
    }
    canceled += 1;
  }
  return { canceled };
}
