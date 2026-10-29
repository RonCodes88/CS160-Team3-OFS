import type { SupabaseClient } from "@supabase/supabase-js";
import type { OptimizedTripRoute } from "./optimization";

// Save the optimized route using a single database call.
export async function persistOptimizedTrip(
  db: SupabaseClient,
  tripId: string,
  plan: OptimizedTripRoute,
): Promise<void> {
  // The database handles saving the stops, route geometry, and trip status together.
  const { error } = await db.rpc("save_optimized_trip_route", {
    p_trip_id: tripId,
    p_geometry: plan.geometry,
    p_stops: plan.stops.map((stop) => ({
      order_id: stop.orderId,
      stop_sequence: stop.stopSequence,
      estimated_arrival: stop.estimatedArrival,
    })),
  });

  if (error) {
    throw new Error(error.message);
  }
}
