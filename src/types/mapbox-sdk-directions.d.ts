// Minimal types for the part of @mapbox/mapbox-sdk that OFS uses. The SDK
// ships no TypeScript types; extend this if more of it is needed.
declare module "@mapbox/mapbox-sdk/services/directions" {
  type Profile = "driving-traffic" | "driving" | "walking" | "cycling";

  export type DirectionsRequest = {
    profile?: Profile;
    waypoints: { coordinates: [number, number] }[];
    geometries?: "geojson" | "polyline" | "polyline6";
    overview?: "simplified" | "full" | "false";
    steps?: boolean;
  };

  export type MapiRequest<T> = {
    send(): Promise<{ statusCode: number; body: T }>;
    abort(): void;
  };

  export type DirectionsService = {
    getDirections(request: DirectionsRequest): MapiRequest<unknown>;
  };

  export default function createDirectionsService(config: { accessToken: string }): DirectionsService;
}
