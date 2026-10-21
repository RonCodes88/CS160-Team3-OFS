import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { GET as getAuditLog } from "@/app/api/admin/audit-log/route";
import { DELETE, PUT } from "@/app/api/admin/products/[productId]/route";
import { POST } from "@/app/api/admin/products/route";
import { listAuditLog } from "@/lib/audit/log";
import { getSessionUser, type Role } from "@/lib/auth/session";
import {
  createProduct,
  retireProduct,
  updateProduct,
  type Product,
  type ProductFailure,
} from "@/lib/products/service";

// Route-level tests: the database is mocked, the session is controlled per
// test, and the real role checks, validation and error mapping run.
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn(() => ({})) }));
vi.mock("@/lib/auth/session", () => ({ getSessionUser: vi.fn() }));
vi.mock("@/lib/products/service", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/products/service")>()),
  createProduct: vi.fn(),
  updateProduct: vi.fn(),
  retireProduct: vi.fn(),
}));
vi.mock("@/lib/audit/log", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/audit/log")>()),
  listAuditLog: vi.fn(),
}));

const PRODUCT_ID = "3f1c2b8e-9a4d-4e2f-8b1a-0c9d7e6f5a41";
const CATEGORY_ID = "11111111-1111-4111-8111-111111111111";
const USER_ID = "b2f7c1d0-1111-4222-8333-944455556666";

const product: Product = {
  id: PRODUCT_ID,
  sku: "APL-001",
  categoryId: CATEGORY_ID,
  name: "Gala Apples",
  description: "",
  imageUrl: null,
  priceCents: 199,
  unitWeight: 50,
  stockQuantity: 0,
  isActive: true,
  updatedAt: "2026-10-07T12:00:00Z",
};

const newProductBody = {
  sku: "APL-001",
  categoryId: CATEGORY_ID,
  name: "Gala Apples",
  priceCents: 199,
  unitWeight: 50,
};

function signInAs(role: Role | null) {
  vi.mocked(getSessionUser).mockResolvedValue(role ? { id: USER_ID, email: "manager@ofs.test", role } : null);
}

function jsonRequest(path: string, method: string, body?: unknown) {
  return new NextRequest(`http://localhost${path}`, {
    method,
    headers: body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body),
  });
}

const params = (productId: string) => ({ params: Promise.resolve({ productId }) });

const post = (body: unknown) => POST(jsonRequest("/api/admin/products", "POST", body));
const put = (productId: string, body: unknown) =>
  PUT(jsonRequest(`/api/admin/products/${productId}`, "PUT", body), params(productId));
const del = (productId: string) =>
  DELETE(jsonRequest(`/api/admin/products/${productId}`, "DELETE"), params(productId));
const auditLog = (qs = "") => getAuditLog(jsonRequest(`/api/admin/audit-log${qs}`, "GET"));

async function errorCode(response: Response) {
  return ((await response.json()) as { error: { code: string } }).error.code;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(createProduct).mockResolvedValue({ ok: true, product, changed: true });
  vi.mocked(updateProduct).mockResolvedValue({ ok: true, product, changed: true });
  vi.mocked(retireProduct).mockResolvedValue({
    ok: true,
    product: { ...product, isActive: false },
    changed: true,
  });
  vi.mocked(listAuditLog).mockResolvedValue({ entries: [], hasMore: false });
});

describe("authorization on every manager route", () => {
  const routes = {
    "POST /api/admin/products": () => post(newProductBody),
    "PUT /api/admin/products/:productId": () => put(PRODUCT_ID, { priceCents: 249 }),
    "DELETE /api/admin/products/:productId": () => del(PRODUCT_ID),
    "GET /api/admin/audit-log": () => auditLog(),
  };

  describe.each(Object.entries(routes))("%s", (_name, call) => {
    it("returns 401 without a session", async () => {
      signInAs(null);
      const response = await call();
      expect(response.status).toBe(401);
      expect(await errorCode(response)).toBe("UNAUTHENTICATED");
    });

    it.each<Role>(["EMPLOYEE", "CUSTOMER", "VEHICLE"])("returns 403 for %s", async (role) => {
      signInAs(role);
      const response = await call();
      expect(response.status).toBe(403);
      expect(await errorCode(response)).toBe("FORBIDDEN");
    });

    it("allows MANAGER", async () => {
      signInAs("MANAGER");
      expect((await call()).status).toBeLessThan(300);
    });
  });

  it("never touches data when an employee is rejected", async () => {
    signInAs("EMPLOYEE");
    await post(newProductBody);
    await put(PRODUCT_ID, { priceCents: 1 });
    await del(PRODUCT_ID);
    await auditLog();
    expect(createProduct).not.toHaveBeenCalled();
    expect(updateProduct).not.toHaveBeenCalled();
    expect(retireProduct).not.toHaveBeenCalled();
    expect(listAuditLog).not.toHaveBeenCalled();
  });
});

