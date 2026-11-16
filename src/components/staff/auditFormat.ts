// Turns audit_log rows into readable lines for the manager's audit view.
// old_value/new_value hold product columns by their database names.

import type { AuditAction, AuditEntry } from "@/lib/audit/log";
import { formatCents, formatWeight } from "@/lib/cart/format";

export const ACTION_LABELS: Record<AuditAction, string> = {
  INVENTORY_SET_QUANTITY: "Stock set",
  PRODUCT_CREATE: "Product created",
  PRODUCT_UPDATE: "Product edited",
  PRODUCT_RETIRE: "Product retired",
  PRODUCT_REACTIVATE: "Product reactivated",
};

const FIELD_LABELS: Record<string, string> = {
  stock_quantity: "Stock",
  sku: "SKU",
  name: "Name",
  category_id: "Category",
  description: "Description",
  image_url: "Image URL",
  price_cents: "Price",
  unit_weight: "Weight",
  is_active: "Active",
};

const MAX_TEXT = 60;

function formatValue(column: string, value: unknown, categoryNames: Record<string, string>): string {
  if (value === null || value === undefined || value === "") return "(none)";
  if (column === "price_cents" && typeof value === "number") return formatCents(value);
  if (column === "unit_weight" && typeof value === "number") return formatWeight(value);
  if (column === "category_id" && typeof value === "string") return categoryNames[value] ?? value;
  if (typeof value === "boolean") return value ? "yes" : "no";
  const text = typeof value === "string" ? value : JSON.stringify(value);
  return text.length > MAX_TEXT ? `${text.slice(0, MAX_TEXT - 1)}…` : text;
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

/** One line per changed field, e.g. "Price: $1.00 → $1.25". */
export function describeChanges(entry: AuditEntry, categoryNames: Record<string, string> = {}): string[] {
  const after = asRecord(entry.newValue);
  if (entry.action === "PRODUCT_CREATE") {
    const shown = ["price_cents", "unit_weight", "stock_quantity"].filter((column) => column in after);
    return shown.map(
      (column) => `${FIELD_LABELS[column]}: ${formatValue(column, after[column], categoryNames)}`,
    );
  }
  const before = asRecord(entry.oldValue);
  return Object.keys(after).map((column) => {
    const label = FIELD_LABELS[column] ?? column;
    return `${label}: ${formatValue(column, before[column], categoryNames)} → ${formatValue(column, after[column], categoryNames)}`;
  });
}

/** "Oct 28, 2026, 3:04 PM" in the store's time zone. */
export function formatAuditTime(iso: string): string {
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "America/Los_Angeles",
  }).format(new Date(iso));
}
