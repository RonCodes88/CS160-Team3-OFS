"use client";

import { useEffect, useState } from "react";
import {
  AlertTriangle,
  Minus,
  Plus,
  ShoppingBasket,
  Trash2,
  Truck,
} from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { StickyTag } from "@/components/ui/StickyTag";
import { formatCents, formatWeight } from "@/lib/cart/format";
import {
  DELIVERY_FEE_CENTS,
  FREE_DELIVERY_WEIGHT_LIMIT,
  MAX_CART_WEIGHT,
} from "@/lib/cart/pricing";

type CartItem = {
  productId: string;
  name: string;
  unitLabel: string;
  unitPriceCents: number;
  /** Hundredths of a pound. */
  unitWeight: number;
  quantity: number;
};

/** Totals as priced by the server; the page never recalculates them. */
export type CartTotals = {
  subtotalCents: number;
  totalWeight: number;
  deliveryFeeCents: number;
  totalCents: number;
  feeWarning: boolean;
  overWeightLimit: boolean;
};

const EMPTY_TOTALS: CartTotals = {
  subtotalCents: 0,
  totalWeight: 0,
  deliveryFeeCents: 0,
  totalCents: 0,
  feeWarning: false,
  overWeightLimit: false,
};

type ApiCartItem = {
  product_id: string;
  name: string;
  unit_label?: string;
  price_cents: number;
  unit_weight: number;
  quantity: number;
};

type ApiCartResponse = {
  items?: ApiCartItem[];
  subtotal_cents?: number;
  total_weight?: number;
  delivery_fee_cents?: number;
  total_cents?: number;
  fee_warning?: boolean;
  over_weight_limit?: boolean;
  error?: {
    message?: string;
  };
};

function mapCartItems(data: ApiCartResponse): CartItem[] {
  return (data.items ?? []).map((item: ApiCartItem) => ({
    productId: item.product_id,
    name: item.name,
    unitLabel: item.unit_label ?? "unit",
    unitPriceCents: item.price_cents,
    unitWeight: item.unit_weight,
    quantity: item.quantity,
  }));
}

function mapCartTotals(data: ApiCartResponse): CartTotals {
  return {
    subtotalCents: data.subtotal_cents ?? 0,
    totalWeight: data.total_weight ?? 0,
    deliveryFeeCents: data.delivery_fee_cents ?? 0,
    totalCents: data.total_cents ?? 0,
    feeWarning: data.fee_warning ?? false,
    overWeightLimit: data.over_weight_limit ?? false,
  };
}

const stepButton =
  "inline-flex h-10 w-10 items-center justify-center rounded-wobbly border-2 border-pencil bg-white shadow-hard-sm transition-all duration-100 hover:bg-postit active:translate-x-[2px] active:translate-y-[2px] active:shadow-none disabled:pointer-events-none disabled:opacity-40";

