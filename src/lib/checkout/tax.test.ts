import { describe, expect, it } from "vitest";
import { calculateDemoTaxCents } from "./tax";

describe("5% demo tax on item subtotal only", () => {
  // 9/10 and 29/30 cent subtotals straddle half-cent rounding thresholds.
  it.each([[0, 0], [1, 0], [9, 0], [10, 1], [19, 1], [29, 1], [30, 2], [500, 25], [1999, 100]])(
    "%i cents yields %i tax cents (half up)", (subtotal, tax) => {
      expect(calculateDemoTaxCents(subtotal)).toBe(tax);
    },
  );
  it.each([-1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])("rejects %s", (value) => {
    expect(() => calculateDemoTaxCents(value)).toThrow(RangeError);
  });
  it("does not overflow when multiplying large safe integers", () => {
    expect(calculateDemoTaxCents(Number.MAX_SAFE_INTEGER)).toBe(450359962737050);
  });
});
