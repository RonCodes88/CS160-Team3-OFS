import type { LatLng } from "@/lib/delivery/batching";
import { STORE_LOCATION } from "@/lib/delivery/store";

// Forward geocoding with the Mapbox Geocoding API (v6) for saved delivery
// addresses. Only the coordinates are kept; the customer's typed address is
// what gets stored and shown.

const ENDPOINT = "https://api.mapbox.com/search/geocode/v6/forward";
const DEFAULT_TIMEOUT_MS = 10_000;

export type GeocodeErrorCode = "NOT_CONFIGURED" | "UNAUTHORIZED" | "RATE_LIMITED" | "TIMEOUT" | "PROVIDER_ERROR";

/** Mapbox could not answer. A missing match is not an error: geocodeAddress returns null. */
export class GeocodeError extends Error {
  constructor(
    readonly code: GeocodeErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "GeocodeError";
  }
}

export type GeocodeOptions = {
  /** Defaults to MAPBOX_ACCESS_TOKEN. */
  accessToken?: string;
  timeoutMs?: number;
  /** For tests: a stand-in for fetch. */
  fetch?: typeof fetch;
};

type Feature = {
  geometry?: { type?: string; coordinates?: [number, number] };
  properties?: { feature_type?: string; match_code?: { confidence?: string } };
};

/**
 * Returns the coordinates of a US street address, or null when Mapbox finds no
 * confident street-address match. Results are biased toward the store.
 */
export async function geocodeAddress(query: string, options: GeocodeOptions = {}): Promise<LatLng | null> {
  const accessToken = options.accessToken ?? process.env.MAPBOX_ACCESS_TOKEN;
  if (!accessToken) throw new GeocodeError("NOT_CONFIGURED", "MAPBOX_ACCESS_TOKEN is not set.");

  const url = new URL(ENDPOINT);
  url.searchParams.set("q", query);
  url.searchParams.set("country", "us");
  url.searchParams.set("types", "address");
  url.searchParams.set("limit", "1");
  url.searchParams.set("proximity", `${STORE_LOCATION.lng},${STORE_LOCATION.lat}`);
  url.searchParams.set("access_token", accessToken);

  let response: Response;
  try {
    response = await (options.fetch ?? fetch)(url, {
      signal: AbortSignal.timeout(options.timeoutMs ?? DEFAULT_TIMEOUT_MS),
    });
  } catch (err) {
    // Messages never include the request URL, which carries the access token.
    if ((err as Error)?.name === "TimeoutError") throw new GeocodeError("TIMEOUT", "Mapbox did not respond in time.");
    throw new GeocodeError("PROVIDER_ERROR", "Could not reach Mapbox.");
  }
  if (response.status === 401 || response.status === 403) {
    throw new GeocodeError("UNAUTHORIZED", "Mapbox rejected the access token.");
  }
  if (response.status === 429) throw new GeocodeError("RATE_LIMITED", "Mapbox rate limit reached.");
  if (!response.ok) throw new GeocodeError("PROVIDER_ERROR", `Mapbox returned HTTP ${response.status}.`);

  let body: { features?: Feature[] };
  try {
    body = (await response.json()) as { features?: Feature[] };
  } catch {
    throw new GeocodeError("PROVIDER_ERROR", "Mapbox returned an unreadable response.");
  }
  const feature = body.features?.[0];
  const coordinates = feature?.geometry?.coordinates;
  // A "low" confidence match may be a different street; ask the customer to fix it.
  if (
    !feature ||
    feature.properties?.feature_type !== "address" ||
    feature.properties.match_code?.confidence === "low" ||
    !Array.isArray(coordinates)
  ) {
    return null;
  }
  const [lng, lat] = coordinates;
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  return { lat, lng };
}
