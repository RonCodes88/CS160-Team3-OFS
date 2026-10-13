import { describe, expect, it, vi } from "vitest";
import { previewCheckout, type CheckoutDependencies, type CheckoutTotals } from "./validation";

function fixture(weight = 100) {
  const cart = { customerId: "customer", status: "ACTIVE", items: [{ productId: "apple", quantity: 2 }] };
  const address = { id: "address", customerId: "customer", eligible: true };
  const products = [{ id: "apple", isActive: true, unitPriceCents: 250, unitWeight: weight, stockQuantity: 2 }];
  const deps = {
    getActiveCart: vi.fn(async () => cart),
    getAddress: vi.fn(async () => address),
    getProducts: vi.fn(async () => products),
    calculateTaxCents: vi.fn(async () => 40),
  } satisfies CheckoutDependencies;
  const expected: CheckoutTotals = {
    subtotalCents: 500, totalWeight: weight * 2,
    deliveryFeeCents: weight * 2 >= 2000 ? 1000 : 0,
    taxCents: 40, totalCents: weight * 2 >= 2000 ? 1540 : 540,
  };
  const run = () => previewCheckout("customer", { addressId: "address", expected }, deps);
  return { cart, address, products, deps, expected, run };
}

describe("checkout preview validation", () => {
  it("uses authoritative product data and the supplied tax service without changing the cart", async () => {
    const f = fixture();
    const before = structuredClone(f.cart);
    expect(await f.run()).toEqual({ ok: true, value: { ...f.expected, feeWarning: false } });
    expect(f.deps.getActiveCart).toHaveBeenCalledWith("customer");
    expect(f.deps.getAddress).toHaveBeenCalledWith("customer", "address");
    expect(f.deps.getProducts).toHaveBeenCalledWith(["apple"]);
    expect(f.deps.calculateTaxCents).toHaveBeenCalledWith(500, f.address);
    expect(f.cart).toEqual(before);
  });

  it.each([[1799, 0, false], [1800, 0, true], [1999, 0, true], [2000, 1000, false],
    [19999, 1000, false], [20000, 1000, false]])("accepts weight %i with fee %i", async (weight, fee, warning) => {
    const f = fixture(weight as number);
    f.cart.items[0].quantity = 1;
    Object.assign(f.expected, { subtotalCents: 250, totalWeight: weight, deliveryFeeCents: fee, totalCents: 290 + (fee as number) });
    expect(await f.run()).toEqual({ ok: true, value: { ...f.expected, feeWarning: warning } });
  });

  it("rejects above 200 lb before calculating tax", async () => {
    const f = fixture(20001);
    f.cart.items[0].quantity = 1;
    expect(await f.run()).toMatchObject({ ok: false, error: { code: "CART_OVERWEIGHT" } });
    expect(f.deps.calculateTaxCents).not.toHaveBeenCalled();
  });

  it.each(["subtotalCents", "totalWeight", "deliveryFeeCents", "taxCents", "totalCents"] as const)("rejects changed %s and returns current totals", async (key) => {
    const f = fixture();
    const current = { ...f.expected, feeWarning: false };
    f.expected[key]++;
    expect(await f.run()).toMatchObject({ ok: false, error: { code: "TOTALS_MISMATCH" }, current });
  });

  it.each([null, {}, { addressId: "" }, { addressId: "address" }, { addressId: "address", expected: {} }])("rejects incomplete input %j", async (input) => {
    const f = fixture();
    expect(await previewCheckout("customer", input, f.deps)).toMatchObject({ ok: false });
    expect(f.deps.getActiveCart).not.toHaveBeenCalled();
  });

  it.each([-1, 1.5, NaN, Infinity, "500", Number.MAX_SAFE_INTEGER + 1])("rejects invalid expected amounts %s", async (bad) => {
    const f = fixture();
    expect(await previewCheckout("customer", { addressId: "address", expected: { ...f.expected, totalCents: bad } }, f.deps))
      .toMatchObject({ ok: false, error: { code: "INVALID_TOTALS" } });
  });

  it("requires an address", async () => {
    const f = fixture();
    expect(await previewCheckout("customer", { expected: f.expected }, f.deps))
      .toMatchObject({ ok: false, error: { code: "ADDRESS_REQUIRED" } });
  });

  it.each(["empty", "missing", "foreign", "checked out"])("rejects a %s cart", async (kind) => {
    const f = fixture();
    const deps: CheckoutDependencies = { ...f.deps, getActiveCart: async () => kind === "missing" ? null : f.cart };
    if (kind === "empty") f.cart.items = [];
    if (kind === "foreign") f.cart.customerId = "other";
    if (kind === "checked out") f.cart.status = "CHECKED_OUT";
    expect(await previewCheckout("customer", { addressId: "address", expected: f.expected }, deps))
      .toMatchObject({ ok: false, error: { code: kind === "empty" ? "CART_EMPTY" : "CART_UNAVAILABLE" } });
    expect(f.deps.getProducts).not.toHaveBeenCalled();
  });

  it.each(["missing", "foreign", "outside", "wrong id"])("rejects a %s address", async (kind) => {
    const f = fixture();
    if (kind === "foreign") f.address.customerId = "other";
    if (kind === "outside") f.address.eligible = false;
    if (kind === "wrong id") f.address.id = "another-address";
    const deps: CheckoutDependencies = { ...f.deps, getAddress: async () => kind === "missing" ? null : f.address };
    expect(await previewCheckout("customer", { addressId: "address", expected: f.expected }, deps))
      .toMatchObject({ ok: false, error: { code: "ADDRESS_INVALID" } });
  });

  it.each(["missing", "retired", "out of stock", "insufficient stock"])("rejects %s products", async (kind) => {
    const f = fixture();
    if (kind === "missing") f.products.length = 0;
    else if (kind === "retired") f.products[0].isActive = false;
    else f.products[0].stockQuantity = kind === "out of stock" ? 0 : 1;
    expect(await f.run()).toMatchObject({ ok: false, error: {
      code: kind === "missing" || kind === "retired" ? "PRODUCT_UNAVAILABLE" : "INSUFFICIENT_STOCK", productId: "apple",
    } });
    expect(f.deps.calculateTaxCents).not.toHaveBeenCalled();
  });

  it.each([0, -1, 1.5, NaN, Number.MAX_SAFE_INTEGER + 1])("rejects invalid quantity %s", async (quantity) => {
    const f = fixture();
    f.cart.items[0].quantity = quantity;
    expect(await f.run()).toMatchObject({ ok: false, error: { code: "INVALID_QUANTITY" } });
  });

  it("rejects duplicate cart lines instead of checking their stock separately", async () => {
    const f = fixture();
    f.cart.items.push({ ...f.cart.items[0] });
    expect(await f.run()).toMatchObject({ ok: false, error: { code: "INVALID_CART" } });
  });

  it("ignores client identity, items, stock and price fields", async () => {
    const f = fixture();
    expect(await previewCheckout("customer", {
      addressId: "address", expected: f.expected, customerId: "other", role: "MANAGER",
      items: [{ productId: "apple", quantity: 1, unitPriceCents: 1, stockQuantity: 999 }],
    }, f.deps)).toMatchObject({ ok: true, value: f.expected });
    expect(f.deps.getActiveCart).toHaveBeenCalledWith("customer");
  });

  it.each([-1, 0.5, NaN, Infinity])("does not accept invalid tax %s", async (tax) => {
    const f = fixture();
    f.deps.calculateTaxCents.mockResolvedValue(tax);
    await expect(f.run()).rejects.toThrow();
  });

  it("does not silently use zero tax when the tax provider fails", async () => {
    const f = fixture();
    f.deps.calculateTaxCents.mockRejectedValue(new Error("Tax unavailable"));
    await expect(f.run()).rejects.toThrow("Tax unavailable");
  });

  it("propagates read failures for the future route's generic error handler", async () => {
    const f = fixture();
    f.deps.getProducts.mockRejectedValue(new Error("Database unavailable"));
    await expect(f.run()).rejects.toThrow("Database unavailable");
  });

  it("rejects unsafe subtotal arithmetic", async () => {
    const f = fixture();
    f.products[0].unitPriceCents = Number.MAX_SAFE_INTEGER;
    await expect(f.run()).rejects.toThrow();
  });
});
