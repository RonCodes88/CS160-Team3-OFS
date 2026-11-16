import type { SupabaseClient } from "@supabase/supabase-js";
import { departWithFreshRoute } from "@/lib/delivery/departure";
import { runDeliveryTick } from "@/lib/delivery/job";
import { getPendingDeliveryOrders } from "@/lib/orders/queue";
import { routeTripById } from "@/lib/routing/service";

/**
 * Connects one delivery tick to the database: batch waiting orders into trips,
 * route them, and send routed trips out with an available robot. Shared by
 * scripts/delivery-worker.ts and the in-app workers so both run the same code.
 */
export function createDeliveryTick(
  db: SupabaseClient,
  waitMinutes: number,
  report: (error: unknown) => void = error => console.error("Delivery operation failed:", error),
): (now?: Date) => Promise<void> {
  async function tripIds(status: "PLANNED" | "ROUTED"): Promise<string[]> {
    const { data, error } = await db.from("trips").select("id").eq("status", status).order("created_at");
    if (error) throw error;
    return data.map(trip => trip.id);
  }

  return now => runDeliveryTick({
    readQueue: () => getPendingDeliveryOrders(db),
    createTrip: async (ids, wait) => {
      const { data, error } = await db.rpc("delivery_create_trip", { p_order_ids: ids, p_wait_minutes: wait });
      if (error) throw error;
      return data as string | null;
    },
    pendingTrips: () => tripIds("PLANNED"),
    route: id => routeTripById(db, id),
    routedTrips: () => tripIds("ROUTED"),
    depart: id => departWithFreshRoute(db, id),
    report,
  }, now ?? new Date(), waitMinutes);
}
