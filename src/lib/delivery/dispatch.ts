import { MAX_TRIP_ORDERS, MAX_TRIP_WEIGHT, type PlannedTrip } from "./batching";

export function waitLimitMinutes(value: string | undefined): number {
  const minutes = value === undefined ? 20 : Number(value);
  if (!Number.isFinite(minutes) || minutes <= 0) throw new Error("Delivery wait limit must be positive minutes.");
  return minutes;
}

/** Eligible for routing on this worker tick; this does not mark a robot as departed. */
export function shouldDispatch(trip: PlannedTrip, now: Date, minutes = 20): boolean {
  waitLimitMinutes(String(minutes));
  if (!Number.isFinite(now.getTime())) throw new Error("Invalid dispatch clock.");
  if (!Number.isSafeInteger(trip.totalWeight) || trip.totalWeight < 0 || trip.totalWeight > MAX_TRIP_WEIGHT
    || trip.orders.length > MAX_TRIP_ORDERS) throw new Error("Invalid trip capacity.");
  if (!trip.orders.length) return false;
  const times = trip.orders.map(order => order.paidAt.getTime());
  if (times.some(time => !Number.isFinite(time))) throw new Error("Invalid paid timestamp.");
  return trip.orders.length === MAX_TRIP_ORDERS || trip.totalWeight === MAX_TRIP_WEIGHT
    || now.getTime() - Math.min(...times) >= minutes * 60000;
}
