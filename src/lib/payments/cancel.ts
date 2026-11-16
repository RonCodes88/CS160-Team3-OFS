import { PaymentError } from "./service";

/** Stripe states where the customer has not authorized any money yet. */
const UNAUTHORIZED_STATES = ["requires_payment_method", "requires_confirmation", "requires_action"];

export type PendingAttempt = { id: string; provider_payment_id: string | null };
export type CancelDependencies = {
  /** PENDING attempts of this customer only. */
  listPending(customerId: string): Promise<PendingAttempt[]>;
  retrieve(providerId: string): Promise<{ status: string }>;
  cancel(attempt: PendingAttempt & { provider_payment_id: string }): Promise<void>;
  /**
   * Finds or creates the Stripe payment for an attempt that was saved before
   * Stripe answered, links it, and returns its ID. Creation reuses the
   * attempt's idempotency key, so it can never make a second payment.
   */
  link(attempt: PendingAttempt): Promise<string>;
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
    // The customer only receives the client secret after the link is saved, so
    // an unlinked attempt was never shown a card form and holds no money.
    const providerId = attempt.provider_payment_id ?? await deps.link(attempt);
    const intent = await deps.retrieve(providerId);
    if (intent.status !== "canceled") {
      if (!UNAUTHORIZED_STATES.includes(intent.status)) {
        throw new PaymentError(409, "PAYMENT_ALREADY_AUTHORIZED", "This payment was already authorized. Finish confirming it instead.");
      }
      await deps.cancel({ ...attempt, provider_payment_id: providerId });
    }
    const result = await deps.finalize(attempt.id, customerId);
    if (result.status !== "VOIDED") {
      throw new PaymentError(503, "PAYMENT_RECOVERY_REQUIRED", "Payment cancellation is incomplete. Try again.");
    }
    canceled += 1;
  }
  return { canceled };
}
