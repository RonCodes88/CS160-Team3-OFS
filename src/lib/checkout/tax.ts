/**
 * Class-project simplification, not California tax compliance. Returned with
 * preview totals so the future UI can label the charge honestly and consistently.
 */
export const DEMO_TAX_POLICY = {
  label: "Demo tax (5%)",
  description: "Simplified tax rate for this class project.",
  // One basis point is 0.01 percentage points: 500 basis points = 5%.
  rateBasisPoints: 500,
  excludesDelivery: true,
  rounding: "half-up",
} as const;

/** 5% of item subtotal, rounded once to the nearest cent (half up). */
export function calculateDemoTaxCents(subtotalCents: number): number {
  if (!Number.isSafeInteger(subtotalCents) || subtotalCents < 0) {
    throw new RangeError("Subtotal must be non-negative safe integer cents.");
  }
  // 5% = 1/20. Avoid multiplying and overflowing an otherwise safe subtotal.
  // A remainder of 10 represents half a tax cent, so round it up. For example,
  // a 250-cent subtotal produces 12.5 tax cents, rounded to 13 cents.
  return Math.floor(subtotalCents / 20) + (subtotalCents % 20 >= 10 ? 1 : 0);
}
