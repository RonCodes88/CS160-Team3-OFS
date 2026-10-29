import type { SupabaseClient } from "@supabase/supabase-js";
import { readServiceArea } from "@/lib/auth/serviceArea";
import { PaymentError } from "@/lib/payments/service";

/** The order transaction owns snapshots, inventory, cart checkout and history. */
export async function createOrderFromPayment(db: SupabaseClient, attemptId: string, processingToken: string): Promise<string> {
  const area = readServiceArea();
  const { data, error } = await db.rpc("order_create_from_payment", {
    p_attempt_id: attemptId, p_token: processingToken,
    p_store_lat: area.origin.lat, p_store_lng: area.origin.lng, p_radius_meters: area.radiusMeters,
  });
  if (error?.code === "P0022") {
    const messages: Record<string, string> = {
      CART_UNAVAILABLE: "Your cart is no longer active.", CART_EMPTY: "Your cart is empty.",
      ADDRESS_INVALID: "Your delivery address is no longer eligible.",
      PRODUCT_UNAVAILABLE: "An item is no longer available.", INSUFFICIENT_STOCK: "There is not enough stock.",
      CART_OVERWEIGHT: "Your cart exceeds 200 lb.", CHECKOUT_CHANGED: "Your checkout changed. Review it before trying again.",
    };
    if (messages[error.message]) throw new PaymentError(409, error.message, messages[error.message]);
  }
  // Unknown outcomes must be retried/reconciled, never treated as a confirmed rollback.
  if (error) throw new PaymentError(503, "ORDER_RECOVERY_REQUIRED", "Order processing is incomplete. Retry confirmation.");
  return data as string;
}
