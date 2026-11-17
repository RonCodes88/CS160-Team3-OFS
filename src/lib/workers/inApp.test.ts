import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sendPendingNotifications } from "@/lib/notifications/service";
import { reconcilePayments } from "@/lib/payments/recovery";
import { simulateAssignedTrip } from "@/lib/vehicle/simulator";
import { createInAppJobs, repeat, startInAppWorkers, type InAppJobs } from "./inApp";

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn(() => ({})) }));
vi.mock("@/lib/delivery/worker", () => ({ createDeliveryTick: vi.fn(() => vi.fn()) }));
vi.mock("@/lib/notifications/service", () => ({ sendPendingNotifications: vi.fn() }));
vi.mock("@/lib/payments/recovery", () => ({ createRecoveryDependencies: vi.fn(() => ({})), reconcilePayments: vi.fn() }));
vi.mock("@/lib/vehicle/simulator", async importOriginal => ({
  ...(await importOriginal<typeof import("@/lib/vehicle/simulator")>()),
  simulateAssignedTrip: vi.fn(),
}));

const STARTED = Symbol.for("ofs.inAppWorkers.started");
const ROBOT = { OFS_IN_APP_ROBOT: "true", OFS_ROBOT_EMAIL: "vehicle.test@ofs.local", OFS_ROBOT_PASSWORD: "test-only" };

/** Collects scheduled runs instead of waiting on real timers. */
function fakeTimers() {
  const scheduled: { run: () => void; ms: number }[] = [];
  return { scheduled, setTimer: (run: () => void, ms: number) => void scheduled.push({ run, ms }) };
}
const flush = () => new Promise(resolve => setTimeout(resolve, 0));

beforeEach(() => {
  vi.clearAllMocks();
  delete (globalThis as Record<symbol, unknown>)[STARTED];
  vi.spyOn(console, "info").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

describe("startInAppWorkers", () => {
  it("does nothing unless a setting turns it on", () => {
    const build = vi.fn();
    expect(startInAppWorkers({}, { build })).toEqual([]);
    expect(startInAppWorkers({ OFS_IN_APP_WORKERS: "1", OFS_IN_APP_ROBOT: "yes" }, { build })).toEqual([]);
    expect(build).not.toHaveBeenCalled();
  });

  it("starts each job once per server, the robot after the others", () => {
    const { scheduled, setTimer } = fakeTimers();
    const jobs: InAppJobs = { delivery: vi.fn(), recovery: vi.fn(), robot: vi.fn(), robotPollMs: 5000, description: ["a", "b"] };
    expect(startInAppWorkers({ OFS_IN_APP_WORKERS: "true" }, { build: () => jobs, setTimer })).toEqual(["a", "b"]);
    expect(scheduled.map(entry => entry.ms)).toEqual([5000, 5000, 10000]);

    // A second start (for example a dev-server reload) changes nothing.
    expect(startInAppWorkers({ OFS_IN_APP_WORKERS: "true" }, { build: () => jobs, setTimer })).toEqual([]);
    expect(scheduled).toHaveLength(3);
  });

  it.each([[undefined, 60000], [10000, 10000]])("repeats delivery batching after %s ms (default a minute)", async (deliveryIntervalMs, expected) => {
    const { scheduled, setTimer } = fakeTimers();
    const jobs: InAppJobs = { delivery: vi.fn(async () => {}), deliveryIntervalMs, description: ["a"] };
    startInAppWorkers({ OFS_IN_APP_WORKERS: "true" }, { build: () => jobs, setTimer });
    scheduled[0].run();
    await flush();
    expect(scheduled[1].ms).toBeGreaterThan(expected - 1000);
    expect(scheduled[1].ms).toBeLessThanOrEqual(expected);
  });

  it("logs a bad setting instead of crashing the website, and can start once it is fixed", () => {
    const { setTimer } = fakeTimers();
    expect(startInAppWorkers(ROBOT, { setTimer, build: () => { throw new Error("OFS_ROBOT_STEP_MS must be a whole number"); } })).toEqual([]);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining("In-app workers not started: OFS_ROBOT_STEP_MS"));
    expect(startInAppWorkers(ROBOT, { setTimer, build: () => ({ robot: vi.fn(), description: ["robot"] }) })).toEqual(["robot"]);
  });
});

describe("repeat", () => {
  it("runs the job, then schedules the next run without overlapping", async () => {
    const { scheduled, setTimer } = fakeTimers();
    const job = vi.fn(async () => {});
    repeat(job, { intervalMs: 60000, firstDelayMs: 5000, onError: vi.fn(), setTimer });
    expect(job).not.toHaveBeenCalled();

    scheduled[0].run();
    await flush();
    expect(job).toHaveBeenCalledOnce();
    expect(scheduled).toHaveLength(2);
    expect(scheduled[1].ms).toBeGreaterThan(59000);
  });

  it("reports a failed run and keeps going", async () => {
    const { scheduled, setTimer } = fakeTimers();
    const onError = vi.fn();
    repeat(async () => { throw new Error("db down"); }, { intervalMs: 1000, firstDelayMs: 0, onError, setTimer });
    scheduled[0].run();
    await flush();
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: "db down" }));
    expect(scheduled).toHaveLength(2);
  });
});

