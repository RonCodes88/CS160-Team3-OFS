// End-to-end customer journey in a real browser against the real app and the
// local database: register, shop, cart rules, multiple tabs, access guards,
// staff dashboard, and a Stripe test-mode payment. No mocked responses.
import { randomUUID } from "node:crypto";
import type { APIRequestContext, Page } from "@playwright/test";
import { expect, test } from "@playwright/test";
import {
  createProduct, loginAs, retireProducts, SEED_PASSWORD, SEEDED, setCart, stripeConfigured, type TestProduct,
} from "./helpers";

const NOT_FOUND_TEXT = "can't find that product";
let manager: APIRequestContext;
let feather: TestProduct; // 0.01 lb
let brick: TestProduct; // 17.99 lb
const created: TestProduct[] = [];

test.beforeAll(async ({ browser }) => {
  // The dev server compiles each page on its first visit and may reload it
  // once. Open every page up front so the tests see settled pages.
  // First compiles can be slow on a cold cache, so allow plenty of time.
  test.setTimeout(240_000);
  const warmup = await browser.newPage();
  for (const path of ["/", "/shop", "/cart", "/login", "/register", "/staff", "/checkout"]) {
    await warmup.goto(path, { timeout: 120_000 });
    await warmup.waitForLoadState("networkidle", { timeout: 30_000 }).catch(() => {});
  }
  await warmup.close();

  manager = await loginAs(SEEDED.manager);
  feather = await createProduct(manager, { name: "E2E Feather", priceCents: 1, unitWeight: 1, stockQuantity: 5000 });
  brick = await createProduct(manager, { name: "E2E Brick", priceCents: 250, unitWeight: 1799, stockQuantity: 50 });
  created.push(feather, brick);
});

test.afterAll(async () => {
  await retireProducts(manager, created);
});

/**
 * The dev server recompiles a page the first time it is opened, which can
 * reload it and wipe a half-filled form. Retry until the form is submitted.
 */
async function submitAuthForm(page: Page, path: string, email: string, password: string, button: string) {
  await expect(async () => {
    await page.goto(path);
    await page.waitForLoadState("networkidle");
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password").fill(password);
    await page.getByRole("button", { name: button, exact: true }).click();
    await expect(page).not.toHaveURL(/\/(login|register)/, { timeout: 8_000 });
  }).toPass({ timeout: 60_000 });
}

async function signIn(page: Page, email: string, password: string, path = "/login") {
  await submitAuthForm(page, path, email, password, "Log in");
}

async function register(page: Page) {
  const email = `e2e-${randomUUID()}@ofs.test`;
  const password = `Pw-${randomUUID()}`;
  await submitAuthForm(page, "/register", email, password, "Create account");
  await expect(page).toHaveURL(/\/shop/);
  return { email, password };
}

const summary = (page: Page) => page.getByRole("complementary", { name: "Order summary" });

test("a guest must sign in; a new customer registers, shops, and sees the fee rules in the cart", async ({ page }) => {
  // Guests can browse but not add.
  await page.goto(`/shop?q=${encodeURIComponent(brick.name)}`);
  await expect(page.getByRole("link", { name: `Log in to add ${brick.name} to cart` })).toBeVisible();

  await register(page);

  // Search, then add from the shop: 17.99 lb is free with no warning.
  await page.getByPlaceholder("Search bananas, rice, coffee...").fill(brick.name);
  await page.keyboard.press("Enter");
  await page.getByRole("button", { name: `Add ${brick.name} to cart` }).click();
  await expect(page.getByLabel("Cart summary")).toContainText("Free delivery under 20.00 lb");

  // 18.00 lb: still free, but the shopper is warned.
  await page.goto(`/shop?q=${encodeURIComponent(feather.name)}`);
  await page.getByRole("button", { name: `Add ${feather.name} to cart` }).click();
  await expect(page.getByLabel("Cart summary")).toContainText("until the $10.00 delivery fee");

  // The cart page shows the server's weight and totals.
  await page.goto("/cart");
  await expect(summary(page)).toContainText("18.00 lb");
  await expect(summary(page)).toContainText("away from the");

  // A second brick takes the cart to 35.99 lb: the $10 fee applies.
  await page.getByRole("button", { name: `Add one ${brick.name}`, exact: true }).click();
  await expect(page.getByRole("group", { name: `Quantity of ${brick.name}` })).toContainText("2");
  await expect(summary(page)).toContainText("35.99 lb");
  await expect(summary(page)).toContainText("$10.00");
  await expect(summary(page)).toContainText("$15.01"); // 2 x $2.50 + $0.01 + $10.00

  // Removing a line brings the cart back under 20 lb and the fee goes away.
  await page.getByRole("button", { name: `Remove ${brick.name} from cart` }).click();
  await expect(summary(page)).toContainText("0.01 lb");
  await expect(summary(page)).not.toContainText("$10.00");
});

