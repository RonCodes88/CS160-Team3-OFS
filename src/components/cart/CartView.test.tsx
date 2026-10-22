import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CartSummary, type CartTotals } from "./CartView";

const totals = (overrides: Partial<CartTotals> = {}): CartTotals => ({
  subtotalCents: 1234, totalWeight: 500, deliveryFeeCents: 0, totalCents: 1234,
  feeWarning: false, overWeightLimit: false, ...overrides,
});

const render = (itemCount: number, value: CartTotals) =>
  renderToStaticMarkup(<CartSummary itemCount={itemCount} totals={value} />);

describe("CartSummary", () => {
  it("shows the server's totals as given and links to checkout", () => {
    // Deliberately inconsistent numbers: the summary must not recompute them.
    const html = render(2, totals({ subtotalCents: 1234, deliveryFeeCents: 1000, totalCents: 9999, totalWeight: 2000 }));
    expect(html).toContain("$12.34");
    expect(html).toContain("$10.00");
    expect(html).toContain("$99.99");
    expect(html).toContain("20.00 lb");
    expect(html).toContain('href="/checkout"');
  });

  it("shows Free delivery and no warning under the threshold", () => {
    const html = render(1, totals({ totalWeight: 1799 }));
    expect(html).toContain("Free");
    expect(html).not.toContain("Heads up");
  });

  it("warns when the server flags the cart as near the fee", () => {
    const html = render(1, totals({ totalWeight: 1999, feeWarning: true }));
    expect(html).toContain("Heads up");
    expect(html).toContain("0.01 lb");
  });

  it("disables checkout for an empty cart", () => {
    const html = render(0, totals({ subtotalCents: 0, totalWeight: 0, totalCents: 0 }));
    expect(html).not.toContain('href="/checkout"');
    expect(html).toContain("Add an item to check out.");
  });

  it("disables checkout and explains the 200 lb limit when over weight", () => {
    const html = render(3, totals({ totalWeight: 20001, deliveryFeeCents: 1000, overWeightLimit: true }));
    expect(html).not.toContain('href="/checkout"');
    expect(html).toContain("This cart is over");
    expect(html).toContain("200.00 lb");
    expect(html).toContain("Bring the cart under the weight limit to check out.");
  });
});
