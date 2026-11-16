import {
  distanceMeters,
  MAX_TRIP_ORDERS,
  type LatLng,
} from "@/lib/delivery/batching";
import { STORE_LOCATION } from "@/lib/delivery/store";
import {
  fetchTripRoute,
  RoutingError,
  type Route,
  type RouteRequest,
} from "./mapbox";

export type DeliveryOrderStop = {
  orderId: string;
  location: LatLng;
};

export type OptimizedStop = {
  orderId: string;
  stopSequence: number;
  estimatedArrival: string;
};

export type OptimizedTripRoute = {
  geometry: Route["geometry"];
  distanceMeters: number;
  durationSeconds: number;
  stops: OptimizedStop[];
};

type RouteProvider = (request: RouteRequest) => Promise<Route>;

export type OptimizationOptions = {
  origin?: LatLng;
  departureTime?: Date;
  routeProvider?: RouteProvider;
};

function isValidLocation(point: LatLng): boolean {
  return (
    Number.isFinite(point.lat) &&
    Number.isFinite(point.lng) &&
    Math.abs(point.lat) <= 90 &&
    Math.abs(point.lng) <= 180
  );
}

// Pick the nearest stop each time, though this may not give the shortest route.
function orderStops(
  stops: readonly DeliveryOrderStop[],
  origin: LatLng,
): DeliveryOrderStop[] {
  const remaining = [...stops];
  const ordered: DeliveryOrderStop[] = [];
  let current = origin;

  while (remaining.length > 0) {
    remaining.sort(
      (a, b) =>
        distanceMeters(current, a.location) -
          distanceMeters(current, b.location) ||
        a.orderId.localeCompare(b.orderId),
    );

    const next = remaining.shift()!;
    ordered.push(next);
    current = next.location;
  }

  return ordered;
}

// Build the optimized route and ETAs without saving anything to the database.
export async function optimizeTripRoute(
  stops: readonly DeliveryOrderStop[],
  options: OptimizationOptions = {},
): Promise<OptimizedTripRoute> {
  const {
    origin = STORE_LOCATION,
    departureTime = new Date(),
    routeProvider = fetchTripRoute,
  } = options;

  if (stops.length === 0 || stops.length > MAX_TRIP_ORDERS) {
    throw new RoutingError(
      "INVALID_REQUEST",
      `A trip must have between 1 and ${MAX_TRIP_ORDERS} stops.`,
    );
  }

  if (
    !isValidLocation(origin) ||
    stops.some((stop) => !stop.orderId || !isValidLocation(stop.location))
  ) {
    throw new RoutingError(
      "INVALID_REQUEST",
      "A delivery stop has invalid data.",
    );
  }

  if (new Set(stops.map((stop) => stop.orderId)).size !== stops.length) {
    throw new RoutingError(
      "INVALID_REQUEST",
      "Duplicate order IDs are not allowed.",
    );
  }

  if (!Number.isFinite(departureTime.getTime())) {
    throw new RoutingError(
      "INVALID_REQUEST",
      "Invalid departure time.",
    );
  }

  const ordered = orderStops(stops, origin);

  // Include the return to the store when requesting the route.
  const route = await routeProvider({
    origin,
    stops: ordered.map((stop) => stop.location),
    returnToOrigin: true,
    departureTime,
  });

  // Make sure the provider returned valid travel times for every route leg.
  if (
    !route ||
    !Array.isArray(route.legs) ||
    route.legs.length !== ordered.length + 1 ||
    route.legs.some(
      (leg) =>
        !Number.isFinite(leg.durationSeconds) ||
        leg.durationSeconds < 0,
    )
  ) {
    throw new RoutingError(
      "PROVIDER_ERROR",
      "Routing provider returned invalid route legs.",
    );
  }

  const coordinates = route.geometry?.coordinates;

  if (
    route.geometry?.type !== "LineString" ||
    !Array.isArray(coordinates) ||
    coordinates.length < 2 ||
    !coordinates.every(
      (point) =>
        Array.isArray(point) &&
        point.length === 2 &&
        Number.isFinite(point[0]) &&
        Number.isFinite(point[1]) &&
        Math.abs(point[0]) <= 180 &&
        Math.abs(point[1]) <= 90,
    ) ||
    !Number.isFinite(route.distanceMeters) ||
    route.distanceMeters < 0 ||
    !Number.isFinite(route.durationSeconds) ||
    route.durationSeconds < 0 ||
    route.legs.some(
      (leg) =>
        !Number.isFinite(leg.distanceMeters) ||
        leg.distanceMeters < 0,
    )
  ) {
    throw new RoutingError(
      "PROVIDER_ERROR",
      "Routing provider returned invalid geometry or distance data.",
    );
  }

  // Add up travel times to estimate when each delivery will arrive.
  let elapsedSeconds = 0;

  const optimizedStops = ordered.map((stop, index) => {
    elapsedSeconds += route.legs[index].durationSeconds;

    const arrivalTime =
      departureTime.getTime() + elapsedSeconds * 1000;

    if (
      !Number.isFinite(arrivalTime) ||
      Math.abs(arrivalTime) > 8.64e15
    ) {
      throw new RoutingError(
        "PROVIDER_ERROR",
        "Routing provider returned an invalid ETA.",
      );
    }

    return {
      orderId: stop.orderId,
      stopSequence: index + 1,
      estimatedArrival: new Date(arrivalTime).toISOString(),
    };
  });

  return {
    geometry: route.geometry,
    distanceMeters: route.distanceMeters,
    durationSeconds: route.durationSeconds,
    stops: optimizedStops,
  };
}
