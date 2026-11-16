// API integration tests: real HTTP requests against the running app and the
// local database. No mocks. Each test signs in the way a real client would.
import type { APIRequestContext } from "@playwright/test";
import { expect, test } from "@playwright/test";
import {
  createProduct, loginAs, newClient, registerCustomer, retireProducts, SEEDED, setCart, type TestProduct,
} from "./helpers";

let manager: APIRequestContext;
let employee: APIRequestContext;
// "Feather" weighs 0.01 lb and "Brick" 17.99 lb, so every boundary in
// AGENTS.md (18.00, 19.99, 20.00, 199.99, 200.00, above 200) can be hit exactly.
let feather: TestProduct;
let brick: TestProduct;
const created: TestProduct[] = [];

test.beforeAll(async () => {
  manager = await loginAs(SEEDED.manager);
  employee = await loginAs(SEEDED.employee);
  feather = await createProduct(manager, { name: "E2E Feather", priceCents: 1, unitWeight: 1, stockQuantity: 5000 });
  brick = await createProduct(manager, { name: "E2E Brick", priceCents: 250, unitWeight: 1799, stockQuantity: 50 });
  created.push(feather, brick);
});

test.afterAll(async () => {
  await retireProducts(manager, created);
});

test.describe("access control", () => {
  const protectedRoutes = [
    "/api/cart", "/api/addresses", "/api/staff/inventory", "/api/staff/inventory/low-stock",
    "/api/admin/audit-log", "/api/vehicle/trip", "/api/auth/me",
  ];

  test("guests get 401 on every protected route and 200 on the public catalog", async () => {
    const guest = await newClient();
    for (const route of protectedRoutes) {
      expect((await guest.get(route)).status(), route).toBe(401);
    }
    expect((await guest.get("/api/categories")).status()).toBe(200);
    expect((await guest.get("/api/products")).status()).toBe(200);
    expect((await guest.get("/api/no-such-route")).status()).toBe(404);
  });

  test("a customer gets 403 from staff, manager and vehicle routes", async () => {
    const { client } = await registerCustomer();
    for (const route of ["/api/staff/inventory", "/api/admin/audit-log", "/api/vehicle/trip"]) {
      expect((await client.get(route)).status(), route).toBe(403);
    }
    const put = await client.put(`/api/staff/inventory/${feather.id}`, { data: { quantity: 1 } });
    expect(put.status()).toBe(403);
    expect((await client.delete(`/api/admin/products/${feather.id}`)).status()).toBe(403);
  });

  test("an employee can read inventory but cannot manage products or shop", async () => {
    expect((await employee.get("/api/staff/inventory")).status()).toBe(200);
    expect((await employee.get("/api/admin/audit-log")).status()).toBe(403);
    expect((await employee.delete(`/api/admin/products/${feather.id}`)).status()).toBe(403);
    expect((await employee.get("/api/cart")).status()).toBe(403);
  });

  test("registration always creates a CUSTOMER and never returns a hash", async () => {
    const client = await newClient();
    const email = `e2e-role-${Date.now()}@ofs.test`;
    const response = await client.post("/api/auth/register", {
      data: { email, password: "long-enough-pw", role: "MANAGER" },
    });
    expect(response.status()).toBe(201);
    const body = await response.json();
    expect(body.user.role).toBe("CUSTOMER");
    expect(JSON.stringify(body)).not.toMatch(/hash|argon/i);
    expect((await client.get("/api/admin/audit-log")).status()).toBe(403);

    const duplicate = await (await newClient()).post("/api/auth/register", {
      data: { email: email.toUpperCase(), password: "long-enough-pw" },
    });
    expect(duplicate.status()).toBe(409);
  });

  test("logout ends the session for later requests", async () => {
    const { client } = await registerCustomer();
    expect((await client.get("/api/cart")).status()).toBe(200);
    expect((await client.post("/api/auth/logout")).status()).toBe(200);
    expect((await client.get("/api/cart")).status()).toBe(401);
  });

  test("malformed login and register bodies are client errors, not 500s", async () => {
    const guest = await newClient();
    const bodies = [{}, { email: 5, password: [] }, { email: "a\u0000b@x.co", password: "12345678" }, []];
    for (const data of bodies) {
      expect((await guest.post("/api/auth/register", { data })).status()).toBe(400);
      expect((await guest.post("/api/auth/login", { data })).status()).toBeLessThan(500);
    }
    const notJson = await guest.post("/api/auth/login", {
      headers: { "content-type": "application/json" }, data: "{not json",
    });
    expect(notJson.status()).toBe(400);
  });
});

