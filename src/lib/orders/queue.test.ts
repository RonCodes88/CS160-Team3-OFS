import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import { getPendingDeliveryOrders } from "./queue";

function client(data: unknown, error: unknown = null) {
  const rpc = vi.fn().mockResolvedValue({ data, error });
  return { db: { rpc } as unknown as SupabaseClient, rpc };
}

describe("pending delivery queue", () => {
  it("maps checkout snapshots into the batching contract without repricing or geocoding", async () => {
    const { db } = client([{ order_id: "order", paid_at: "2026-11-04T12:00:00Z",
      total_weight: 19999, latitude: 37.3352, longitude: -121.8811 }]);
    expect(await getPendingDeliveryOrders(db)).toEqual([{
      orderId: "order", paidAt: new Date("2026-11-04T12:00:00Z"),
      totalWeight: 19999, location: { lat: 37.3352, lng: -121.8811 },
    }]);
  });

  it("returns an empty queue when no orders are waiting", async () => {
    expect(await getPendingDeliveryOrders(client([]).db)).toEqual([]);
  });

  it("surfaces database failure instead of pretending the queue is empty", async () => {
    await expect(getPendingDeliveryOrders(client(null, { message: "unavailable" }).db))
      .rejects.toThrow("unavailable");
  });
});
