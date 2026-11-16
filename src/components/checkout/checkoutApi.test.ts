import { describe, expect, it, vi } from "vitest";
import {
  cancelPayment,
  confirmPayment,
  fetchPreview,
  loadPaymentSession,
  rejectionMessage,
  saveAddress,
  startPayment,
  storePaymentSession,
  type PaymentSession,
} from "./checkoutApi";

const PREVIEW = { subtotalCents: 1999, totalWeight: 2000, deliveryFeeCents: 1000, taxCents: 100, totalCents: 3099, feeWarning: false };
const TOTALS = { subtotalCents: 1999, totalWeight: 2000, deliveryFeeCents: 1000, taxCents: 100, totalCents: 3099 };
const SESSION: PaymentSession = { key: "key-1", addressId: "addr", expected: TOTALS };

const reply = (body: unknown, status = 200) =>
  vi.fn(async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;
const sent = (fetcher: typeof fetch) => {
  const [url, init] = vi.mocked(fetcher).mock.calls[0] as [string, RequestInit];
  return { url, headers: init.headers as Record<string, string>, body: JSON.parse(String(init.body)) };
};

describe("fetchPreview", () => {
  it("returns the server's totals on success", async () => {
    expect(await fetchPreview("addr", reply(PREVIEW))).toEqual({ ok: true, preview: PREVIEW });
  });

  it("uses the server's current totals when the first look doesn't match", async () => {
    const fetcher = reply({ error: { code: "TOTALS_MISMATCH", message: "changed" }, current: PREVIEW }, 409);
    expect(await fetchPreview("addr", fetcher)).toEqual({ ok: true, preview: PREVIEW });
    expect(sent(fetcher)).toMatchObject({ url: "/api/checkout/preview", body: { addressId: "addr" } });
  });

  it("passes other errors through", async () => {
    const fetcher = reply({ error: { code: "INSUFFICIENT_STOCK", message: "Not enough stock." } }, 409);
    expect(await fetchPreview("addr", fetcher)).toEqual({ ok: false, error: { code: "INSUFFICIENT_STOCK", message: "Not enough stock." } });
  });

  it("has a fallback message for an unreadable error", async () => {
    const fetcher = vi.fn(async () => new Response("oops", { status: 500 })) as unknown as typeof fetch;
    expect(await fetchPreview("addr", fetcher)).toMatchObject({ ok: false, error: { code: "UNKNOWN" } });
  });
});

describe("saveAddress", () => {
  it("returns the saved address or the server's message", async () => {
    expect(await saveAddress({ line1: "x" }, reply({ address: { id: "a" } }, 201))).toEqual({ ok: true, address: { id: "a" } });
    expect(await saveAddress({}, reply({ error: { code: "ADDRESS_OUTSIDE_AREA", message: "Too far." } }, 422)))
      .toEqual({ ok: false, error: { code: "ADDRESS_OUTSIDE_AREA", message: "Too far." } });
  });
});

describe("startPayment", () => {
  it("sends the idempotency key and only the reviewed address and totals", async () => {
    const fetcher = reply({ attemptId: "att", clientSecret: "pi_secret", status: "requires_payment_method" });
    expect(await startPayment(SESSION, fetcher)).toEqual({ ok: true, attemptId: "att", clientSecret: "pi_secret", status: "requires_payment_method" });
    const request = sent(fetcher);
    expect(request.headers["Idempotency-Key"]).toBe("key-1");
    expect(request.body).toEqual({ addressId: "addr", expected: TOTALS });
  });

  it("returns refreshed totals with an error", async () => {
    const fetcher = reply({ error: { code: "TOTALS_MISMATCH", message: "changed" }, current: PREVIEW }, 409);
    expect(await startPayment(SESSION, fetcher)).toEqual({ ok: false, error: { code: "TOTALS_MISMATCH", message: "changed" }, current: PREVIEW });
  });
});

describe("confirmPayment", () => {
  it.each([
    [200, { attemptId: "att", status: "CAPTURED", orderId: "order-1" }, { kind: "placed", orderId: "order-1" }],
    [202, { status: "PENDING" }, { kind: "pending" }],
    [503, { error: { code: "PAYMENT_BUSY" } }, { kind: "pending" }],
    [422, { status: "PENDING", error: { code: "PAYMENT_DECLINED" } }, { kind: "declined", message: expect.stringContaining("declined") }],
    [422, { status: "VOIDED", error: { code: "INSUFFICIENT_STOCK" } }, { kind: "rejected", status: "VOIDED", code: "INSUFFICIENT_STOCK" }],
    [404, { error: { code: "PAYMENT_NOT_FOUND", message: "Payment not found." } }, { kind: "error", message: "Payment not found." }],
  ])("maps HTTP %i to an outcome", async (status, body, outcome) => {
    expect(await confirmPayment("att", "key-1", reply(body, status))).toEqual(outcome);
  });

  it("treats a network failure as still pending, since the payment may have gone through", async () => {
    const offline = vi.fn(async () => { throw new TypeError("offline"); }) as unknown as typeof fetch;
    expect(await confirmPayment("att", "key-1", offline)).toEqual({ kind: "pending" });
  });
});

describe("rejectionMessage", () => {
  it("says whether the customer was charged", () => {
    expect(rejectionMessage({ status: "VOIDED", code: "INSUFFICIENT_STOCK" })).toContain("an item sold out. Your card was not charged.");
    expect(rejectionMessage({ status: "REFUNDED", code: "SOMETHING_NEW" })).toContain("your checkout changed. Your payment was refunded.");
  });
});

describe("cancelPayment", () => {
  it("reports success or the server's error", async () => {
    expect(await cancelPayment(reply({ canceled: 1 }))).toEqual({ ok: true });
    expect(await cancelPayment(reply({ error: { code: "PAYMENT_ALREADY_AUTHORIZED", message: "Finish it." } }, 409)))
      .toEqual({ ok: false, error: { code: "PAYMENT_ALREADY_AUTHORIZED", message: "Finish it." } });
  });
});

describe("payment session storage", () => {
  it("round-trips a session and clears it", () => {
    const data = new Map<string, string>();
    const storage = {
      getItem: (k: string) => data.get(k) ?? null,
      setItem: (k: string, v: string) => void data.set(k, v),
      removeItem: (k: string) => void data.delete(k),
    };
    storePaymentSession(SESSION, storage);
    expect(loadPaymentSession(storage)).toEqual(SESSION);
    storePaymentSession(null, storage);
    expect(loadPaymentSession(storage)).toBeNull();
  });

  it("ignores missing, malformed or blocked storage", () => {
    expect(loadPaymentSession(undefined)).toBeNull();
    expect(loadPaymentSession({ getItem: () => "{not json" })).toBeNull();
    expect(loadPaymentSession({ getItem: () => JSON.stringify({ key: 1 }) })).toBeNull();
    const blocked = { setItem: () => { throw new Error("blocked"); }, removeItem: () => { throw new Error("blocked"); } };
    expect(() => storePaymentSession(SESSION, blocked)).not.toThrow();
  });

  it("works when the browser blocks access to the storage property itself", () => {
    const original = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      get() { throw new Error("Storage disabled"); },
    });
    try {
      expect(() => loadPaymentSession()).not.toThrow();
      expect(loadPaymentSession()).toBeNull();
      expect(() => storePaymentSession(SESSION)).not.toThrow();
      expect(() => storePaymentSession(null)).not.toThrow();
    } finally {
      if (original) Object.defineProperty(globalThis, "localStorage", original);
      else Reflect.deleteProperty(globalThis, "localStorage");
    }
  });
});
