import { createAdminClient } from "../src/lib/supabase/admin";
import { getPendingDeliveryOrders } from "../src/lib/orders/queue";
import { routeTripById } from "../src/lib/routing/service";
import { runDeliveryTick } from "../src/lib/delivery/job";
import { waitLimitMinutes } from "../src/lib/delivery/dispatch";

try { process.loadEnvFile(".env.local"); } catch (error) {
  if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
}
const minutes = waitLimitMinutes(process.env.OFS_DELIVERY_WAIT_MINUTES);
const db = createAdminClient();
let stopping = false;
let wake: (() => void) | undefined;
for (const signal of ["SIGINT", "SIGTERM"] as const) process.on(signal, () => { stopping = true; wake?.(); });

async function main() {
  console.info(`Delivery worker: checks every minute; wait limit ${minutes} minutes.`);
  do {
    const started = Date.now();
    try {
      await runDeliveryTick({
        readQueue: () => getPendingDeliveryOrders(db),
        createTrip: async (ids, wait) => {
          const { data, error } = await db.rpc("delivery_create_trip", { p_order_ids: ids, p_wait_minutes: wait });
          if (error) throw error;
          return data as string | null;
        },
        pendingTrips: async () => {
          const { data, error } = await db.from("trips").select("id").eq("status", "PLANNED").order("created_at");
          if (error) throw error;
          return data.map(trip => trip.id);
        },
        route: id => routeTripById(db, id),
        report: error => console.error("Trip routing failed:", error),
      }, new Date(), minutes);
    } catch (error) { console.error("Delivery tick failed:", error); }
    if (stopping || process.argv.includes("--once")) break;
    // Await each tick: a slow routing request must not overlap the next tick.
    await new Promise<void>(resolve => {
      const timer = setTimeout(resolve, Math.max(0, 60000 - (Date.now() - started)));
      wake = () => { clearTimeout(timer); resolve(); };
    });
  } while (!stopping);
}
void main().catch(error => { console.error(error); process.exitCode = 1; });