test("the 200 lb limit rejects the change in the browser and keeps the cart", async ({ page }) => {
  await register(page);
  // 11 bricks and 211 feathers is exactly 200.00 lb.
  expect((await setCart(page.request, brick.id, 11)).status()).toBe(200);
  expect((await setCart(page.request, feather.id, 211)).status()).toBe(200);

  await page.goto("/cart");
  await expect(summary(page)).toContainText("200.00 lb");
  await expect(page.getByRole("link", { name: "Checkout", exact: true })).toBeVisible();

  await page.getByRole("button", { name: `Add one ${feather.name}`, exact: true }).click();
  await expect(page.getByRole("main").getByRole("alert")).toContainText("200 lb");
  await expect(page.getByRole("group", { name: `Quantity of ${feather.name}` })).toContainText("211");
  await expect(summary(page)).toContainText("200.00 lb");
});

test("mobile cart displays exact fee boundaries and preserves the maximum after reload", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await register(page);
  expect((await setCart(page.request, brick.id, 1)).status()).toBe(200);

  for (const [quantity, weight, fee] of [
    [200, "19.99 lb", false],
    [201, "20.00 lb", true],
  ] as const) {
    expect((await setCart(page.request, feather.id, quantity)).status()).toBe(200);
    await page.goto("/cart");
    await expect(summary(page)).toContainText(weight);
    const delivery = summary(page).getByRole("term").filter({ hasText: /^Delivery$/ }).locator("+ dd");
    await expect(delivery).toHaveText(fee ? "$10.00" : "Free");
  }

  expect((await setCart(page.request, brick.id, 11)).status()).toBe(200);
  expect((await setCart(page.request, feather.id, 210)).status()).toBe(200);
  await page.reload();
  await expect(summary(page)).toContainText("199.99 lb");
  const plus = page.getByRole("button", { name: `Add one ${feather.name}`, exact: true });
  await plus.click();
  await expect(summary(page)).toContainText("200.00 lb");
  await plus.click();
  await expect(page.getByRole("main").getByRole("alert")).toContainText("200 lb");
  await page.reload();
  await expect(summary(page)).toContainText("200.00 lb");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test("two tabs share one cart, survive rapid clicks, and recover when the other tab logs out", async ({ context, page }) => {
  await register(page);
  expect((await setCart(page.request, feather.id, 1)).status()).toBe(200);

  const second = await context.newPage();
  await Promise.all([page.goto("/cart"), second.goto("/cart")]);

  // Hammer the plus button in the first tab.
  const plus = page.getByRole("button", { name: `Add one ${feather.name}`, exact: true });
  for (let i = 0; i < 6; i += 1) await plus.click({ force: true, noWaitAfter: true }).catch(() => {});
  await expect(plus).toBeEnabled();

  // Whatever the first tab shows is what the server stored, and the second tab agrees after a reload.
  const shown = await page.getByRole("group", { name: `Quantity of ${feather.name}` }).innerText();
  const stored = await (await page.request.get("/api/cart")).json();
  expect(shown).toContain(String(stored.items[0].quantity));
  expect(stored.items[0].quantity).toBeGreaterThan(1);
  await second.reload();
  await expect(second.getByRole("group", { name: `Quantity of ${feather.name}` })).toContainText(
    String(stored.items[0].quantity),
  );

  // Log out through the first tab's session, then act in the stale second tab.
  expect((await page.request.post("/api/auth/logout")).status()).toBe(200);
  await second.getByRole("button", { name: `Add one ${feather.name}`, exact: true }).click();
  await expect(second.getByRole("main").getByRole("alert")).toBeVisible();
  await second.reload();
  await expect(second.getByRole("link", { name: "Checkout", exact: true })).toHaveCount(0);
});

test("pages are guarded by sign-in, role and ownership", async ({ page }) => {
  // Guests are sent to log in and returned afterwards.
  await page.goto("/checkout");
  await expect(page).toHaveURL(/\/login\?next=%2Fcheckout|\/login\?next=\/checkout/);
  await page.goto("/staff");
  await expect(page).toHaveURL(/\/login/);

  // A redirect parameter can never leave the site.
  const { email, password } = await register(page);
  await page.request.post("/api/auth/logout");
  await signIn(page, email, password, "/login?next=//example.com");
  await expect(page).toHaveURL(/localhost:\d+\/shop/);

  // Customers cannot open the staff dashboard or someone else's order.
  await page.goto("/staff");
  await expect(page.getByRole("heading", { name: "Staff only" })).toBeVisible();
  const missingOrder = await page.goto(`/orders/${randomUUID()}`);
  expect(missingOrder?.status()).toBe(404);
  await expect(page.getByRole("heading", { name: "We can't find that page." })).toBeVisible();
  expect((await page.goto("/orders/not-an-id"))?.status()).toBe(404);
  expect((await page.goto("/no/such/page"))?.status()).toBe(404);
  await expect(page.getByRole("link", { name: "Back to the shop" })).toBeVisible();
  await page.goto("/shop/not-a-product");
  await expect(page.getByRole("main")).toContainText(NOT_FOUND_TEXT);

  // An empty cart cannot be checked out.
  await page.goto("/checkout");
  await expect(page.getByText("Your cart is empty.")).toBeVisible();
});

test("an employee updates stock from the dashboard; only the manager sees the audit log", async ({ browser }) => {
  const product = await createProduct(manager, {
    name: "E2E Shelf", priceCents: 400, unitWeight: 100, stockQuantity: 8,
  });
  created.push(product);

  const employeeContext = await browser.newContext();
  const employeePage = await employeeContext.newPage();
  await signIn(employeePage, SEEDED.employee, SEED_PASSWORD);
  await expect(employeePage.getByRole("heading", { name: "Staff dashboard" })).toBeVisible();
  await expect(employeePage.getByRole("tab", { name: "Audit log" })).toHaveCount(0);

  await employeePage.getByRole("searchbox").fill(product.sku);
  await employeePage.keyboard.press("Enter");
  await expect(employeePage.getByRole("tabpanel")).toContainText(product.name);
  const stock = employeePage.getByLabel("Stock", { exact: true });
  await expect(stock).toHaveCount(1);
  await stock.fill("3");
  await employeePage.getByRole("button", { name: `Save stock for ${product.name}` }).click();
  await expect(employeePage.getByText(`${product.name} stock changed from 8 to 3.`)).toBeVisible();

  // Garbage in the stock box is refused without calling the server.
  await stock.fill("-4");
  await employeePage.getByRole("button", { name: `Save stock for ${product.name}` }).click();
  await expect(employeePage.getByText(`${product.name} stock changed from 3`)).toHaveCount(0);
  await employeeContext.close();

  // The shop now only sells three.
  const shopper = await browser.newContext();
  const shopperPage = await shopper.newPage();
  await register(shopperPage);
  expect((await setCart(shopperPage.request, product.id, 4)).status()).toBe(409);
  expect((await setCart(shopperPage.request, product.id, 3)).status()).toBe(200);
  await shopper.close();

  const managerContext = await browser.newContext();
  const managerPage = await managerContext.newPage();
  await signIn(managerPage, SEEDED.manager, SEED_PASSWORD);
  // The manager retires the product, finds it under Retired, and brings it back.
  await managerPage.getByRole("searchbox").fill(product.sku);
  await managerPage.keyboard.press("Enter");
  // Wait for the search to narrow the list to this one product.
  await expect(managerPage.getByLabel("Stock", { exact: true })).toHaveCount(1);
  await managerPage.getByRole("button", { name: "Retire", exact: true }).click();
  await managerPage.getByRole("button", { name: "Yes, retire" }).click();
  await expect(managerPage.getByText(`${product.name} was retired.`)).toBeVisible();
  await managerPage.getByRole("tab", { name: "Retired" }).click();
  await managerPage.getByRole("searchbox").fill(product.sku);
  await managerPage.keyboard.press("Enter");
  await managerPage.getByRole("button", { name: `Reactivate ${product.name}` }).click();
  await expect(managerPage.getByText(`${product.name} is back in the shop.`)).toBeVisible();
  expect((await managerPage.request.get(`/api/products/${product.id}`)).status()).toBe(200);

  await managerPage.getByRole("tab", { name: "Audit log" }).click();
  await expect(managerPage.getByRole("tabpanel")).toContainText(product.name);
  await expect(managerPage.getByRole("tabpanel")).toContainText(SEEDED.employee);
  await managerContext.close();
});

test("a customer pays with a Stripe test card and the order, stock and cart are updated", async ({ page }) => {
  test.skip(!stripeConfigured(), "Stripe test keys are not configured (.env.local).");
  test.setTimeout(180_000);

  const product = await createProduct(manager, {
    name: "E2E Paid", priceCents: 1000, unitWeight: 1000, stockQuantity: 5,
  });
  created.push(product);

  // The seeded customer already has a saved address inside the service area.
  await signIn(page, SEEDED.customer, SEED_PASSWORD);
  await expect(page).toHaveURL(/\/shop/);
  const existing = await (await page.request.get("/api/cart")).json();
  for (const item of existing.items) await setCart(page.request, item.product_id, 0);
  await page.request.post("/api/checkout/cancel", { data: {} });
  expect((await setCart(page.request, product.id, 2)).status()).toBe(200); // 20.00 lb, $20.00

  await page.goto("/checkout");
  await page.getByRole("button", { name: "Deliver here" }).click();

  // Server totals: $20.00 items + $10.00 delivery + 5% demo tax on items = $31.00.
  const main = page.getByRole("main");
  await expect(main).toContainText("20.00 lb");
  await expect(main).toContainText("$10.00");
  await expect(main).toContainText("$31.00");

  const earlier = page.getByRole("button", { name: "Cancel the earlier payment" });
  if (await earlier.isVisible().catch(() => false)) await earlier.click();
  await page.getByRole("button", { name: "Continue to payment" }).click();

  const pay = page.getByRole("button", { name: "Pay $31.00" });
  await expect(pay).toBeVisible({ timeout: 60_000 });
  const card = page.frameLocator('iframe[title="Secure payment input frame"]').first();
  // Stripe lists payment methods as an accordion; open the card form.
  const cardOption = card.getByText("Card", { exact: true });
  await expect(cardOption.or(card.locator('[name="number"]')).first()).toBeVisible({ timeout: 60_000 });
  if (!(await card.locator('[name="number"]').isVisible().catch(() => false))) await cardOption.click();
  await card.locator('[name="number"]').fill("4242424242424242");
  await card.locator('[name="expiry"]').fill("12 / 34");
  await card.locator('[name="cvc"]').fill("123");
  const postal = card.locator('[name="postalCode"]');
  if (await postal.isVisible().catch(() => false)) await postal.fill("95113");

  // A double click must still produce exactly one order.
  await pay.dblclick();
  await expect(page).toHaveURL(/\/orders\/[0-9a-f-]{36}/, { timeout: 90_000 });
  await expect(main).toContainText("Total paid");
  await expect(main).toContainText("$31.00");
  await expect(main).toContainText(product.name);

  // Stock went from 5 to 3, and the cart is empty again.
  const inventory = await (await manager.get(`/api/staff/inventory?q=${product.sku}`)).json();
  expect(JSON.stringify(inventory)).toContain('"stockQuantity":3');
  expect((await (await page.request.get("/api/cart")).json()).items).toHaveLength(0);

  // The confirmation URL is private to its owner.
  const orderUrl = page.url();
  await page.request.post("/api/auth/logout");
  await page.goto(orderUrl);
  await expect(page).toHaveURL(/\/login/);
});
