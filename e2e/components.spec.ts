import { test as base, expect } from "@playwright/test";
import { writeFile } from "node:fs/promises";

// Actual production components run in a separate React bundle. Only external
// navigation, Stripe's SDK, and HTTP responses are fixture adapters.
const test = base.extend<{ browserCoverage: void }>({
  browserCoverage: [async ({ page }, use, testInfo) => {
    await page.coverage.startJSCoverage({ resetOnNavigation: false });
    await use();
    const entries = (await page.coverage.stopJSCoverage()).filter((entry) => entry.url.endsWith("/fixture.js"));
    if (entries.length) {
      const sourceMap = await (await page.request.get("http://localhost:3002/fixture.js.map")).json();
      await writeFile(testInfo.outputPath("browser-v8.json"), JSON.stringify({ entries, sourceMap }));
    }
  }, { auto: true }],
});
const fixture = (path: string) => `http://localhost:3002${path}`;
const totals = { subtotalCents: 300, totalWeight: 100, deliveryFeeCents: 0, taxCents: 15, totalCents: 315 };
const session = { key: "session-key", addressId: "address-1", expected: totals };
const cart = { items: [{ product_id: "apple", name: "Apples", price_cents: 300, unit_weight: 100, quantity: 1 }],
  subtotal_cents: 300, total_weight: 100, delivery_fee_cents: 0, total_cents: 300, fee_warning: false, over_weight_limit: false };

async function checkoutRoutes(page: import("@playwright/test").Page) {
  await page.route("**/api/cart", (route) => route.fulfill({ json: cart }));
  await page.route("**/api/checkout/preview", (route) => route.fulfill({ json: { ...totals, feeWarning: false } }));
}

test("checkout retries an offline resume and replaces a canceled payment intent", async ({ page }) => {
  await checkoutRoutes(page);
  let attempts = 0;
  await page.route("**/api/checkout/payment-intent", (route) => {
    attempts++;
    if (attempts === 1) return route.abort("internetdisconnected");
    return route.fulfill({ json: { attemptId: `attempt-${attempts}`, clientSecret: `secret-${attempts}`, status: "PENDING" } });
  });
  await page.route("**/api/checkout/cancel", (route) => route.fulfill({ json: {} }));
  await page.addInitScript((stored) => localStorage.setItem("ofs:checkout-payment", JSON.stringify(stored)), session);
  await page.goto(fixture("/checkout"));
  await expect(page.getByRole("alert")).toContainText("Network error");
  await page.getByRole("button", { name: "Continue to payment" }).click();
  await expect(page.getByRole("status")).toHaveText("Card form: secret-2");
  await page.getByRole("button", { name: "Change address (cancels this payment)", exact: true }).click();
  await page.getByRole("button", { name: "Deliver here" }).click();
  await page.getByRole("button", { name: "Continue to payment" }).click();
  await expect(page.getByRole("status")).toHaveText("Card form: secret-3");
});

test("checkout survives denied storage and an address API failure, then retries", async ({ page }) => {
  await checkoutRoutes(page);
  let previews = 0;
  await page.route("**/api/checkout/preview", (route) => {
    previews++;
    return route.fulfill(previews === 1 ? { status: 422, json: { error: { code: "ADDRESS_INVALID", message: "Address no longer eligible" } } }
      : { json: { ...totals, feeWarning: false } });
  });
  await page.addInitScript(() => Object.defineProperty(window, "localStorage", { get() { throw new Error("Storage denied"); } }));
  await page.goto(fixture("/checkout"));
  await page.getByRole("button", { name: "Deliver here" }).click();
  await expect(page.getByRole("alert")).toContainText("Address no longer eligible");
  await page.getByRole("button", { name: "Deliver here" }).click();
  await expect(page.getByRole("button", { name: "Continue to payment" })).toBeEnabled();
});

