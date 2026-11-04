import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { RoutingError, type Route } from "./mapbox";
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

  it("recovers orders when routing fails", async () => {
    const routeProvider = vi.fn().mockRejectedValue(
      new Error("Mapbox unavailable"),
    );

    const rpc = vi.fn().mockResolvedValue({ data: null, error: null });
    const db = { rpc } as unknown as SupabaseClient;

    await expect(
      routeTrip(db, tripId, stops, {
        origin,
        departureTime,
        routeProvider,
      }),
    ).rejects.toThrow("Mapbox unavailable");

        expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith(
      "fail_trip_route",
      expect.objectContaining({ p_trip_id: tripId }),
    );
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

describe("route failure recovery (Issue #27)", () => {
  it("does not recover invalid route inputs", async () => {
    const rpc = vi.fn();
    const routeProvider = vi.fn();
    const db = { rpc } as unknown as SupabaseClient;

    await expect(
      routeTrip(db, tripId, [], { origin, departureTime, routeProvider }),
    ).rejects.toThrow("between 1 and");

    expect(routeProvider).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
  });

  it("requests atomic recovery when route generation fails", async () => {
    const routeProvider = vi.fn().mockRejectedValue(
      new Error("Mapbox unavailable"),
    );
    const rpc = vi.fn().mockResolvedValue({
      data: null,
      error: null,
    });
    const db = { rpc } as unknown as SupabaseClient;

    await expect(
      routeTrip(db, tripId, stops, {
        origin,
        departureTime,
        routeProvider,
      }),
    ).rejects.toThrow("Mapbox unavailable");

    expect(rpc).toHaveBeenCalledWith(
      "fail_trip_route",
      expect.objectContaining({ p_trip_id: tripId }),
    );
  });
});

describe("Mapbox rejection recovery (Issue #27)", () => {
  it("recovers after Mapbox HTTP 422", async () => {
    const routeProvider = vi.fn().mockRejectedValue(
      new RoutingError(
        "INVALID_REQUEST",
        "Mapbox rejected the route request.",
        422,
      ),
    );

    const rpc = vi.fn().mockResolvedValue({
      data: null,
      error: null,
    });

    const db = { rpc } as unknown as SupabaseClient;

    await expect(
      routeTrip(db, tripId, stops, {
        origin,
        departureTime,
        routeProvider,
      }),
    ).rejects.toMatchObject({
      code: "INVALID_REQUEST",
      status: 422,
    });

    expect(routeProvider).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith("fail_trip_route", {
      p_trip_id: tripId,
      p_failure_code: "INVALID_REQUEST",
    });
  });
});
