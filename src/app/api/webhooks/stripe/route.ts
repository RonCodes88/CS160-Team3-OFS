import Stripe from "stripe";
import { createAdminClient } from "@/lib/supabase/admin";
import { verifyPaymentWebhook } from "@/lib/payments/webhook";
import { finalizeWebhookPayment } from "@/lib/payments/finalize-backend";
import { PaymentError } from "@/lib/payments/service";

export const runtime = "nodejs";

/** Stripe authenticates with its signature; this endpoint does not use a customer cookie. */
export async function POST(request: Request): Promise<Response> {
  try {
    const event = verifyPaymentWebhook(Stripe.webhooks, await request.text(),
      request.headers.get("Stripe-Signature"), process.env.STRIPE_WEBHOOK_SECRET);
    if (event) await finalizeWebhookPayment(createAdminClient(), event.paymentIntentId);
    // A relevant event is acknowledged only after successful durable processing.
    return Response.json({ received: true });
  } catch (error) {
    if (error instanceof PaymentError) return Response.json({ error: { code: error.code, message: error.message } }, { status: error.status });
    // Return a retryable response for unknown outcomes, without logging provider payloads.
    return Response.json({ error: { code: "WEBHOOK_RETRY", message: "Payment processing is incomplete." } }, { status: 503 });
  }
}
