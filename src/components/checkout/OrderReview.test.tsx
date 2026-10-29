import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { OrderReview } from "./OrderReview";
import type { CheckoutPreview } from "./checkoutApi";

const items = [
  { productId: "p1", name: "Whole Milk", unitLabel: "gal", unitPriceCents: 449, unitWeight: 860, quantity: 2 },
  { productId: "p2", name: "Bananas", unitLabel: "lb", unitPriceCents: 79, unitWeight: 100, quantity: 3 },
];
const preview = (overrides: Partial<CheckoutPreview> = {}): CheckoutPreview => ({
  subtotalCents: 1135, totalWeight: 2020, deliveryFeeCents: 1000, taxCents: 57, totalCents: 2192, feeWarning: false, ...overrides,
});
const render = (value: CheckoutPreview) => renderToStaticMarkup(<OrderReview items={items} preview={value} />);

describe("OrderReview", () => {
  it("lists each line and shows the server's totals, fee and tax as given", () => {
    const html = render(preview());
    expect(html).toContain("Whole Milk");
    expect(html).toContain("$8.98");
    expect(html).toContain("$2.37");
    expect(html).toContain("$11.35");
    expect(html).toContain("20.20 lb");
    expect(html).toContain("$10.00");
    expect(html).toContain("$0.57");
    expect(html).toContain("$21.92");
  });

  it("shows free delivery under 20 lb and warns near the fee", () => {
    const html = render(preview({ totalWeight: 1999, deliveryFeeCents: 0, feeWarning: true, totalCents: 1192 }));
    expect(html).toContain("Free");
    expect(html).toContain("Heads up");
    expect(html).toContain("0.01 lb");
  });

  it("does not warn when the server doesn't flag the cart", () => {
    expect(render(preview({ totalWeight: 1799, deliveryFeeCents: 0 }))).not.toContain("Heads up");
  });
});
