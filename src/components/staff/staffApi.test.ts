import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  callApi,
  createProduct,
  fetchAuditLog,
  fetchInventory,
  fetchLowStock,
  retireProduct,
  saveQuantity,
  updateProduct,
} from "./staffApi";

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockResolvedValue(Response.json({ items: [], hasMore: false }));
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const lastCall = () => fetchMock.mock.calls.at(-1) as [string, RequestInit];

describe("callApi", () => {
  it("returns the body of a successful response", async () => {
    fetchMock.mockResolvedValueOnce(Response.json({ hello: "world" }));
    expect(await callApi("/api/x")).toEqual({ ok: true, data: { hello: "world" } });
  });

  it("shows the API's error message", async () => {
    fetchMock.mockResolvedValueOnce(
      Response.json({ error: { code: "CONFLICT", message: "Another product already uses this SKU." } }, { status: 409 }),
    );
    expect(await callApi("/api/x")).toEqual({
      ok: false,
      status: 409,
      message: "Another product already uses this SKU.",
    });
  });

  it("asks the user to log in again when the session has ended", async () => {
    fetchMock.mockResolvedValueOnce(Response.json({ error: { message: "Sign in required." } }, { status: 401 }));
    expect(await callApi("/api/x")).toMatchObject({ ok: false, status: 401, message: expect.stringContaining("Log in again") });
  });

  it("falls back to a generic message when the error body isn't JSON", async () => {
    fetchMock.mockResolvedValueOnce(new Response("Bad gateway", { status: 502 }));
    expect(await callApi("/api/x")).toEqual({
      ok: false,
      status: 502,
      message: "Something went wrong. Please try again.",
    });
  });

  it("reports a network failure without throwing", async () => {
    fetchMock.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    expect(await callApi("/api/x")).toMatchObject({ ok: false, status: 0, message: expect.stringContaining("reach the server") });
  });
});

describe("request helpers", () => {
  it("searches inventory with a trimmed term and paging", async () => {
    await fetchInventory("  milk ", 25);
    expect(lastCall()[0]).toBe("/api/staff/inventory?q=milk&limit=25&offset=25");
  });

  it("leaves out an empty search", async () => {
    await fetchInventory("", 0);
    expect(lastCall()[0]).toBe("/api/staff/inventory?limit=25&offset=0");
  });

  it("asks for low stock at a threshold", async () => {
    await fetchLowStock(5, 0);
    expect(lastCall()[0]).toBe("/api/staff/inventory/low-stock?threshold=5&limit=25&offset=0");
  });

  it("filters the audit log by action only when one is chosen", async () => {
    await fetchAuditLog(null, 0);
    expect(lastCall()[0]).toBe("/api/admin/audit-log?limit=25&offset=0");
    await fetchAuditLog("PRODUCT_RETIRE", 50);
    expect(lastCall()[0]).toBe("/api/admin/audit-log?action=PRODUCT_RETIRE&limit=25&offset=50");
  });

  it("sends the new quantity and the quantity on screen when saving stock", async () => {
    await saveQuantity("p1", 12, 9);
    const [url, init] = lastCall();
    expect(url).toBe("/api/staff/inventory/p1");
    expect(init).toMatchObject({ method: "PUT", body: '{"quantity":12,"expectedQuantity":9}', headers: { "content-type": "application/json" } });
  });

  it("uses POST, PUT, and DELETE for the product endpoints", async () => {
    await createProduct({ sku: "A" });
    expect(lastCall()).toEqual(["/api/admin/products", expect.objectContaining({ method: "POST", body: '{"sku":"A"}' })]);
    await updateProduct("p1", { name: "B" });
    expect(lastCall()).toEqual(["/api/admin/products/p1", expect.objectContaining({ method: "PUT", body: '{"name":"B"}' })]);
    await retireProduct("p1");
    expect(lastCall()).toEqual(["/api/admin/products/p1", expect.objectContaining({ method: "DELETE" })]);
    expect(lastCall()[1].headers).toBeUndefined();
  });
});
