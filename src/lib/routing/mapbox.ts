import createDirectionsService, {
  type DirectionsService,
} from "@mapbox/mapbox-sdk/services/directions";
import type { LatLng } from "@/lib/delivery/batching";
import { STORE_LOCATION } from "@/lib/delivery/store";

// Calls the Mapbox Directions API for one robot trip: the store, then each
// stop in the given order, then (by default) back to the store. Stop order is
// decided by route optimization (#26); this only fetches and parses the route.

/** Mapbox Directions accepts 2 to 25 waypoints. */
const MAX_WAYPOINTS = 25;
const DEFAULT_TIMEOUT_MS = 10_000;

export type RouteRequest = {
  stops: readonly LatLng[];
  /** Defaults to the store. */
  origin?: LatLng;
  /** Add a final leg back to the origin. Defaults to true: the robot returns to the store. */
  returnToOrigin?: boolean;
};

export type RouteLeg = {
  /** Whole meters. */
  distanceMeters: number;
  /** Whole seconds. */
  durationSeconds: number;
};

export type Route = {
  /** GeoJSON LineString; coordinates are [lng, lat] as GeoJSON requires. */
  geometry: { type: "LineString"; coordinates: [number, number][] };
  distanceMeters: number;
  durationSeconds: number;
  /** One leg per hop: origin to stop 1, stop 1 to stop 2, ... (and back, if requested). */
  legs: RouteLeg[];
};

export type RoutingErrorCode =
  | "INVALID_REQUEST"
  | "NO_ROUTE"
  | "UNAUTHORIZED"
  | "RATE_LIMITED"
  | "TIMEOUT"
  | "PROVIDER_ERROR"
  | "NOT_CONFIGURED";

/** Every failure the caller needs to handle, e.g. by marking the trip ROUTE_FAILED (#27). */
export class RoutingError extends Error {
  constructor(
    readonly code: RoutingErrorCode,
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "RoutingError";
  }
}

export type RoutingOptions = {
  /** Defaults to MAPBOX_ACCESS_TOKEN. */
  accessToken?: string;
  /** Defaults to "driving". */
  profile?: "driving" | "walking" | "cycling";
  timeoutMs?: number;
  /** For tests: a stand-in for the SDK's Directions service. */
  directions?: DirectionsService;
};

type MapboxBody = {
  code?: string;
  message?: string;
  routes?: {
    distance: number;
    duration: number;
    geometry: { type: "LineString"; coordinates: [number, number][] };
    legs: { distance: number; duration: number }[];
  }[];
};

function isValidPoint({ lat, lng }: LatLng): boolean {
  return Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180;
}

function waypointsFor({ stops, origin = STORE_LOCATION, returnToOrigin = true }: RouteRequest): LatLng[] {
  if (stops.length === 0) throw new RoutingError("INVALID_REQUEST", "A route needs at least one stop.");
  const points = [origin, ...stops, ...(returnToOrigin ? [origin] : [])];
  if (points.length > MAX_WAYPOINTS) {
    throw new RoutingError("INVALID_REQUEST", `A route can have at most ${MAX_WAYPOINTS} waypoints.`);
  }
  if (!points.every(isValidPoint)) throw new RoutingError("INVALID_REQUEST", "A waypoint has invalid coordinates.");
  return points;
}

function toRoute(body: MapboxBody, legCount: number): Route {
  if (body.code !== "Ok" || !body.routes?.length) {
    throw new RoutingError("NO_ROUTE", `Mapbox found no route (${body.code ?? "no code"}).`);
  }
  const [route] = body.routes;
  if (route.legs.length !== legCount || route.geometry?.type !== "LineString") {
    throw new RoutingError("PROVIDER_ERROR", "Mapbox returned a route in an unexpected shape.");
  }
  return {
    geometry: { type: "LineString", coordinates: route.geometry.coordinates },
    distanceMeters: Math.round(route.distance),
    durationSeconds: Math.round(route.duration),
    legs: route.legs.map((leg) => ({
      distanceMeters: Math.round(leg.distance),
      durationSeconds: Math.round(leg.duration),
    })),
  };
}

type SdkError = { type?: string; statusCode?: number; body?: unknown; message?: string };

// Messages never include the request URL, which carries the access token.
function toRoutingError(err: unknown): RoutingError {
  if (err instanceof RoutingError) return err;
  const { type, statusCode, body } = (err ?? {}) as SdkError;
  if (type === "RequestAbortedError") return new RoutingError("TIMEOUT", "Mapbox did not respond in time.");
  const code = (body as MapboxBody | undefined)?.code;
  if (statusCode === 401 || statusCode === 403) {
    return new RoutingError("UNAUTHORIZED", "Mapbox rejected the access token.", statusCode);
  }
  if (statusCode === 429) return new RoutingError("RATE_LIMITED", "Mapbox rate limit reached.", statusCode);
  if (code === "NoRoute" || code === "NoSegment") {
    return new RoutingError("NO_ROUTE", `Mapbox found no route (${code}).`, statusCode);
  }
  if (statusCode === 422 || code === "InvalidInput") {
    return new RoutingError("INVALID_REQUEST", "Mapbox rejected the route request.", statusCode);
  }
  if (statusCode) return new RoutingError("PROVIDER_ERROR", `Mapbox returned HTTP ${statusCode}.`, statusCode);
  return new RoutingError("PROVIDER_ERROR", "Could not reach Mapbox.");
}

/** Fetches the route through a trip's stops in order. Throws RoutingError on any failure. */
export async function fetchTripRoute(request: RouteRequest, options: RoutingOptions = {}): Promise<Route> {
  const points = waypointsFor(request);

  let directions = options.directions;
  if (!directions) {
    const accessToken = options.accessToken ?? process.env.MAPBOX_ACCESS_TOKEN;
    if (!accessToken) throw new RoutingError("NOT_CONFIGURED", "MAPBOX_ACCESS_TOKEN is not set.");
    try {
      directions = createDirectionsService({ accessToken });
    } catch {
      // The SDK checks the token's format before sending anything.
      throw new RoutingError("NOT_CONFIGURED", "MAPBOX_ACCESS_TOKEN is not a valid Mapbox token.");
    }
  }

  const call = directions.getDirections({
    profile: options.profile ?? "driving",
    waypoints: points.map(({ lat, lng }) => ({ coordinates: [lng, lat] })),
    geometries: "geojson",
    overview: "full",
    steps: false,
  });

  const timer = setTimeout(() => call.abort(), options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  try {
    const response = await call.send();
    return toRoute(response.body as MapboxBody, points.length - 1);
  } catch (err) {
    throw toRoutingError(err);
  } finally {
    clearTimeout(timer);
  }
}
