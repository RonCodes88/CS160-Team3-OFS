/** Simulated robot transport. It uses only the same authenticated HTTP APIs as a robot client. */
export type RobotClientOptions = {
  baseUrl: string;
  email: string;
  password: string;
  allowRemote?: boolean;
  fetcher?: typeof fetch;
  pause?: (milliseconds: number) => Promise<void>;
};
type RobotStop = {
  id: string;
  status: "PENDING" | "EN_ROUTE" | "ARRIVED" | "DELIVERED" | "DELAYED" | "FAILED";
  stopSequence: number;
  location: { lat: number; lng: number };
};
type RobotPoint = RobotStop["location"];
type RobotTrip = { id: string; stops: RobotStop[]; path: RobotPoint[] | null };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const delay = (milliseconds: number) => new Promise<void>(resolve => setTimeout(resolve, milliseconds));
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid robot assignment response.");
  return value as Record<string, unknown>;
}
function parseTrip(body: unknown): RobotTrip | null {
  const value = record(body).trip;
  if (value === null) return null;
  const trip = record(value);
  if (typeof trip.id !== "string" || !UUID.test(trip.id) || trip.status !== "OUT_FOR_DELIVERY"
    || !Array.isArray(trip.stops) || trip.stops.length < 1 || trip.stops.length > 10) throw new Error("Invalid robot assignment.");
  const stops = trip.stops.map((value: unknown): RobotStop => {
    const stop = record(value), location = record(stop.location);
    const status = stop.status;
    if (typeof stop.id !== "string" || !UUID.test(stop.id)
      || typeof stop.stopSequence !== "number" || !Number.isInteger(stop.stopSequence)
      || stop.stopSequence < 1 || stop.stopSequence > 10
      || (status !== "PENDING" && status !== "EN_ROUTE" && status !== "ARRIVED" && status !== "DELIVERED" && status !== "DELAYED" && status !== "FAILED")
      || typeof location.lat !== "number" || !Number.isFinite(location.lat) || Math.abs(location.lat) > 90
      || typeof location.lng !== "number" || !Number.isFinite(location.lng) || Math.abs(location.lng) > 180) throw new Error("Invalid robot assignment stop.");
    return { id: stop.id, stopSequence: stop.stopSequence, status, location: { lat: location.lat, lng: location.lng } };
  });
  if (new Set(stops.map(stop => stop.id)).size !== stops.length
    || new Set(stops.map(stop => stop.stopSequence)).size !== stops.length) throw new Error("Invalid robot assignment duplicates.");
  return { id: trip.id, stops: stops.sort((a, b) => a.stopSequence - b.stopSequence), path: parsePath(trip.routeGeometry) };
}
/** The trip's road route as points, or null when it is missing or malformed (the robot then goes straight to each stop). */
function parsePath(geometry: unknown): RobotPoint[] | null {
  if (!geometry || typeof geometry !== "object" || Array.isArray(geometry)) return null;
  const { type, coordinates } = geometry as Record<string, unknown>;
  if (type !== "LineString" || !Array.isArray(coordinates) || coordinates.length < 2 || coordinates.length > 10000) return null;
  const path: RobotPoint[] = [];
  for (const pair of coordinates) {
    if (!Array.isArray(pair) || pair.length < 2) return null;
    const [lng, lat] = pair;
    if (typeof lat !== "number" || typeof lng !== "number" || !Number.isFinite(lat) || !Number.isFinite(lng)
      || Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
    path.push({ lat, lng });
  }
  return path;
}
/**
 * The route points between the robot's position on the path and the next stop,
 * thinned to at most `steps` evenly spaced points. The stop itself is reported
 * separately, so it is not included.
 */
export function legPoints(path: RobotPoint[], from: number, stop: RobotPoint, steps: number): { points: RobotPoint[]; end: number } {
  let end = from, best = Infinity;
  for (let index = from; index < path.length; index++) {
    const distance = (path[index].lat - stop.lat) ** 2 + (path[index].lng - stop.lng) ** 2;
    if (distance < best) { best = distance; end = index; }
  }
  const leg = path.slice(from + 1, end);
  if (leg.length <= steps) return { points: leg, end };
  const points = Array.from({ length: steps }, (_, step) => leg[Math.floor(((step + 1) * leg.length) / (steps + 1))]);
  return { points, end };
}
class RobotHttpError extends Error {
  constructor(readonly status: number) { super(`Robot HTTP request failed (${status}).`); }
}
export function createRobotClient(options: RobotClientOptions) {
  const base = new URL(options.baseUrl);
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(base.hostname);
  if (base.username || base.password || base.pathname !== "/" || base.search || base.hash
    || (!local && (!options.allowRemote || base.protocol !== "https:"))
    || (base.protocol !== "http:" && base.protocol !== "https:")) {
    throw new Error("Robot base URL must be a loopback origin, or an explicitly permitted HTTPS test origin.");
  }
  if (!options.email.trim() || !options.password) throw new Error("Robot email and password are required.");
  const fetcher = options.fetcher ?? fetch;
  const pause = options.pause ?? delay;
  let cookie: string | undefined;
  async function exchange(path: string, init: RequestInit): Promise<Response> {
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const response = await fetcher(new URL(path, base), { ...init, redirect: "error", cache: "no-store", signal: AbortSignal.timeout(10000) });
        if (!response.ok) throw new RobotHttpError(response.status);
        return response;
      } catch (error) {
        const retryable = !(error instanceof RobotHttpError) || error.status === 429 || error.status >= 500;
        if (!retryable || attempt === 2) {
          if (error instanceof RobotHttpError) throw error;
          throw new Error("Robot HTTP request failed after three attempts.");
        }
        await pause(250 * (attempt + 1));
      }
    }
    throw new Error("Robot HTTP retry exhausted.");
  }
  async function authenticate() {
    const response = await exchange("/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: options.email, password: options.password }) });
    const body: unknown = await response.json();
    if (record(record(body).user).role !== "VEHICLE") throw new Error("Robot account must have the VEHICLE role.");
    const session = response.headers.getSetCookie().map(value => value.split(";")[0]).find(value => value.startsWith("ofs_session="));
    if (!session || !/^ofs_session=[A-Za-z0-9_-]+$/.test(session)) throw new Error("Robot login did not return a session cookie.");
    cookie = session;
  }
  async function request(path: string, method = "GET", body?: object): Promise<unknown> {
    if (!cookie) await authenticate();
    const send = () => exchange(path, { method, headers: { "Content-Type": "application/json", Cookie: cookie ?? "" },
      ...(body ? { body: JSON.stringify(body) } : {}) });
    let response: Response;
    try { response = await send(); } catch (error) {
      if (!(error instanceof RobotHttpError) || error.status !== 401) throw error;
      cookie = undefined;
      await authenticate();
      response = await send();
    }
    return response.json();
  }
  return {
    assignedTrip: async () => parseTrip(await request("/api/vehicle/trip")),
    location: async (location: RobotStop["location"]) => request("/api/vehicle/location", "PATCH", {
      latitude: location.lat, longitude: location.lng, batteryPercent: 100,
    }),
    stop: async (id: string, status: "ARRIVED" | "DELIVERED") => request(`/api/vehicle/stops/${id}`, "PATCH", { status }),
  };
}

