import type { SupabaseClient } from "@supabase/supabase-js";
import { getActiveCart } from "@/lib/cart/service";
import { getCheckoutProducts } from "@/lib/catalog/checkout";
import { getOwnedAddress } from "@/lib/auth/addresses";
import { isWithinServiceArea, readServiceArea } from "@/lib/auth/serviceArea";
import { calculateDemoTaxCents } from "./tax";
import { previewCheckout } from "./validation";

/**
 * Connect the validator's interfaces to the real owning services. Keeping this
 * wiring separate lets validator tests use controlled data without a database.
 * customerId must come from a verified CUSTOMER session. These reads are not a
 * transaction or stock reservation; payment finalization must validate again.
 */
export async function previewCustomerCheckout(db: SupabaseClient, customerId: string, body: unknown) {
  return previewCheckout(customerId, body, {
    getActiveCart: (id) => getActiveCart(db, id),
    getProducts: (ids) => getCheckoutProducts(db, ids),
    getAddress: async (id, addressId) => {
      const address = await getOwnedAddress(db, id, addressId);
      if (!address) return null;
      // Eligibility is calculated here from server data, never accepted from
      // the browser. Missing area settings throw and become a 503 in the route.
      return { id: address.id, customerId: address.customerId,
        eligible: isWithinServiceArea(address.location, readServiceArea()) };
    },
    // The agreed demo policy taxes only items, so no delivery fee is passed.
    calculateTaxCents: async (subtotal) => calculateDemoTaxCents(subtotal),
  });
}
