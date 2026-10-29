import type { SupabaseClient } from "@supabase/supabase-js";
import type { PreviewInput } from "@/lib/checkout/validation";
import { PaymentError, startPayment } from "./service";
import { paymentRepository } from "./repository";
import { loadPaymentQuote } from "./quote";
import { createAuthorizationIntent, createStripeClient } from "./stripe";

export async function createCustomerPaymentIntent(db: SupabaseClient, customerId: string, key: string, input: PreviewInput) {
  let stripe;
  try { stripe = createStripeClient(process.env.STRIPE_SECRET_KEY); }
  catch { throw new PaymentError(503, "PAYMENT_NOT_CONFIGURED", "Test payments are not configured."); }
  return startPayment(customerId, key, input, {
    ...paymentRepository(db),
    loadQuote: (id, body) => loadPaymentQuote(db, id, body),
    create: (attempt) => createAuthorizationIntent(stripe.paymentIntents, attempt),
    retrieve: (id) => stripe.paymentIntents.retrieve(id),
  });
}
