import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { formatCents, formatWeight } from "@/lib/cart/format";
import {
  DELIVERY_FEE_CENTS,
  FREE_DELIVERY_WEIGHT_LIMIT,
  MAX_CART_WEIGHT,
} from "@/lib/cart/pricing";
import type { CartTotals } from "./cartApi";
import { WeightMeter } from "./WeightMeter";

/**
 * Server-priced totals, fee and weight warnings, and the checkout button,
 * which stays disabled while the cart is empty or over the weight limit.
 */
export function CartSummary({
  itemCount,
  totals,
}: {
  itemCount: number;
  totals: CartTotals;
}) {
  const canCheckout = itemCount > 0 && !totals.overWeightLimit;

  return (
    <aside aria-label="Order summary">
      <Card
        decoration="tack"
        className="lg:sticky lg:top-6"
      >
        <h2 className="text-3xl">Summary</h2>

        <WeightMeter totalWeight={totals.totalWeight} />

        {totals.feeWarning && (
          <p className="mt-4 rotate-1 border-2 border-pencil bg-postit p-3 text-lg shadow-hard-sm">
            Heads up: you&apos;re{" "}
            {formatWeight(
              FREE_DELIVERY_WEIGHT_LIMIT -
              totals.totalWeight,
            )}{" "}
            away from the{" "}
            {formatCents(DELIVERY_FEE_CENTS)} delivery fee.
          </p>
        )}

        {totals.overWeightLimit && (
          <p className="mt-4 border-[3px] border-marker bg-white p-3 text-lg">
            This cart is over{" "}
            {formatWeight(MAX_CART_WEIGHT)}. Remove some
            items to check out.
          </p>
        )}

        <dl className="mt-6 space-y-2 text-xl">
          <Row
            label="Subtotal"
            value={formatCents(totals.subtotalCents)}
          />

          <Row
            label="Total weight"
            value={formatWeight(totals.totalWeight)}
          />

          <Row
            label="Delivery"
            value={
              totals.deliveryFeeCents === 0
                ? "Free"
                : formatCents(totals.deliveryFeeCents)
            }
          />

          <div className="flex justify-between border-t-2 border-dashed border-pencil pt-3 font-heading text-2xl">
            <dt>Total</dt>
            <dd className="tabular-nums">
              {formatCents(totals.totalCents)}
            </dd>
          </div>
        </dl>

        {canCheckout ? (
          <Button href="/checkout" className="mt-6 w-full">
            Checkout
          </Button>
        ) : (
          <Button className="mt-6 w-full" disabled>
            Checkout
          </Button>
        )}

        {!canCheckout && (
          <p className="mt-2 text-base text-pencil/70">
            {itemCount === 0
              ? "Add an item to check out."
              : "Bring the cart under the weight limit to check out."}
          </p>
        )}

        <p className="mt-6 text-sm text-pencil/60">
          Delivery is free under{" "}
          {formatWeight(FREE_DELIVERY_WEIGHT_LIMIT)}.
          Orders can weigh up to{" "}
          {formatWeight(MAX_CART_WEIGHT)}.
        </p>
      </Card>
    </aside>
  );
}

function Row({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div className="flex justify-between">
      <dt>{label}</dt>
      <dd className="tabular-nums">{value}</dd>
    </div>
  );
}
