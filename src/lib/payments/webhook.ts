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
): { eventId: string; type: string; paymentIntentId: string } | null {
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
  return { eventId: event.id, type: event.type, paymentIntentId: intent.id };
}
