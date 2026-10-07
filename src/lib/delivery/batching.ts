// Groups PAID orders waiting for delivery into robot trips. Pure logic: the
// batching job loads the pending queue, calls planTrips, then persists the
// trips and moves their orders to BATCHED. Dispatch timing (full trip or
// 20-minute wait) is decided separately.

export const MAX_TRIP_ORDERS = 10;
/** Hundredths of a pound: 20000 = 200.00 lbs. */
export const MAX_TRIP_WEIGHT = 20000;

export type LatLng = { lat: number; lng: number };

export type PendingOrder = {
  orderId: string;
  paidAt: Date;
  /** Hundredths of a pound. */
  totalWeight: number;
  location: LatLng;
};

export type PlannedTrip = {
  orders: PendingOrder[];
  totalWeight: number;
};

const EARTH_RADIUS_METERS = 6_371_000;

/** Great-circle (haversine) distance between two points, in meters. */
export function distanceMeters(a: LatLng, b: LatLng): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_METERS * Math.asin(Math.sqrt(h));
}

/** Oldest first; order ID breaks ties so the plan is deterministic. */
function byAge(a: PendingOrder, b: PendingOrder): number {
  return a.paidAt.getTime() - b.paidAt.getTime() || (a.orderId < b.orderId ? -1 : a.orderId > b.orderId ? 1 : 0);
}

/**
 * Splits the pending queue into trips. The oldest remaining order seeds each
 * trip, then the nearest remaining orders are added while the trip stays
 * within MAX_TRIP_ORDERS and MAX_TRIP_WEIGHT. Orders that do not fit are
 * skipped and left for a later trip. Every order lands in exactly one trip.
 */
export function planTrips(queue: readonly PendingOrder[]): PlannedTrip[] {
  for (const o of queue) {
    if (!Number.isSafeInteger(o.totalWeight) || o.totalWeight < 0 || o.totalWeight > MAX_TRIP_WEIGHT) {
      throw new RangeError(`Order ${o.orderId} has invalid weight ${o.totalWeight}`);
    }
  }

  let remaining = [...queue].sort(byAge);
  const trips: PlannedTrip[] = [];

  while (remaining.length > 0) {
    const [seed, ...rest] = remaining;
    const trip: PlannedTrip = { orders: [seed], totalWeight: seed.totalWeight };

    // Stable sort keeps older orders first among equally near ones.
    const candidates = rest
      .map((o) => ({ o, d: distanceMeters(seed.location, o.location) }))
      .sort((x, y) => x.d - y.d)
      .map(({ o }) => o);

    for (const candidate of candidates) {
      if (trip.orders.length >= MAX_TRIP_ORDERS) break;
      if (trip.totalWeight + candidate.totalWeight > MAX_TRIP_WEIGHT) continue;
      trip.orders.push(candidate);
      trip.totalWeight += candidate.totalWeight;
    }

    const taken = new Set(trip.orders);
    remaining = remaining.filter((o) => !taken.has(o));
    trips.push(trip);
  }

  return trips;
}
