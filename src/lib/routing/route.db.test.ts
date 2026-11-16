import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { routeTripById } from "./service";
import { STORE_LOCATION } from "@/lib/delivery/store";

// Load local test settings when available. Missing settings will skip these tests.
try {
  process.loadEnvFile(".env.test.local");
} catch {
  // Environment variables can also be set outside this file.
}

const TEST_URL = process.env.SUPABASE_TEST_URL;
const TEST_KEY = process.env.SUPABASE_TEST_SECRET_KEY;

// Never allow these integration tests to run against a hosted database.
if (
  TEST_URL &&
  !/^http:\/\/(localhost|127\.0\.0\.1|host\.docker\.internal)(:\d+)?\/?$/.test(
    TEST_URL,
  )
) {
  throw new Error(
    `Refusing to run routing tests against non-local URL: ${TEST_URL}`,
  );
}

const run = randomUUID().slice(0, 8);

const GEOMETRY = {
  type: "LineString",
  coordinates: [
    [-121.8945, 37.3361],
    [-121.8811, 37.3352],
    [-121.8945, 37.3361],
  ],
};

describe.skipIf(!TEST_URL || !TEST_KEY)(
  "route persistence against local Postgres",
  () => {
    let db: SupabaseClient;
    let customerId: string;

    // Keep track of test records so cleanup can remove everything afterward.
    const created: { table: string; id: string }[] = [];
    const tripIds: string[] = [];

    async function insert(table: string, row: object): Promise<string> {
      const { data, error } = await db
        .from(table)
        .insert(row)
        .select("id")
        .single();

      if (error) {
        throw new Error(`${table} insert failed: ${error.message}`);
      }

      const id = (data as { id: string }).id;
      created.push({ table, id });

      if (table === "trips") {
        tripIds.push(id);
      }

      return id;
    }

    async function makeTrip(orderCount: number) {
      const tripId = await insert("trips", {
        status: "PLANNED",
        order_count: orderCount,
        total_weight: orderCount * 100,
      });

      const orderIds: string[] = [];

      for (let i = 0; i < orderCount; i++) {
        const orderId = await insert("orders", {
          customer_id: customerId,
          status: "BATCHED",
          paid_at: "2026-10-20T12:00:00.000Z",
          trip_id: tripId,
          total_weight: 100,
          delivery_address: {
            line_1: `${i + 1} Test Street`,
            city: "San Jose",
            state: "CA",
            postal_code: "95110",
          },
          location:
            i === 0
              ? "SRID=4326;POINT(-121.8945 37.3361)"
              : "SRID=4326;POINT(-121.8811 37.3352)",
        });

        orderIds.push(orderId);
      }

      return { tripId, orderIds };
    }

    // Failed routes should leave the trip and its delivery stops untouched.
    async function expectUnchanged(tripId: string) {
      const { data: trip, error: tripError } = await db
        .from("trips")
        .select("status, route_geometry")
        .eq("id", tripId)
        .single();

      expect(tripError).toBeNull();
      expect(trip?.status).toBe("PLANNED");
      expect(trip?.route_geometry).toBeNull();

      const { data: stops, error: stopsError } = await db
        .from("delivery_stops")
        .select("id")
        .eq("trip_id", tripId);

      expect(stopsError).toBeNull();
      expect(stops).toEqual([]);
    }

    beforeAll(async () => {
      db = createClient(TEST_URL!, TEST_KEY!, {
        auth: { persistSession: false },
      });

      customerId = await insert("users", {
        email: `routing-${run}@db.test`,
        password_hash: "x",
      });
    });

    // Remove generated stops first, then clean up the inserted records.
    afterAll(async () => {
      if (!db) return;

      for (const tripId of tripIds) {
        const { error } = await db
          .from("delivery_stops")
          .delete()
          .eq("trip_id", tripId);

        if (error) {
          throw new Error(`Stop cleanup failed: ${error.message}`);
        }
      }

      for (const { table, id } of [...created].reverse()) {
        const { error } = await db.from(table).delete().eq("id", id);

        if (error) {
          throw new Error(`${table} cleanup failed: ${error.message}`);
        }
      }
    });

    it("rejects a trip that is not PLANNED", async () => {
      const { tripId } = await makeTrip(1);

      const { error } = await db
        .from("trips")
        .update({ status: "ROUTED" })
        .eq("id", tripId);

      expect(error).toBeNull();

      const routeProvider = vi.fn();

      await expect(
        routeTripById(db, tripId, { routeProvider, origin: STORE_LOCATION }),
      ).rejects.toThrow("Only PLANNED trips can be routed.");

      expect(routeProvider).not.toHaveBeenCalled();

      const { data: stops, error: stopsError } = await db
        .from("delivery_stops")
        .select("id")
        .eq("trip_id", tripId);

      expect(stopsError).toBeNull();
      expect(stops).toEqual([]);
    });

    it("rejects a trip when its assigned order count is wrong", async () => {
      const { tripId } = await makeTrip(2);

      const { error } = await db
        .from("trips")
        .update({ order_count: 1 })
        .eq("id", tripId);

      expect(error).toBeNull();

      const routeProvider = vi.fn();

      await expect(
        routeTripById(db, tripId, { routeProvider, origin: STORE_LOCATION }),
      ).rejects.toThrow(
        "Assigned order count does not match the trip order count.",
      );

      expect(routeProvider).not.toHaveBeenCalled();

      await expectUnchanged(tripId);
    });

    it("returns assigned orders to the queue when Mapbox fails", async () => {
      const { tripId, orderIds } = await makeTrip(1);

      const routeProvider = vi.fn().mockRejectedValue(
        new Error("Mapbox unavailable"),
      );

      await expect(
        routeTripById(db, tripId, { routeProvider, origin: STORE_LOCATION }),
      ).rejects.toThrow("Mapbox unavailable");

      expect(routeProvider).toHaveBeenCalledTimes(1);

      const { data: trip, error: tripError } = await db
        .from("trips")
        .select("status, route_geometry")
        .eq("id", tripId)
        .single();

      expect(tripError).toBeNull();
      expect(trip?.status).toBe("ROUTE_FAILED");
      expect(trip?.route_geometry).toBeNull();

      const { data: orders, error: orderError } = await db
        .from("orders")
        .select("id, status, trip_id, paid_at")
        .eq("id", orderIds[0]);

      expect(orderError).toBeNull();
      expect(orders).toHaveLength(1);
      expect(orders?.[0]).toMatchObject({
        id: orderIds[0],
        status: "PAID",
        trip_id: null,
      });
      expect(new Date(orders![0].paid_at).toISOString()).toBe(
        "2026-10-20T12:00:00.000Z",
      );

      const { data: stops, error: stopError } = await db
        .from("delivery_stops")
        .select("id")
        .eq("trip_id", tripId);

      expect(stopError).toBeNull();
      expect(stops).toEqual([]);
    });

    it("routes a trip by ID and persists the complete plan", async () => {
      const { tripId, orderIds } = await makeTrip(2);

      const origin = { lat: 37.33, lng: -121.89 };

      const geometry = {
        type: "LineString" as const,
        coordinates: [
          [-121.89, 37.33],
          [-121.8945, 37.3361],
          [-121.8811, 37.3352],
          [-121.89, 37.33],
        ],
      };

      // Mock Mapbox while keeping the database operations real.
      const routeProvider = vi.fn().mockResolvedValue({
        geometry,
        distanceMeters: 4000,
        durationSeconds: 420,
        legs: [
          { distanceMeters: 1000, durationSeconds: 120 },
          { distanceMeters: 2000, durationSeconds: 180 },
          { distanceMeters: 1000, durationSeconds: 120 },
        ],
      });

      const plan = await routeTripById(db, tripId, {
        origin,
        departureTime: new Date("2026-10-21T12:00:00.000Z"),
        routeProvider,
      });

      expect(routeProvider).toHaveBeenCalledTimes(1);

      expect(routeProvider.mock.calls[0][0]).toMatchObject({
        origin,
        returnToOrigin: true,
      });

      expect(plan.stops.map((stop) => stop.orderId).sort()).toEqual(
        [...orderIds].sort(),
      );

      expect(plan.stops.map((stop) => stop.stopSequence)).toEqual([1, 2]);

      expect(plan.stops.map((stop) => stop.estimatedArrival)).toEqual([
        "2026-10-21T12:02:00.000Z",
        "2026-10-21T12:05:00.000Z",
      ]);

      // Confirm the route and ETAs were actually saved in PostgreSQL.
      const { data: trip, error: tripError } = await db
        .from("trips")
        .select("status, route_geometry")
        .eq("id", tripId)
        .single();

      expect(tripError).toBeNull();
      expect(trip?.status).toBe("ROUTED");
      expect(trip?.route_geometry).toEqual(geometry);

      const { data: savedStops, error: stopsError } = await db
        .from("delivery_stops")
        .select("order_id, stop_sequence, estimated_arrival")
        .eq("trip_id", tripId)
        .order("stop_sequence");

      expect(stopsError).toBeNull();
      expect(savedStops).toHaveLength(2);

      expect(
        savedStops?.map((stop) => ({
          orderId: stop.order_id,
          stopSequence: stop.stop_sequence,
          estimatedArrival: new Date(
            stop.estimated_arrival,
          ).toISOString(),
        })),
      ).toEqual(plan.stops);
    });

    it("loads the correct delivery coordinates for a trip", async () => {
      const { tripId, orderIds } = await makeTrip(2);

      // The other trip should never show up in these results.
      const otherTrip = await makeTrip(1);

      const { data, error } = await db.rpc("get_trip_order_locations", {
        p_trip_id: tripId,
      });

      expect(error).toBeNull();

      const locations = (data ?? []) as Array<{
        order_id: string;
        lat: number;
        lng: number;
      }>;

      expect(locations).toHaveLength(2);

      const first = locations.find(
        (location) => location.order_id === orderIds[0],
      );

      const second = locations.find(
        (location) => location.order_id === orderIds[1],
      );

      expect(first).toBeDefined();
      expect(second).toBeDefined();

      expect(first!.lat).toBeCloseTo(37.3361, 5);
      expect(first!.lng).toBeCloseTo(-121.8945, 5);

      expect(second!.lat).toBeCloseTo(37.3352, 5);
      expect(second!.lng).toBeCloseTo(-121.8811, 5);

      expect(
        locations.some(
          (location) =>
            location.order_id === otherTrip.orderIds[0],
        ),
      ).toBe(false);
    });

    it("saves geometry, stop sequence, ETAs and ROUTED status", async () => {
      const { tripId, orderIds } = await makeTrip(2);

      const eta1 = new Date(Date.now() + 15 * 60_000).toISOString();

      const eta2 = new Date(Date.now() + 30 * 60_000).toISOString();

      const { error } = await db.rpc("save_optimized_trip_route", {
        p_trip_id: tripId,
        p_geometry: GEOMETRY,
        p_stops: [
          {
            order_id: orderIds[0],
            stop_sequence: 1,
            estimated_arrival: eta1,
          },
          {
            order_id: orderIds[1],
            stop_sequence: 2,
            estimated_arrival: eta2,
          },
        ],
      });

      expect(error).toBeNull();

      const { data: trip, error: tripError } = await db
        .from("trips")
        .select("status, route_geometry")
        .eq("id", tripId)
        .single();

      expect(tripError).toBeNull();
      expect(trip?.status).toBe("ROUTED");
      expect(trip?.route_geometry).toEqual(GEOMETRY);

      const { data: stops, error: stopsError } = await db
        .from("delivery_stops")
        .select(
          "order_id, stop_sequence, estimated_arrival, location",
        )
        .eq("trip_id", tripId)
        .order("stop_sequence");

      expect(stopsError).toBeNull();
      expect(stops).toHaveLength(2);

      expect(stops?.map((stop) => stop.order_id)).toEqual(orderIds);

      expect(stops?.map((stop) => stop.stop_sequence)).toEqual([1, 2]);

      expect(new Date(stops![0].estimated_arrival).toISOString()).toBe(eta1);

      expect(new Date(stops![1].estimated_arrival).toISOString()).toBe(eta2);

      expect(stops?.[0]?.location).toBeTruthy();
      expect(stops?.[1]?.location).toBeTruthy();
    });

    it("rolls back all writes when one order is invalid", async () => {
      const { tripId, orderIds } = await makeTrip(2);

      const { error } = await db.rpc("save_optimized_trip_route", {
        p_trip_id: tripId,
        p_geometry: GEOMETRY,
        p_stops: [
          {
            order_id: orderIds[0],
            stop_sequence: 1,
            estimated_arrival: new Date().toISOString(),
          },
          {
            order_id: randomUUID(),
            stop_sequence: 2,
            estimated_arrival: new Date().toISOString(),
          },
        ],
      });

      expect(error?.message).toMatch(/Unable to save all delivery stops/);

      await expectUnchanged(tripId);
    });

    it("restores original paid times after route failure", async () => {
      const { tripId, orderIds } = await makeTrip(2);
      const paidTimes = [
        "2026-10-20T08:00:00.000Z",
        "2026-10-20T07:00:00.000Z",
      ];

      for (const [index, orderId] of orderIds.entries()) {
        const { error } = await db
          .from("orders")
          .update({ paid_at: paidTimes[index] })
          .eq("id", orderId);

        expect(error).toBeNull();
      }

      const { error } = await db.rpc("fail_trip_route", {
        p_trip_id: tripId,
        p_failure_code: "PROVIDER_ERROR",
      });

      expect(error).toBeNull();

      const { data: trip } = await db
        .from("trips")
        .select("status, route_geometry")
        .eq("id", tripId)
        .single();

      expect(trip?.status).toBe("ROUTE_FAILED");
      expect(trip?.route_geometry).toBeNull();

      const { data: orders } = await db
        .from("orders")
        .select("id, status, trip_id, paid_at")
        .in("id", orderIds)
        .order("paid_at")
        .order("id");

      expect(orders?.map((order) => order.id)).toEqual([
        orderIds[1],
        orderIds[0],
      ]);

      expect(orders?.map((order) => ({
        status: order.status,
        tripId: order.trip_id,
        paidAt: new Date(order.paid_at).toISOString(),
      }))).toEqual([
        { status: "PAID", tripId: null, paidAt: paidTimes[1] },
        { status: "PAID", tripId: null, paidAt: paidTimes[0] },
      ]);

      const { data: history } = await db
        .from("order_status_history")
        .select("order_id, status, notes")
        .in("order_id", orderIds);

      expect(history).toHaveLength(2);
      expect(history?.every((entry) =>
        entry.status === "PAID" &&
        entry.notes?.toLowerCase().includes("route")
      )).toBe(true);
    });

    it("is safe to repeat failure recovery", async () => {
      const { tripId, orderIds } = await makeTrip(1);

      for (let attempt = 0; attempt < 2; attempt++) {
        const { error } = await db.rpc("fail_trip_route", {
          p_trip_id: tripId,
          p_failure_code: "PROVIDER_ERROR",
        });
        expect(error).toBeNull();
      }

      const { data: history, error: historyError } = await db
        .from("order_status_history")
        .select("id, status")
        .eq("order_id", orderIds[0]);

      expect(historyError).toBeNull();
      expect(history).toHaveLength(1);
      expect(history?.[0].status).toBe("PAID");
    });

    it("does not affect orders assigned to another trip", async () => {
      const failingTrip = await makeTrip(2);
      const otherTrip = await makeTrip(1);

      const { error } = await db.rpc("fail_trip_route", {
        p_trip_id: failingTrip.tripId,
        p_failure_code: "PROVIDER_ERROR",
      });

      expect(error).toBeNull();

      const { data: order, error: orderError } = await db
        .from("orders")
        .select("status, trip_id")
        .eq("id", otherTrip.orderIds[0])
        .single();

      expect(orderError).toBeNull();
      expect(order).toMatchObject({
        status: "BATCHED",
        trip_id: otherTrip.tripId,
      });

      const { data: trip, error: tripError } = await db
        .from("trips")
        .select("status")
        .eq("id", otherTrip.tripId)
        .single();

      expect(tripError).toBeNull();
      expect(trip?.status).toBe("PLANNED");
    });

    it("rejects invalid assigned orders without partial recovery", async () => {
      const { tripId, orderIds } = await makeTrip(2);

      const { error: updateError } = await db
        .from("orders")
        .update({ status: "DELIVERED" })
        .eq("id", orderIds[1]);

      expect(updateError).toBeNull();

      const { error } = await db.rpc("fail_trip_route", {
        p_trip_id: tripId,
        p_failure_code: "PROVIDER_ERROR",
      });

      expect(error?.message).toMatch(/cannot return to the queue/);

      const { data: trip } = await db
        .from("trips")
        .select("status")
        .eq("id", tripId)
        .single();

      expect(trip?.status).toBe("PLANNED");

      const { data: orders } = await db
        .from("orders")
        .select("status, trip_id")
        .in("id", orderIds);

      expect(orders?.map((order) => order.status).sort()).toEqual([
        "BATCHED",
        "DELIVERED",
      ]);

      expect(orders?.every((order) => order.trip_id === tripId)).toBe(true);
    });

    it("rejects duplicate delivery stops", async () => {
      const { tripId, orderIds } = await makeTrip(2);

      const { error } = await db.rpc("save_optimized_trip_route", {
        p_trip_id: tripId,
        p_geometry: GEOMETRY,
        p_stops: [
          {
            order_id: orderIds[0],
            stop_sequence: 1,
            estimated_arrival: new Date().toISOString(),
          },
          {
            order_id: orderIds[0],
            stop_sequence: 2,
            estimated_arrival: new Date().toISOString(),
          },
        ],
      });

      expect(error?.message).toMatch(/Invalid or duplicate delivery stops/);

      await expectUnchanged(tripId);
    });
  },
);
