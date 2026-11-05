import type { SupabaseClient } from "@supabase/supabase-js";
import type { PendingOrder } from "@/lib/delivery/batching";

type QueueRow = {
  order_id: string; paid_at: string; total_weight: number;
  latitude: number; longitude: number;
};

/** Internal Order-service read: checkout snapshots, oldest paid first. Reading does
 * not claim orders; the batching transaction must recheck eligibility when assigning. */
export async function getPendingDeliveryOrders(db: SupabaseClient): Promise<PendingOrder[]> {
  const { data, error } = await db.rpc("order_read_pending_delivery_queue");
  if (error) throw new Error(`Pending delivery queue unavailable: ${error.message}`);
  return (data as QueueRow[]).map((row) => ({
    orderId: row.order_id, paidAt: new Date(row.paid_at), totalWeight: row.total_weight,
    location: { lat: row.latitude, lng: row.longitude },
  }));
}
