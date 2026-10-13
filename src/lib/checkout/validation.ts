import { priceCart, type PricedLine } from "@/lib/cart/pricing";

export type CheckoutTotals = {
  subtotalCents: number;
  totalWeight: number;
  deliveryFeeCents: number;
  taxCents: number;
  totalCents: number;
};

export type CheckoutPreview = CheckoutTotals & { feeWarning: boolean };

export type CheckoutCart = {
  customerId: string;
  status: string;
  items: readonly { productId: string; quantity: number }[];
};

export type CheckoutProduct = {
  id: string;
  isActive: boolean;
  unitPriceCents: number;
  unitWeight: number;
  stockQuantity: number;
};

export type CheckoutAddress = {
  id: string;
  customerId: string;
  /** Set by the address service after geocoding and service-area validation. Never from the browser. */
  eligible: boolean;
};

/** Read-only service contracts; actual cart/address adapters are pending upstream work. */
export type CheckoutDependencies = {
  getActiveCart(customerId: string): Promise<CheckoutCart | null>;
  getAddress(customerId: string, addressId: string): Promise<CheckoutAddress | null>;
  getProducts(productIds: readonly string[]): Promise<readonly CheckoutProduct[]>;
  /** Required server-side policy. There is deliberately no default tax rate. */
  calculateTaxCents(subtotalCents: number, address: CheckoutAddress): Promise<number>;
};

export type CheckoutErrorCode =
  | "INVALID_REQUEST" | "ADDRESS_REQUIRED" | "INVALID_TOTALS"
  | "CART_UNAVAILABLE" | "CART_EMPTY" | "INVALID_CART" | "INVALID_QUANTITY"
  | "ADDRESS_INVALID" | "PRODUCT_UNAVAILABLE" | "INSUFFICIENT_STOCK"
  | "CART_OVERWEIGHT" | "TOTALS_MISMATCH";

export type CheckoutResult =
  | { ok: true; value: CheckoutPreview }
  | { ok: false; error: { code: CheckoutErrorCode; message: string; productId?: string }; current?: CheckoutPreview };

const TOTAL_FIELDS = ["subtotalCents", "totalWeight", "deliveryFeeCents", "taxCents", "totalCents"] as const;

function object(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function failure(code: CheckoutErrorCode, message: string, productId?: string): CheckoutResult {
  return { ok: false, error: { code, message, ...(productId === undefined ? {} : { productId }) } };
}

/**
 * Server-side preview only: no reservations, mutations, charges, or orders.
 * customerId MUST come from a verified CUSTOMER session in the future route.
 * body.expected is a comparison snapshot, never an authoritative amount.
 * Unexpected dependency/data failures throw for the route's generic 500 handler.
 * A successful preview does not replace revalidation during payment/finalization.
 */
export async function previewCheckout(
  customerId: string,
  body: unknown,
  services: CheckoutDependencies,
): Promise<CheckoutResult> {
  if (!customerId) throw new Error("A verified customer identity is required.");
  if (!object(body)) return failure("INVALID_REQUEST", "Checkout request must be a JSON object.");
  if (typeof body.addressId !== "string" || !body.addressId.trim()) {
    return failure("ADDRESS_REQUIRED", "Select a delivery address.");
  }
  const expected = body.expected;
  if (!object(expected) || !TOTAL_FIELDS.every((key) => nonNegativeInteger(expected[key]))) {
    return failure("INVALID_TOTALS", "Provide the displayed checkout totals as non-negative integers.");
  }

  const cart = await services.getActiveCart(customerId);
  if (!cart || cart.customerId !== customerId || cart.status !== "ACTIVE") {
    return failure("CART_UNAVAILABLE", "No active cart is available.");
  }
  if (cart.items.length === 0) return failure("CART_EMPTY", "Your cart is empty.");

  const seen = new Set<string>();
  for (const item of cart.items) {
    if (!Number.isSafeInteger(item.quantity) || item.quantity < 1) {
      return failure("INVALID_QUANTITY", "Cart quantities must be positive whole numbers.", item.productId);
    }
    if (!item.productId || seen.has(item.productId)) {
      return failure("INVALID_CART", "The cart contains an invalid or duplicate product.");
    }
    seen.add(item.productId);
  }

  const address = await services.getAddress(customerId, body.addressId);
  if (!address || address.id !== body.addressId || address.customerId !== customerId || address.eligible !== true) {
    return failure("ADDRESS_INVALID", "Select a valid delivery address within the service area.");
  }

  const products = await services.getProducts([...seen]);
  const byId = new Map(products.map((product) => [product.id, product]));
  const lines: PricedLine[] = [];
  for (const item of cart.items) {
    const product = byId.get(item.productId);
    if (!product || !product.isActive) {
      return failure("PRODUCT_UNAVAILABLE", "An item in your cart is no longer available.", item.productId);
    }
    if (!nonNegativeInteger(product.stockQuantity) || !nonNegativeInteger(product.unitPriceCents)
      || !nonNegativeInteger(product.unitWeight) || product.unitWeight === 0) {
      throw new Error("Invalid authoritative product data.");
    }
    if (item.quantity > product.stockQuantity) {
      return failure("INSUFFICIENT_STOCK", "There is not enough stock for the requested quantity.", item.productId);
    }
    lines.push({ quantity: item.quantity, unitPriceCents: product.unitPriceCents, unitWeight: product.unitWeight });
  }

  const pricing = priceCart(lines);
  if (![pricing.subtotalCents, pricing.totalWeight, pricing.totalCents].every(nonNegativeInteger)) {
    throw new Error("Checkout totals exceed safe integer arithmetic.");
  }
  if (pricing.overWeightLimit) return failure("CART_OVERWEIGHT", "Your cart exceeds the 200 lb limit. Remove items to continue.");

  const taxCents = await services.calculateTaxCents(pricing.subtotalCents, address);
  if (!nonNegativeInteger(taxCents) || !nonNegativeInteger(pricing.totalCents + taxCents)) {
    throw new Error("Invalid tax amount or checkout total.");
  }
  const current: CheckoutPreview = {
    subtotalCents: pricing.subtotalCents,
    totalWeight: pricing.totalWeight,
    deliveryFeeCents: pricing.deliveryFeeCents,
    taxCents,
    totalCents: pricing.totalCents + taxCents,
    feeWarning: pricing.feeWarning,
  };
  if (TOTAL_FIELDS.some((key) => expected[key] !== current[key])) {
    return {
      ok: false,
      error: { code: "TOTALS_MISMATCH", message: "Your checkout totals have changed. Review the updated totals before continuing." },
      current,
    };
  }
  return { ok: true, value: current };
}
