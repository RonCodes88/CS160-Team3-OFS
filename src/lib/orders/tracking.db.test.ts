import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getCustomerTracking } from "./tracking";

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
  throw new Error("Refusing to run tracking tests against a hosted database.");
}

const run = randomUUID().slice(0, 8);

const route = {
  type: "LineString",
  coordinates: [[-121.89, 37.33], [-121.88, 37.34]],
};

const etaA = "2026-11-11T03:00:00.000Z";
const etaB = "2026-11-11T03:15:00.000Z";
const locationUpdatedAt = "2026-11-11T02:50:00.000Z";

describe.skipIf(!TEST_URL || !TEST_KEY)(
  "customer tracking against local Postgres",
  () => {
    let db: SupabaseClient;
    let customerA: string;
    let customerB: string;
    let tripA: string;
    let tripB: string;
    let orderA: string;
    let orderB: string;
    let waitingOrder: string;
    let routedOrder: string;

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
        email: `tracking31-${name}-${run}@test.local`,
        password_hash: "test-only",
        role,
      });
    }

    async function makeOrder(
      customerId: string,
      tripId: string | null,
      status: string,
      longitude: number,
      latitude: number,
    ) {
      return insert("orders", {
        customer_id: customerId,
        trip_id: tripId,
        status,
        total_weight: 100,
        paid_at: "2026-11-10T22:00:00.000Z",
        delivery_address: {
          line_1: "1 Test Street",
          city: "San Jose",
          state: "CA",
          postal_code: "95110",
        },
        location: `SRID=4326;POINT(${longitude} ${latitude})`,
      });
    }

    beforeAll(async () => {
      db = createClient(TEST_URL!, TEST_KEY!, {
        auth: { persistSession: false },
      });

      customerA = await makeUser("customer-a", "CUSTOMER");
      customerB = await makeUser("customer-b", "CUSTOMER");
      const vehicleUser = await makeUser("vehicle", "VEHICLE");

      tripA = await insert("trips", {
        status: "OUT_FOR_DELIVERY",
        order_count: 2,
        total_weight: 200,
        route_geometry: route,
      });

      tripB = await insert("trips", {
        status: "ROUTED",
        order_count: 1,
        total_weight: 100,
        route_geometry: route,
      });

      orderA = await makeOrder(
        customerA, tripA, "OUT_FOR_DELIVERY", -121.89, 37.33,
      );

      orderB = await makeOrder(
        customerB, tripA, "OUT_FOR_DELIVERY", -121.88, 37.34,
      );

      waitingOrder = await makeOrder(
        customerA, null, "PAID", -121.87, 37.35,
      );

      routedOrder = await makeOrder(
        customerA, tripB, "BATCHED", -121.86, 37.36,
      );

      await insert("delivery_stops", {
        trip_id: tripA,
        order_id: orderA,
        stop_sequence: 1,
        status: "EN_ROUTE",
        estimated_arrival: etaA,
        location: "SRID=4326;POINT(-121.89 37.33)",
      });

      await insert("delivery_stops", {
        trip_id: tripA,
        order_id: orderB,
        stop_sequence: 2,
        status: "ARRIVED",
        estimated_arrival: etaB,
        location: "SRID=4326;POINT(-121.88 37.34)",
      });

      await insert("vehicles", {
        user_id: vehicleUser,
        status: "DELIVERING",
        current_trip_id: tripA,
        battery_percent: 80,
        last_location: "SRID=4326;POINT(-121.891 37.331)",
        last_update_at: locationUpdatedAt,
      });
    });

    afterAll(async () => {
      if (!db) return;

      for (const entry of [...created].reverse()) {
        const { error } = await db
          .from(entry.table)
          .delete()
          .eq("id", entry.id);

        if (error) {
          throw new Error(`${entry.table} cleanup failed: ${error.message}`);
        }
      }
    });

    it("returns the customer's order, ETA, route and robot GPS", async () => {
      const result = await getCustomerTracking(db, customerA, orderA);

      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error("Expected tracking information.");

      expect(result.tracking).toMatchObject({
        orderId: orderA,
        status: "OUT_FOR_DELIVERY",
        tripStatus: "OUT_FOR_DELIVERY",
        stopStatus: "EN_ROUTE",
        route,
      });

      expect(Date.parse(result.tracking.estimatedArrival!)).toBe(
        Date.parse(etaA),
      );

      expect(result.tracking.robotLocation?.latitude).toBeCloseTo(37.331, 6);
      expect(result.tracking.robotLocation?.longitude).toBeCloseTo(-121.891, 6);
      expect(Date.parse(result.tracking.robotLocation!.updatedAt)).toBe(
        Date.parse(locationUpdatedAt),
      );
    });

    it("returns the correct stop for another customer on the same trip", async () => {
      const result = await getCustomerTracking(db, customerB, orderB);

      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error("Expected tracking information.");

      expect(result.tracking.orderId).toBe(orderB);
      expect(result.tracking.stopStatus).toBe("ARRIVED");
      expect(Date.parse(result.tracking.estimatedArrival!)).toBe(
        Date.parse(etaB),
      );
    });

    it("forbids access to another customer's order", async () => {
      expect(await getCustomerTracking(db, customerB, orderA)).toEqual({
        ok: false,
        reason: "FORBIDDEN",
      });

      expect(await getCustomerTracking(db, customerA, orderB)).toEqual({
        ok: false,
        reason: "FORBIDDEN",
      });
    });

    it("returns NOT_FOUND for a nonexistent order", async () => {
      expect(await getCustomerTracking(db, customerA, randomUUID())).toEqual({
        ok: false,
        reason: "NOT_FOUND",
      });
    });

    it("handles an order without an assigned trip", async () => {
      const result = await getCustomerTracking(db, customerA, waitingOrder);

      expect(result).toEqual({
        ok: true,
        tracking: {
          orderId: waitingOrder,
          status: "PAID",
          tripStatus: null,
          stopStatus: null,
          estimatedArrival: null,
          route: null,
          robotLocation: null,
        },
      });
    });

    it("returns a routed trip without inventing an ETA or robot location", async () => {
      const result = await getCustomerTracking(db, customerA, routedOrder);

      expect(result).toEqual({
        ok: true,
        tracking: {
          orderId: routedOrder,
          status: "BATCHED",
          tripStatus: "ROUTED",
          stopStatus: null,
          estimatedArrival: null,
          route,
          robotLocation: null,
        },
      });
    });
  },
);
