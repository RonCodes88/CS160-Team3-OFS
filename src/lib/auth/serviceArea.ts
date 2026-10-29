import { distanceMeters, type LatLng } from "@/lib/delivery/batching";

/** Store coordinates in decimal degrees and the maximum delivery distance in meters. */
export type ServiceArea = { origin: LatLng; radiusMeters: number };

/** Configuration failure (HTTP 503), distinct from an address outside the area (422). */
export class ServiceAreaUnavailable extends Error {
  constructor() { super("Delivery service area is not configured."); }
}

function validPoint(point: LatLng): boolean {
  return Number.isFinite(point.lat) && Math.abs(point.lat) <= 90
    && Number.isFinite(point.lng) && Math.abs(point.lng) <= 180;
}

/**
 * Read the team's approved delivery area from server-only configuration.
 * No fallback to provisional routing coordinates or a guessed radius: missing
 * settings must never accidentally approve a delivery. Tests can supply an env
 * object without changing the machine's actual configuration.
 */
export function readServiceArea(env: Record<string, string | undefined> = process.env): ServiceArea {
  const raw = [env.OFS_STORE_LATITUDE, env.OFS_STORE_LONGITUDE, env.OFS_DELIVERY_RADIUS_METERS];
  // Check blanks before conversion: Number("") and Number(" ") both produce 0,
  // which would otherwise look like valid latitude/longitude coordinates.
  if (raw.some((value) => !value?.trim())) throw new ServiceAreaUnavailable();
  const [lat, lng, radiusMeters] = raw.map(Number);
  if (!validPoint({ lat, lng }) || !Number.isFinite(radiusMeters) || radiusMeters <= 0) {
    throw new ServiceAreaUnavailable();
  }
  return { origin: { lat, lng }, radiusMeters };
}

/**
 * Check a previously geocoded address using straight-line spherical distance,
 * not driving distance or a Mapbox route. The boundary is inclusive.
 * Floating-point coordinates are appropriate here; money/weight remain integers.
 */
export function isWithinServiceArea(point: LatLng | null, area: ServiceArea): boolean {
  if (!validPoint(area.origin) || !Number.isFinite(area.radiusMeters) || area.radiusMeters <= 0) {
    throw new ServiceAreaUnavailable();
  }
  // Bad address coordinates mean ineligible; bad store configuration throws above.
  return point !== null && validPoint(point) && distanceMeters(area.origin, point) <= area.radiusMeters;
}