/** One snapshot is sufficient: successful delivery reports are idempotent across restarts. */
export async function simulateAssignedTrip(client: ReturnType<typeof createRobotClient>, options: {
  stepMs?: number;
  pause?: (milliseconds: number) => Promise<void>;
  shouldStop?: () => boolean;
  /** Report up to this many positions along the road route before each stop, so the map shows the robot moving. */
  driveSteps?: number;
  /** How long the robot waits at the door between ARRIVED and DELIVERED. Defaults to stepMs. */
  arrivalWaitMs?: number;
} = {}): Promise<{ tripId: string | null; delivered: number }> {
  const stepMs = options.stepMs ?? 0;
  const arrivalWaitMs = options.arrivalWaitMs ?? stepMs;
  const driveSteps = options.driveSteps ?? 0;
  for (const value of [stepMs, arrivalWaitMs]) {
    if (!Number.isFinite(value) || value < 0 || value > 60000) throw new Error("Robot step interval must be between 0 and 60000 milliseconds.");
  }
  if (!Number.isInteger(driveSteps) || driveSteps < 0 || driveSteps > 100) throw new Error("Robot drive steps must be a whole number from 0 to 100.");
  const pause = options.pause ?? delay;
  const trip = await client.assignedTrip();
  if (!trip) return { tripId: null, delivered: 0 };
  let delivered = 0;
  let onPath = 0;
  for (const stop of trip.stops) {
    if (options.shouldStop?.()) break;
    if (stop.status === "DELIVERED") continue;
    if (stop.status === "FAILED") throw new Error("Robot assignment has a failed stop requiring intervention.");
    if (stop.status !== "ARRIVED") {
      if (driveSteps && trip.path) {
        const leg = legPoints(trip.path, onPath, stop.location, driveSteps);
        onPath = leg.end;
        for (const point of leg.points) {
          if (options.shouldStop?.()) return { tripId: trip.id, delivered };
          await client.location(point);
          if (stepMs) await pause(stepMs);
        }
      }
      // Without driveSteps the simulator reports only each destination; it does not emulate hardware motion.
      await client.location(stop.location);
      if (stepMs) await pause(stepMs);
      await client.stop(stop.id, "ARRIVED");
    }
    if (arrivalWaitMs) await pause(arrivalWaitMs);
    await client.stop(stop.id, "DELIVERED");
    delivered++;
  }
  return { tripId: trip.id, delivered };
}
