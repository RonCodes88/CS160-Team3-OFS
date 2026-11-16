import { describe, expect, it, vi } from "vitest";
import { cancelPendingPayments, type CancelDependencies } from "./cancel";

function fixture(status = "requires_payment_method", attempts = [{ id: "attempt", provider_payment_id: "pi_test" as string | null }]) {
  const deps: CancelDependencies = {
    listPending: vi.fn(async () => attempts),
    retrieve: vi.fn(async () => ({ status })),
    cancel: vi.fn(async () => {}),
    finalize: vi.fn(async () => ({ status: "VOIDED" })),
    link: vi.fn(async () => "pi_linked"),
  };
  return { deps, run: () => cancelPendingPayments("customer", deps) };
}

describe("cancelPendingPayments", () => {
  it.each(["requires_payment_method", "requires_confirmation", "requires_action"])(
    "cancels an unauthorized %s intent and records it as voided", async (status) => {
      const f = fixture(status);
      expect(await f.run()).toEqual({ canceled: 1 });
      expect(f.deps.listPending).toHaveBeenCalledWith("customer");
      expect(f.deps.cancel).toHaveBeenCalledWith({ id: "attempt", provider_payment_id: "pi_test" });
      expect(vi.mocked(f.deps.cancel).mock.invocationCallOrder[0])
        .toBeLessThan(vi.mocked(f.deps.finalize).mock.invocationCallOrder[0]);
      expect(f.deps.finalize).toHaveBeenCalledWith("attempt", "customer");
    });

  it("only records an intent Stripe already canceled", async () => {
    const f = fixture("canceled");
    expect(await f.run()).toEqual({ canceled: 1 });
    expect(f.deps.cancel).not.toHaveBeenCalled();
  });

  it.each(["requires_capture", "processing", "succeeded"])("never cancels an authorized %s payment", async (status) => {
    const f = fixture(status);
    await expect(f.run()).rejects.toMatchObject({ status: 409, code: "PAYMENT_ALREADY_AUTHORIZED" });
    expect(f.deps.cancel).not.toHaveBeenCalled();
    expect(f.deps.finalize).not.toHaveBeenCalled();
  });

  it("links an attempt that never got a Stripe payment, then cancels it so the cart is freed", async () => {
    const f = fixture("requires_payment_method", [{ id: "attempt", provider_payment_id: null }]);
    expect(await f.run()).toEqual({ canceled: 1 });
    expect(f.deps.link).toHaveBeenCalledWith({ id: "attempt", provider_payment_id: null });
    expect(f.deps.retrieve).toHaveBeenCalledWith("pi_linked");
    expect(f.deps.cancel).toHaveBeenCalledWith({ id: "attempt", provider_payment_id: "pi_linked" });
  });

  it("does not link attempts that already have a Stripe payment", async () => {
    const f = fixture();
    await f.run();
    expect(f.deps.link).not.toHaveBeenCalled();
  });

  it("leaves the attempt alone when the provider link fails", async () => {
    const f = fixture("requires_payment_method", [{ id: "attempt", provider_payment_id: null }]);
    vi.mocked(f.deps.link).mockRejectedValue(new Error("stripe down"));
    await expect(f.run()).rejects.toThrow("stripe down");
    expect(f.deps.cancel).not.toHaveBeenCalled();
    expect(f.deps.finalize).not.toHaveBeenCalled();
  });

  it("fails when finalization did not record the void", async () => {
    const f = fixture();
    vi.mocked(f.deps.finalize).mockResolvedValue({ status: "PENDING" });
    await expect(f.run()).rejects.toMatchObject({ status: 503 });
  });

  it("does nothing without pending payments and requires a customer", async () => {
    expect(await fixture("x", []).run()).toEqual({ canceled: 0 });
    await expect(cancelPendingPayments("", fixture().deps)).rejects.toThrow();
  });
});
