import { describe, expect, it } from "vitest";
import {
  DELIVERY_FEE_CENTS,
  FEE_WARNING_WEIGHT,
  FREE_DELIVERY_WEIGHT_LIMIT,
  MAX_CART_WEIGHT,
  calculateDeliveryFee,
  isNearFeeThreshold,
  priceCart,
  type PricedLine,
} from "./pricing";

// Weight is hundredths of a pound: 2000 = 20.00 lbs.
const line = (unitPriceCents: number, unitWeight: number, quantity = 1): PricedLine => ({
  unitPriceCents,
  unitWeight,
  quantity,
});

describe("business rule constants", () => {
  it("match the spec", () => {
    expect(DELIVERY_FEE_CENTS).toBe(1000);
    expect(FREE_DELIVERY_WEIGHT_LIMIT).toBe(2000);
    expect(FEE_WARNING_WEIGHT).toBe(1800);
    expect(MAX_CART_WEIGHT).toBe(20000);
  });
});

describe("calculateDeliveryFee", () => {
  it.each([
    [0, 0],
    [1, 0],
    [1999, 0], // 19.99 lbs
    [2000, 1000], // 20.00 lbs
    [2001, 1000],
    [19999, 1000], // 199.99 lbs
    [20000, 1000], // 200.00 lbs
  ])("weight %i -> fee %i cents", (weight, fee) => {
    expect(calculateDeliveryFee(weight)).toBe(fee);
  });

  it.each([-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])("rejects invalid weight %s", (weight) => {
    expect(() => calculateDeliveryFee(weight)).toThrow(RangeError);
  });
});

describe("isNearFeeThreshold", () => {
  it.each([
    [0, false],
    [1799, false],
    [1800, true], // 18.00 lbs
    [1999, true], // 19.99 lbs
    [2000, false], // fee already applies
    [20000, false],
  ])("weight %i -> %s", (weight, expected) => {
    expect(isNearFeeThreshold(weight)).toBe(expected);
  });
});

describe("priceCart", () => {
  it("prices an empty cart as zero with no fee", () => {
    expect(priceCart([])).toEqual({
      subtotalCents: 0,
      totalWeight: 0,
      deliveryFeeCents: 0,
      totalCents: 0,
      feeWarning: false,
      overWeightLimit: false,
    });
  });

  it("multiplies unit price and weight by quantity and sums lines", () => {
    const result = priceCart([line(399, 150, 3), line(1250, 200, 2)]);
    expect(result.subtotalCents).toBe(399 * 3 + 1250 * 2);
    expect(result.totalWeight).toBe(150 * 3 + 200 * 2);
    expect(result.deliveryFeeCents).toBe(0);
    expect(result.totalCents).toBe(result.subtotalCents);
  });

  it("charges no fee at 19.99 lbs", () => {
    const result = priceCart([line(500, 1999)]);
    expect(result).toMatchObject({ deliveryFeeCents: 0, totalCents: 500, feeWarning: true });
  });

  it("charges the $10 fee at exactly 20.00 lbs", () => {
    const result = priceCart([line(500, 1000, 2)]);
    expect(result).toMatchObject({
      totalWeight: 2000,
      deliveryFeeCents: 1000,
      totalCents: 1000 + 1000,
      feeWarning: false,
    });
  });

  it("warns starting at 18.00 lbs", () => {
    expect(priceCart([line(100, 1799)]).feeWarning).toBe(false);
    expect(priceCart([line(100, 1800)]).feeWarning).toBe(true);
  });

  it("allows 199.99 and 200.00 lbs", () => {
    expect(priceCart([line(100, 19999)]).overWeightLimit).toBe(false);
    expect(priceCart([line(100, 10000, 2)]).overWeightLimit).toBe(false);
  });

  it("flags carts above 200.00 lbs", () => {
    const result = priceCart([line(100, 10000, 2), line(100, 1)]);
    expect(result.totalWeight).toBe(20001);
    expect(result.overWeightLimit).toBe(true);
    expect(result.deliveryFeeCents).toBe(1000);
  });

  it("keeps money in integer cents with no float drift", () => {
    // 0.1 + 0.2 style inputs in dollars would drift; cents never do.
    const result = priceCart([line(10, 1, 1), line(20, 1, 1)]);
    expect(result.subtotalCents).toBe(30);
    expect(Number.isInteger(result.totalCents)).toBe(true);
  });

  it.each([
    ["negative price", line(-1, 100)],
    ["fractional price", line(1.5, 100)],
    ["negative weight", line(100, -1)],
    ["fractional weight", line(100, 0.5)],
    ["zero quantity", line(100, 100, 0)],
    ["negative quantity", line(100, 100, -2)],
    ["fractional quantity", line(100, 100, 1.5)],
    ["NaN price", line(Number.NaN, 100)],
  ])("rejects a line with %s", (_label, bad) => {
    expect(() => priceCart([bad])).toThrow(RangeError);
  });
});