test.describe("cart weight and delivery fee rules", () => {
  test("fee and warning switch at exactly 18.00 and 20.00 lb", async () => {
    const { client } = await registerCustomer();

    let cart = await (await setCart(client, brick.id, 1)).json(); // 17.99 lb
    expect(cart).toMatchObject({ total_weight: 1799, delivery_fee_cents: 0, fee_warning: false });

    cart = await (await setCart(client, feather.id, 1)).json(); // 18.00 lb
    expect(cart).toMatchObject({ total_weight: 1800, delivery_fee_cents: 0, fee_warning: true });

    cart = await (await setCart(client, feather.id, 200)).json(); // 19.99 lb
    expect(cart).toMatchObject({ total_weight: 1999, delivery_fee_cents: 0, fee_warning: true });

    cart = await (await setCart(client, feather.id, 201)).json(); // 20.00 lb
    expect(cart).toMatchObject({ total_weight: 2000, delivery_fee_cents: 1000, fee_warning: false });
    expect(cart.total_cents).toBe(cart.subtotal_cents + 1000);
  });

  test("199.99 and 200.00 lb are accepted; above 200 lb is rejected and the cart is unchanged", async () => {
    const { client } = await registerCustomer();
    await setCart(client, brick.id, 11); // 197.89 lb

    let cart = await (await setCart(client, feather.id, 210)).json(); // 199.99 lb
    expect(cart).toMatchObject({ total_weight: 19999, delivery_fee_cents: 1000, over_weight_limit: false });

    cart = await (await setCart(client, feather.id, 211)).json(); // 200.00 lb
    expect(cart).toMatchObject({ total_weight: 20000, delivery_fee_cents: 1000, over_weight_limit: false });

    const rejected = await setCart(client, feather.id, 212); // 200.01 lb
    expect(rejected.status()).toBe(422);
    expect((await rejected.json()).error.code).toBe("CART_OVERWEIGHT");

    cart = await (await client.get("/api/cart")).json();
    expect(cart.total_weight).toBe(20000);
  });

  test("invalid quantities and products are rejected with 400", async () => {
    const { client } = await registerCustomer();
    for (const quantity of [-1, 1.5, "2", null, 1e12, true]) {
      const response = await client.post("/api/cart", { data: { productId: feather.id, quantity } });
      expect(response.status(), `quantity ${String(quantity)}`).toBe(400);
    }
    expect((await client.post("/api/cart", { data: { productId: "nope", quantity: 1 } })).status()).toBe(400);
    expect((await client.post("/api/cart", { data: [] })).status()).toBe(400);
    expect((await client.get("/api/cart").then((r) => r.json())).items).toHaveLength(0);
  });

  test("more than the stock is rejected, and two tabs changing one cart stay consistent", async () => {
    const { client } = await registerCustomer();
    const tooMany = await setCart(client, brick.id, 51);
    expect(tooMany.status()).toBe(409);
    expect((await tooMany.json()).error.code).toBe("INSUFFICIENT_STOCK");

    // Twenty simultaneous changes, as from rapid clicks in several tabs.
    const responses = await Promise.all(
      Array.from({ length: 20 }, (_, index) => setCart(client, feather.id, index + 1)),
    );
    expect(responses.every((response) => response.status() === 200)).toBe(true);
    const cart = await (await client.get("/api/cart")).json();
    expect(cart.items).toHaveLength(1);
    expect(cart.total_weight).toBe(cart.items[0].quantity * feather.unitWeight);
  });

  test("one customer never sees another customer's cart", async () => {
    const first = await registerCustomer();
    const second = await registerCustomer();
    await setCart(first.client, feather.id, 3);
    expect((await second.client.get("/api/cart").then((r) => r.json())).items).toHaveLength(0);
  });
});

