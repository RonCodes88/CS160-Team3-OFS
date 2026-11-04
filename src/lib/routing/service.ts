import type { SupabaseClient } from "@supabase/supabase-js";
import { MAX_TRIP_ORDERS } from "@/lib/delivery/batching";
import {
  optimizeTripRoute,
  type DeliveryOrderStop,
  type OptimizationOptions,
  type OptimizedTripRoute,
} from "./optimization";
import { RoutingError } from "./mapbox";
import { persistOptimizedTrip } from "./persistence";

// Optimize and save the route using stops loaded by trusted server-side code.
export async function routeTrip(
  db: SupabaseClient,
  tripId: string,
  stops: readonly DeliveryOrderStop[],
  options: OptimizationOptions = {},
): Promise<OptimizedTripRoute> {
  let plan: OptimizedTripRoute;

  try {
    plan = await optimizeTripRoute(stops, options);
  } catch (error) {
    // Bad input shouldn't fail a trip.
    if (error instanceof RoutingError && error.code === "INVALID_REQUEST" && error.status === undefined) {
      throw error;
    }

    const failureCode =
      error instanceof RoutingError ? error.code : "PROVIDER_ERROR";

    const { error: recoveryError } = await db.rpc("fail_trip_route", {
      p_trip_id: tripId,
      p_failure_code: failureCode,
    });

    if (recoveryError) {
      throw new Error(
        `Failed to recover trip after routing failure: ${recoveryError.message}`,
        { cause: error },
      );
    }

    throw error;
  }

  await persistOptimizedTrip(db, tripId, plan);

  return plan;
}

// Load delivery locations from the database instead of trusting API input.
// Any API handler using this function still needs to authorize the user.
export async function routeTripById(
  db: SupabaseClient,
  tripId: string,
  options: OptimizationOptions = {},
): Promise<OptimizedTripRoute> {
  const uuidPattern =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  if (!uuidPattern.test(tripId)) {
    throw new Error("Invalid trip ID.");
  }

  const { data: trip, error: tripError } = await db
    .from("trips")
    .select("status, order_count")
    .eq("id", tripId)
    .single();

  if (tripError) {
    throw new Error(`Failed to load trip: ${tripError.message}`);
  }

  if (!trip) {
    throw new Error("Trip not found.");
  }

  if (trip.status !== "PLANNED") {
    throw new Error("Only PLANNED trips can be routed.");
  }

  if (
    !Number.isInteger(trip.order_count) ||
    trip.order_count < 1 ||
    trip.order_count > MAX_TRIP_ORDERS
  ) {
    throw new Error("Trip has an invalid order count.");
  }

  const { data: rows, error: locationError } = await db.rpc(
    "get_trip_order_locations",
    { p_trip_id: tripId },
  );

  if (locationError) {
    throw new Error(
      `Failed to load trip order locations: ${locationError.message}`,
    );
  }

  if (!Array.isArray(rows) || rows.length !== trip.order_count) {
    throw new Error(
      "Assigned order count does not match the trip order count.",
    );
  }

  // Check each location before using it for route planning.
  const stops: DeliveryOrderStop[] = rows.map((row: unknown) => {
    if (!row || typeof row !== "object") {
      throw new Error("Invalid delivery location data.");
    }

    const location = row as Record<string, unknown>;

    const orderId = location.order_id;
    const lat = location.lat;
    const lng = location.lng;

    if (
      typeof orderId !== "string" ||
      !uuidPattern.test(orderId) ||
      typeof lat !== "number" ||
      typeof lng !== "number" ||
      !Number.isFinite(lat) ||
      !Number.isFinite(lng) ||
      Math.abs(lat) > 90 ||
      Math.abs(lng) > 180
    ) {
      throw new Error("Invalid delivery location data.");
    }

    return {
      orderId,
      location: { lat, lng },
    };
  });

  // The save RPC rechecks trip assignments in a transaction before saving.
  return routeTrip(db, tripId, stops, options);
}
