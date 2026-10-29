import Stripe from "stripe";

/** Server-only factory; live keys are forbidden for this class project. */
export function createStripeClient(secretKey: string | undefined): Stripe {
  if (!secretKey || !/^(sk|rk)_test_\S+$/.test(secretKey)) {
    throw new Error("Stripe test secret key is required");
  }
  return new Stripe(secretKey);
}

type IntentCreator = Pick<Stripe["paymentIntents"], "create">;

/** Call only with a persisted attempt ID and freshly validated server totals. */
export async function createAuthorizationIntent(
  intents: IntentCreator,
  input: { attemptId: string; totalCents: number },
) {
  if (!Number.isSafeInteger(input.totalCents) || input.totalCents <= 0) {
    throw new RangeError("Payment amount must be positive integer cents");
  }
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(input.attemptId)) {
    throw new Error("Invalid payment attempt ID");
  }

  // Reserve funds on confirmation; capture belongs to the finalization flow.
  // Reuse the persisted attempt ID on retries so Stripe reuses the same intent.
  return intents.create({
    amount: input.totalCents,
    currency: "usd",
    capture_method: "manual",
    allowed_payment_method_types: ["card"],
    metadata: { attemptId: input.attemptId },
  }, { idempotencyKey: `ofs:payment-intent:${input.attemptId}` });
}
