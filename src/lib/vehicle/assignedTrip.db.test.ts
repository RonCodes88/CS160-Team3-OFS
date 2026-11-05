import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getAssignedTripForVehicle } from "./assignedTrip";

try {
  process.loadEnvFile(".env.test.local");
} catch {
  // Local settings can also come from the environment.
}

const TEST_URL = process.env.SUPABASE_TEST_URL;
const TEST_KEY = process.env.SUPABASE_TEST_SECRET_KEY;

if (
  TEST_URL &&
  !/^http:\/\/(localhost|127\.0\.0\.1|host\.docker\.internal)(:\d+)?\/?$/.test(TEST_URL)
) {
  throw new Error("Refusing to run vehicle tests against a hosted database.");
}

const run = randomUUID().slice(0, 8);
const geometry = {
  type: "LineString",
  coordinates: [[-121.89, 37.33], [-121.88, 37.34]],
};

describe.skipIf(!TEST_URL || !TEST_KEY)(
  "assigned vehicle trips against local Postgres",
  () => {
    let db: SupabaseClient;
    let vehicleA: string;
    let vehicleB: string;
    let idleVehicle: string;
    let tripA: string;
    let tripB: string;
    let firstOrder: string;
    let secondOrder: string;

    const created: Array<{ table: string; id: string }> = [];

    async function insert(table: string, row: object): Promise<string> {
      const { data, error } = await db
        .from(table)
        .insert(row)
        .select("id")
        .single();

      if (error) throw new Error(`${table} insert failed: ${error.message}`);

      const id = (data as { id: string }).id;
      created.push({ table, id });
      return id;
    }

    async function makeUser(name: string, role: string) {
      return insert("users", {
        email: `vehicle28-${name}-${run}@test.local`,
        password_hash: "test-only",
        role,
      });
    }

    async function makeOrder(
      customerId: string,
      assignedTripId: string,
      lng: number,
      lat: number,
    ) {
      return insert("orders", {
        customer_id: customerId,
        status: "BATCHED",
        trip_id: assignedTripId,
        total_weight: 100,
        paid_at: "2026-11-04T12:00:00.000Z",
        delivery_address: {
          line_1: "1 Test Street",
          city: "San Jose",
          state: "CA",
          postal_code: "95110",
        },
        location: `SRID=4326;POINT(${lng} ${lat})`,
      });
    }

    beforeAll(async () => {
      db = createClient(TEST_URL!, TEST_KEY!, {
        auth: { persistSession: false },
      });

      vehicleA = await makeUser("a", "VEHICLE");
      vehicleB = await makeUser("b", "VEHICLE");
      idleVehicle = await makeUser("idle", "VEHICLE");
      const customerId = await makeUser("customer", "CUSTOMER");

      tripA = await insert("trips", {
        status: "ROUTED",
        order_count: 2,
        total_weight: 200,
        route_geometry: geometry,
      });

      tripB = await insert("trips", {
        status: "ROUTED",
        order_count: 1,
        total_weight: 100,
        route_geometry: geometry,
      });

      firstOrder = await makeOrder(customerId, tripA, -121.89, 37.33);
      secondOrder = await makeOrder(customerId, tripA, -121.88, 37.34);
      const otherOrder = await makeOrder(customerId, tripB, -121.87, 37.35);

      // Insert out of order to check the returned stop sequence.
      await insert("delivery_stops", {
        trip_id: tripA,
        order_id: secondOrder,
        stop_sequence: 2,
        status: "PENDING",
        location: "SRID=4326;POINT(-121.88 37.34)",
        estimated_arrival: "2026-11-04T12:15:00.000Z",
      });

      await insert("delivery_stops", {
        trip_id: tripA,
        order_id: firstOrder,
        stop_sequence: 1,
        status: "PENDING",
        location: "SRID=4326;POINT(-121.89 37.33)",
        estimated_arrival: "2026-11-04T12:00:00.000Z",
      });

      await insert("delivery_stops", {
        trip_id: tripB,
        order_id: otherOrder,
        stop_sequence: 1,
        status: "PENDING",
        location: "SRID=4326;POINT(-121.87 37.35)",
      });

      await insert("vehicles", {
        user_id: vehicleA,
        status: "DELIVERING",
        current_trip_id: tripA,
      });

      await insert("vehicles", {
        user_id: vehicleB,
        status: "DELIVERING",
        current_trip_id: tripB,
      });

      await insert("vehicles", {
        user_id: idleVehicle,
        status: "AVAILABLE",
      });
    });

    afterAll(async () => {
      if (!db) return;

      for (const { table, id } of [...created].reverse()) {
        const { error } = await db.from(table).delete().eq("id", id);

        if (error) {
          throw new Error(`${table} cleanup failed: ${error.message}`);
        }
      }
    });

    it("returns the assigned route with stops in order", async () => {
      const trip = await getAssignedTripForVehicle(db, vehicleA);

      expect(trip?.id).toBe(tripA);
      expect(trip?.status).toBe("ROUTED");
      expect(trip?.routeGeometry).toEqual(geometry);
      expect(trip?.stops.map((stop) => stop.orderId)).toEqual([
        firstOrder,
        secondOrder,
      ]);
      expect(trip?.stops.map((stop) => stop.stopSequence)).toEqual([1, 2]);
      expect(trip?.stops[0].location).toEqual({
        lat: 37.33,
        lng: -121.89,
      });
    });

    it("does not return another vehicle's assigned trip", async () => {
      const trip = await getAssignedTripForVehicle(db, vehicleB);

      expect(trip?.id).toBe(tripB);
      expect(trip?.id).not.toBe(tripA);
      expect(trip?.stops).toHaveLength(1);
      expect(trip?.stops.some((stop) =>
        [firstOrder, secondOrder].includes(stop.orderId)
      )).toBe(false);
    });

    it("returns null when the vehicle has no assigned trip", async () => {
      expect(await getAssignedTripForVehicle(db, idleVehicle)).toBeNull();
    });
  },
);
