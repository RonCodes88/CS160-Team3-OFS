import type { SupabaseClient } from "@supabase/supabase-js";
import { routeTripById } from "@/lib/routing/service";

/** Re-evaluate traffic after an unavailable vehicle has delayed a routed trip. */
export async function departWithFreshRoute(db: SupabaseClient, tripId: string, options: {
  vehicleId?: string;
  route?: (tripId: string) => Promise<unknown>;
} = {}): Promise<string | null> {
  const parameters = { p_trip_id: tripId, ...(options.vehicleId ? { p_vehicle_id: options.vehicleId } : {}) };
  const { data: preparation, error: prepareError } = await db.rpc("delivery_prepare_departure_route", parameters);
  if (prepareError) throw new Error(`Departure preparation failed: ${prepareError.message}`);
  if (preparation === "WAIT") return null;
  if (preparation !== "READY" && preparation !== "REPLAN") throw new Error("Invalid departure preparation response.");
  if (preparation === "REPLAN") await (options.route ?? (id => routeTripById(db, id)))(tripId);
  // The transaction rechecks freshness after all provider requests and lock waits.
  const { data, error } = await db.rpc("delivery_dispatch_trip", parameters);
  if (error) throw new Error(`Departure failed: ${error.message}`);
  if (data !== null && typeof data !== "string") throw new Error("Invalid departure response.");
  return data;
}
