import type { SupabaseClient } from "@supabase/supabase-js";

export type AssignedTrip = {
  id: string;
  status: string;
  routeGeometry: unknown;
  stops: Array<{
    id: string;
    orderId: string;
    stopSequence: number;
    status: string;
    estimatedArrival: string | null;
    location: { lat: number; lng: number };
  }>;
};

export async function getAssignedTripForVehicle(
  db: SupabaseClient,
  userId: string,
): Promise<AssignedTrip | null> {
  // Find the trip through the signed-in vehicle, not a client-provided trip ID.
  const { data: vehicle, error: vehicleError } = await db
    .from("vehicles")
    .select("current_trip_id")
    .eq("user_id", userId)
    .maybeSingle();

  if (vehicleError) {
    throw new Error(`Vehicle lookup failed: ${vehicleError.message}`);
  }

  if (!vehicle?.current_trip_id) return null;

  const tripId = vehicle.current_trip_id;

  const { data: trip, error: tripError } = await db
    .from("trips")
    .select("id, status, route_geometry")
    .eq("id", tripId)
    .single();

  if (tripError || !trip) {
    throw new Error(`Assigned trip lookup failed: ${tripError?.message ?? "Trip missing"}`);
  }

  const { data: stops, error: stopsError } = await db
    .from("delivery_stops")
    .select("id, order_id, stop_sequence, status, estimated_arrival")
    .eq("trip_id", tripId)
    .order("stop_sequence", { ascending: true });

  if (stopsError) {
    throw new Error(`Delivery stops lookup failed: ${stopsError.message}`);
  }

  const savedStops = stops ?? [];

  if (savedStops.length === 0) {
    return {
      id: trip.id,
      status: trip.status,
      routeGeometry: trip.route_geometry,
      stops: [],
    };
  }

  const { data: locations, error: locationError } = await db.rpc(
    "get_trip_order_locations",
    { p_trip_id: tripId },
  );

  if (locationError) {
    throw new Error(`Stop locations lookup failed: ${locationError.message}`);
  }

  const byOrderId = new Map<string, { lat: number; lng: number }>(
    (locations ?? []).map((row: {
      order_id: string;
      lat: number;
      lng: number;
    }) => [row.order_id, { lat: row.lat, lng: row.lng }]),
  );

  return {
    id: trip.id,
    status: trip.status,
    routeGeometry: trip.route_geometry,
    stops: savedStops.map((stop) => {
      const location = byOrderId.get(stop.order_id);

      if (!location) {
        throw new Error("Missing location for assigned delivery stop");
      }

      return {
        id: stop.id,
        orderId: stop.order_id,
        stopSequence: stop.stop_sequence,
        status: stop.status,
        estimatedArrival: stop.estimated_arrival,
        location,
      };
    }),
  };
}
