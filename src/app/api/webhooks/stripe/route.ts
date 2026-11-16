import Stripe from "stripe";
import { sendNotificationsAfterResponse } from "@/lib/notifications/service";
import { createAdminClient } from "@/lib/supabase/admin";
import { verifyPaymentWebhook } from "@/lib/payments/webhook";
import { finalizeWebhookPayment } from "@/lib/payments/finalize-backend";
import { PaymentError } from "@/lib/payments/service";

export const runtime = "nodejs";

/** How long an event for a payment this database doesn't know is retried. */
const UNKNOWN_PAYMENT_GRACE_SECONDS = 10 * 60;

/** Stripe authenticates with its signature; this endpoint does not use a customer cookie. */
export async function POST(request: Request): Promise<Response> {
  try {
    const event = verifyPaymentWebhook(Stripe.webhooks, await request.text(),
      request.headers.get("Stripe-Signature"), process.env.STRIPE_WEBHOOK_SECRET);
    if (event?.fromOfs) {
      try {
        const result = await finalizeWebhookPayment(createAdminClient(), event.paymentIntentId);
        if (result.orderId) sendNotificationsAfterResponse();
      } catch (error) {
        // A fresh event may arrive before the attempt is linked, so Stripe
        // should retry. An old one belongs to another database that shares
        // this Stripe test account (a teammate's): acknowledge it, or Stripe
        // retries for days and may disable the endpoint.
        const stale = Date.now() / 1000 - event.createdAtSeconds > UNKNOWN_PAYMENT_GRACE_SECONDS;
        if (!(error instanceof PaymentError && error.code === "PAYMENT_NOT_LINKED" && stale)) throw error;
      }
    }
    // A relevant event is acknowledged only after successful durable processing.
    return Response.json({ received: true });
  } catch (error) {
    if (error instanceof PaymentError) return Response.json({ error: { code: error.code, message: error.message } }, { status: error.status });
    // Return a retryable response for unknown outcomes, without logging provider payloads.
    return Response.json({ error: { code: "WEBHOOK_RETRY", message: "Payment processing is incomplete." } }, { status: 503 });
  }
}
