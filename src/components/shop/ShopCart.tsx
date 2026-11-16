"use client";

import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { AlertTriangle, Minus, Plus, ShoppingBasket, Truck, X } from "lucide-react";
import { formatCents, formatWeight } from "@/lib/cart/format";
import { DELIVERY_FEE_CENTS, FREE_DELIVERY_WEIGHT_LIMIT, MAX_CART_WEIGHT } from "@/lib/cart/pricing";
import { EMPTY_TOTALS, mapCartTotals, type CartTotals } from "@/components/cart/cartApi";
import type { ShopCartLine } from "@/lib/catalog/shopCart";
import type { CatalogProduct } from "@/lib/catalog/types";

type ApiCart = {
  items: Array<{
    product_id: string;
    name: string;
    price_cents: number;
    unit_weight: number;
    quantity: number;
  }>;
};

/** Who is shopping: only customers have a cart; guests are sent to log in. */
type Shopper = "loading" | "customer" | "guest" | "staff";

type ShopCartValue = {
  shopper: Shopper;
  lines: readonly ShopCartLine[];
  setQuantity: (product: CatalogProduct, quantity: number) => void;
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

/** Shows the quantities the shopper asked for over the server's, until the server catches up. */
function withWanted(lines: readonly ShopCartLine[], wanted: ReadonlyMap<string, ShopCartLine>): ShopCartLine[] {
  const merged = lines
    .map((line) => wanted.get(line.productId) ?? line)
    .filter((line) => line.quantity > 0);
  for (const [id, line] of wanted) {
    if (line.quantity > 0 && !lines.some((l) => l.productId === id)) merged.push(line);
  }
  return merged;
}

export function ShopCartProvider({ children }: { children: ReactNode }) {
  const [shopper, setShopper] = useState<Shopper>("loading");
  const [lines, setLines] = useState<ShopCartLine[]>([]);
  // Priced by the server; updated with each response, never computed here.
  const [totals, setTotals] = useState<CartTotals>(EMPTY_TOTALS);
  const [pending, setPending] = useState<ReadonlySet<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  // The last cart the server confirmed, and the quantities not yet saved.
  const saved = useRef<ShopCartLine[]>([]);
  const wanted = useRef(new Map<string, ShopCartLine>());
  const saving = useRef(false);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/cart", { cache: "no-store" })
      .then(async (response) => {
        if (cancelled) return;
        if (response.status === 401) return setShopper("guest");
        if (response.status === 403) return setShopper("staff");
        const data = await response.json();
        if (!response.ok) throw new Error(data.error?.message ?? "Unable to load your cart.");
        saved.current = toLines(data as ApiCart);
        setLines(saved.current);
        setTotals(mapCartTotals(data));
        setShopper("customer");
      })
      .catch((e: Error) => {
        if (cancelled) return;
        // Still let them try: adding reloads the cart from the server.
        setShopper("customer");
        setError(e.message);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Errors clear themselves so the toast never hides the cart bar for long.
  useEffect(() => {
    if (!error) return;
    const timer = setTimeout(() => setError(null), 8000);
    return () => clearTimeout(timer);
  }, [error]);

  // Every click shows right away. Cart saves go one at a time, each
  // sending the latest quantity, so quick clicks are never lost or reordered.
  // The server still checks stock and the weight limit; a rejected change
  // rolls back to the last saved cart.
  function setQuantity(product: CatalogProduct, quantity: number) {
    if (shopper !== "customer" || quantity < 0) return;
    setError(null);
    wanted.current.set(product.id, {
      productId: product.id,
      name: product.name,
      unitPriceCents: product.priceCents,
      unitWeight: product.unitWeight,
      quantity,
    });
    setLines(withWanted(saved.current, wanted.current));
    setPending(new Set(wanted.current.keys()));
    if (!saving.current) void save();
  }

  async function save() {
    saving.current = true;
    // Every response contains the entire cart. Serialize across products so
    // an older response cannot overwrite the result of a newer mutation.
    try {
      while (wanted.current.size > 0) {
        const next = wanted.current.entries().next().value;
        if (!next) break;
        const [productId, line] = next;
        const quantity = line.quantity;
        try {
          const response = await fetch("/api/cart", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ productId, quantity }),
          });
          const data = await response.json();
          if (!response.ok) throw new Error(data.error?.message ?? "Unable to update your cart.");
          saved.current = toLines(data as ApiCart);
          setTotals(mapCartTotals(data));
          if (wanted.current.get(productId)?.quantity === quantity) wanted.current.delete(productId);
        } catch (e) {
          wanted.current.delete(productId);
          setError(e instanceof Error ? e.message : "Unable to update your cart.");
        }
        setLines(withWanted(saved.current, wanted.current));
        setPending(new Set(wanted.current.keys()));
      }
    } finally {
      saving.current = false;
    }
  }

  return (
    <ShopCartContext.Provider value={{ shopper, lines, setQuantity }}>
      {children}
      <CartBar lines={lines} totals={totals} saving={pending.size > 0} error={error} onDismiss={() => setError(null)} />
    </ShopCartContext.Provider>
  );
}

