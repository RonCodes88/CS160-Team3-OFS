import { randomBytes, randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { NextRequest } from "next/server";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PUT } from "@/app/api/staff/inventory/[productId]/route";
import { GET as getLowStock } from "@/app/api/staff/inventory/low-stock/route";
import { GET as getInventory } from "@/app/api/staff/inventory/route";
import { hashSessionToken, SESSION_COOKIE, type Role } from "@/lib/auth/session";

// Runs the real routes against a LOCAL Supabase with the migrations applied.
// Setup: `npx supabase start`, then put SUPABASE_TEST_URL and
// SUPABASE_TEST_SECRET_KEY in .env.test.local. Skipped when not configured.
try {
  process.loadEnvFile(".env.test.local");
} catch {
  // Optional file.
}

const TEST_URL = process.env.SUPABASE_TEST_URL;
const TEST_KEY = process.env.SUPABASE_TEST_SECRET_KEY;

// host.docker.internal is the developer's own machine when tests run in Docker.
if (
  TEST_URL &&
  !/^http:\/\/(localhost|127\.0\.0\.1|host\.docker\.internal)(:\d+)?\/?$/.test(TEST_URL)
) {
  throw new Error(`Refusing to run DB tests against non-local SUPABASE_TEST_URL: ${TEST_URL}`);
}

const run = randomUUID().slice(0, 8);

type Fixture = { id: string; token: string };

