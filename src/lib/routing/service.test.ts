import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Route } from "./mapbox";
import { routeTrip } from "./service";

const tripId = "11111111-1111-4111-8111-111111111111";

const origin = { lat: 37.33, lng: -121.89 };
const destination = { lat: 37.34, lng: -121.88 };

const departureTime = new Date("2026-10-20T12:00:00Z");

const stops = [
  {
    orderId: "22222222-2222-4222-8222-222222222222",
    location: destination,
  },
];

// Sample round-trip route with separate travel times for each leg.
const validRoute: Route = {
  geometry: {
    type: "LineString",
    coordinates: [
      [-121.89, 37.33],
      [-121.88, 37.34],
      [-121.89, 37.33],
    ],
  },
  distanceMeters: 2000,
  durationSeconds: 300,
  legs: [
    { distanceMeters: 1000, durationSeconds: 120 },
    { distanceMeters: 1000, durationSeconds: 180 },
  ],
};

describe("routeTrip", () => {
  it("optimizes and persists a successful route", async () => {
    const routeProvider = vi.fn().mockResolvedValue(validRoute);
    const rpc = vi.fn().mockResolvedValue({
      data: null,
      error: null,
    });

    const db = { rpc } as unknown as SupabaseClient;

    const result = await routeTrip(db, tripId, stops, {
      origin,
      departureTime,
      routeProvider,
    });

    expect(routeProvider).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledTimes(1);

    expect(result.stops).toEqual([
      {
        orderId: stops[0].orderId,
        stopSequence: 1,
        estimatedArrival: "2026-10-20T12:02:00.000Z",
      },
    ]);

    // Check that the saved route includes the calculated stop sequence and ETA.
    expect(rpc).toHaveBeenCalledWith(
      "save_optimized_trip_route",
      {
        p_trip_id: tripId,
        p_geometry: validRoute.geometry,
        p_stops: [
          {
            order_id: stops[0].orderId,
            stop_sequence: 1,
            estimated_arrival: "2026-10-20T12:02:00.000Z",
          },
        ],
      },
    );
  });

  it("does not save anything when routing fails", async () => {
    const routeProvider = vi.fn().mockRejectedValue(
      new Error("Mapbox unavailable"),
    );

    const rpc = vi.fn();
    const db = { rpc } as unknown as SupabaseClient;

    await expect(
      routeTrip(db, tripId, stops, {
        origin,
        departureTime,
        routeProvider,
      }),
    ).rejects.toThrow("Mapbox unavailable");

    // A routing failure should stop the process before any database write.
    expect(rpc).not.toHaveBeenCalled();
  });

  it("reports persistence failure", async () => {
    const routeProvider = vi.fn().mockResolvedValue(validRoute);

    const rpc = vi.fn().mockResolvedValue({
      data: null,
      error: { message: "Database write failed" },
    });

    const db = { rpc } as unknown as SupabaseClient;

    await expect(
      routeTrip(db, tripId, stops, {
        origin,
        departureTime,
        routeProvider,
      }),
    ).rejects.toThrow("Database write failed");

    expect(rpc).toHaveBeenCalledTimes(1);
  });
});
