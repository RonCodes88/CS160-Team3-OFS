import type Stripe from "stripe";
import { PaymentError } from "./service";

const paymentEvents = new Set([
  "payment_intent.amount_capturable_updated", "payment_intent.succeeded",
  "payment_intent.payment_failed", "payment_intent.canceled",
]);

/** Pass request.text() unchanged; parsing/re-serializing would invalidate the signature. */
export function verifyPaymentWebhook(
  webhooks: Pick<Stripe["webhooks"], "constructEvent">,
  rawBody: string,
  signature: string | null,
  endpointSecret: string | undefined,
): { eventId: string; type: string; paymentIntentId: string; fromOfs: boolean; createdAtSeconds: number } | null {
  if (!endpointSecret || !/^whsec_\S+$/.test(endpointSecret)) {
    throw new PaymentError(503, "WEBHOOK_NOT_CONFIGURED", "Stripe webhook verification is not configured.");
  }
  if (!signature) throw new PaymentError(400, "INVALID_WEBHOOK", "Stripe-Signature is required.");
  let event: Stripe.Event;
  try {
    // Keep Stripe's default timestamp tolerance; never disable replay-age checks.
    event = webhooks.constructEvent(rawBody, signature, endpointSecret);
  } catch {
    // SDK errors can contain the original payload. Do not propagate or log them.
    throw new PaymentError(400, "INVALID_WEBHOOK", "Invalid Stripe webhook signature or payload.");
  }
  if (event?.livemode !== false) {
    throw new PaymentError(400, "LIVE_WEBHOOK_REJECTED", "Only Stripe test events are accepted.");
  }
  if (!paymentEvents.has(event.type)) return null;
  const intent = event.data?.object;
  if (typeof event.id !== "string" || !event.id.startsWith("evt_")
    || intent?.object !== "payment_intent" || typeof intent.id !== "string"
    || !intent.id.startsWith("pi_") || intent.livemode !== false) {
    throw new PaymentError(400, "INVALID_WEBHOOK", "Invalid payment event payload.");
  }
  // Events can arrive out of order. Finalization must retrieve current Stripe state
  // and locate the persisted attempt by provider ID, not trust event metadata.
  // OFS creates every intent with metadata.attemptId. An intent without it came
  // from something else on the same Stripe account and can be acknowledged
  // unprocessed. This only decides whether to look; it never supplies identity.
  const fromOfs = typeof intent.metadata?.attemptId === "string" && intent.metadata.attemptId.length > 0;
  return {
    eventId: event.id, type: event.type, paymentIntentId: intent.id, fromOfs,
    // Without a timestamp, treat the event as new so it is retried, not dropped.
    createdAtSeconds: typeof event.created === "number" ? event.created : Math.floor(Date.now() / 1000),
  };
}