describe("createInAppJobs", () => {
  it("builds only what is turned on", () => {
    expect(Object.keys(createInAppJobs({ OFS_IN_APP_WORKERS: "true" })).sort()).toEqual(["delivery", "deliveryIntervalMs", "description", "recovery"]);
    const robotOnly = createInAppJobs(ROBOT);
    expect(robotOnly.delivery).toBeUndefined();
    expect(robotOnly.robot).toBeTypeOf("function");
    expect(robotOnly.robotPollMs).toBe(5000);
  });

  it("checks for deliveries every minute unless a demo sets a shorter interval", () => {
    const normal = createInAppJobs({ OFS_IN_APP_WORKERS: "true" });
    expect(normal.deliveryIntervalMs).toBe(60000);
    expect(normal.description[0]).toContain("every minute");
    const demo = createInAppJobs({ OFS_IN_APP_WORKERS: "true", OFS_DELIVERY_TICK_SECONDS: "10" });
    expect(demo.deliveryIntervalMs).toBe(10000);
    expect(demo.description[0]).toContain("every 10 s");
  });

  it.each<[Record<string, string>, string]>([
    [{ OFS_IN_APP_WORKERS: "true", OFS_DELIVERY_WAIT_MINUTES: "0" }, "positive minutes"],
    [{ OFS_IN_APP_WORKERS: "true", OFS_DELIVERY_TICK_SECONDS: "1" }, "OFS_DELIVERY_TICK_SECONDS"],
    [{ OFS_IN_APP_WORKERS: "true", OFS_DELIVERY_TICK_SECONDS: "90" }, "OFS_DELIVERY_TICK_SECONDS"],
    [{ OFS_IN_APP_ROBOT: "true" }, "email and password are required"],
    [{ ...ROBOT, OFS_ROBOT_BASE_URL: "http://example.com" }, "loopback"],
    [{ ...ROBOT, OFS_ROBOT_STEP_MS: "fast" }, "OFS_ROBOT_STEP_MS"],
    [{ ...ROBOT, OFS_ROBOT_DRIVE_STEPS: "500" }, "OFS_ROBOT_DRIVE_STEPS"],
    [{ ...ROBOT, OFS_ROBOT_POLL_MS: "10" }, "OFS_ROBOT_POLL_MS"],
  ])("rejects %o", (env, error) => {
    expect(() => createInAppJobs(env)).toThrow(error);
  });

  it("warns once when email is off but reports other send failures every time", async () => {
    const { recovery } = createInAppJobs({ OFS_IN_APP_WORKERS: "true" });
    vi.mocked(reconcilePayments).mockResolvedValue({} as never);
    vi.mocked(sendPendingNotifications).mockRejectedValue(new Error("NOTIFICATIONS_NOT_CONFIGURED"));
    await recovery!();
    await recovery!();
    expect(console.warn).toHaveBeenCalledOnce();
    expect(console.error).not.toHaveBeenCalled();

    vi.mocked(sendPendingNotifications).mockRejectedValue(new Error("EMAIL_PROVIDER_UNAVAILABLE"));
    vi.mocked(reconcilePayments).mockRejectedValue(new Error("stripe down"));
    await recovery!();
    expect(console.error).toHaveBeenCalledWith("Payment recovery failed:", "stripe down");
    expect(console.error).toHaveBeenCalledWith("Sending notifications failed:", "EMAIL_PROVIDER_UNAVAILABLE");
  });

  it("drives the robot at a demo pace by default", async () => {
    const { robot } = createInAppJobs(ROBOT);
    vi.mocked(simulateAssignedTrip).mockResolvedValue({ tripId: "trip-1", delivered: 2 });
    await robot!();
    expect(simulateAssignedTrip).toHaveBeenCalledWith(expect.anything(), { stepMs: 8000, arrivalWaitMs: 30000, driveSteps: 10 });
    expect(console.info).toHaveBeenCalledWith(expect.stringContaining("finished trip trip-1 (2 delivered)"));
  });
});
