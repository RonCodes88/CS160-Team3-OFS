import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PUT } from "@/app/api/staff/inventory/[productId]/route";
import { GET as getLowStock } from "@/app/api/staff/inventory/low-stock/route";
import { GET as getInventory } from "@/app/api/staff/inventory/route";
import { getSessionUser, type Role } from "@/lib/auth/session";
import { listInventory, listLowStock, setInventoryQuantity } from "@/lib/inventory/service";

// Route-level tests: the database is mocked, the session is controlled per
// test, and the real role checks and validation run.
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn(() => ({})) }));
vi.mock("@/lib/auth/session", () => ({ getSessionUser: vi.fn() }));
vi.mock("@/lib/inventory/service", () => ({
  listInventory: vi.fn(),
  listLowStock: vi.fn(),
  setInventoryQuantity: vi.fn(),
}));

const PRODUCT_ID = "3f1c2b8e-9a4d-4e2f-8b1a-0c9d7e6f5a41";
const USER_ID = "b2f7c1d0-1111-4222-8333-944455556666";

function signInAs(role: Role | null) {
  vi.mocked(getSessionUser).mockResolvedValue(role ? { id: USER_ID, role } : null);
}

function get(path: string) {
  return new NextRequest(`http://localhost${path}`);
}

function put(productId: string, body: unknown) {
  const request = new NextRequest(`http://localhost/api/staff/inventory/${productId}`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
  return PUT(request, { params: Promise.resolve({ productId }) });
}

async function errorCode(response: Response) {
  return ((await response.json()) as { error: { code: string } }).error.code;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(listInventory).mockResolvedValue({ items: [], hasMore: false });
  vi.mocked(listLowStock).mockResolvedValue({ items: [], hasMore: false });
  vi.mocked(setInventoryQuantity).mockResolvedValue({
    ok: true,
    value: {
      productId: PRODUCT_ID,
      oldQuantity: 5,
      newQuantity: 12,
      changed: true,
      updatedAt: "2026-09-30T12:00:00Z",
    },
  });
});

describe("authorization on every staff inventory route", () => {
  const routes = {
    "GET /api/staff/inventory": () => getInventory(get("/api/staff/inventory")),
    "GET /api/staff/inventory/low-stock": () => getLowStock(get("/api/staff/inventory/low-stock")),
    "PUT /api/staff/inventory/:productId": () => put(PRODUCT_ID, { quantity: 12 }),
  };

  describe.each(Object.entries(routes))("%s", (_name, call) => {
    it("returns 401 without a session", async () => {
      signInAs(null);
      const response = await call();
      expect(response.status).toBe(401);
      expect(await errorCode(response)).toBe("UNAUTHENTICATED");
    });

    it.each<Role>(["CUSTOMER", "VEHICLE"])("returns 403 for %s", async (role) => {
      signInAs(role);
      const response = await call();
      expect(response.status).toBe(403);
      expect(await errorCode(response)).toBe("FORBIDDEN");
    });

    it.each<Role>(["EMPLOYEE", "MANAGER"])("allows %s", async (role) => {
      signInAs(role);
      expect((await call()).status).toBe(200);
    });
  });

  it("never touches data when the caller is rejected", async () => {
    signInAs("CUSTOMER");
    await put(PRODUCT_ID, { quantity: 12 });
    await getInventory(get("/api/staff/inventory"));
    expect(setInventoryQuantity).not.toHaveBeenCalled();
    expect(listInventory).not.toHaveBeenCalled();
  });
});

describe("GET /api/staff/inventory", () => {
  it("passes search and paging to the service and echoes paging", async () => {
    signInAs("EMPLOYEE");
    vi.mocked(listInventory).mockResolvedValue({
      items: [
        {
          productId: PRODUCT_ID,
          sku: "MILK-1",
          name: "Milk",
          categoryId: "c1",
          stockQuantity: 4,
          updatedAt: "2026-09-30T12:00:00Z",
        },
      ],
      hasMore: false,
    });

    const response = await getInventory(get("/api/staff/inventory?q=milk&limit=10&offset=20"));

    expect(response.status).toBe(200);
    expect(listInventory).toHaveBeenCalledWith({}, { search: "milk", limit: 10, offset: 20 });
    const body = await response.json();
    expect(body).toMatchObject({ limit: 10, offset: 20, hasMore: false });
    expect(body.items[0]).toMatchObject({ sku: "MILK-1", stockQuantity: 4 });
  });

  it("returns 400 for invalid paging", async () => {
    signInAs("EMPLOYEE");
    const response = await getInventory(get("/api/staff/inventory?limit=0"));
    expect(response.status).toBe(400);
    expect(await errorCode(response)).toBe("VALIDATION_ERROR");
    expect(listInventory).not.toHaveBeenCalled();
  });

  it("returns a generic 500 when the database fails", async () => {
    signInAs("EMPLOYEE");
    vi.mocked(listInventory).mockRejectedValue(new Error("connection refused"));
    vi.spyOn(console, "error").mockImplementation(() => {});

    const response = await getInventory(get("/api/staff/inventory"));

    expect(response.status).toBe(500);
    expect(JSON.stringify(await response.json())).not.toContain("connection refused");
  });
});

