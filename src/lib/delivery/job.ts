import { planTrips, type PendingOrder, type PlannedTrip } from "./batching";
import { shouldDispatch } from "./dispatch";

export type DeliveryJob = {
  readQueue(): Promise<PendingOrder[]>;
  createTrip(ids: string[], minutes: number): Promise<string | null>;
  pendingTrips(): Promise<string[]>;
  route(id: string): Promise<unknown>;
  routedTrips(): Promise<string[]>;
  depart(id: string): Promise<unknown>;
  report(error: unknown): void;
};

export async function runDeliveryTick(deps: DeliveryJob, now: Date, minutes: number): Promise<void> {
  // Recover committed trips if a previous process stopped before routing them.
  const pending = new Set<string>();
  try {
    for (const id of await deps.pendingTrips()) pending.add(id);
  } catch (error) {
    deps.report(error);
  }

  // New queue work and recovery are independent. A failed read or claim must
  // not strand trips that have already committed and are waiting for routing.
  let planned: PlannedTrip[] = [];
  try {
    planned = planTrips(await deps.readQueue());
  } catch (error) {
    deps.report(error);
  }
  for (const trip of planned) {
    if (!shouldDispatch(trip, now, minutes)) continue;
    try {
      const id = await deps.createTrip(trip.orders.map(order => order.orderId), minutes);
      if (id) pending.add(id);
    } catch (error) {
      deps.report(error);
    }
  }
  for (const id of pending) {
    try { await deps.route(id); } catch (error) { deps.report(error); }
  }
  // Persisted ROUTED trips survive a restart or a temporary lack of vehicles.
  let routed: string[] = [];
  try { routed = await deps.routedTrips(); } catch (error) { deps.report(error); }
  for (const id of routed) {
    try { await deps.depart(id); } catch (error) { deps.report(error); }
  }
}