test.describe("staff inventory and manager products", () => {
  test("a stock change is saved, audited with old and new values, and visible to shoppers", async () => {
    const product = await createProduct(manager, {
      name: "E2E Stocked", priceCents: 199, unitWeight: 50, stockQuantity: 5,
    });
    created.push(product);

    const update = await employee.put(`/api/staff/inventory/${product.id}`, { data: { quantity: 2 } });
    expect(update.status()).toBe(200);

    const audit = await (await manager.get(`/api/admin/audit-log?productId=${product.id}`)).json();
    const entry = JSON.stringify(audit);
    expect(entry).toContain(SEEDED.employee);
    expect(entry).toMatch(/"stock_quantity":5/);
    expect(entry).toMatch(/"stock_quantity":2/);

    const { client } = await registerCustomer();
    expect((await setCart(client, product.id, 3)).status()).toBe(409);
    expect((await setCart(client, product.id, 2)).status()).toBe(200);
  });

  test("bad stock values are rejected with 400", async () => {
    for (const quantity of [-1, 2.5, "7", null, 2 ** 31]) {
      const response = await employee.put(`/api/staff/inventory/${feather.id}`, { data: { quantity } });
      expect(response.status(), `quantity ${String(quantity)}`).toBe(400);
    }
    expect((await employee.put("/api/staff/inventory/not-a-uuid", { data: { quantity: 1 } })).status()).toBeLessThan(500);
  });

  test("a retired product leaves the shop and cannot be added, but its row is kept", async () => {
    const product = await createProduct(manager, {
      name: "E2E Retiring", priceCents: 300, unitWeight: 100, stockQuantity: 9,
    });
    const { client } = await registerCustomer();
    expect((await setCart(client, product.id, 1)).status()).toBe(200);

    expect((await manager.delete(`/api/admin/products/${product.id}`)).status()).toBe(200);

    const guest = await newClient();
    expect((await guest.get(`/api/products/${product.id}`)).status()).toBe(404);
    expect((await setCart(client, product.id, 2)).status()).toBe(409);
    const audit = JSON.stringify(await (await manager.get(`/api/admin/audit-log?productId=${product.id}`)).json());
    expect(audit).toContain("PRODUCT_RETIRE");
  });

  test("products reject floats, negatives and unknown fields", async () => {
    const categories = await (await manager.get("/api/categories")).json();
    const base = {
      sku: `E2E-BAD-${Date.now()}`, categoryId: categories.categories[0].id, name: "Bad", priceCents: 100, unitWeight: 100,
    };
    for (const change of [{ priceCents: 1.5 }, { priceCents: -1 }, { unitWeight: 0 }, { unitWeight: 20001 }, { isActive: false }, { surprise: 1 }]) {
      const response = await manager.post("/api/admin/products", { data: { ...base, ...change } });
      expect(response.status(), JSON.stringify(change)).toBe(400);
    }
  });
});

test.describe("checkout preview", () => {
  test("the server recalculates totals and rejects a client that sends different ones", async () => {
    const customer = await loginAs(SEEDED.customer);
    // The seeded customer keeps a cart between runs: empty it first.
    const existing = await (await customer.get("/api/cart")).json();
    for (const item of existing.items) await setCart(customer, item.product_id, 0);

    const addresses = await (await customer.get("/api/addresses")).json();
    const addressId = addresses.addresses[0].id;
    const zero = { subtotalCents: 0, totalWeight: 0, deliveryFeeCents: 0, taxCents: 0, totalCents: 0 };

    const empty = await customer.post("/api/checkout/preview", { data: { addressId, expected: zero } });
    expect(empty.status()).toBe(422);
    expect((await empty.json()).error.code).toBe("CART_EMPTY");

    await setCart(customer, brick.id, 1);
    await setCart(customer, feather.id, 201); // 20.00 lb: the fee applies
    const mismatch = await customer.post("/api/checkout/preview", { data: { addressId, expected: zero } });
    expect(mismatch.status()).toBe(409);
    const { current } = await mismatch.json();
    // 250 + 201 cents of items, 5% demo tax on items (half up), $10 delivery.
    expect(current).toMatchObject({
      subtotalCents: 451, totalWeight: 2000, deliveryFeeCents: 1000, taxCents: 23, totalCents: 1474,
    });

    const accepted = await customer.post("/api/checkout/preview", { data: { addressId, expected: current } });
    expect(accepted.status()).toBe(200);

    const stranger = await registerCustomer();
    await setCart(stranger.client, feather.id, 1);
    const foreign = await stranger.client.post("/api/checkout/preview", { data: { addressId, expected: zero } });
    expect(foreign.status()).toBeGreaterThanOrEqual(400);
    expect(foreign.status()).toBeLessThan(500);

    for (const item of [brick, feather]) await setCart(customer, item.id, 0);
  });

  test("a payment intent needs an idempotency key", async () => {
    const { client } = await registerCustomer();
    const response = await client.post("/api/checkout/payment-intent", { data: {} });
    expect(response.status()).toBe(400);
  });

  test("an unsigned Stripe webhook is rejected", async () => {
    const guest = await newClient();
    const response = await guest.post("/api/webhooks/stripe", { data: { type: "payment_intent.succeeded" } });
    // 400 for a bad signature; 5xx when no signing secret is configured (CI).
    // Either way the event is never accepted.
    expect(response.status()).toBeGreaterThanOrEqual(400);
    expect(await (await guest.get("/api/products")).json()).toHaveProperty("products");
  });
});
