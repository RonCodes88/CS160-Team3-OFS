// Browser calls to the staff and admin APIs. The server checks the role on
// every request, so hiding a button here is only for convenience.

import type { AuditAction, AuditEntry } from "@/lib/audit/log";
import type { InventoryItem } from "@/lib/inventory/service";
import type { Product } from "@/lib/products/service";

export type { AuditAction, AuditEntry, InventoryItem, Product };

export type ApiResult<T> = { ok: true; data: T } | { ok: false; status: number; message: string };

export type InventoryPage = { items: InventoryItem[]; hasMore: boolean };
export type AuditPage = { entries: AuditEntry[]; hasMore: boolean };
export type QuantityChange = { productId: string; oldQuantity: number; newQuantity: number; changed: boolean };
export type ProductChange = { product: Product; changed: boolean };

export const PAGE_SIZE = 25;

const SIGNED_OUT = "Your session has ended. Log in again to keep working.";
const OFFLINE = "Couldn't reach the server. Check your connection and try again.";

/** Sends a request and turns any failure into a message the page can show. */
export async function callApi<T>(url: string, init?: RequestInit): Promise<ApiResult<T>> {
  let response: Response;
  try {
    response = await fetch(url, {
      cache: "no-store",
      ...init,
      headers: init?.body ? { "content-type": "application/json" } : undefined,
    });
  } catch {
    return { ok: false, status: 0, message: OFFLINE };
  }

  const body = await response.json().catch(() => null);
  if (response.ok) return { ok: true, data: body as T };
  if (response.status === 401) return { ok: false, status: 401, message: SIGNED_OUT };
  const message = body?.error?.message;
  return {
    ok: false,
    status: response.status,
    message: typeof message === "string" && message ? message : "Something went wrong. Please try again.",
  };
}

function query(params: Record<string, string | number | null>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== null && value !== "") search.set(key, String(value));
  }
  return search.toString();
}

export function fetchInventory(search: string, offset: number) {
  return callApi<InventoryPage>(`/api/staff/inventory?${query({ q: search.trim(), limit: PAGE_SIZE, offset })}`);
}

export function fetchLowStock(threshold: number, offset: number) {
  return callApi<InventoryPage>(
    `/api/staff/inventory/low-stock?${query({ threshold, limit: PAGE_SIZE, offset })}`,
  );
}

export function saveQuantity(productId: string, quantity: number) {
  return callApi<QuantityChange>(`/api/staff/inventory/${productId}`, {
    method: "PUT",
    body: JSON.stringify({ quantity }),
  });
}

export function createProduct(body: Record<string, unknown>) {
  return callApi<Product>("/api/admin/products", { method: "POST", body: JSON.stringify(body) });
}

export function updateProduct(productId: string, changes: Record<string, unknown>) {
  return callApi<ProductChange>(`/api/admin/products/${productId}`, {
    method: "PUT",
    body: JSON.stringify(changes),
  });
}

export function retireProduct(productId: string) {
  return callApi<ProductChange>(`/api/admin/products/${productId}`, { method: "DELETE" });
}

export function fetchAuditLog(action: AuditAction | null, offset: number) {
  return callApi<AuditPage>(`/api/admin/audit-log?${query({ action, limit: PAGE_SIZE, offset })}`);
}
