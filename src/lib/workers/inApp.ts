// Lets the website run the background jobs itself, so the whole customer flow
// (pay, batch, route, robot drives, delivered, emails) works with only
// `npm run dev` or `docker compose up`, and nobody needs a terminal.
//
// Off unless OFS_IN_APP_WORKERS=true (delivery + payment recovery + email)
// and/or OFS_IN_APP_ROBOT=true (the simulated robot). The jobs are the same
// code the worker scripts run. Don't also run those scripts against the same
// database, and only turn this on for one running copy of the site.

import { waitLimitMinutes } from "@/lib/delivery/dispatch";
import { createDeliveryTick } from "@/lib/delivery/worker";
import { sendPendingNotifications } from "@/lib/notifications/service";
import { createRecoveryDependencies, reconcilePayments } from "@/lib/payments/recovery";
import { createAdminClient } from "@/lib/supabase/admin";
import { createRobotClient, simulateAssignedTrip } from "@/lib/vehicle/simulator";

type Env = Record<string, string | undefined>;
type Job = () => Promise<void>;
type SetTimer = (run: () => void, ms: number) => void;

export type InAppJobs = {
  delivery?: Job; recovery?: Job; robot?: Job;
  /** How often delivery batching runs. One minute unless a demo shortens it. */
  deliveryIntervalMs?: number;
  robotPollMs?: number;
  description: string[];
};

const MINUTE = 60_000;
const STARTED = Symbol.for("ofs.inAppWorkers.started");

/** Runs `job` after `firstDelayMs`, then again `intervalMs` after each run starts. Runs never overlap. */
export function repeat(job: Job, options: { intervalMs: number; firstDelayMs: number; onError: (error: unknown) => void; setTimer?: SetTimer }): void {
  const setTimer = options.setTimer ?? defaultSetTimer;
  const run = async () => {
    const started = Date.now();
    try {
      await job();
    } catch (error) {
      options.onError(error);
    }
    setTimer(run, Math.max(0, options.intervalMs - (Date.now() - started)));
  };
  setTimer(() => void run(), options.firstDelayMs);
}

function defaultSetTimer(run: () => void, ms: number): void {
  setTimeout(run, ms).unref?.();
}

function whole(env: Env, name: string, fallback: number, min: number, max: number): number {
  const value = Number(env[name] ?? fallback);
  if (!Number.isInteger(value) || value < min || value > max) throw new Error(`${name} must be a whole number from ${min} to ${max}.`);
  return value;
}

const message = (error: unknown) => (error instanceof Error ? error.message : String(error));

/** Builds the real jobs from the environment. Throws on a bad setting so nothing half-starts. */
export function createInAppJobs(env: Env): InAppJobs {
  const jobs: InAppJobs = { description: [] };

  if (env.OFS_IN_APP_WORKERS === "true") {
    const db = createAdminClient();
    const minutes = waitLimitMinutes(env.OFS_DELIVERY_WAIT_MINUTES);
    jobs.delivery = createDeliveryTick(db, minutes);
    // The rule is "batching runs every minute". Demos can check more often so a
    // paid order leaves within seconds; the batching rules themselves don't change.
    const tickSeconds = whole(env, "OFS_DELIVERY_TICK_SECONDS", 60, 5, 60);
    jobs.deliveryIntervalMs = tickSeconds * 1000;

    const payments = createRecoveryDependencies(db);
    let warnedEmailOff = false;
    jobs.recovery = async () => {
      // Independent work: an email outage must not block payment recovery.
      const [paid, sent] = await Promise.allSettled([reconcilePayments(payments), sendPendingNotifications()]);
      if (paid.status === "rejected") console.error("Payment recovery failed:", message(paid.reason));
      if (sent.status === "rejected") {
        if (message(sent.reason) !== "NOTIFICATIONS_NOT_CONFIGURED") console.error("Sending notifications failed:", message(sent.reason));
        else if (!warnedEmailOff) {
          warnedEmailOff = true;
          console.warn("Email is not configured, so notifications stay queued. See docs/run-workers.md.");
        }
      }
    };
    const every = tickSeconds === 60 ? "every minute" : `every ${tickSeconds} s`;
    jobs.description.push(`delivery batching ${every} (wait limit ${minutes} min)`, "payment recovery and email every minute");
  }

  if (env.OFS_IN_APP_ROBOT === "true") {
    const client = createRobotClient({
      baseUrl: env.OFS_ROBOT_BASE_URL || `http://127.0.0.1:${env.PORT || 3000}`,
      email: env.OFS_ROBOT_EMAIL ?? "",
      password: env.OFS_ROBOT_PASSWORD ?? "",
    });
    const stepMs = whole(env, "OFS_ROBOT_STEP_MS", 8000, 0, MINUTE);
    const arrivalWaitMs = whole(env, "OFS_ROBOT_ARRIVAL_WAIT_MS", 30000, 0, MINUTE);
    const driveSteps = whole(env, "OFS_ROBOT_DRIVE_STEPS", 10, 0, 100);
    jobs.robotPollMs = whole(env, "OFS_ROBOT_POLL_MS", 5000, 100, MINUTE);
    jobs.robot = async () => {
      const result = await simulateAssignedTrip(client, { stepMs, arrivalWaitMs, driveSteps });
      if (result.tripId) console.info(`Simulated robot finished trip ${result.tripId} (${result.delivered} delivered).`);
    };
    jobs.description.push(`simulated robot (${driveSteps} moves per stop, ${stepMs / 1000}s apart)`);
  }

  return jobs;
}

/**
 * Starts the in-app jobs once per server process. Never throws: a bad setting
 * is logged and the website keeps serving pages.
 */
export function startInAppWorkers(
  env: Env = process.env,
  options: { build?: (env: Env) => InAppJobs; setTimer?: SetTimer } = {},
): string[] {
  if (env.OFS_IN_APP_WORKERS !== "true" && env.OFS_IN_APP_ROBOT !== "true") return [];
  const state = globalThis as Record<symbol, unknown>;
  if (state[STARTED]) return [];

  let jobs: InAppJobs;
  try {
    jobs = (options.build ?? createInAppJobs)(env);
  } catch (error) {
    console.error(`In-app workers not started: ${message(error)}`);
    return [];
  }
  state[STARTED] = true;

  const { setTimer } = options;
  if (jobs.delivery) {
    repeat(jobs.delivery, { intervalMs: jobs.deliveryIntervalMs ?? MINUTE, firstDelayMs: 5000, setTimer,
      onError: error => console.error("Delivery tick failed:", message(error)) });
  }
  if (jobs.recovery) {
    repeat(jobs.recovery, { intervalMs: MINUTE, firstDelayMs: 5000, setTimer,
      onError: error => console.error("Recovery tick failed:", message(error)) });
  }
  if (jobs.robot) {
    // Wait for the server to start listening before the robot signs in over HTTP.
    repeat(jobs.robot, { intervalMs: jobs.robotPollMs ?? 5000, firstDelayMs: 10000, setTimer,
      onError: error => console.error("Simulated robot:", message(error)) });
  }
  console.info(`In-app workers started: ${jobs.description.join("; ")}.`);
  return jobs.description;
}
