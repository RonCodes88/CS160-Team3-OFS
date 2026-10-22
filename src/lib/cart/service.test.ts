import { describe, expect, it } from "vitest";
import { withCartTotals, type CartRow } from "./service";

// One product line at a chosen total weight, to hit the fee and limit boundaries.
function cartAt(totalWeight: number, priceCents = 250): CartRow {
    return {
        cart_id: "cart",
        total_weight: totalWeight,
        items: [{
            product_id: "p1", sku: "SKU", name: "Rice", description: "",
            price_cents: priceCents, unit_weight: totalWeight, quantity: 1, line_weight: totalWeight,
        }],
    };
}

describe("withCartTotals", () => {
    it("returns zero totals for an empty cart", () => {
        expect(withCartTotals({ cart_id: "cart", total_weight: 0, items: [] })).toMatchObject({
            subtotal_cents: 0, total_weight: 0, delivery_fee_cents: 0, total_cents: 0,
            fee_warning: false, over_weight_limit: false,
        });
    });

    it("multiplies server prices and weights by quantity", () => {
        const cart: CartRow = {
            cart_id: "cart", total_weight: 0, items: [
                { product_id: "a", sku: "A", name: "Milk", description: "", price_cents: 499, unit_weight: 860, quantity: 2, line_weight: 1720 },
                { product_id: "b", sku: "B", name: "Eggs", description: "", price_cents: 549, unit_weight: 150, quantity: 1, line_weight: 150 },
            ],
        };
        expect(withCartTotals(cart)).toMatchObject({
            subtotal_cents: 1547, total_weight: 1870, delivery_fee_cents: 0, total_cents: 1547, fee_warning: true,
        });
    });

    it.each([
        [1799, 0, false, false],
        [1800, 0, true, false],
        [1999, 0, true, false],
        [2000, 1000, false, false],
        [19999, 1000, false, false],
        [20000, 1000, false, false],
        [20001, 1000, false, true],
    ])("at weight %i charges fee %i (warning %s, over limit %s)", (weight, fee, warning, over) => {
        expect(withCartTotals(cartAt(weight))).toMatchObject({
            total_weight: weight, delivery_fee_cents: fee, total_cents: 250 + fee,
            fee_warning: warning, over_weight_limit: over,
        });
    });
});
