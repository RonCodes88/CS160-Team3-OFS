import { expect, test } from "@playwright/test";

const initialCart = {
  cart_id: "cart",
  items: [
    { product_id: "apple", name: "Apples", price_cents: 300, unit_weight: 100, quantity: 1 },
    { product_id: "pear", name: "Pears", price_cents: 400, unit_weight: 200, quantity: 1 },
  ],
  subtotal_cents: 700, total_weight: 300, delivery_fee_cents: 0,
  total_cents: 700, fee_warning: false, over_weight_limit: false,
};

test("cart blocks overlapping product changes and checkout until the server replies", async ({ page }) => {
  let finish: () => void = () => {};
  const pending = new Promise<void>((resolve) => { finish = resolve; });
  let mutations = 0;
  await page.route("**/api/cart", async (route) => {
    if (route.request().method() !== "POST") return route.fulfill({ json: initialCart });
    mutations++;
    await pending;
    return route.fulfill({ json: {
      ...initialCart,
      items: initialCart.items.map((item) => item.product_id === "apple" ? { ...item, quantity: 2 } : item),
      subtotal_cents: 1000, total_weight: 400, total_cents: 1000,
    } });
  });
  await page.goto("/cart");
  await page.getByRole("button", { name: "Add one Apples", exact: true }).click();
  await expect(page.getByRole("button", { name: "Add one Pears", exact: true })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Checkout", exact: true })).toBeDisabled();
  finish();
  await expect(page.getByRole("link", { name: "Checkout", exact: true })).toBeVisible();
  await expect(page.getByRole("group", { name: "Quantity of Apples" })).toContainText("2");
  await expect(page.getByRole("group", { name: "Quantity of Pears" })).toContainText("1");
  await expect(page.getByRole("complementary", { name: "Order summary" })).toContainText("$10.00");
  expect(mutations).toBe(1);
});

test("a rejected cart change preserves the server cart and allows retry", async ({ page }) => {
  let mutations = 0;
  await page.route("**/api/cart", async (route) => {
    if (route.request().method() !== "POST") return route.fulfill({ json: initialCart });
    mutations++;
    if (mutations === 1) return route.fulfill({ status: 409, json: {
      error: { code: "INSUFFICIENT_STOCK", message: "Requested quantity exceeds available stock." },
    } });
    return route.fulfill({ json: { ...initialCart, items: initialCart.items.filter((item) => item.product_id !== "apple") } });
  });
  await page.goto("/cart");
  await page.getByRole("button", { name: "Add one Apples", exact: true }).click();
  await expect(page.getByRole("main").getByRole("alert")).toContainText("exceeds available stock");
  await expect(page.getByRole("group", { name: "Quantity of Apples" })).toContainText("1");
  await page.getByRole("button", { name: "Remove Apples from cart", exact: true }).click();
  await expect(page.getByRole("group", { name: "Quantity of Apples" })).toHaveCount(0);
  await expect(page.getByRole("group", { name: "Quantity of Pears" })).toBeVisible();
});

test("an expired session displays a recoverable message without a checkout link", async ({ page }) => {
  await page.route("**/api/cart", (route) => route.fulfill({ status: 401, json: { error: { message: "Login required" } } }));
  await page.goto("/cart");
  await expect(page.getByRole("main").getByRole("alert")).toContainText("Please log in");
  await expect(page.getByRole("link", { name: "Checkout", exact: true })).toHaveCount(0);
});

test("two tabs read committed changes and recover after navigation and reload", async ({ context }) => {
  let cart = structuredClone(initialCart);
  await context.route("**/api/cart", async (route) => {
    if (route.request().method() === "POST") {
      const { productId, quantity } = route.request().postDataJSON();
      cart = { ...cart, items: cart.items
        .map((item) => item.product_id === productId ? { ...item, quantity } : item)
        .filter((item) => item.quantity > 0) };
    }
    await route.fulfill({ json: cart });
  });
  const first = await context.newPage();
  await first.goto("/cart");
  await first.getByRole("button", { name: "Add one Apples", exact: true }).click();
  await expect(first.getByRole("group", { name: "Quantity of Apples" })).toContainText("2");
  const second = await context.newPage();
  await second.goto("/cart");
  await expect(second.getByRole("group", { name: "Quantity of Apples" })).toContainText("2");
  await second.getByRole("button", { name: "Remove Pears from cart", exact: true }).click();
  await expect(second.getByRole("group", { name: "Quantity of Pears" })).toHaveCount(0);
  await first.reload();
  await expect(first.getByRole("group", { name: "Quantity of Pears" })).toHaveCount(0);
  await expect(first.getByRole("group", { name: "Quantity of Apples" })).toContainText("2");
});

test("public account navigation survives failed login, back, reload, and a second tab", async ({ context, page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await context.route("**/api/cart", (route) => route.fulfill({ json: { ...initialCart, items: [] } }));
  await context.route("**/api/auth/login", (route) => route.fulfill({ status: 500, contentType: "text/plain", body: "Unavailable" }));
  await page.goto("/");
  await page.getByRole("navigation", { name: "Main", exact: true }).getByRole("link", { name: "Log in", exact: true }).click();
  await page.getByLabel("Email", { exact: true }).fill("tester@example.test");
  await page.getByLabel("Password", { exact: true }).fill("UnsentPassword123!");
  await page.getByRole("button", { name: "Log in", exact: true }).click();
  await expect(page.getByRole("main").getByRole("alert")).toContainText("Please try again");
  await expect(page.getByRole("button", { name: "Log in", exact: true })).toBeEnabled();
  await page.getByRole("link", { name: "Create an account", exact: true }).click();
  await expect(page.getByRole("button", { name: "Create account", exact: true })).toBeVisible();
  await page.reload();
  await page.getByRole("main").getByRole("link", { name: "Log in", exact: true }).click();
  await expect(page.getByRole("button", { name: "Log in", exact: true })).toBeVisible();
  await page.goBack();
  await expect(page.getByRole("button", { name: "Create account", exact: true })).toBeVisible();
  const anotherTab = await context.newPage();
  await anotherTab.goto("/cart");
  await expect(anotherTab.getByRole("main")).toContainText("Your cart is empty");
  expect(errors).toEqual([]);
});
