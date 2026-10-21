import { beforeEach, describe, expect, it, vi } from "vitest";
import type { OrderSummary } from "@/lib/notifications/messages";
import type { NotificationSender } from "@/lib/notifications/sender";
import { processPendingNotifications } from "@/lib/notifications/service";
import type { ClaimedNotification, NotificationStore } from "@/lib/notifications/store";

const ORDER: OrderSummary = {
  id: "3f1c2b8e-9a4d-4e2f-8b1a-0c9d7e6f5a41",
  subtotalCents: 500,
  deliveryFeeCents: 0,
  taxCents: 0,
  totalCents: 500,
  deliveryAddress: { line_1: "1 Main St", city: "San Jose", state: "CA", postal_code: "95113" },
  items: [{ productName: "Bananas", quantity: 1, unitPriceCents: 500 }],
};

function claimed(id: string, overrides: Partial<ClaimedNotification> = {}): ClaimedNotification {
  return {
    id,
    orderId: ORDER.id,
    type: "ORDER_CONFIRMED",
    recipientEmail: `${id}@example.com`,
    payload: {},
    attempts: 1,
    ...overrides,
  };
}

function fakeStore(batch: ClaimedNotification[]) {
  return {
    claim: vi.fn(async () => batch),
    loadOrder: vi.fn(async () => ORDER as OrderSummary | null),
    markSent: vi.fn(async () => {}),
    markFailed: vi.fn(async () => {}),
  } satisfies NotificationStore;
}

let sender: NotificationSender & { send: ReturnType<typeof vi.fn> };

beforeEach(() => {
  sender = { send: vi.fn(async () => {}) };
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("processPendingNotifications", () => {
  it("sends each claimed notification to its recipient and marks it sent", async () => {
    const store = fakeStore([claimed("a"), claimed("b")]);

    const result = await processPendingNotifications(store, sender, { limit: 5 });

    expect(store.claim).toHaveBeenCalledWith(5);
    expect(sender.send).toHaveBeenCalledTimes(2);
    expect(sender.send).toHaveBeenCalledWith({
      to: "a@example.com",
      subject: "Order #3F1C2B8E confirmed",
      text: expect.stringContaining("1 × Bananas"),
    });
    expect(store.markSent).toHaveBeenCalledWith("a");
    expect(store.markSent).toHaveBeenCalledWith("b");
    expect(result).toEqual({ sent: 2, failed: 0 });
  });

  it("marks a failed send FAILED with the reason and keeps going", async () => {
    const store = fakeStore([claimed("a"), claimed("b")]);
    sender.send.mockRejectedValueOnce(new Error("SMTP timeout"));

    const result = await processPendingNotifications(store, sender);

    expect(store.markFailed).toHaveBeenCalledWith("a", "SMTP timeout");
    expect(store.markSent).toHaveBeenCalledWith("b");
    expect(store.markSent).not.toHaveBeenCalledWith("a");
    expect(result).toEqual({ sent: 1, failed: 1 });
  });

  it("fails a notification whose order is missing without sending it", async () => {
    const store = fakeStore([claimed("a")]);
    store.loadOrder.mockResolvedValueOnce(null);

    const result = await processPendingNotifications(store, sender);

    expect(sender.send).not.toHaveBeenCalled();
    expect(store.markFailed).toHaveBeenCalledWith("a", expect.stringContaining("not found"));
    expect(result).toEqual({ sent: 0, failed: 1 });
  });

  it("does not throw if recording the failure also fails", async () => {
    const store = fakeStore([claimed("a"), claimed("b")]);
    sender.send.mockRejectedValueOnce(new Error("down"));
    store.markFailed.mockRejectedValueOnce(new Error("db down"));

    await expect(processPendingNotifications(store, sender)).resolves.toEqual({ sent: 1, failed: 1 });
  });

  it("uses the payload saved with the notification", async () => {
    const store = fakeStore([
      claimed("a", { type: "DELIVERY_UPDATE", payload: { reason: "ARRIVED" } }),
    ]);

    await processPendingNotifications(store, sender);

    expect(sender.send.mock.calls[0][0].subject).toBe("Your robot has arrived with order #3F1C2B8E");
  });

  it("does nothing when the queue is empty", async () => {
    const store = fakeStore([]);
    expect(await processPendingNotifications(store, sender)).toEqual({ sent: 0, failed: 0 });
    expect(sender.send).not.toHaveBeenCalled();
  });
});
