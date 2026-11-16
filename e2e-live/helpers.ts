import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { expect, request as playwrightRequest, type APIRequestContext } from "@playwright/test";

const port = process.env.OFS_E2E_PORT ?? "3004";
export const BASE_URL = `http://localhost:${port}`;

// Demo accounts loaded by supabase/seed.sql (local and demo databases only).
export const SEED_PASSWORD = "ChangeMe123!";
export const SEEDED = {
  customer: "customer.test@ofs.local",
  employee: "employee.test@ofs.local",
  manager: "manager.test@ofs.local",
  vehicle: "vehicle.test@ofs.local",
} as const;

/** A fresh HTTP client with its own cookie jar, like a separate browser. */
export function newClient(): Promise<APIRequestContext> {
  return playwrightRequest.newContext({ baseURL: BASE_URL });
}

export async function loginAs(email: string, password = SEED_PASSWORD): Promise<APIRequestContext> {
  const client = await newClient();
  const response = await client.post("/api/auth/login", { data: { email, password } });
  expect(response.status(), `login as ${email}`).toBe(200);
  return client;
}

export type NewCustomer = { client: APIRequestContext; email: string; password: string };

/** Registers a brand-new customer, so each test starts with an empty cart. */
export async function registerCustomer(): Promise<NewCustomer> {
  const client = await newClient();
  const email = `e2e-${randomUUID()}@ofs.test`;
  const password = `Pw-${randomUUID()}`;
  const response = await client.post("/api/auth/register", { data: { email, password } });
  expect(response.status(), "register").toBe(201);
  return { client, email, password };
}

export type TestProduct = { id: string; name: string; sku: string; priceCents: number; unitWeight: number };

/** Creates a product through the manager API with an exact weight and price. */
export async function createProduct(
  manager: APIRequestContext,
  fields: { name: string; priceCents: number; unitWeight: number; stockQuantity: number },
): Promise<TestProduct> {
  const categories = await (await manager.get("/api/categories")).json();
  const suffix = randomUUID().slice(0, 8);
  const response = await manager.post("/api/admin/products", {
    data: {
      sku: `E2E-${suffix}`,
      categoryId: categories.categories[0].id,
      name: `${fields.name} ${suffix}`,
      description: "Created by the live end-to-end suite.",
      priceCents: fields.priceCents,
      unitWeight: fields.unitWeight,
      stockQuantity: fields.stockQuantity,
    },
  });
  expect(response.status(), "create product").toBe(201);
  return response.json();
}

/** Retires the products a spec created, so they leave the shop. */
export async function retireProducts(manager: APIRequestContext, products: TestProduct[]) {
  for (const product of products) await manager.delete(`/api/admin/products/${product.id}`);
}

export async function setCart(client: APIRequestContext, productId: string, quantity: number) {
  return client.post("/api/cart", { data: { productId, quantity } });
}

/** True when Stripe test keys are available, so the payment step can run. */
export function stripeConfigured(): boolean {
  const names = ["STRIPE_SECRET_KEY", "NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY"];
  const fromFile = existsSync(".env.local") ? readFileSync(".env.local", "utf8") : "";
  return names.every(
    (name) => process.env[name]?.includes("_test_") || new RegExp(`^${name}=.*_test_.+`, "m").test(fromFile),
  );
}
