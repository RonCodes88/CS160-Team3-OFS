import type { SupabaseClient } from "@supabase/supabase-js";

export type CustomerTracking = {
  orderId: string;
  status: string;
  tripStatus: string | null;
  stopStatus: string | null;
  estimatedArrival: string | null;
  route: unknown | null;
  robotLocation: {
    latitude: number;
    longitude: number;
    updatedAt: string;
  } | null;
  /** Where this order is being delivered, from its checkout snapshot. */
  destination: { latitude: number; longitude: number } | null;
};

export type CustomerTrackingResult =
  | { ok: true; tracking: CustomerTracking }
  | { ok: false; reason: "NOT_FOUND" | "FORBIDDEN" };

function decodeVehiclePoint(value: unknown) {
  if (typeof value !== "string" || !/^[0-9a-f]{50}$/i.test(value)) {
    return null;
  }

  const point = Buffer.from(value, "hex");
  const byteOrder = point.readUInt8(0);

  if (byteOrder !== 0 && byteOrder !== 1) return null;

  const littleEndian = byteOrder === 1;
  const readInt = (offset: number) =>
    littleEndian ? point.readUInt32LE(offset) : point.readUInt32BE(offset);
  const readDouble = (offset: number) =>
    littleEndian ? point.readDoubleLE(offset) : point.readDoubleBE(offset);

  if (readInt(1) !== 0x20000001 || readInt(5) !== 4326) {
    return null;
  }

  const longitude = readDouble(9);
  const latitude = readDouble(17);

  if (
    !Number.isFinite(latitude) ||
    !Number.isFinite(longitude) ||
    Math.abs(latitude) > 90 ||
    Math.abs(longitude) > 180
  ) {
    return null;
  }

  return { latitude, longitude };
}

type LngLat = [number, number];

/**
 * The trip's road route, cut off at this customer's stop. Stops after it are
 * other customers' homes, so this customer's line must not lead there.
 * Returns null for a missing or malformed route.
 */
export function routeToDestination(
  route: unknown,
  destination: { latitude: number; longitude: number } | null,
): { type: "LineString"; coordinates: LngLat[] } | null {
  if (!destination || !route || typeof route !== "object") return null;
  const { type, coordinates } = route as Record<string, unknown>;
  if (type !== "LineString" || !Array.isArray(coordinates) || coordinates.length < 2) return null;
  const points: LngLat[] = [];
  for (const pair of coordinates) {
    if (!Array.isArray(pair) || !Number.isFinite(pair[0]) || !Number.isFinite(pair[1])) return null;
    points.push([pair[0], pair[1]]);
  }

  let end = 0;
  let best = Infinity;
  points.forEach(([lng, lat], index) => {
    const distance = (lng - destination.longitude) ** 2 + (lat - destination.latitude) ** 2;
    if (distance < best) {
      best = distance;
      end = index;
    }
  });
  return { type: "LineString", coordinates: points.slice(0, Math.max(end, 1) + 1) };
}

export async function getCustomerTracking(
  db: SupabaseClient,
  customerId: string,
  orderId: string,
): Promise<CustomerTrackingResult> {
  const { data: order, error: orderError } = await db
    .from("orders")
    .select("id, customer_id, status, trip_id, location")
    .eq("id", orderId)
    .maybeSingle();

  if (orderError) {
    throw new Error(`Order lookup failed: ${orderError.message}`);
  }

  if (!order) return { ok: false, reason: "NOT_FOUND" };

  if (order.customer_id !== customerId) {
    return { ok: false, reason: "FORBIDDEN" };
  }

  const tracking: CustomerTracking = {
    orderId: order.id,
    status: order.status,
    tripStatus: null,
    stopStatus: null,
    estimatedArrival: null,
    route: null,
    robotLocation: null,
    destination: decodeVehiclePoint(order.location),
  };

  if (!order.trip_id) {
    return { ok: true, tracking };
  }

  const { data: trip, error: tripError } = await db
    .from("trips")
    .select("status, route_geometry")
    .eq("id", order.trip_id)
    .maybeSingle();

  if (tripError) {
    throw new Error(`Trip lookup failed: ${tripError.message}`);
  }

  if (trip) {
    tracking.tripStatus = trip.status;
    tracking.route = routeToDestination(trip.route_geometry, tracking.destination);
  }

  const { data: stop, error: stopError } = await db
    .from("delivery_stops")
    .select("status, estimated_arrival")
    .eq("trip_id", order.trip_id)
    .eq("order_id", order.id)
    .maybeSingle();

  if (stopError) {
    throw new Error(`Delivery stop lookup failed: ${stopError.message}`);
  }

  if (stop) {
    tracking.stopStatus = stop.status;
    tracking.estimatedArrival = stop.estimated_arrival;
  }

  // Only show live robot location while this order is being delivered.
  if (order.status === "OUT_FOR_DELIVERY") {
    const { data: vehicle, error: vehicleError } = await db
      .from("vehicles")
      .select("last_location, last_update_at")
      .eq("current_trip_id", order.trip_id)
      .limit(1)
      .maybeSingle();

    if (vehicleError) {
      throw new Error(`Vehicle lookup failed: ${vehicleError.message}`);
    }

    if (vehicle?.last_location && vehicle.last_update_at) {
      const point = decodeVehiclePoint(vehicle.last_location);

      if (point) {
        tracking.robotLocation = {
          ...point,
          updatedAt: vehicle.last_update_at,
        };
      }
    }
  }

  return { ok: true, tracking };
}