describe.skipIf(!TEST_URL || !TEST_KEY)("staff inventory API against Postgres", () => {
  let db: SupabaseClient;
  let categoryId: string;
  const users: Record<string, Fixture> = {};
  const products: Record<string, string> = {};
  const tokens: Record<string, string> = {};

  async function insertOne<T extends { id: string }>(table: string, row: object): Promise<T> {
    const { data, error } = await db.from(table).insert(row).select().single();
    if (error) throw new Error(`${table} insert failed: ${error.message}`);
    return data as T;
  }

  async function createUser(key: string, role: Role, status = "ACTIVE") {
    const user = await insertOne<{ id: string }>("users", {
      email: `${key}-${run}@test.local`,
      password_hash: "test-only-not-a-real-hash",
      role,
      status,
    });
    const token = randomBytes(32).toString("hex");
    await insertOne("auth_sessions", {
      user_id: user.id,
      token_hash: hashSessionToken(token),
      expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    });
    users[key] = { id: user.id, token };
  }

  async function createSessionToken(userId: string, overrides: object) {
    const token = randomBytes(32).toString("hex");
    await insertOne("auth_sessions", {
      user_id: userId,
      token_hash: hashSessionToken(token),
      expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      ...overrides,
    });
    return token;
  }

  async function createProduct(key: string, name: string, stock: number, isActive = true) {
    const product = await insertOne<{ id: string }>("products", {
      sku: `${key.toUpperCase()}-${run}`,
      category_id: categoryId,
      name: `${name} ${run}`,
      price_cents: 299,
      unit_weight: 100,
      stock_quantity: stock,
      is_active: isActive,
    });
    products[key] = product.id;
  }

  async function stockOf(productId: string) {
    const { data, error } = await db
      .from("products")
      .select("stock_quantity")
      .eq("id", productId)
      .single();
    if (error) throw error;
    return (data as { stock_quantity: number }).stock_quantity;
  }

  async function auditRows(productId: string) {
    const { data, error } = await db
      .from("audit_log")
      .select("*")
      .eq("product_id", productId)
      .order("created_at");
    if (error) throw error;
    return data as Array<{
      actor_user_id: string;
      product_id: string;
      action: string;
      old_value: unknown;
      new_value: unknown;
      created_at: string;
    }>;
  }

  function request(path: string, token?: string, init: { method?: string; body?: unknown } = {}) {
    const headers = new Headers();
    if (token) headers.set("cookie", `${SESSION_COOKIE}=${token}`);
    if (init.body !== undefined) headers.set("content-type", "application/json");
    return new NextRequest(`http://localhost${path}`, {
      method: init.method ?? "GET",
      headers,
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    });
  }

  function putQuantity(productId: string, token: string | undefined, body: unknown) {
    return PUT(request(`/api/staff/inventory/${productId}`, token, { method: "PUT", body }), {
      params: Promise.resolve({ productId }),
    });
  }

  async function listed(path: string, token: string) {
    const response = await getInventory(request(path, token));
    expect(response.status).toBe(200);
    const body = (await response.json()) as { items: Array<{ productId: string }> };
    return body.items.map((item) => item.productId);
  }

  beforeAll(async () => {
    // The routes build their own client from these.
    process.env.NEXT_PUBLIC_SUPABASE_URL = TEST_URL;
    process.env.SUPABASE_SECRET_KEY = TEST_KEY;
    db = createClient(TEST_URL!, TEST_KEY!, { auth: { persistSession: false } });

    const category = await insertOne<{ id: string }>("categories", {
      name: `Test ${run}`,
      slug: `test-${run}`,
    });
    categoryId = category.id;

    await createUser("employee", "EMPLOYEE");
    await createUser("manager", "MANAGER");
    await createUser("customer", "CUSTOMER");
    await createUser("disabled", "EMPLOYEE", "DISABLED");
    tokens.expired = await createSessionToken(users.employee.id, {
      expires_at: new Date(Date.now() - 60 * 1000).toISOString(),
    });
    tokens.revoked = await createSessionToken(users.employee.id, {
      revoked_at: new Date().toISOString(),
    });

    await createProduct("apples", "Test Apples", 50);
    await createProduct("atten", "Test Beans", 10);
    await createProduct("above", "Test Carrots", 11);
    await createProduct("retired", "Test Retired Dates", 0, false);
  });

  beforeEach(async () => {
    // Fixture reset; a direct update intentionally bypasses auditing.
    const { error } = await db.from("products").update({ stock_quantity: 50 }).eq("id", products.apples);
    if (error) throw error;
  });

  afterAll(async () => {
    if (!db) return;
    const productIds = Object.values(products);
    const userIds = Object.values(users).map((u) => u.id);
    await db.from("audit_log").delete().in("product_id", productIds);
    await db.from("products").delete().in("id", productIds);
    await db.from("users").delete().in("id", userIds);
    await db.from("categories").delete().eq("id", categoryId);
  });

  describe("sessions", () => {
    it.each(["expired", "revoked"])("rejects a %s session with 401", async (kind) => {
      const response = await getInventory(request("/api/staff/inventory", tokens[kind]));
      expect(response.status).toBe(401);
    });

    it("rejects a disabled employee with 401", async () => {
      const response = await getInventory(request("/api/staff/inventory", users.disabled.token));
      expect(response.status).toBe(401);
    });

    it("rejects an unknown token with 401", async () => {
      const response = await getInventory(request("/api/staff/inventory", "made-up-token"));
      expect(response.status).toBe(401);
    });

    it("rejects a customer with 403", async () => {
      const response = await getInventory(request("/api/staff/inventory", users.customer.token));
      expect(response.status).toBe(403);
    });
  });

  describe("GET /api/staff/inventory", () => {
    it("searches by name and hides retired products", async () => {
      const ids = await listed(`/api/staff/inventory?q=${run}&limit=100`, users.employee.token);
      expect(ids).toEqual(
        expect.arrayContaining([products.apples, products.atten, products.above]),
      );
      expect(ids).not.toContain(products.retired);

      const apples = await listed(`/api/staff/inventory?q=Apples ${run}`, users.manager.token);
      expect(apples).toEqual([products.apples]);
    });

    it("includes the editable product fields with each item", async () => {
      const response = await getInventory(
        request(`/api/staff/inventory?q=APPLES-${run}`, users.employee.token),
      );
      const { items } = (await response.json()) as { items: unknown[] };
      expect(items[0]).toMatchObject({
        productId: products.apples,
        categoryId,
        description: "",
        imageUrl: null,
        priceCents: 299,
        unitWeight: 100,
      });
    });

    it("searches by SKU", async () => {
      const ids = await listed(`/api/staff/inventory?q=APPLES-${run}`, users.employee.token);
      expect(ids).toEqual([products.apples]);
    });

    it("treats filter syntax in the search term as plain text", async () => {
      const ids = await listed(
        `/api/staff/inventory?q=${encodeURIComponent(`${run}",is_active.eq.false`)}`,
        users.employee.token,
      );
      expect(ids).not.toContain(products.retired);
    });
  });

  describe("GET /api/staff/inventory/low-stock", () => {
    it("includes stock equal to the threshold and excludes stock above it", async () => {
      const response = await getLowStock(
        request("/api/staff/inventory/low-stock?threshold=10&limit=100", users.employee.token),
      );
      expect(response.status).toBe(200);
      const ids = ((await response.json()) as { items: Array<{ productId: string }> }).items.map(
        (item) => item.productId,
      );
      expect(ids).toContain(products.atten);
      expect(ids).not.toContain(products.above);
      expect(ids).not.toContain(products.apples);
      expect(ids).not.toContain(products.retired);
    });
  });

  describe("PUT /api/staff/inventory/:productId", () => {
    it("lets an employee update stock and writes one accurate audit row", async () => {
      const before = await auditRows(products.apples);

      const response = await putQuantity(products.apples, users.employee.token, { quantity: 25 });

      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ oldQuantity: 50, newQuantity: 25, changed: true });
      expect(await stockOf(products.apples)).toBe(25);

      const after = await auditRows(products.apples);
      expect(after).toHaveLength(before.length + 1);
      expect(after.at(-1)).toMatchObject({
        actor_user_id: users.employee.id,
        product_id: products.apples,
        action: "INVENTORY_SET_QUANTITY",
        old_value: { stock_quantity: 50 },
        new_value: { stock_quantity: 25 },
      });
      expect(Date.parse(after.at(-1)!.created_at)).not.toBeNaN();
    });

    it("lets a manager update stock, audited as the manager", async () => {
      const response = await putQuantity(products.apples, users.manager.token, { quantity: 0 });
      expect(response.status).toBe(200);
      expect(await stockOf(products.apples)).toBe(0);
      expect((await auditRows(products.apples)).at(-1)?.actor_user_id).toBe(users.manager.id);
    });

    it("rejects a negative quantity without changing stock or writing an audit row", async () => {
      const before = await auditRows(products.apples);
      const response = await putQuantity(products.apples, users.employee.token, { quantity: -1 });
      expect(response.status).toBe(400);
      expect(await stockOf(products.apples)).toBe(50);
      expect(await auditRows(products.apples)).toHaveLength(before.length);
    });

    it("rejects a customer without changing stock or writing an audit row", async () => {
      const before = await auditRows(products.apples);
      const response = await putQuantity(products.apples, users.customer.token, { quantity: 1 });
      expect(response.status).toBe(403);
      expect(await stockOf(products.apples)).toBe(50);
      expect(await auditRows(products.apples)).toHaveLength(before.length);
    });

    it("returns 401 without a session and changes nothing", async () => {
      const response = await putQuantity(products.apples, undefined, { quantity: 1 });
      expect(response.status).toBe(401);
      expect(await stockOf(products.apples)).toBe(50);
    });

    it("returns 404 for a product that does not exist", async () => {
      const response = await putQuantity(randomUUID(), users.employee.token, { quantity: 1 });
      expect(response.status).toBe(404);
    });

    it("treats setting the current value as a no-op with no audit row", async () => {
      const before = await auditRows(products.apples);
      const response = await putQuantity(products.apples, users.employee.token, { quantity: 50 });
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ changed: false });
      expect(await auditRows(products.apples)).toHaveLength(before.length);
    });
  });

  describe("database safety nets", () => {
    it("the function rejects non-staff actors even if called directly", async () => {
      const { error } = await db.rpc("staff_set_inventory_quantity", {
        p_actor_user_id: users.customer.id,
        p_product_id: products.apples,
        p_quantity: 1,
      });
      expect(error?.code).toBe("42501");
      expect(await stockOf(products.apples)).toBe(50);
    });

    it("the function rejects negative quantities even if called directly", async () => {
      const { error } = await db.rpc("staff_set_inventory_quantity", {
        p_actor_user_id: users.employee.id,
        p_product_id: products.apples,
        p_quantity: -5,
      });
      expect(error?.code).toBe("22023");
      expect(await stockOf(products.apples)).toBe(50);
    });

    it("the CHECK constraint blocks negative stock from any writer", async () => {
      const { error } = await db
        .from("products")
        .update({ stock_quantity: -1 })
        .eq("id", products.apples);
      expect(error?.code).toBe("23514");
    });
  });
});
