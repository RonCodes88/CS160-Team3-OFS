import { describe, expect, it, vi } from "vitest";
import { reconcilePayments, type RecoveryAttempt, type RecoveryDependencies } from "./recovery";
import { PaymentError } from "./service";
const attempt: RecoveryAttempt = {
  id: "attempt",
  customer_id: "customer",
  provider_payment_id: "pi_saved",
  recovery_token: "lease",
  recovery_attempts: 1
};
function fixture(change: Partial<RecoveryAttempt> = {}) {
  const deps: RecoveryDependencies = {
    claim: vi.fn(async () => [{
        ...attempt, ...change
      }]),
    recoverProviderLink: vi.fn(async () => { }),
    finalize: vi.fn(async () => ({
      attemptId: "attempt",
      status: "CAPTURED",
      orderId: "order"
    })),
    finish: vi.fn(async () => { })
  };
  return {
    deps,
    run: () => reconcilePayments(deps)
  };
}
describe("scheduled payment reconciliation", () => {
  it("uses the shared finalizer for an existing intent and records success", async () => {
    const f = fixture();
    expect(await f.run()).toEqual({
      completed: 1,
      waiting: 0,
      failed: 0
    });
    expect(f.deps.finalize).toHaveBeenCalledWith("attempt", "customer");
    expect(f.deps.recoverProviderLink).not.toHaveBeenCalled();
    expect(f.deps.finish).toHaveBeenCalledWith(expect.anything(), "COMPLETED", null);
  });
  it("recovers an unlinked provider intent before finalizing without creating another charge", async () => {
    const f = fixture({ provider_payment_id: null });
    await f.run();
    expect(f.deps.recoverProviderLink).toHaveBeenCalled();
    expect(vi.mocked(f.deps.recoverProviderLink).mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(f.deps.finalize).mock.invocationCallOrder[0]);
  });
  it("keeps an unpaid payment waiting without consuming its failure budget", async () => {
    const f = fixture();
    vi.mocked(f.deps.finalize).mockResolvedValue({
      attemptId: "attempt",
      status: "PENDING"
    });
    expect(await f.run()).toMatchObject({ waiting: 1 });
    expect(f.deps.finish).toHaveBeenCalledWith(expect.anything(), "WAITING", null);
  });
  it("records only safe error codes and continues after an uncertain failure", async () => {
    const f = fixture();
    vi.mocked(f.deps.claim).mockResolvedValue([attempt, {
        ...attempt,
        id: "second"
      }]);
    vi.mocked(f.deps.finalize).mockRejectedValueOnce(new Error("secret provider response"));
    expect(await f.run()).toEqual({
      completed: 1,
      waiting: 0,
      failed: 1
    });
    expect(f.deps.finish).toHaveBeenCalledWith(attempt, "FAILED", "RECOVERY_UNAVAILABLE");
  });
  it("records known retry/reconciliation failures without leaking messages", async () => {
    const f = fixture({ provider_payment_id: null });
    vi.mocked(f.deps.recoverProviderLink).mockRejectedValue(new PaymentError(503, "PAYMENT_NOT_LINKED", "sensitive"));
    expect(await f.run()).toMatchObject({ failed: 1 });
    expect(f.deps.finish).toHaveBeenCalledWith(expect.anything(), "FAILED", "PAYMENT_NOT_LINKED");
    expect(f.deps.finalize).not.toHaveBeenCalled();
  });
});
