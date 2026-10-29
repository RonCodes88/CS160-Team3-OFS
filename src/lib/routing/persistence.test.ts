import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { OptimizedTripRoute } from "./optimization";
import { persistOptimizedTrip } from "./persistence";

const tripId = "11111111-1111-4111-8111-111111111111";
const orderId = "22222222-2222-4222-8222-222222222222";

// Sample route used to test both successful and failed database writes.
const plan: OptimizedTripRoute = {
  geometry: {
    type: "LineString",
    coordinates: [
      [-121.89, 37.33],
      [-121.88, 37.34],
    ],
  },
  distanceMeters: 2000,
  durationSeconds: 300,
  stops: [
    {
      orderId,
      stopSequence: 1,
      estimatedArrival: "2026-10-20T12:02:00.000Z",
    },
  ],
};

describe("persistOptimizedTrip", () => {
  it("sends the complete route through one database RPC", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: null,
      error: null,
    });

    // Mock the database call so the test doesn't need a real connection.
    const db = { rpc } as unknown as SupabaseClient;

    await persistOptimizedTrip(db, tripId, plan);

    expect(rpc).toHaveBeenCalledTimes(1);

    expect(rpc).toHaveBeenCalledWith(
      "save_optimized_trip_route",
      {
        p_trip_id: tripId,
        p_geometry: plan.geometry,
        p_stops: [
          {
            order_id: orderId,
            stop_sequence: 1,
            estimated_arrival: "2026-10-20T12:02:00.000Z",
          },
        ],
      },
    );
  });

  it("reports a database error instead of claiming success", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: null,
      error: { message: "Database write failed" },
    });

    const db = { rpc } as unknown as SupabaseClient;

    await expect(
      persistOptimizedTrip(db, tripId, plan),
    ).rejects.toThrow("Database write failed");

    expect(rpc).toHaveBeenCalledTimes(1);
  });
});