describe("GET /api/staff/inventory/low-stock", () => {
  it("uses the default threshold of 10", async () => {
    signInAs("MANAGER");
    const response = await getLowStock(get("/api/staff/inventory/low-stock"));
    expect(response.status).toBe(200);
    expect(listLowStock).toHaveBeenCalledWith({}, { threshold: 10, limit: 50, offset: 0 });
    expect(await response.json()).toMatchObject({ threshold: 10 });
  });

  it("accepts a custom threshold", async () => {
    signInAs("EMPLOYEE");
    await getLowStock(get("/api/staff/inventory/low-stock?threshold=3"));
    expect(listLowStock).toHaveBeenCalledWith({}, { threshold: 3, limit: 50, offset: 0 });
  });

  it("returns 400 for a negative threshold", async () => {
    signInAs("EMPLOYEE");
    const response = await getLowStock(get("/api/staff/inventory/low-stock?threshold=-1"));
    expect(response.status).toBe(400);
    expect(listLowStock).not.toHaveBeenCalled();
  });
});

describe("PUT /api/staff/inventory/:productId", () => {
  it("updates stock as the session user and returns old and new quantities", async () => {
    signInAs("EMPLOYEE");
    const response = await put(PRODUCT_ID, { quantity: 12 });

    expect(response.status).toBe(200);
    expect(setInventoryQuantity).toHaveBeenCalledWith({}, USER_ID, PRODUCT_ID, 12);
    expect(await response.json()).toMatchObject({ oldQuantity: 5, newQuantity: 12, changed: true });
  });

  it("ignores user ids or roles sent in the body", async () => {
    signInAs("EMPLOYEE");
    await put(PRODUCT_ID, { quantity: 12, userId: "someone-else", role: "MANAGER" });
    expect(setInventoryQuantity).toHaveBeenCalledWith({}, USER_ID, PRODUCT_ID, 12);
  });

  it("accepts 0", async () => {
    signInAs("EMPLOYEE");
    expect((await put(PRODUCT_ID, { quantity: 0 })).status).toBe(200);
    expect(setInventoryQuantity).toHaveBeenCalledWith({}, USER_ID, PRODUCT_ID, 0);
  });

  it.each([
    ["negative", { quantity: -1 }],
    ["fractional", { quantity: 2.5 }],
    ["string", { quantity: "12" }],
    ["missing", {}],
    ["array body", [12]],
  ])("rejects a %s quantity with 400 and changes nothing", async (_label, body) => {
    signInAs("EMPLOYEE");
    const response = await put(PRODUCT_ID, body);
    expect(response.status).toBe(400);
    expect(await errorCode(response)).toBe("VALIDATION_ERROR");
    expect(setInventoryQuantity).not.toHaveBeenCalled();
  });

  it("rejects malformed JSON with 400", async () => {
    signInAs("EMPLOYEE");
    const response = await put(PRODUCT_ID, "{not json");
    expect(response.status).toBe(400);
    expect(setInventoryQuantity).not.toHaveBeenCalled();
  });

  it.each(["123", "not-a-uuid", "low-stock-typo"])(
    "rejects product id %j with 400 before touching the database",
    async (productId) => {
      signInAs("EMPLOYEE");
      const response = await put(productId, { quantity: 1 });
      expect(response.status).toBe(400);
      expect(setInventoryQuantity).not.toHaveBeenCalled();
    },
  );

  it("returns 404 for an unknown product", async () => {
    signInAs("EMPLOYEE");
    vi.mocked(setInventoryQuantity).mockResolvedValue({ ok: false, reason: "NOT_FOUND" });
    const response = await put(PRODUCT_ID, { quantity: 1 });
    expect(response.status).toBe(404);
    expect(await errorCode(response)).toBe("NOT_FOUND");
  });

  it("returns 403 if the database rejects the actor", async () => {
    signInAs("EMPLOYEE");
    vi.mocked(setInventoryQuantity).mockResolvedValue({ ok: false, reason: "FORBIDDEN" });
    expect((await put(PRODUCT_ID, { quantity: 1 })).status).toBe(403);
  });

  it("returns 400 if the database rejects the quantity", async () => {
    signInAs("EMPLOYEE");
    vi.mocked(setInventoryQuantity).mockResolvedValue({ ok: false, reason: "INVALID_QUANTITY" });
    expect((await put(PRODUCT_ID, { quantity: 1 })).status).toBe(400);
  });
});
