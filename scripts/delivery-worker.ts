import { createAdminClient } from "../src/lib/supabase/admin";
import { waitLimitMinutes } from "../src/lib/delivery/dispatch";
import { createDeliveryTick } from "../src/lib/delivery/worker";

try { process.loadEnvFile(".env.local"); } catch (error) {
  if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
}
const minutes = waitLimitMinutes(process.env.OFS_DELIVERY_WAIT_MINUTES);
const db = createAdminClient();
const tick = createDeliveryTick(db, minutes);
let stopping = false;
let wake: (() => void) | undefined;
for (const signal of ["SIGINT", "SIGTERM"] as const) process.on(signal, () => { stopping = true; wake?.(); });

async function main() {
  console.info(`Delivery worker: checks every minute; wait limit ${minutes} minutes.`);
  do {
    const started = Date.now();
    try {
      await tick(new Date());
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
