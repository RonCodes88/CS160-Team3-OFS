import { createHash } from "node:crypto";
import type { CheckoutTotals, PreviewInput } from "@/lib/checkout/validation";

export class PaymentError extends Error {
  constructor(public status: number, public code: string, message: string, public current?: CheckoutTotals) {
    super(message);
  }
}

export type PaymentQuote = {
  cartId: string;
  addressId: string;
  location: { lat: number; lng: number };
  items: { productId: string; quantity: number; unitPriceCents: number; unitWeight: number }[];
  totals: CheckoutTotals;
};
export type NewAttempt = {
  customer_id: string; cart_id: string; address_id: string; idempotency_key: string;
  request_hash: string; checkout_snapshot: PaymentQuote;
  subtotal_cents: number; delivery_fee_cents: number; tax_cents: number; total_cents: number;
};
export type PaymentAttempt = NewAttempt & {
  id: string; provider_payment_id: string | null; status: string; created_at: string;
};
type ProviderIntent = {
  id: string; client_secret: string | null; status: string; amount: number;
  currency: string; capture_method: string; livemode: boolean; metadata: Record<string, string>;
};
export type PaymentDependencies = {
  loadQuote(customerId: string, input: PreviewInput): Promise<PaymentQuote>;
  find(customerId: string, key: string): Promise<PaymentAttempt | null>;
  reserve(attempt: NewAttempt): Promise<PaymentAttempt>;
  attach(customerId: string, attemptId: string, providerId: string): Promise<void>;
  create(input: { attemptId: string; totalCents: number }): Promise<ProviderIntent>;
  retrieve(id: string): Promise<ProviderIntent>;
};

// JSONB can reorder object keys; comparisons must remain stable after a DB round trip.
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}
const digest = (value: unknown) => createHash("sha256").update(canonical(value)).digest("hex");
export const scopePaymentKey = (customerId: string, key: string) => digest([customerId, key]);

/** Session identity and parsed input only. Persistence precedes any Stripe call. */
export async function startPayment(customerId: string, key: string, input: PreviewInput, deps: PaymentDependencies) {
  if (!customerId || !/^[A-Za-z0-9_-]{1,128}$/.test(key)) {
    throw new PaymentError(400, "INVALID_IDEMPOTENCY_KEY", "Provide an Idempotency-Key of 1–128 letters, digits, hyphens or underscores.");
  }
  // Customer scoping prevents one customer's key from colliding with another's.
  const scopedKey = scopePaymentKey(customerId, key);
  const requestHash = digest(input);
  let attempt = await deps.find(customerId, scopedKey);
  const checkRequest = () => {
    if (attempt && (attempt.customer_id !== customerId || attempt.request_hash !== requestHash)) {
      throw new PaymentError(409, "IDEMPOTENCY_CONFLICT", "This key was already used for a different checkout request.");
    }
  };
  checkRequest();
  // Completed attempts remain replayable even after their cart is checked out.
  if (attempt && attempt.status !== "PENDING") return resumeAttempt(attempt, deps, false);
  const quote = await deps.loadQuote(customerId, input);
  if (!Number.isSafeInteger(quote.totals.totalCents) || quote.totals.totalCents < 50 || quote.totals.totalCents > 99_999_999) {
    throw new PaymentError(422, "PAYMENT_AMOUNT_UNSUPPORTED", "Card payments must be between $0.50 and $999,999.99.");
  }
  if (!attempt) {
    attempt = await deps.reserve({ customer_id: customerId, cart_id: quote.cartId, address_id: quote.addressId,
      idempotency_key: scopedKey, request_hash: requestHash, checkout_snapshot: quote,
      subtotal_cents: quote.totals.subtotalCents, delivery_fee_cents: quote.totals.deliveryFeeCents,
      tax_cents: quote.totals.taxCents, total_cents: quote.totals.totalCents });
  }
  // A concurrent request may have won the insert. Validate the returned attempt too.
  checkRequest();
  if (canonical(attempt.checkout_snapshot) !== canonical(quote)) {
    throw new PaymentError(409, "CHECKOUT_CHANGED", "Your checkout changed after payment started. Review it before continuing.");
  }
  if (attempt.status !== "PENDING") {
    return resumeAttempt(attempt, deps, false);
  }
  return resumeAttempt(attempt, deps, true);
}

async function resumeAttempt(attempt: PaymentAttempt, deps: PaymentDependencies, allowConfirmation: boolean) {
  if (!allowConfirmation && !attempt.provider_payment_id) {
    throw new PaymentError(409, "PAYMENT_RECONCILIATION_REQUIRED", "This payment needs reconciliation before it can be retried.");
  }
  if (!attempt.provider_payment_id && Date.now() - Date.parse(attempt.created_at) >= 23 * 3600_000) {
    // Stripe can prune keys after 24 hours. An uncertain old attempt needs reconciliation.
    throw new PaymentError(409, "PAYMENT_RECONCILIATION_REQUIRED", "This payment needs reconciliation before it can be retried.");
  }
  let intent: ProviderIntent;
  try {
    intent = attempt.provider_payment_id ? await deps.retrieve(attempt.provider_payment_id)
      : await deps.create({ attemptId: attempt.id, totalCents: attempt.total_cents });
  } catch {
    // Keep PENDING on uncertain failures; marking failed could allow a duplicate charge.
    throw new PaymentError(503, "PAYMENT_PROVIDER_UNAVAILABLE", "Payment is temporarily unavailable. Retry with the same idempotency key.");
  }
  if (intent.livemode || intent.amount !== attempt.total_cents || intent.currency !== "usd"
    || intent.capture_method !== "manual" || intent.metadata.attemptId !== attempt.id
    || (attempt.provider_payment_id && intent.id !== attempt.provider_payment_id)) {
    throw new PaymentError(502, "PAYMENT_PROVIDER_MISMATCH", "The payment provider returned an inconsistent payment.");
  }
  await deps.attach(attempt.customer_id, attempt.id, intent.id);
  const confirmable = allowConfirmation && ["requires_payment_method", "requires_confirmation", "requires_action"].includes(intent.status);
  if (confirmable && !intent.client_secret) {
    throw new PaymentError(502, "PAYMENT_PROVIDER_MISMATCH", "The payment provider did not return confirmation details.");
  }
  return { attemptId: attempt.id, paymentIntentId: intent.id,
    clientSecret: confirmable ? intent.client_secret : null, status: intent.status };
}
