import { Card } from "@/components/ui/Card";
import type { CartItem } from "@/components/cart/cartApi";
import { formatCents, formatWeight } from "@/lib/cart/format";
import { DELIVERY_FEE_CENTS, FREE_DELIVERY_WEIGHT_LIMIT } from "@/lib/cart/pricing";
import type { CheckoutPreview } from "./checkoutApi";

/**
 * The order summary shown before payment. Totals are the server's checkout
 * preview, shown as given; line prices come from the server-priced cart.
 */
export function OrderReview({ items, preview }: { items: CartItem[]; preview: CheckoutPreview }) {
  return (
    <Card>
      <h2 className="text-3xl">2. Review your order</h2>

      <ul className="mt-6 divide-y-2 divide-dashed divide-pencil/30 text-lg">
        {items.map((item) => (
          <li key={item.productId} className="flex justify-between gap-4 py-2">
            <span>
              {item.name} <span className="text-pencil/70">× {item.quantity}</span>
            </span>
            <span className="tabular-nums">{formatCents(item.unitPriceCents * item.quantity)}</span>
          </li>
        ))}
      </ul>

      {preview.feeWarning && (
        <p className="mt-4 rotate-1 border-2 border-pencil bg-postit p-3 text-lg shadow-hard-sm">
          Heads up: you&apos;re {formatWeight(FREE_DELIVERY_WEIGHT_LIMIT - preview.totalWeight)} away from the{" "}
          {formatCents(DELIVERY_FEE_CENTS)} delivery fee.
        </p>
      )}

      <dl className="mt-6 space-y-2 text-xl">
        <Row label="Subtotal" value={formatCents(preview.subtotalCents)} />
        <Row label="Total weight" value={formatWeight(preview.totalWeight)} />
        <Row label="Delivery" value={preview.deliveryFeeCents === 0 ? "Free" : formatCents(preview.deliveryFeeCents)} />
        <Row label="Tax" value={formatCents(preview.taxCents)} />
        <div className="flex justify-between border-t-2 border-dashed border-pencil pt-3 font-heading text-2xl">
          <dt>Total</dt>
          <dd className="tabular-nums">{formatCents(preview.totalCents)}</dd>
        </div>
      </dl>
    </Card>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between">
      <dt>{label}</dt>
      <dd className="tabular-nums">{value}</dd>
    </div>
  );
}