test("Stripe intent replacement remounts immutable Elements and handles SDK failure", async ({ page }) => {
  let payments = 0;
  await page.route("**/fake-stripe", (route) => {
    payments++;
    return route.fulfill(payments === 1 ? { status: 500, body: "offline" } : { json: {} });
  });
  await page.goto(fixture("/payment"));
  await expect(page.getByRole("status")).toHaveText("Card form: first-secret");
  await page.getByRole("button", { name: "Replace intent" }).click();
  await expect(page.getByRole("status")).toHaveText("Card form: second-secret");
  await page.getByRole("button", { name: "Pay $3.15", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("Check your connection");
  await page.getByRole("button", { name: "Pay $3.15", exact: true }).click();
  await expect(page.getByRole("button", { name: "Placing your order…" })).toBeDisabled();
});

const item = { productId: "11111111-1111-4111-8111-111111111112", sku: "APPLE", name: "Apples",
  categoryId: "11111111-1111-4111-8111-111111111111", description: "", imageUrl: null,
  priceCents: 300, unitWeight: 100, stockQuantity: 5, updatedAt: "2026-11-15T00:00:00Z" };

test("manager validates stock, handles failures, edits product, and confirms retirement", async ({ page }) => {
  let current = { ...item };
  let stocks = 0;
  await page.route("**/api/staff/inventory?*", (route) => route.fulfill({ json: { items: [current], hasMore: false } }));
  await page.route(`**/api/staff/inventory/${item.productId}`, (route) => {
    stocks++;
    if (stocks === 1) return route.fulfill({ status: 503, json: { error: { message: "Inventory unavailable" } } });
    const oldQuantity = current.stockQuantity;
    current = { ...current, stockQuantity: route.request().postDataJSON().quantity };
    return route.fulfill({ json: { changed: true, oldQuantity, newQuantity: current.stockQuantity } });
  });
  await page.route(`**/api/admin/products/${item.productId}`, (route) => {
    current = { ...current, ...route.request().postDataJSON() };
    return route.fulfill({ json: { changed: true, product: { ...current, id: current.productId, isActive: route.request().method() !== "DELETE" } } });
  });
  await page.goto(fixture("/staff"));
  await page.getByLabel("Stock", { exact: true }).fill("-1");
  await page.getByRole("button", { name: "Save stock for Apples" }).click();
  await expect(page.getByRole("alert")).toContainText("Stock must be a whole number");
  expect(stocks).toBe(0);
  await page.getByLabel("Stock", { exact: true }).fill("9");
  await page.getByRole("button", { name: "Save stock for Apples" }).click();
  await expect(page.getByRole("alert")).toContainText("Inventory unavailable");
  await page.getByRole("button", { name: "Save stock for Apples" }).click();
  await expect(page.getByLabel("Stock", { exact: true })).toHaveValue("9");
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  await page.getByLabel("Price ($)", { exact: true }).fill("4.25");
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(page.getByText("Saved changes to Apples.")).toBeVisible();
  await expect(page.getByRole("list")).toContainText("$4.25");
  await page.getByRole("button", { name: "Retire", exact: true }).click();
  await page.getByRole("button", { name: "Keep it", exact: true }).click();
  await expect(page.getByText("Retire Apples?")).toHaveCount(0);
  await page.getByRole("button", { name: "Retire", exact: true }).click();
  await page.getByRole("button", { name: "Yes, retire", exact: true }).click();
  await expect(page.getByText("Apples was retired.")).toBeVisible();
});

test("staff tabs recover from expired sessions without showing manager actions to employees", async ({ page }) => {
  await page.route("**/api/staff/inventory?*", (route) => route.fulfill({ json: { items: [item], hasMore: false } }));
  await page.route("**/api/staff/inventory/low-stock?*", (route) => route.fulfill({ status: 401, json: {} }));
  await page.goto(fixture("/employee"));
  await expect(page.getByLabel("Stock", { exact: true })).toHaveValue("5");
  await expect(page.getByRole("button", { name: "Edit", exact: true })).toHaveCount(0);
  await expect(page.getByRole("tab", { name: "Audit log" })).toHaveCount(0);
  await page.getByRole("tab", { name: "Low stock" }).click();
  await expect(page.getByRole("alert")).toContainText("Your session has ended");
  await page.getByRole("tab", { name: "Inventory", exact: true }).click();
  await expect(page.getByLabel("Stock", { exact: true })).toHaveValue("5");
});

test("mobile navigation closes after each action and login retries an offline request", async ({ page }) => {
  await page.goto(fixture("/mobile"));
  await page.getByRole("button", { name: "Open menu" }).click();
  await expect(page.getByRole("button", { name: "Close menu" })).toHaveAttribute("aria-expanded", "true");
  await page.getByRole("button", { name: "Close menu" }).click();
  await expect(page.getByRole("link", { name: "Log in", exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Open menu" }).click();
  await page.getByRole("link", { name: "Log in", exact: true }).click();
  let logins = 0;
  await page.route("**/api/auth/login", (route) => {
    logins++;
    return logins === 1 ? route.abort("internetdisconnected") : route.fulfill({ status: 401, json: { error: { message: "Invalid login" } } });
  });
  await page.getByLabel("Email", { exact: true }).fill("fixture@example.test");
  await page.getByLabel("Password", { exact: true }).fill("UnsentPassword123!");
  await page.getByRole("button", { name: "Log in", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("Couldn't reach the server");
  await page.getByRole("button", { name: "Log in", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("Invalid login");
});