/**
 * Pinned to the bottom of the screen so the cart total and any error are
 * visible wherever the shopper has scrolled. Item counts follow the shopper's
 * clicks right away; money, weight, and the fee come from the server's last
 * response, so they catch up once a save finishes.
 */
export function CartBar({
  lines,
  totals,
  saving,
  error,
  onDismiss,
}: {
  lines: readonly ShopCartLine[];
  totals: CartTotals;
  saving: boolean;
  error: string | null;
  onDismiss: () => void;
}) {
  const count = lines.reduce((sum, line) => sum + line.quantity, 0);

  let delivery: ReactNode;
  if (totals.overWeightLimit) {
    delivery = <span className="font-heading text-marker">Over the {formatWeight(MAX_CART_WEIGHT)} limit</span>;
  } else if (totals.deliveryFeeCents > 0) {
    delivery = <>{formatCents(totals.deliveryFeeCents)} delivery fee</>;
  } else if (totals.feeWarning) {
    delivery = (
      <span className="font-heading">
        {formatWeight(FREE_DELIVERY_WEIGHT_LIMIT - totals.totalWeight)} until the{" "}
        {formatCents(DELIVERY_FEE_CENTS)} delivery fee
      </span>
    );
  } else {
    delivery = <>Free delivery under {formatWeight(FREE_DELIVERY_WEIGHT_LIMIT)}</>;
  }

  return (
    <>
      {/* Keeps the bar from covering the end of the page. */}
      {count > 0 && <div aria-hidden className="h-24" />}
      <div className="pointer-events-none fixed inset-x-0 bottom-0 z-30 flex flex-col items-center gap-2 px-4 pb-4">
        <div
          role="alert"
          className={
            error
              ? "pointer-events-auto flex w-full max-w-xl items-start gap-3 rounded-wobbly-md border-[3px] border-marker bg-white p-3 text-lg shadow-hard"
              : "sr-only"
          }
        >
          {error && (
            <>
              <AlertTriangle aria-hidden strokeWidth={2.5} className="mt-1 h-5 w-5 shrink-0 text-marker" />
              <p className="flex-1">{error}</p>
              <button type="button" onClick={onDismiss} aria-label="Dismiss" className="mt-0.5 shrink-0">
                <X aria-hidden strokeWidth={3} className="h-5 w-5" />
              </button>
            </>
          )}
        </div>

        {count > 0 && (
          <section
            aria-label="Cart summary"
            className="pointer-events-auto flex w-full max-w-3xl items-center gap-3 rounded-wobbly-md border-2 border-pencil bg-postit px-4 py-3 shadow-hard"
          >
            <ShoppingBasket aria-hidden strokeWidth={2.5} className="hidden h-7 w-7 shrink-0 sm:block" />
            <div className="min-w-0 flex-1" aria-live="polite">
              <p className="font-heading text-xl tabular-nums">
                {count} {count === 1 ? "item" : "items"} · {formatCents(totals.subtotalCents)}
                {saving && <span className="ml-2 font-body text-base text-pencil/70">Saving…</span>}
              </p>
              <p className="flex items-center gap-1 text-base tabular-nums">
                <Truck aria-hidden strokeWidth={2.5} className="h-4 w-4 shrink-0" />
                <span className="truncate">
                  {formatWeight(totals.totalWeight)} · {delivery}
                </span>
              </p>
            </div>
            <Link
              href="/cart"
              className="inline-flex h-11 shrink-0 items-center rounded-wobbly border-2 border-pencil bg-white px-4 text-lg shadow-hard-sm transition-all duration-100 hover:bg-pen hover:text-white active:translate-x-[2px] active:translate-y-[2px] active:shadow-none"
            >
              View cart
            </Link>
          </section>
        )}
      </div>
    </>
  );
}

