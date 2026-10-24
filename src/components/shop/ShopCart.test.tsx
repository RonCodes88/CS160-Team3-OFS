import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { CartTotals } from "@/components/cart/cartApi";
import type { ShopCartLine } from "@/lib/catalog/shopCart";
import { CartBar } from "./ShopCart";

const line = (quantity: number, overrides: Partial<ShopCartLine> = {}): ShopCartLine => ({
  productId: "milk", name: "Whole Milk", unitPriceCents: 499, unitWeight: 860, quantity, ...overrides,
});

const totals = (overrides: Partial<CartTotals> = {}): CartTotals => ({
  subtotalCents: 499, totalWeight: 860, deliveryFeeCents: 0, totalCents: 499,
  feeWarning: false, overWeightLimit: false, ...overrides,
});

const render = (lines: ShopCartLine[], value: CartTotals, saving = false) =>
  renderToStaticMarkup(<CartBar lines={lines} totals={value} saving={saving} error={null} onDismiss={() => {}} />);

describe("shop CartBar", () => {
  it("shows the server's subtotal and weight, not ones computed from the lines", () => {
    // Lines would price at $4.99 / 8.60 lb; the bar must show the server's numbers.
    const html = render([line(1)], totals({ subtotalCents: 1234, totalWeight: 1111 }));
    expect(html).toContain("1 item · $12.34");
    expect(html).toContain("11.11 lb");
    expect(html).not.toContain("$4.99");
    expect(html).not.toContain("8.60 lb");
    expect(html).toContain("Free delivery under 20.00 lb");
    expect(html).toContain('href="/cart"');
  });

  it("counts items from the lines so clicks show right away", () => {
    const html = render([line(2), line(1, { productId: "rice" })], totals(), true);
    expect(html).toContain("3 items · $4.99");
    expect(html).toContain("Saving…");
  });

  it("shows how far from the fee when the server sets fee_warning", () => {
    const html = render([line(1)], totals({ totalWeight: 1860, feeWarning: true }));
    expect(html).toContain("18.60 lb");
    expect(html).toContain("1.40 lb until the $10.00 delivery fee");
  });

  it("does not warn near the threshold unless the server says so", () => {
    const html = render([line(1)], totals({ totalWeight: 1860, feeWarning: false }));
    expect(html).not.toContain("until the");
    expect(html).toContain("Free delivery under 20.00 lb");
  });

  it("shows the server's delivery fee at 20.00 lb", () => {
    const html = render([line(1)], totals({ subtotalCents: 2499, totalWeight: 2000, deliveryFeeCents: 1000, totalCents: 3499 }));
    expect(html).toContain("$24.99");
    expect(html).toContain("20.00 lb · $10.00 delivery fee");
  });

  it("flags a cart the server marks over the 200 lb limit", () => {
    const html = render([line(1)], totals({ totalWeight: 20001, deliveryFeeCents: 1000, overWeightLimit: true }));
    expect(html).toContain("Over the 200.00 lb limit");
    expect(html).not.toContain("delivery fee");
  });

  it("hides the bar for an empty cart", () => {
    const html = render([], totals({ subtotalCents: 0, totalWeight: 0, totalCents: 0 }));
    expect(html).not.toContain("Cart summary");
  });
});