export function CartView() {
  const [items, setItems] = useState<CartItem[]>([]);
  const [totals, setTotals] = useState<CartTotals>(EMPTY_TOTALS);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [updatingId, setUpdatingId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function loadCart() {
      try {
        const response = await fetch("/api/cart", {
          cache: "no-store",
        });

        if (!response.ok) {
          if (response.status === 401) {
            if (!cancelled) {
              setError("Please log in to access your cart.");
            }
            return;
          }

          throw new Error("Failed to load your cart.");
        }

        const data = (await response.json()) as ApiCartResponse;

        if (!cancelled) {
          setItems(mapCartItems(data));
          setTotals(mapCartTotals(data));
        }
      } catch (error: unknown) {
        if (!cancelled) {
          setError(
            error instanceof Error
              ? error.message
              : "Something went wrong.",
          );
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    void loadCart();

    return () => {
      cancelled = true;
    };
  }, []);

  async function change(productId: string, quantity: number) {
    setError(null);
    setUpdatingId(productId);

    try {
      const response = await fetch("/api/cart", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          productId,
          quantity,
        }),
      });

      const data = (await response.json()) as ApiCartResponse;

      if (!response.ok) {
        setError(
          data.error?.message ?? "Could not update cart quantity.",
        );
        return;
      }

      setItems(mapCartItems(data));
      setTotals(mapCartTotals(data));
    } catch (error: unknown) {
      setError(
        error instanceof Error
          ? error.message
          : "Network error while updating cart.",
      );
    } finally {
      setUpdatingId(null);
    }
  }

  if (loading) {
    return (
      <section className="mx-auto w-full max-w-5xl px-4 py-12 text-center sm:px-6 md:py-16">
        <p className="animate-pulse text-2xl font-heading">
          Loading your cart...
        </p>
      </section>
    );
  }

  return (
    <section className="mx-auto w-full max-w-5xl px-4 py-12 sm:px-6 md:py-16">
      <StickyTag>Active Cart</StickyTag>

      <h1 className="mt-4 text-4xl md:text-5xl">
        Your cart
      </h1>

      <div
        role="alert"
        aria-live="assertive"
        className={
          error
            ? "mt-6 flex items-start gap-3 rounded-wobbly-md border-[3px] border-marker bg-white p-4 text-lg shadow-hard-sm"
            : "sr-only"
        }
      >
        {error && (
          <>
            <AlertTriangle
              aria-hidden
              strokeWidth={2.5}
              className="mt-1 h-6 w-6 shrink-0 text-marker"
            />

            <p className="flex-1">{error}</p>

            <button
              type="button"
              onClick={() => setError(null)}
              className="underline decoration-marker"
            >
              Dismiss
            </button>
          </>
        )}
      </div>

      <div className="mt-8 grid gap-8 lg:grid-cols-[1fr_22rem]">
        <div>
          {items.length === 0 ? (
            <Card className="text-center">
              <ShoppingBasket
                aria-hidden
                strokeWidth={2.5}
                className="mx-auto h-12 w-12"
              />

              <p className="mt-4 text-2xl">
                Your cart is empty.
              </p>
            </Card>
          ) : (
            <ul className="space-y-4">
              {items.map((item) => {
                const isBusy = updatingId === item.productId;

                return (
                  <li
                    key={item.productId}
                    className={`flex flex-wrap items-center gap-4 rounded-wobbly-md border-2 border-pencil bg-white p-4 shadow-soft transition-opacity ${isBusy
                      ? "pointer-events-none opacity-50"
                      : ""
                      }`}
                  >
                    <div className="min-w-0 flex-1">
                      <p className="font-heading text-xl">
                        {item.name}
                      </p>

                      <p className="text-base text-pencil/70">
                        {formatCents(item.unitPriceCents)} ·{" "}
                        {formatWeight(item.unitWeight)} each
                      </p>
                    </div>

                    <div
                      className="flex items-center gap-2"
                      role="group"
                      aria-label={`Quantity of ${item.name}`}
                    >
                      <button
                        type="button"
                        className={stepButton}
                        aria-label={`Remove one ${item.name}`}
                        disabled={item.quantity <= 1 || isBusy}
                        onClick={() =>
                          change(
                            item.productId,
                            item.quantity - 1,
                          )
                        }
                      >
                        <Minus
                          aria-hidden
                          strokeWidth={3}
                          className="h-4 w-4"
                        />
                      </button>

                      <span
                        className="w-8 text-center text-xl tabular-nums"
                        aria-live="polite"
                      >
                        {item.quantity}
                      </span>

                      <button
                        type="button"
                        className={stepButton}
                        aria-label={`Add one ${item.name}`}
                        disabled={isBusy}
                        onClick={() =>
                          change(
                            item.productId,
                            item.quantity + 1,
                          )
                        }
                      >
                        <Plus
                          aria-hidden
                          strokeWidth={3}
                          className="h-4 w-4"
                        />
                      </button>
                    </div>

                    <p className="w-20 text-right text-xl tabular-nums">
                      {formatCents(
                        item.unitPriceCents * item.quantity,
                      )}
                    </p>

                    <button
                      type="button"
                      className={stepButton}
                      aria-label={`Remove ${item.name} from cart`}
                      disabled={isBusy}
                      onClick={() =>
                        change(item.productId, 0)
                      }
                    >
                      <Trash2
                        aria-hidden
                        strokeWidth={2.5}
                        className="h-4 w-4"
                      />
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <CartSummary itemCount={items.length} totals={totals} />
      </div>
    </section>
  );
}

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

function WeightMeter({
  totalWeight,
}: {
  totalWeight: number;
}) {
  const free =
    totalWeight < FREE_DELIVERY_WEIGHT_LIMIT;

  const percent = Math.min(
    100,
    Math.round(
      (totalWeight * 100) / FREE_DELIVERY_WEIGHT_LIMIT,
    ),
  );

  return (
    <div className="mt-4">
      <div className="flex items-center justify-between text-base">
        <span className="inline-flex items-center gap-1">
          <Truck
            aria-hidden
            strokeWidth={2.5}
            className="h-4 w-4"
          />
          {free
            ? "Free delivery meter"
            : "Delivery fee applies"}
        </span>

        <span className="tabular-nums">
          {formatWeight(totalWeight)} /{" "}
          {formatWeight(FREE_DELIVERY_WEIGHT_LIMIT)}
        </span>
      </div>

      <div
        role="meter"
        aria-label="Cart weight toward the free delivery limit"
        aria-valuemin={0}
        aria-valuemax={FREE_DELIVERY_WEIGHT_LIMIT}
        aria-valuenow={Math.min(
          totalWeight,
          FREE_DELIVERY_WEIGHT_LIMIT,
        )}
        aria-valuetext={formatWeight(totalWeight)}
        className="mt-2 h-4 overflow-hidden rounded-wobbly border-2 border-pencil bg-white"
      >
        <div
          className={`h-full transition-[width] duration-200 ${free
            ? percent >= 90
              ? "bg-postit"
              : "bg-pen/60"
            : "bg-marker"
            }`}
          style={{ width: `${percent}%` }}
        />
      </div>
    </div>
  );
}