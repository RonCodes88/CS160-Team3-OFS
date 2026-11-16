import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import { getOrderSummary, listCustomerOrders } from "@/lib/orders/read";

const ORDER_ID = "3f1c2b8e-9a4d-4e2f-8b1a-0c9d7e6f5a41";

/** Fakes db.from(table).select(cols).eq(col, value).maybeSingle(). */
function clientReturning(result: unknown) {
  const maybeSingle = vi.fn(async () => result);
  const eq = vi.fn(() => ({ maybeSingle }));
  const select = vi.fn(() => ({ eq }));
  const from = vi.fn(() => ({ select }));
  return { db: { from } as unknown as SupabaseClient, from, select, eq };
}

const ROW = {
  id: ORDER_ID,
  subtotal_cents: 898,
  delivery_fee_cents: 1000,
  tax_cents: 0,
  total_cents: 1898,
  delivery_address: { line_1: "211 S 1st St", city: "San Jose", state: "CA", postal_code: "95113" },
  order_items: [
    { product_name: "Whole Milk", quantity: 2, unit_price_cents: 449 },
    { product_name: "Bananas", quantity: 1, unit_price_cents: 0 },
  ],
};

describe("getOrderSummary", () => {
  it("returns the order's totals, address, and item snapshots", async () => {
    const { db, from, select, eq } = clientReturning({ data: ROW, error: null });

    expect(await getOrderSummary(db, ORDER_ID)).toEqual({
      id: ORDER_ID,
      subtotalCents: 898,
      deliveryFeeCents: 1000,
      taxCents: 0,
      totalCents: 1898,
      deliveryAddress: ROW.delivery_address,
      items: [
        { productName: "Whole Milk", quantity: 2, unitPriceCents: 449 },
        { productName: "Bananas", quantity: 1, unitPriceCents: 0 },
      ],
    });
    expect(from).toHaveBeenCalledWith("orders");
    expect(select).toHaveBeenCalledWith(expect.stringContaining("order_items(product_name, quantity, unit_price_cents)"));
    expect(eq).toHaveBeenCalledWith("id", ORDER_ID);
  });

  it("uses an empty address when the snapshot is missing", async () => {
    const { db } = clientReturning({ data: { ...ROW, delivery_address: null, order_items: [] }, error: null });
    expect(await getOrderSummary(db, ORDER_ID)).toMatchObject({ deliveryAddress: {}, items: [] });
  });

  it("returns null when the order does not exist", async () => {
    const { db } = clientReturning({ data: null, error: null });
    expect(await getOrderSummary(db, ORDER_ID)).toBeNull();
  });

  it("throws with the order ID when the query fails", async () => {
    const { db } = clientReturning({ data: null, error: { message: "permission denied" } });
    await expect(getOrderSummary(db, ORDER_ID)).rejects.toThrow(
      `loading order ${ORDER_ID} failed: permission denied`,
    );
  });
});

describe("listCustomerOrders", () => {
  function listClient(result: unknown) {
    const limit = vi.fn(async () => result);
    const order = vi.fn(() => ({ limit }));
    const eq = vi.fn(() => ({ order }));
    const select = vi.fn(() => ({ eq }));
    const from = vi.fn(() => ({ select }));
    return { db: { from } as unknown as SupabaseClient, eq, order, limit };
  }

  it("lists only the given customer's orders, newest first, with item counts", async () => {
    const { db, eq, order, limit } = listClient({
      data: [
        { id: "o2", status: "OUT_FOR_DELIVERY", total_cents: 1898, paid_at: "2026-11-15T20:00:00Z", order_items: [{ quantity: 2 }, { quantity: 1 }] },
        { id: "o1", status: "DELIVERED", total_cents: 499, paid_at: null, order_items: [] },
      ],
      error: null,
    });

    expect(await listCustomerOrders(db, "customer-1", 5)).toEqual([
      { id: "o2", status: "OUT_FOR_DELIVERY", totalCents: 1898, paidAt: "2026-11-15T20:00:00Z", itemCount: 3 },
      { id: "o1", status: "DELIVERED", totalCents: 499, paidAt: null, itemCount: 0 },
    ]);
    expect(eq).toHaveBeenCalledWith("customer_id", "customer-1");
    expect(order).toHaveBeenCalledWith("created_at", { ascending: false });
    expect(limit).toHaveBeenCalledWith(5);
  });

  it("throws when the database fails", async () => {
    const { db } = listClient({ data: null, error: { message: "down" } });
    await expect(listCustomerOrders(db, "customer-1")).rejects.toThrow("down");
  });
});
