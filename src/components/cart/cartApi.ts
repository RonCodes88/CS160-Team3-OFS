// Maps the GET/POST /api/cart response into the shapes the storefront shows.
// Totals come priced from the server; nothing here recalculates them.

export type CartItem = {
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

export const EMPTY_TOTALS: CartTotals = {
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

export type ApiCartResponse = {
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

export function mapCartItems(data: ApiCartResponse): CartItem[] {
  return (data.items ?? []).map((item: ApiCartItem) => ({
    productId: item.product_id,
    name: item.name,
    unitLabel: item.unit_label ?? "unit",
    unitPriceCents: item.price_cents,
    unitWeight: item.unit_weight,
    quantity: item.quantity,
  }));
}

export function mapCartTotals(data: ApiCartResponse): CartTotals {
  return {
    subtotalCents: data.subtotal_cents ?? 0,
    totalWeight: data.total_weight ?? 0,
    deliveryFeeCents: data.delivery_fee_cents ?? 0,
    totalCents: data.total_cents ?? 0,
    feeWarning: data.fee_warning ?? false,
    overWeightLimit: data.over_weight_limit ?? false,
  };
}