describe("POST /api/admin/products", () => {
  it("creates the product as the session user and returns 201", async () => {
    signInAs("MANAGER");
    const response = await post(newProductBody);

    expect(response.status).toBe(201);
    expect(await response.json()).toEqual(product);
    expect(createProduct).toHaveBeenCalledWith(
      {},
      USER_ID,
      expect.objectContaining({ sku: "APL-001", price_cents: 199, unit_weight: 50 }),
    );
  });

  it("rejects an actor id in the body instead of trusting it", async () => {
    signInAs("MANAGER");
    const response = await post({ ...newProductBody, actorUserId: "someone-else" });
    expect(response.status).toBe(400);
    expect(createProduct).not.toHaveBeenCalled();
  });

  it.each([
    ["missing name", { ...newProductBody, name: undefined }],
    ["float price", { ...newProductBody, priceCents: 1.99 }],
    ["weight over 200 lbs", { ...newProductBody, unitWeight: 20001 }],
  ])("returns 400 for %s without touching the database", async (_label, body) => {
    signInAs("MANAGER");
    const response = await post(body);
    expect(response.status).toBe(400);
    expect(await errorCode(response)).toBe("VALIDATION_ERROR");
    expect(createProduct).not.toHaveBeenCalled();
  });

  it("returns 400 for malformed JSON", async () => {
    signInAs("MANAGER");
    expect((await post("{nope")).status).toBe(400);
  });

  it.each<[ProductFailure, number, string]>([
    ["DUPLICATE_SKU", 409, "CONFLICT"],
    ["UNKNOWN_CATEGORY", 400, "VALIDATION_ERROR"],
    ["INVALID", 400, "VALIDATION_ERROR"],
    ["FORBIDDEN", 403, "FORBIDDEN"],
  ])("maps a %s database result to %d", async (reason, status, code) => {
    signInAs("MANAGER");
    vi.mocked(createProduct).mockResolvedValue({ ok: false, reason });
    const response = await post(newProductBody);
    expect(response.status).toBe(status);
    expect(await errorCode(response)).toBe(code);
  });
});

describe("PUT /api/admin/products/:productId", () => {
  it("updates price and weight as the session user", async () => {
    signInAs("MANAGER");
    const response = await put(PRODUCT_ID, { priceCents: 249, unitWeight: 60 });

    expect(response.status).toBe(200);
    expect(updateProduct).toHaveBeenCalledWith({}, USER_ID, PRODUCT_ID, {
      price_cents: 249,
      unit_weight: 60,
    });
    expect(await response.json()).toMatchObject({ changed: true, product: { id: PRODUCT_ID } });
  });

  it("refuses stock changes and points to the inventory API", async () => {
    signInAs("MANAGER");
    const response = await put(PRODUCT_ID, { stockQuantity: 5 });
    expect(response.status).toBe(400);
    expect(JSON.stringify(await response.json())).toContain("/api/staff/inventory");
    expect(updateProduct).not.toHaveBeenCalled();
  });

  it("returns 400 for a bad product id before touching the database", async () => {
    signInAs("MANAGER");
    expect((await put("not-a-uuid", { priceCents: 1 })).status).toBe(400);
    expect(updateProduct).not.toHaveBeenCalled();
  });

  it("returns 404 for an unknown product", async () => {
    signInAs("MANAGER");
    vi.mocked(updateProduct).mockResolvedValue({ ok: false, reason: "NOT_FOUND" });
    expect((await put(PRODUCT_ID, { priceCents: 1 })).status).toBe(404);
  });

  it("returns 409 when the new SKU is taken", async () => {
    signInAs("MANAGER");
    vi.mocked(updateProduct).mockResolvedValue({ ok: false, reason: "DUPLICATE_SKU" });
    expect((await put(PRODUCT_ID, { sku: "TAKEN" })).status).toBe(409);
  });
});

describe("DELETE /api/admin/products/:productId", () => {
  it("retires the product and returns it as inactive", async () => {
    signInAs("MANAGER");
    const response = await del(PRODUCT_ID);
    expect(response.status).toBe(200);
    expect(retireProduct).toHaveBeenCalledWith({}, USER_ID, PRODUCT_ID);
    expect(await response.json()).toMatchObject({ changed: true, product: { isActive: false } });
  });

  it("returns 400 for a bad product id", async () => {
    signInAs("MANAGER");
    expect((await del("123")).status).toBe(400);
    expect(retireProduct).not.toHaveBeenCalled();
  });

  it("returns 404 for an unknown product", async () => {
    signInAs("MANAGER");
    vi.mocked(retireProduct).mockResolvedValue({ ok: false, reason: "NOT_FOUND" });
    expect((await del(PRODUCT_ID)).status).toBe(404);
  });
});

describe("GET /api/admin/audit-log", () => {
  it("passes filters through and echoes paging", async () => {
    signInAs("MANAGER");
    const response = await auditLog(`?productId=${PRODUCT_ID}&action=PRODUCT_RETIRE&limit=5`);
    expect(response.status).toBe(200);
    expect(listAuditLog).toHaveBeenCalledWith(
      {},
      { productId: PRODUCT_ID, action: "PRODUCT_RETIRE", limit: 5, offset: 0 },
    );
    expect(await response.json()).toMatchObject({ entries: [], hasMore: false, limit: 5, offset: 0 });
  });

  it("returns 400 for an unknown action", async () => {
    signInAs("MANAGER");
    expect((await auditLog("?action=EVERYTHING")).status).toBe(400);
    expect(listAuditLog).not.toHaveBeenCalled();
  });

  it("returns a generic 500 when the database fails", async () => {
    signInAs("MANAGER");
    vi.mocked(listAuditLog).mockRejectedValue(new Error("connection refused"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    const response = await auditLog();
    expect(response.status).toBe(500);
    expect(JSON.stringify(await response.json())).not.toContain("connection refused");
  });
});
