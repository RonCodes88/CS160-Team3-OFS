import type { SupabaseClient } from "@supabase/supabase-js";
import { getActiveCart, type ActiveCart } from "@/lib/cart/service";
import { getCheckoutProducts } from "@/lib/catalog/checkout";
import { getOwnedAddress, type OwnedAddress } from "@/lib/auth/addresses";
import { isWithinServiceArea, readServiceArea } from "@/lib/auth/serviceArea";
import { calculateDemoTaxCents } from "@/lib/checkout/tax";
import { previewCheckout, type CheckoutErrorCode, type CheckoutProduct, type PreviewInput } from "@/lib/checkout/validation";
import { PaymentError, type PaymentQuote } from "./service";

const status: Record<CheckoutErrorCode, number> = {
  INVALID_REQUEST: 400, ADDRESS_REQUIRED: 400, INVALID_TOTALS: 400,
  CART_UNAVAILABLE: 422, CART_EMPTY: 422, INVALID_CART: 422, INVALID_QUANTITY: 422,
  ADDRESS_INVALID: 422, PRODUCT_UNAVAILABLE: 409, INSUFFICIENT_STOCK: 409,
  CART_OVERWEIGHT: 422, TOTALS_MISMATCH: 409,
};

/** Snapshot the exact values used by validation, without a second cart/product read. */
export async function loadPaymentQuote(db: SupabaseClient, customerId: string, input: PreviewInput): Promise<PaymentQuote> {
  const loaded: { cart?: ActiveCart | null; address?: OwnedAddress | null; products?: CheckoutProduct[] } = {};
  const result = await previewCheckout(customerId, input, {
    getActiveCart: async (id) => loaded.cart = await getActiveCart(db, id),
    getProducts: async (ids) => loaded.products = await getCheckoutProducts(db, ids),
    getAddress: async (id, addressId) => {
      const address = loaded.address = await getOwnedAddress(db, id, addressId);
      return address ? { ...address, eligible: isWithinServiceArea(address.location, readServiceArea()) } : null;
    },
    calculateTaxCents: async (subtotal) => calculateDemoTaxCents(subtotal),
  });
  if (!result.ok) throw new PaymentError(status[result.error.code], result.error.code, result.error.message, result.current);
  const { cart, address, products } = loaded;
  if (!cart?.id || !address?.location || !products) throw new Error("Incomplete validated checkout");
  const byId = new Map(products.map((p) => [p.id, p]));
  const { subtotalCents, totalWeight, deliveryFeeCents, taxCents, totalCents } = result.value;
  return { cartId: cart.id, addressId: address.id, location: address.location,
    items: cart.items.map((item) => ({ ...item, unitPriceCents: byId.get(item.productId)!.unitPriceCents,
      unitWeight: byId.get(item.productId)!.unitWeight })).sort((a, b) => a.productId.localeCompare(b.productId)),
    totals: { subtotalCents, totalWeight, deliveryFeeCents, taxCents, totalCents } };
}
