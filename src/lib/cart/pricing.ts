// Server-side cart pricing. Money is integer cents; weight is integer
// hundredths of a pound (2000 = 20.00 lbs). Callers must build lines from
// product rows loaded on the server, never from prices or weights the client
// sent.

export const DELIVERY_FEE_CENTS = 1000;
/** Carts at or above this weight pay the delivery fee. */
export const FREE_DELIVERY_WEIGHT_LIMIT = 2000;
/** Carts at or above this weight (but still free) get a fee warning. */
export const FEE_WARNING_WEIGHT = 1800;
/** Heaviest cart we accept; anything above is rejected, never split. */
export const MAX_CART_WEIGHT = 20000;

export type PricedLine = {
  unitPriceCents: number;
  unitWeight: number;
  quantity: number;
};

export type CartPricing = {
  subtotalCents: number;
  totalWeight: number;
  deliveryFeeCents: number;
  totalCents: number;
  /** True when the cart is still free but close to the fee threshold. */
  feeWarning: boolean;
  /** True when the cart exceeds MAX_CART_WEIGHT and must not be checked out. */
  overWeightLimit: boolean;
};

function assertNonNegativeInt(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`${name} must be a non-negative integer, got ${value}`);
  }
}

export function calculateDeliveryFee(totalWeight: number): number {
  assertNonNegativeInt(totalWeight, "totalWeight");
  return totalWeight >= FREE_DELIVERY_WEIGHT_LIMIT ? DELIVERY_FEE_CENTS : 0;
}

export function isNearFeeThreshold(totalWeight: number): boolean {
  assertNonNegativeInt(totalWeight, "totalWeight");
  return totalWeight >= FEE_WARNING_WEIGHT && totalWeight < FREE_DELIVERY_WEIGHT_LIMIT;
}

export function priceCart(lines: readonly PricedLine[]): CartPricing {
  let subtotalCents = 0;
  let totalWeight = 0;

  for (const { unitPriceCents, unitWeight, quantity } of lines) {
    assertNonNegativeInt(unitPriceCents, "unitPriceCents");
    assertNonNegativeInt(unitWeight, "unitWeight");
    if (!Number.isSafeInteger(quantity) || quantity < 1) {
      throw new RangeError(`quantity must be a positive integer, got ${quantity}`);
    }
    subtotalCents += unitPriceCents * quantity;
    totalWeight += unitWeight * quantity;
  }

  const deliveryFeeCents = calculateDeliveryFee(totalWeight);

  return {
    subtotalCents,
    totalWeight,
    deliveryFeeCents,
    totalCents: subtotalCents + deliveryFeeCents,
    feeWarning: isNearFeeThreshold(totalWeight),
    overWeightLimit: totalWeight > MAX_CART_WEIGHT,
  };
}
