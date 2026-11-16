import { createRobotClient, simulateAssignedTrip } from "../src/lib/vehicle/simulator";
try { process.loadEnvFile(".env.local"); } catch (error) {
  if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
}
function milliseconds(name: string, fallback: number, minimum: number) {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isInteger(value) || value < minimum || value > 60000) throw new Error(`${name} must be between ${minimum} and 60000 milliseconds.`);
  return value;
}
async function main() {
  const supported = new Set(["--once", "--allow-remote"]);
  if (process.argv.slice(2).some(argument => !supported.has(argument))) throw new Error("Supported options: --once, --allow-remote.");
  const client = createRobotClient({
    baseUrl: process.env.OFS_ROBOT_BASE_URL ?? "http://127.0.0.1:3000",
    email: process.env.OFS_ROBOT_EMAIL ?? "",
    password: process.env.OFS_ROBOT_PASSWORD ?? "",
    allowRemote: process.argv.includes("--allow-remote"),
  });
  const pollMs = milliseconds("OFS_ROBOT_POLL_MS", 5000, 100);
  const stepMs = milliseconds("OFS_ROBOT_STEP_MS", 500, 0);
  const driveSteps = Number(process.env.OFS_ROBOT_DRIVE_STEPS ?? 0);
  const arrivalWaitMs = milliseconds("OFS_ROBOT_ARRIVAL_WAIT_MS", stepMs, 0);
  let stopping = false;
  let wake: (() => void) | undefined;
  for (const signal of ["SIGINT", "SIGTERM"] as const) process.on(signal, () => { stopping = true; wake?.(); });
  const pause = (ms: number) => new Promise<void>(resolve => {
    if (stopping) { resolve(); return; }
    const timer = setTimeout(resolve, ms);
    wake = () => { clearTimeout(timer); resolve(); };
  });
  console.info("Robot simulator started. Reports destination locations and delivery acknowledgements over HTTP.");
  do {
    try {
      const result = await simulateAssignedTrip(client, { stepMs, arrivalWaitMs, driveSteps, pause, shouldStop: () => stopping });
      console.info(result.tripId ? `Trip ${result.tripId}: ${result.delivered} delivery acknowledgements.` : "No assigned trip.");
    } catch (error) {
      console.error(error instanceof Error ? error.message : "Robot simulator failed.");
      if (process.argv.includes("--once")) { process.exitCode = 1; break; }
    }
    if (stopping || process.argv.includes("--once")) break;
    await pause(pollMs);
  } while (!stopping);
}
void main().catch(error => { console.error(error instanceof Error ? error.message : "Robot simulator configuration failed."); process.exitCode = 1; });
