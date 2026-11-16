import { createAdminClient } from "../src/lib/supabase/admin";
import { createRecoveryDependencies, reconcilePayments } from "../src/lib/payments/recovery";
import { sendPendingNotifications } from "../src/lib/notifications/service";
import { isUuid } from "../src/lib/inventory/validation";

try {
  process.loadEnvFile(".env.local");
} catch (error) {
  if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
    throw error;
  }
}
const db = createAdminClient();
let stopping = false;
let wake: (() => void) | undefined;
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    stopping = true;
    wake?.();
  });
}

async function status() {
  const [payments, notifications] = await Promise.all([
    db.from("payment_attempts").select("id,status,finalize_step,recovery_attempts,recovery_manual,recovery_error_code,recovery_next_at")
      .neq("finalize_step", "DONE").order("recovery_next_at").limit(100),
    db.from("notifications").select("id,status,attempts,error_message,locked_until").neq("status", "SENT").order("created_at").limit(100),
  ]);
  if (payments.error || notifications.error) {
    throw new Error("Recovery status unavailable");
  }
  // No customer identity, addresses, card details, or provider payloads.
  console.info(JSON.stringify({
    payments: payments.data,
    notifications: notifications.data
  }));
}

async function retry(flag: string, table: "payment_attempts" | "notifications") {
  const id = process.argv[process.argv.indexOf(flag) + 1];
  if (!id || !isUuid(id)) {
    throw new Error(`${flag} requires a UUID`);
  }
  const now = new Date().toISOString();
  const mutation = table === "payment_attempts"
    ? db.from(table).update({
      recovery_manual: false,
      recovery_attempts: 0,
      recovery_next_at: now,
      recovery_error_code: null
    })
      .eq("id", id).neq("finalize_step", "DONE").or(`recovery_until.is.null,recovery_until.lt.${now}`)
    : db.from(table).update({
      attempts: 0,
      status: "PENDING",
      error_message: null
    })
      .eq("id", id).neq("status", "SENT").or(`locked_until.is.null,locked_until.lt.${now}`);
  const { data, error } = await mutation.select("id");
  if (error || data?.length !== 1) {
    throw new Error("Recovery reset unavailable, completed, or currently leased");
  }
  console.info(JSON.stringify({ retryQueued: id }));
}

async function main() {
  if (process.argv.includes("--status")) {
    return status();
  }
  if (process.argv.includes("--retry-payment")) {
    return retry("--retry-payment", "payment_attempts");
  }
  if (process.argv.includes("--retry-notification")) {
    return retry("--retry-notification", "notifications");
  }
  const payments = createRecoveryDependencies(db);
  do {
    const started = Date.now();
    // Independent work: an email provider outage must not prevent payment recovery.
    const results = await Promise.allSettled([reconcilePayments(payments), sendPendingNotifications()]);
    console.info(JSON.stringify({
      event: "recovery_tick",
      payments: results[0].status === "fulfilled" ? results[0].value : { error: "PAYMENT_RECOVERY_UNAVAILABLE" },
      notifications: results[1].status === "fulfilled" ? results[1].value : { error: "NOTIFICATIONS_UNAVAILABLE" }
    }));
    if (stopping || process.argv.includes("--once")) {
      break;
    }
    await new Promise<void>(resolve => {
      const timer = setTimeout(resolve, Math.max(0, 60000 - (Date.now() - started)));
      wake = () => {
        clearTimeout(timer);
        resolve();
      };
    });
  } while (!stopping);
}
void main().catch(() => {
  console.error("Recovery worker failed. Check configuration and operator status.");
  process.exitCode = 1;
});
