"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, ShoppingBasket } from "lucide-react";
import { Card } from "@/components/ui/Card";
import { StickyTag } from "@/components/ui/StickyTag";
import {
  EMPTY_TOTALS,
  mapCartItems,
  mapCartTotals,
  type ApiCartResponse,
  type CartItem,
  type CartTotals,
} from "./cartApi";
import { CartItemRow } from "./CartItemRow";
import { CartSummary } from "./CartSummary";

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
              {items.map((item) => (
                <CartItemRow
                  key={item.productId}
                  item={item}
                  isBusy={updatingId === item.productId}
                  onChange={change}
                />
              ))}
            </ul>
          )}
        </div>

        <CartSummary itemCount={items.length} totals={totals} />
      </div>
    </section>
  );
}
