"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { AlertTriangle, Check, Plus, ShoppingBasket } from "lucide-react";
import { formatCents, formatWeight } from "@/lib/cart/format";
import { FREE_DELIVERY_WEIGHT_LIMIT, priceCart } from "@/lib/cart/pricing";
import type { ShopCartLine } from "@/lib/catalog/shopCart";
import type { CatalogProduct } from "@/lib/catalog/types";

type Message = { kind: "added" | "error"; text: string };

type ApiCart = {
  items: Array<{
    product_id: string;
    name: string;
    price_cents: number;
    unit_weight: number;
    quantity: number;
  }>;
};

type ShopCartValue = {
  lines: readonly ShopCartLine[];
  add: (product: CatalogProduct) => void;
};

const ShopCartContext = createContext<ShopCartValue | null>(null);

function useShopCart(): ShopCartValue {
  const value = useContext(ShopCartContext);
  if (!value) throw new Error("useShopCart must be used inside <ShopCartProvider>");
  return value;
}

function toLines(cart: ApiCart): ShopCartLine[] {
  return cart.items.map((item) => ({
    productId: item.product_id,
    name: item.name,
    unitPriceCents: item.price_cents,
    unitWeight: item.unit_weight,
    quantity: item.quantity,
  }));
}

async function readCart(): Promise<ApiCart> {
  const response = await fetch("/api/cart", { cache: "no-store" });
  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.error?.message ?? "Unable to load your cart.");
  }

  return data as ApiCart;
}

export function ShopCartProvider({ children }: { children: ReactNode }) {
  const [lines, setLines] = useState<ShopCartLine[]>([]);
  const [message, setMessage] = useState<Message | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    readCart()
      .then((cart) => setLines(toLines(cart)))
      .catch((error: Error) => {
        // Guests may browse the shop without a cart.
        if (!error.message.includes("Sign in")) {
          setMessage({ kind: "error", text: error.message });
        }
      })
      .finally(() => setReady(true));
  }, []);

  async function add(product: CatalogProduct) {
    if (!ready) return;

    const existing = lines.find((line) => line.productId === product.id);
    const quantity = (existing?.quantity ?? 0) + 1;

    try {
      const response = await fetch("/api/cart", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          productId: product.id,
          quantity,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error?.message ?? "Unable to update your cart.");
      }

      setLines(toLines(data as ApiCart));
      setMessage({ kind: "added", text: `Added ${product.name}.` });
    } catch (error) {
      setMessage({
        kind: "error",
        text: error instanceof Error ? error.message : "Unable to update your cart.",
      });
    }
  }

  return (
    <ShopCartContext.Provider value={{ lines, add }}>
      <ShopCartSummary
        lines={lines}
        message={message}
        onDismiss={() => setMessage(null)}
      />
      {children}
    </ShopCartContext.Provider>
  );
}

function ShopCartSummary({
  lines,
  message,
  onDismiss,
}: {
  lines: readonly ShopCartLine[];
  message: Message | null;
  onDismiss: () => void;
}) {
  const pricing = priceCart(lines);
  const count = lines.reduce((sum, line) => sum + line.quantity, 0);

  return (
    <div className="mt-6 space-y-3">
      <div
        role={message?.kind === "error" ? "alert" : "status"}
        aria-live="polite"
        className={
          message
            ? `flex items-start gap-3 rounded-wobbly-md border-2 bg-white p-3 text-lg shadow-hard-sm ${message.kind === "error"
              ? "border-[3px] border-marker"
              : "border-pencil"
            }`
            : "sr-only"
        }
      >
        {message && (
          <>
            {message.kind === "error" ? (
              <AlertTriangle
                aria-hidden
                strokeWidth={2.5}
                className="mt-1 h-5 w-5 shrink-0 text-marker"
              />
            ) : (
              <Check
                aria-hidden
                strokeWidth={3}
                className="mt-1 h-5 w-5 shrink-0 text-pen"
              />
            )}

            <p className="flex-1">{message.text}</p>

            <button
              type="button"
              onClick={onDismiss}
              className="underline decoration-marker"
            >
              Dismiss
            </button>
          </>
        )}
      </div>

      {count > 0 && (
        <p className="inline-flex flex-wrap items-center gap-x-2 rounded-wobbly border-2 border-pencil bg-postit px-4 py-2 text-lg shadow-hard-sm">
          <ShoppingBasket aria-hidden strokeWidth={2.5} className="h-5 w-5" />

          <span>
            {count} {count === 1 ? "item" : "items"} ·{" "}
            {formatCents(pricing.subtotalCents)} ·{" "}
            {formatWeight(pricing.totalWeight)}
          </span>

          {pricing.feeWarning && (
            <span>
              · almost at {formatWeight(FREE_DELIVERY_WEIGHT_LIMIT)}, when
              delivery stops being free
            </span>
          )}

          {pricing.deliveryFeeCents > 0 && (
            <span>
              · {formatCents(pricing.deliveryFeeCents)} delivery fee applies
            </span>
          )}
        </p>
      )}
    </div>
  );
}

export function AddToCartButton({
  product,
}: {
  product: CatalogProduct;
}) {
  const { lines, add } = useShopCart();
  const quantity =
    lines.find((line) => line.productId === product.id)?.quantity ?? 0;

  return (
    <button
      type="button"
      disabled={!product.inStock}
      onClick={() => add(product)}
      aria-label={`Add ${product.name} to cart`}
      className="inline-flex h-11 items-center justify-center gap-2 rounded-wobbly border-2 border-pencil bg-white px-4 text-lg shadow-hard-sm transition-all duration-100 hover:bg-marker hover:text-white active:translate-x-[2px] active:translate-y-[2px] active:shadow-none disabled:pointer-events-none disabled:opacity-40"
    >
      <Plus aria-hidden strokeWidth={3} className="h-4 w-4" />
      {product.inStock
        ? quantity > 0
          ? `Add (${quantity} in cart)`
          : "Add to cart"
        : "Out of stock"}
    </button>
  );
}