const control =
  "inline-flex items-center justify-center rounded-wobbly border-2 border-pencil shadow-hard-sm transition-all duration-100 active:translate-x-[2px] active:translate-y-[2px] active:shadow-none disabled:pointer-events-none disabled:opacity-50";

/**
 * "Add to cart" until the product is in the cart, then a − quantity +
 * stepper, so shoppers can see and change what they have without leaving the page.
 */
export function AddToCartControl({ product, size = "md" }: { product: CatalogProduct; size?: "md" | "lg" }) {
  const { shopper, lines, setQuantity } = useShopCart();
  const pathname = usePathname();
  const quantity = lines.find((line) => line.productId === product.id)?.quantity ?? 0;
  const height = size === "lg" ? "h-14 text-xl" : "h-11 text-lg";

  if (!product.inStock) {
    return (
      <button type="button" disabled className={`${control} ${height} w-full bg-white px-3`}>
        Out of stock
      </button>
    );
  }

  if (shopper === "guest") {
    return (
      <Link
        href={`/login?next=${encodeURIComponent(pathname ?? "/shop")}`}
        aria-label={`Log in to add ${product.name} to cart`}
        className={`${control} ${height} w-full gap-2 bg-white px-3 hover:bg-postit`}
      >
        Log in to add
      </Link>
    );
  }

  if (shopper === "staff") {
    return <p className={`flex ${height} items-center justify-center text-base text-pencil/80`}>Customer accounts only</p>;
  }

  if (quantity === 0) {
    return (
      <button
        type="button"
        disabled={shopper === "loading"}
        onClick={() => setQuantity(product, 1)}
        aria-label={`Add ${product.name} to cart`}
        className={`${control} ${height} w-full gap-2 bg-white px-3 hover:bg-marker hover:text-white`}
      >
        <Plus aria-hidden strokeWidth={3} className="h-5 w-5" />
        Add to cart
      </button>
    );
  }

  const square = size === "lg" ? "h-14 w-14" : "h-11 w-11";
  const step = `${control} ${square} shrink-0 bg-white hover:bg-postit`;
  return (
    <div role="group" aria-label={`${product.name} in your cart`} className={`flex ${height} w-full items-center gap-2`}>
      <button
        type="button"
        onClick={() => setQuantity(product, quantity - 1)}
        aria-label={quantity === 1 ? `Remove ${product.name} from cart` : `Remove one ${product.name}`}
        className={step}
      >
        <Minus aria-hidden strokeWidth={3} className="h-5 w-5" />
      </button>
      <span
        className="flex h-full flex-1 items-center justify-center rounded-wobbly border-2 border-dashed border-pencil/50 bg-postit text-2xl tabular-nums"
        aria-live="polite"
      >
        {quantity}
        <span className="sr-only"> in cart</span>
      </span>
      <button
        type="button"
        onClick={() => setQuantity(product, quantity + 1)}
        aria-label={`Add one more ${product.name}`}
        className={step}
      >
        <Plus aria-hidden strokeWidth={3} className="h-5 w-5" />
      </button>
    </div>
  );
}
