import { randomBytes, randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { NextRequest } from "next/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { GET as getAuditLog } from "@/app/api/admin/audit-log/route";
import { DELETE, PUT } from "@/app/api/admin/products/[productId]/route";
import { POST } from "@/app/api/admin/products/route";
import { GET as getInventory } from "@/app/api/staff/inventory/route";
import { hashSessionToken, SESSION_COOKIE, type Role } from "@/lib/auth/session";

// Runs the real manager routes against a LOCAL Supabase with the migrations
// applied. Setup: `npx supabase start`, then put SUPABASE_TEST_URL and
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

type AuditRow = {
  actor_user_id: string;
  product_id: string;
  action: string;
  old_value: Record<string, unknown> | null;
  new_value: Record<string, unknown>;
  created_at: string;
};

describe.skipIf(!TEST_URL || !TEST_KEY)("manager product API against Postgres", () => {
  let db: SupabaseClient;
  let categoryId: string;
  const users: Record<string, { id: string; token: string }> = {};
  const createdProductIds: string[] = [];

  async function insertOne<T>(table: string, row: object): Promise<T> {
    const { data, error } = await db.from(table).insert(row).select().single();
    if (error) throw new Error(`${table} insert failed: ${error.message}`);
    return data as T;
  }

  async function createUser(key: string, role: Role) {
    const user = await insertOne<{ id: string }>("users", {
      email: `${key}-${run}@test.local`,
      password_hash: "test-only-not-a-real-hash",
      role,
    });
    const token = randomBytes(32).toString("hex");
    await insertOne("auth_sessions", {
      user_id: user.id,
      token_hash: hashSessionToken(token),
      expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    });
    users[key] = { id: user.id, token };
  }

  function request(path: string, token: string | undefined, method = "GET", body?: unknown) {
    const headers = new Headers();
    if (token) headers.set("cookie", `${SESSION_COOKIE}=${token}`);
    if (body !== undefined) headers.set("content-type", "application/json");
    return new NextRequest(`http://localhost${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  }

  const params = (productId: string) => ({ params: Promise.resolve({ productId }) });

  function create(token: string | undefined, body: unknown) {
    return POST(request("/api/admin/products", token, "POST", body));
  }
  function update(token: string | undefined, productId: string, body: unknown) {
    return PUT(request(`/api/admin/products/${productId}`, token, "PUT", body), params(productId));
  }
  function retire(token: string | undefined, productId: string) {
    return DELETE(request(`/api/admin/products/${productId}`, token, "DELETE"), params(productId));
  }

  async function createAsManager(suffix: string, extra: object = {}) {
    const response = await create(users.manager.token, {
      sku: `${suffix}-${run}`,
      categoryId,
      name: `Test ${suffix} ${run}`,
      priceCents: 199,
      unitWeight: 50,
      ...extra,
    });
    expect(response.status).toBe(201);
    const product = (await response.json()) as { id: string };
    createdProductIds.push(product.id);
    return product;
  }

  async function productRow(productId: string) {
    const { data, error } = await db.from("products").select("*").eq("id", productId).maybeSingle();
    if (error) throw error;
    return data as Record<string, unknown> | null;
  }

  async function auditRows(productId: string) {
    const { data, error } = await db
      .from("audit_log")
      .select("*")
      .eq("product_id", productId)
      .order("created_at");
    if (error) throw error;
    return data as AuditRow[];
  }

  // Counts only rows by this run's users: other DB test files run in parallel
  // and write their own audit rows.
  async function totalAuditRows() {
    const { count, error } = await db
      .from("audit_log")
      .select("id", { count: "exact", head: true })
      .in("actor_user_id", Object.values(users).map((u) => u.id));
    if (error) throw error;
    return count ?? 0;
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

    await createUser("manager", "MANAGER");
    await createUser("employee", "EMPLOYEE");
  });

  afterAll(async () => {
    if (!db) return;
    await db.from("audit_log").delete().in("product_id", createdProductIds);
    await db.from("products").delete().in("id", createdProductIds);
    await db.from("users").delete().in("id", Object.values(users).map((u) => u.id));
    await db.from("categories").delete().eq("id", categoryId);
  });

  describe("employees are locked out", () => {
    it("cannot create, update, retire or read the audit log, and nothing changes", async () => {
      const product = await createAsManager("LOCK");
      const before = await totalAuditRows();

      const responses = await Promise.all([
        create(users.employee.token, { sku: `EMP-${run}`, categoryId, name: "x", priceCents: 1, unitWeight: 1 }),
        update(users.employee.token, product.id, { priceCents: 1 }),
        retire(users.employee.token, product.id),
        getAuditLog(request("/api/admin/audit-log", users.employee.token)),
      ]);

      expect(responses.map((r) => r.status)).toEqual([403, 403, 403, 403]);
      expect(await productRow(product.id)).toMatchObject({ price_cents: 199, is_active: true });
      const { data } = await db.from("products").select("id").eq("sku", `EMP-${run}`);
      expect(data).toEqual([]);
      expect(await totalAuditRows()).toBe(before);
    });

    it("returns 401 without a session", async () => {
      expect((await create(undefined, {})).status).toBe(401);
    });
  });

  describe("POST /api/admin/products", () => {
    it("creates the product and one PRODUCT_CREATE audit row with the full snapshot", async () => {
      const product = await createAsManager("NEW", { stockQuantity: 12, description: "Fresh" });

      expect(await productRow(product.id)).toMatchObject({
        sku: `NEW-${run}`,
        price_cents: 199,
        unit_weight: 50,
        stock_quantity: 12,
        description: "Fresh",
        is_active: true,
      });
      const rows = await auditRows(product.id);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        actor_user_id: users.manager.id,
        action: "PRODUCT_CREATE",
        old_value: null,
        new_value: { sku: `NEW-${run}`, price_cents: 199, stock_quantity: 12 },
      });
    });

    it("rejects a duplicate SKU with 409 and writes no audit row", async () => {
      await createAsManager("DUP");
      const before = await totalAuditRows();
      const response = await create(users.manager.token, {
        sku: `DUP-${run}`,
        categoryId,
        name: "Duplicate",
        priceCents: 1,
        unitWeight: 1,
      });
      expect(response.status).toBe(409);
      expect(await totalAuditRows()).toBe(before);
    });

    it("rejects an unknown category with 400 and writes no audit row", async () => {
      const before = await totalAuditRows();
      const response = await create(users.manager.token, {
        sku: `NOCAT-${run}`,
        categoryId: randomUUID(),
        name: "No category",
        priceCents: 1,
        unitWeight: 1,
      });
      expect(response.status).toBe(400);
      expect(await totalAuditRows()).toBe(before);
    });
  });

  describe("PUT /api/admin/products/:productId", () => {
    it("updates price and weight and audits only the fields that changed", async () => {
      const product = await createAsManager("UPD");
      const response = await update(users.manager.token, product.id, {
        name: `Test UPD ${run}`, // unchanged
        priceCents: 249,
        unitWeight: 2000,
      });

      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({
        changed: true,
        product: { priceCents: 249, unitWeight: 2000 },
      });
      const last = (await auditRows(product.id)).at(-1);
      expect(last).toMatchObject({
        actor_user_id: users.manager.id,
        action: "PRODUCT_UPDATE",
        old_value: { price_cents: 199, unit_weight: 50 },
        new_value: { price_cents: 249, unit_weight: 2000 },
      });
      expect(Object.keys(last!.new_value).sort()).toEqual(["price_cents", "unit_weight"]);
    });

    it("treats sending the current values as a no-op with no audit row", async () => {
      const product = await createAsManager("SAME");
      const before = (await auditRows(product.id)).length;
      const response = await update(users.manager.token, product.id, { priceCents: 199 });
      expect(await response.json()).toMatchObject({ changed: false });
      expect(await auditRows(product.id)).toHaveLength(before);
    });

    it("rejects taking another product's SKU and leaves both unchanged", async () => {
      const a = await createAsManager("SKUA");
      const b = await createAsManager("SKUB");
      const before = await totalAuditRows();

      const response = await update(users.manager.token, b.id, { sku: `SKUA-${run}` });

      expect(response.status).toBe(409);
      expect(await productRow(b.id)).toMatchObject({ sku: `SKUB-${run}` });
      expect(await productRow(a.id)).toMatchObject({ sku: `SKUA-${run}` });
      expect(await totalAuditRows()).toBe(before);
    });

    it("returns 404 for an unknown product", async () => {
      expect((await update(users.manager.token, randomUUID(), { priceCents: 1 })).status).toBe(404);
    });
  });

  describe("DELETE /api/admin/products/:productId", () => {
    it("retires instead of deleting, audits it, and hides it from staff inventory", async () => {
      const product = await createAsManager("RET");

      const response = await retire(users.manager.token, product.id);

      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ changed: true, product: { isActive: false } });
      expect(await productRow(product.id)).toMatchObject({ id: product.id, is_active: false });
      expect((await auditRows(product.id)).at(-1)).toMatchObject({
        action: "PRODUCT_RETIRE",
        old_value: { is_active: true },
        new_value: { is_active: false },
      });

      const list = await getInventory(request(`/api/staff/inventory?q=RET-${run}`, users.manager.token));
      expect(((await list.json()) as { items: unknown[] }).items).toEqual([]);
    });

    it("retiring twice is a no-op with no extra audit row", async () => {
      const product = await createAsManager("RET2");
      await retire(users.manager.token, product.id);
      const before = (await auditRows(product.id)).length;

      const response = await retire(users.manager.token, product.id);

      expect(await response.json()).toMatchObject({ changed: false });
      expect(await auditRows(product.id)).toHaveLength(before);
    });

    it("returns 404 for an unknown product", async () => {
      expect((await retire(users.manager.token, randomUUID())).status).toBe(404);
    });
  });

  describe("GET /api/admin/audit-log", () => {
    it("shows a product's history newest first with who did it", async () => {
      const product = await createAsManager("HIST");
      await update(users.manager.token, product.id, { priceCents: 299 });
      await retire(users.manager.token, product.id);

      const response = await getAuditLog(
        request(`/api/admin/audit-log?productId=${product.id}`, users.manager.token),
      );

      expect(response.status).toBe(200);
      const body = (await response.json()) as {
        entries: Array<{ action: string; actorEmail: string; productSku: string }>;
      };
      expect(body.entries.map((e) => e.action)).toEqual([
        "PRODUCT_RETIRE",
        "PRODUCT_UPDATE",
        "PRODUCT_CREATE",
      ]);
      expect(body.entries[0]).toMatchObject({
        actorEmail: `manager-${run}@test.local`,
        productSku: `HIST-${run}`,
      });
    });

    it("filters by action", async () => {
      const product = await createAsManager("FILT");
      await update(users.manager.token, product.id, { priceCents: 1 });

      const response = await getAuditLog(
        request(`/api/admin/audit-log?productId=${product.id}&action=PRODUCT_UPDATE`, users.manager.token),
      );
      const body = (await response.json()) as { entries: Array<{ action: string }> };
      expect(body.entries.map((e) => e.action)).toEqual(["PRODUCT_UPDATE"]);
    });
  });

  describe("database safety nets", () => {
    it("the functions reject non-manager actors even if called directly", async () => {
      const product = await createAsManager("SAFE");
      const { error } = await db.rpc("admin_update_product", {
        p_actor_user_id: users.employee.id,
        p_product_id: product.id,
        p_changes: { price_cents: 1 },
      });
      expect(error?.code).toBe("42501");
      expect(await productRow(product.id)).toMatchObject({ price_cents: 199 });
    });

    it("the update function refuses stock or status fields", async () => {
      const product = await createAsManager("RO");
      for (const changes of [{ stock_quantity: 999 }, { is_active: false }]) {
        const { error } = await db.rpc("admin_update_product", {
          p_actor_user_id: users.manager.id,
          p_product_id: product.id,
          p_changes: changes,
        });
        expect(error?.code).toBe("22023");
      }
      expect(await productRow(product.id)).toMatchObject({ stock_quantity: 0, is_active: true });
    });

    it("the create function requires the core fields", async () => {
      const { error } = await db.rpc("admin_create_product", {
        p_actor_user_id: users.manager.id,
        p_product: { sku: `PART-${run}` },
      });
      expect(error?.code).toBe("22023");
    });
  });
});
