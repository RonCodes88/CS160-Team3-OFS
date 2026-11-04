import { describe, expect, it } from "vitest";
import type { AuditEntry } from "@/lib/audit/log";
import { describeChanges, formatAuditTime } from "./auditFormat";

const entry = (overrides: Partial<AuditEntry>): AuditEntry => ({
  id: "a1",
  action: "PRODUCT_UPDATE",
  productId: "p1",
  productSku: "MILK-1",
  productName: "Whole Milk",
  actorUserId: "u1",
  actorEmail: "manager.test@ofs.local",
  oldValue: null,
  newValue: {},
  createdAt: "2026-10-28T22:04:00Z",
  ...overrides,
});

describe("describeChanges", () => {
  it("shows a stock change", () => {
    const lines = describeChanges(
      entry({ action: "INVENTORY_SET_QUANTITY", oldValue: { stock_quantity: 12 }, newValue: { stock_quantity: 5 } }),
    );
    expect(lines).toEqual(["Stock: 12 → 5"]);
  });

  it("formats money, weight, and category names on an edit", () => {
    const lines = describeChanges(
      entry({
        oldValue: { price_cents: 499, unit_weight: 860, category_id: "c1" },
        newValue: { price_cents: 525, unit_weight: 2000, category_id: "c2" },
      }),
      { c1: "Dairy", c2: "Pantry" },
    );
    expect(lines).toEqual(["Price: $4.99 → $5.25", "Weight: 8.60 lb → 20.00 lb", "Category: Dairy → Pantry"]);
  });

  it("shows cleared values and shortens long text", () => {
    const lines = describeChanges(
      entry({ oldValue: { image_url: "https://example.com/a.png", description: "" }, newValue: { image_url: null, description: "x".repeat(80) } }),
    );
    expect(lines[0]).toBe("Image URL: https://example.com/a.png → (none)");
    expect(lines[1]).toMatch(/^Description: \(none\) → x{59}…$/);
  });

  it("shows a retirement as active yes → no", () => {
    const lines = describeChanges(
      entry({ action: "PRODUCT_RETIRE", oldValue: { is_active: true }, newValue: { is_active: false } }),
    );
    expect(lines).toEqual(["Active: yes → no"]);
  });

  it("summarizes a new product by price, weight, and starting stock", () => {
    const lines = describeChanges(
      entry({
        action: "PRODUCT_CREATE",
        newValue: { id: "p1", sku: "MILK-1", name: "Whole Milk", price_cents: 499, unit_weight: 860, stock_quantity: 40 },
      }),
    );
    expect(lines).toEqual(["Price: $4.99", "Weight: 8.60 lb", "Stock: 40"]);
  });

  it("falls back to the column name and the raw value for unknown data", () => {
    expect(describeChanges(entry({ oldValue: "bad", newValue: { extra: { a: 1 } } }))).toEqual([
      'extra: (none) → {"a":1}',
    ]);
  });
});

describe("formatAuditTime", () => {
  it("shows the time in San Jose", () => {
    expect(formatAuditTime("2026-10-28T22:04:00Z")).toBe("Oct 28, 2026, 3:04 PM");
  });
});
