// Browser side of the checkout API. Every amount shown comes from the server;
// the expected totals sent back are only a "this is what I reviewed" snapshot
// that the server compares with its own numbers.

import type { SavedAddress } from "@/lib/auth/addresses";

export type { SavedAddress };
export { formatAddressLine as formatAddress } from "@/lib/auth/addressValidation";

/** Integer cents and hundredths of a pound, exactly as the server priced them. */
export type CheckoutTotals = {
  subtotalCents: number;
  totalWeight: number;
  deliveryFeeCents: number;
  taxCents: number;
  totalCents: number;
};

export type CheckoutPreview = CheckoutTotals & { feeWarning: boolean };

export type ApiError = { code: string; message: string };

type Fetch = typeof fetch;

const EMPTY_EXPECTED: CheckoutTotals = {
  subtotalCents: 0, totalWeight: 0, deliveryFeeCents: 0, taxCents: 0, totalCents: 0,
};

const TOTAL_FIELDS = ["subtotalCents", "totalWeight", "deliveryFeeCents", "taxCents", "totalCents"] as const;

export function totalsOf(preview: CheckoutTotals): CheckoutTotals {
  return Object.fromEntries(TOTAL_FIELDS.map((key) => [key, preview[key]])) as CheckoutTotals;
}

async function readJson(response: Response): Promise<Record<string, unknown>> {
  try {
    const body: unknown = await response.json();
    return typeof body === "object" && body !== null ? (body as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function errorOf(body: Record<string, unknown>, fallback: string): ApiError {
  const error = body.error as Partial<ApiError> | undefined;
  return { code: error?.code ?? "UNKNOWN", message: error?.message ?? fallback };
}

function postJson(fetcher: Fetch, url: string, body: unknown, headers: Record<string, string> = {}) {
  return fetcher(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
    cache: "no-store",
  });
}

export type PreviewResult = { ok: true; preview: CheckoutPreview } | { ok: false; error: ApiError };

/**
 * Asks the server to price the cart for an address. A first look has nothing
 * to compare against, so a totals mismatch that carries the server's current
 * totals is the expected answer and is returned as the preview.
 */
export async function fetchPreview(addressId: string, fetcher: Fetch = fetch): Promise<PreviewResult> {
  const response = await postJson(fetcher, "/api/checkout/preview", { addressId, expected: EMPTY_EXPECTED });
  const body = await readJson(response);
  if (response.ok) return { ok: true, preview: body as unknown as CheckoutPreview };
  const current = body.current as CheckoutPreview | undefined;
  if (response.status === 409 && errorOf(body, "").code === "TOTALS_MISMATCH" && current) {
    return { ok: true, preview: current };
  }
  return { ok: false, error: errorOf(body, "We couldn't review your order. Please try again.") };
}

export type SaveAddressResult = { ok: true; address: SavedAddress } | { ok: false; error: ApiError };

export async function saveAddress(input: Record<string, string>, fetcher: Fetch = fetch): Promise<SaveAddressResult> {
  const response = await postJson(fetcher, "/api/addresses", input);
  const body = await readJson(response);
  if (response.ok) return { ok: true, address: body.address as SavedAddress };
  return { ok: false, error: errorOf(body, "We couldn't save that address. Please try again.") };
}

/** What the browser keeps so a reload resumes the same payment instead of starting a second one. */
export type PaymentSession = {
  key: string;
  addressId: string;
  expected: CheckoutTotals;
};

export type StartPaymentResult =
  | { ok: true; attemptId: string; clientSecret: string | null; status: string }
  | { ok: false; error: ApiError; current?: CheckoutPreview };

/** Same key and body return the same payment attempt, so retries never double-charge. */
export async function startPayment(session: PaymentSession, fetcher: Fetch = fetch): Promise<StartPaymentResult> {
  const response = await postJson(fetcher, "/api/checkout/payment-intent",
    { addressId: session.addressId, expected: session.expected }, { "Idempotency-Key": session.key });
  const body = await readJson(response);
  if (response.ok) {
    return { ok: true, attemptId: String(body.attemptId), clientSecret: (body.clientSecret as string | null) ?? null,
      status: String(body.status) };
  }
  return { ok: false, error: errorOf(body, "Payment could not be prepared. Please try again."),
    ...(body.current ? { current: body.current as CheckoutPreview } : {}) };
}

export type ConfirmOutcome =
  | { kind: "placed"; orderId: string }
  /** Still processing on Stripe's side or busy on ours; ask again shortly. */
  | { kind: "pending" }
  /** The card was declined. The same payment form can be used to try again. */
  | { kind: "declined"; message: string }
  /** Money was released or refunded because the checkout changed; review and start over. */
  | { kind: "rejected"; status: string; code: string }
  | { kind: "error"; message: string };

export async function confirmPayment(attemptId: string, key: string, fetcher: Fetch = fetch): Promise<ConfirmOutcome> {
  let response: Response;
  try {
    response = await postJson(fetcher, "/api/checkout/confirm", { attemptId }, { "Idempotency-Key": key });
  } catch {
    return { kind: "pending" };
  }
  const body = await readJson(response);
  if (response.status === 200 && typeof body.orderId === "string") return { kind: "placed", orderId: body.orderId };
  if (response.status === 202 || response.status === 503) return { kind: "pending" };
  if (response.status === 422) {
    const code = errorOf(body, "").code;
    if (body.status === "PENDING" && code === "PAYMENT_DECLINED") {
      return { kind: "declined", message: "Your card was declined. Try another card." };
    }
    return { kind: "rejected", status: String(body.status ?? ""), code };
  }
  return { kind: "error", message: errorOf(body, "We couldn't confirm your payment.").message };
}

/** Plain-language reason for an order that could not be placed after payment. */
export function rejectionMessage(outcome: { status: string; code: string }): string {
  const reasons: Record<string, string> = {
    INSUFFICIENT_STOCK: "an item sold out",
    PRODUCT_UNAVAILABLE: "an item is no longer available",
    ADDRESS_INVALID: "the delivery address is no longer eligible",
    CART_OVERWEIGHT: "the cart is over the weight limit",
    CART_UNAVAILABLE: "your cart changed",
    CART_EMPTY: "your cart is empty",
    CHECKOUT_CHANGED: "your cart or prices changed",
    TOTALS_MISMATCH: "your totals changed",
    PAYMENT_CANCELED: "the payment was canceled",
  };
  const reason = reasons[outcome.code] ?? "your checkout changed";
  const money = outcome.status === "REFUNDED"
    ? "Your payment was refunded."
    : "Your card was not charged.";
  return `We couldn't place your order because ${reason}. ${money} Review your order and try again.`;
}

export async function cancelPayment(fetcher: Fetch = fetch): Promise<{ ok: true } | { ok: false; error: ApiError }> {
  const response = await postJson(fetcher, "/api/checkout/cancel", {});
  if (response.ok) return { ok: true };
  return { ok: false, error: errorOf(await readJson(response), "We couldn't cancel the earlier payment.") };
}

const STORAGE_KEY = "ofs:checkout-payment";

/** Storage can be missing or blocked (private windows); checkout still works without it. */
export function loadPaymentSession(storage: Pick<Storage, "getItem"> | undefined = globalThis.localStorage): PaymentSession | null {
  try {
    const value = JSON.parse(storage?.getItem(STORAGE_KEY) ?? "null") as PaymentSession | null;
    if (!value || typeof value.key !== "string" || typeof value.addressId !== "string" || typeof value.expected !== "object") {
      return null;
    }
    return { key: value.key, addressId: value.addressId, expected: totalsOf(value.expected) };
  } catch {
    return null;
  }
}

export function storePaymentSession(session: PaymentSession | null,
  storage: Pick<Storage, "setItem" | "removeItem"> | undefined = globalThis.localStorage): void {
  try {
    if (session) storage?.setItem(STORAGE_KEY, JSON.stringify(session));
    else storage?.removeItem(STORAGE_KEY);
  } catch {
    // Without storage a reload starts over; the server still prevents a double charge.
  }
}

/** Idempotency keys: letters, digits and hyphens, as the payment API requires. */
export function newPaymentKey(): string {
  return globalThis.crypto.randomUUID();
}
