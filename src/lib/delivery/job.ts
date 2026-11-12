import { planTrips, type PendingOrder } from "./batching";
import { shouldDispatch } from "./dispatch";

export type DeliveryJob = {
  readQueue(): Promise<PendingOrder[]>;
  createTrip(ids: string[], minutes: number): Promise<string | null>;
  pendingTrips(): Promise<string[]>;
  route(id: string): Promise<unknown>;
  report(error: unknown): void;
};

export async function runDeliveryTick(deps: DeliveryJob, now: Date, minutes: number): Promise<void> {
  // Recover committed trips if a previous process stopped before routing them.
  const pending = new Set(await deps.pendingTrips());
  for (const trip of planTrips(await deps.readQueue())) {
    if (!shouldDispatch(trip, now, minutes)) continue;
    const id = await deps.createTrip(trip.orders.map(order => order.orderId), minutes);
    if (id) pending.add(id);
  }
  for (const id of pending) {
    try { await deps.route(id); } catch (error) { deps.report(error); }
  }
}
