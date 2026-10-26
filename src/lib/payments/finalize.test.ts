import { describe, expect, it, vi } from "vitest";
import { finalizePayment, type FinalizationDependencies, type FinalizationAttempt } from "./finalize";
import { PaymentError } from "./service";

function fixture() {
  let attempt = { id: "attempt", customer_id: "customer", provider_payment_id: "pi_test", total_cents: 525,
    finalize_step: "READY", status: "PENDING", order_id: null, failure_code: null } as FinalizationAttempt;
  const intent = { id: "pi_test", amount: 525, amount_received: 0, amount_capturable: 525, currency: "usd",
    livemode: false, capture_method: "manual", status: "requires_capture", metadata: { attemptId: "attempt" } };
  const deps: FinalizationDependencies = {
    claim: vi.fn(async () => attempt), release: vi.fn(async () => {}),
    advance: vi.fn(async (_id, _token, step, details) => attempt = { ...attempt, finalize_step: step,
      failure_code: details?.failureCode ?? attempt.failure_code, status: details?.status ?? attempt.status }),
    verifyQuote: vi.fn(async () => {}), retrieve: vi.fn(async () => ({ ...intent })),
    capture: vi.fn(async () => ({ ...intent, status: "succeeded", amount_received: 525, amount_capturable: 0 })),
    cancel: vi.fn(async () => {}), refund: vi.fn(async () => "re_test"),
    createOrder: vi.fn(async () => "order"),
  };
  return { deps, intent, set: (data: Partial<FinalizationAttempt>) => { attempt = { ...attempt, ...data }; },
    run: () => finalizePayment("attempt", "customer", deps) };
}

describe("shared payment finalizer", () => {
  it("captures before creating an order and releases its processing claim", async () => {
    const f = fixture(); expect(await f.run()).toEqual({ attemptId: "attempt", status: "CAPTURED", orderId: "order" });
    expect(vi.mocked(f.deps.verifyQuote).mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(f.deps.capture).mock.invocationCallOrder[0]);
    expect(vi.mocked(f.deps.capture).mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(f.deps.createOrder).mock.invocationCallOrder[0]);
    expect(f.deps.release).toHaveBeenCalled();
  });
  it("returns a completed order without contacting Stripe", async () => {
    const f = fixture(); f.set({ finalize_step: "DONE", status: "CAPTURED", order_id: "existing" });
    expect(await f.run()).toMatchObject({ orderId: "existing" }); expect(f.deps.retrieve).not.toHaveBeenCalled();
  });
  it.each(["requires_action", "requires_payment_method", "processing"])("does not create orders for %s", async (status) => {
    const f = fixture(); f.intent.status = status;
    expect(await f.run()).toMatchObject({ status: "PENDING", providerStatus: status });
    expect(f.deps.capture).not.toHaveBeenCalled(); expect(f.deps.createOrder).not.toHaveBeenCalled();
  });
  it("voids an authorization when pre-capture validation rejects checkout", async () => {
    const f = fixture(); vi.mocked(f.deps.verifyQuote).mockRejectedValue(new PaymentError(409, "INSUFFICIENT_STOCK", "Stock changed."));
    expect(await f.run()).toMatchObject({ status: "VOIDED", failureCode: "INSUFFICIENT_STOCK" });
    expect(f.deps.cancel).toHaveBeenCalled(); expect(f.deps.capture).not.toHaveBeenCalled();
  });
  it("refunds a confirmed order rejection after capture", async () => {
    const f = fixture(); vi.mocked(f.deps.createOrder).mockRejectedValue(new PaymentError(409, "CHECKOUT_CHANGED", "Changed."));
    expect(await f.run()).toMatchObject({ status: "REFUNDED", failureCode: "CHECKOUT_CHANGED" });
    expect(f.deps.refund).toHaveBeenCalled();
  });
  it("does not refund on an uncertain order-transaction outcome", async () => {
    const f = fixture(); vi.mocked(f.deps.createOrder).mockRejectedValue(new Error("connection lost"));
    await expect(f.run()).rejects.toThrow(); expect(f.deps.refund).not.toHaveBeenCalled();
    expect(f.deps.release).toHaveBeenCalled();
  });
  it("recovers a committed order whose response was lost without refunding", async () => {
    const f=fixture(); vi.mocked(f.deps.createOrder).mockImplementationOnce(async()=>{
      f.set({ finalize_step:"DONE",status:"CAPTURED",order_id:"committed" }); throw new Error("response lost");
    });
    await expect(f.run()).rejects.toThrow();
    expect(await f.run()).toMatchObject({ orderId:"committed" });
    expect(f.deps.refund).not.toHaveBeenCalled(); expect(f.deps.capture).toHaveBeenCalledTimes(1);
  });
  it("resumes after capture without capturing a second time", async () => {
    const f = fixture(); f.set({ finalize_step: "CAPTURE_PENDING" });
    f.intent.status = "succeeded"; f.intent.amount_received = 525;
    expect(await f.run()).toMatchObject({ orderId: "order" }); expect(f.deps.capture).not.toHaveBeenCalled();
  });
  it("resumes a persisted refund without attempting order creation", async () => {
    const f = fixture(); f.set({ finalize_step: "REFUND_PENDING", failure_code: "CHECKOUT_CHANGED" });
    f.intent.status = "succeeded"; f.intent.amount_received = 525;
    expect(await f.run()).toMatchObject({ status: "REFUNDED" }); expect(f.deps.createOrder).not.toHaveBeenCalled();
  });
  it("does not turn a configuration failure into a refund or cancellation", async () => {
    const f = fixture(); vi.mocked(f.deps.verifyQuote).mockRejectedValue(new Error("config missing"));
    await expect(f.run()).rejects.toThrow(); expect(f.deps.cancel).not.toHaveBeenCalled();
  });
  it.each([{ amount: 100 }, { livemode: true }, { currency: "eur" }, { metadata: { attemptId: "other" } }])(
    "rejects provider mismatch %j", async (change) => {
      const f = fixture(); Object.assign(f.intent, change);
      await expect(f.run()).rejects.toMatchObject({ code: "PAYMENT_PROVIDER_MISMATCH" });
      expect(f.deps.capture).not.toHaveBeenCalled(); expect(f.deps.createOrder).not.toHaveBeenCalled();
    },
  );
  it("does not create an order after an incomplete capture", async () => {
    const f = fixture(); vi.mocked(f.deps.capture).mockResolvedValue({ ...f.intent, status: "processing" });
    await expect(f.run()).rejects.toMatchObject({ code: "PAYMENT_NOT_CAPTURED" });
    expect(f.deps.createOrder).not.toHaveBeenCalled();
  });
  it("returns retryable contention without performing provider calls", async () => {
    const f = fixture(); vi.mocked(f.deps.claim).mockRejectedValue(new PaymentError(503, "PAYMENT_BUSY", "Retry."));
    await expect(f.run()).rejects.toMatchObject({ code: "PAYMENT_BUSY" }); expect(f.deps.retrieve).not.toHaveBeenCalled();
  });
});
