import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { updateDeliveryStopStatus } from "./stopStatusService";

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

describe.skipIf(!TEST_URL || !TEST_KEY)(
  "vehicle delivery stop updates against local Postgres",
  () => {
    let db: SupabaseClient;
    let vehicleA: string;
    let vehicleB: string;
    let tripA: string;
    let tripB: string;
    let order1: string;
    let order2: string;
    let orderB: string;
    let stop1: string;
    let stop2: string;
    let stopB: string;

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

    async function getRow(table: string, id: string, columns: string) {
      const { data, error } = await db
        .from(table)
        .select(columns)
        .eq("id", id)
        .single();

      if (error) throw new Error(`${table} read failed: ${error.message}`);
      return data as unknown as Record<string, unknown>;
    }

    async function makeUser(name: string, role: string) {
      return insert("users", {
        email: `vehicle30-${name}-${run}@test.local`,
        password_hash: "test-only",
        role,
      });
    }

    async function makeOrder(
      customerId: string,
      tripId: string,
      lng: number,
      lat: number,
      status: string,
    ) {
      return insert("orders", {
        customer_id: customerId,
        trip_id: tripId,
        status,
        total_weight: 100,
        paid_at: "2026-11-10T12:00:00.000Z",
        delivery_address: {
          line_1: "1 Test Street",
          city: "San Jose",
          state: "CA",
          postal_code: "95110",
        },
        location: `SRID=4326;POINT(${lng} ${lat})`,
      });
    }

    async function makeStop(
      tripId: string,
      orderId: string,
      sequence: number,
      status: string,
      lng: number,
      lat: number,
    ) {
      return insert("delivery_stops", {
        trip_id: tripId,
        order_id: orderId,
        stop_sequence: sequence,
        status,
        location: `SRID=4326;POINT(${lng} ${lat})`,
      });
    }

    beforeAll(async () => {
      db = createClient(TEST_URL!, TEST_KEY!, {
        auth: { persistSession: false },
      });

      vehicleA = await makeUser("a", "VEHICLE");
      vehicleB = await makeUser("b", "VEHICLE");
      const customerId = await makeUser("customer", "CUSTOMER");

      tripA = await insert("trips", {
        status: "OUT_FOR_DELIVERY",
        order_count: 2,
        total_weight: 200,
      });

      tripB = await insert("trips", {
        status: "OUT_FOR_DELIVERY",
        order_count: 1,
        total_weight: 100,
      });

      order1 = await makeOrder(customerId, tripA, -121.89, 37.33, "OUT_FOR_DELIVERY");
      order2 = await makeOrder(customerId, tripA, -121.88, 37.34, "OUT_FOR_DELIVERY");

      // This order intentionally has an invalid delivery state to test rollback.
      orderB = await makeOrder(customerId, tripB, -121.87, 37.35, "BATCHED");

      stop1 = await makeStop(tripA, order1, 1, "PENDING", -121.89, 37.33);
      stop2 = await makeStop(tripA, order2, 2, "PENDING", -121.88, 37.34);
      stopB = await makeStop(tripB, orderB, 1, "DELAYED", -121.87, 37.35);

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
    });

    afterAll(async () => {
      if (!db) return;

      for (const entry of created.reverse()) {
        const { error } = await db
          .from(entry.table)
          .delete()
          .eq("id", entry.id);

        if (error) {
          throw new Error(`${entry.table} cleanup failed: ${error.message}`);
        }
      }
    });

    it("rejects updates to another vehicle's stop", async () => {
      const result = await updateDeliveryStopStatus(db, vehicleB, stop1, "ARRIVED");

      expect(result).toEqual({ ok: false, reason: "NOT_FOUND" });

      const stop = await getRow("delivery_stops", stop1, "status, arrived_at");
      expect(stop.status).toBe("PENDING");
      expect(stop.arrived_at).toBeNull();
    });

    it("rejects delivery without arrival", async () => {
      const result = await updateDeliveryStopStatus(db, vehicleA, stop1, "DELIVERED");

      expect(result).toEqual({ ok: false, reason: "INVALID_TRANSITION" });

      const order = await getRow("orders", order1, "status");
      expect(order.status).toBe("OUT_FOR_DELIVERY");
    });

    it("accepts arrival from DELAYED and records the time", async () => {
      const result = await updateDeliveryStopStatus(db, vehicleB, stopB, "ARRIVED");

      expect(result).toEqual({
        ok: true,
        stop: { id: stopB, status: "ARRIVED" },
        tripCompleted: false,
      });

      const stop = await getRow("delivery_stops", stopB, "status, arrived_at");
      expect(stop.status).toBe("ARRIVED");
      expect(stop.arrived_at).not.toBeNull();
    });

    it("rolls back delivery when its order is not ready", async () => {
      await expect(
        updateDeliveryStopStatus(db, vehicleB, stopB, "DELIVERED"),
      ).rejects.toThrow("Order is not ready for delivery");

      const stop = await getRow("delivery_stops", stopB, "status, completed_at");
      const order = await getRow("orders", orderB, "status");
      const trip = await getRow("trips", tripB, "status");

      expect(stop.status).toBe("ARRIVED");
      expect(stop.completed_at).toBeNull();
      expect(order.status).toBe("BATCHED");
      expect(trip.status).toBe("OUT_FOR_DELIVERY");
    });

    it("updates orders and completes the trip after the final delivery", async () => {
      const firstArrival = await updateDeliveryStopStatus(db, vehicleA, stop1, "ARRIVED");
      expect(firstArrival.ok).toBe(true);
      const arrived = await getRow("delivery_stops", stop1, "arrived_at");
      expect(await updateDeliveryStopStatus(db, vehicleA, stop1, "ARRIVED")).toEqual(firstArrival);
      expect(await getRow("delivery_stops", stop1, "arrived_at")).toEqual(arrived);

      const firstDelivery = await updateDeliveryStopStatus(db, vehicleA, stop1, "DELIVERED");
      expect(firstDelivery).toEqual({
        ok: true,
        stop: { id: stop1, status: "DELIVERED" },
        tripCompleted: false,
      });
      expect(await updateDeliveryStopStatus(db, vehicleA, stop1, "DELIVERED")).toEqual(firstDelivery);

      const firstOrder = await getRow("orders", order1, "status");
      const firstStop = await getRow("delivery_stops", stop1, "arrived_at, completed_at");
      const ongoingTrip = await getRow("trips", tripA, "status");

      expect(firstOrder.status).toBe("DELIVERED");
      expect(firstStop.arrived_at).not.toBeNull();
      expect(firstStop.completed_at).not.toBeNull();
      expect(ongoingTrip.status).toBe("OUT_FOR_DELIVERY");

      const secondArrival = await updateDeliveryStopStatus(db, vehicleA, stop2, "ARRIVED");
      expect(secondArrival.ok).toBe(true);

      const finalDelivery = await updateDeliveryStopStatus(db, vehicleA, stop2, "DELIVERED");
      expect(finalDelivery).toEqual({
        ok: true,
        stop: { id: stop2, status: "DELIVERED" },
        tripCompleted: true,
      });
      // A lost final response must be safe to retry after the vehicle is released.
      expect(await updateDeliveryStopStatus(db, vehicleA, stop2, "DELIVERED")).toEqual(finalDelivery);
      expect(await updateDeliveryStopStatus(db, vehicleB, stop2, "DELIVERED"))
        .toEqual({ ok: false, reason: "NOT_FOUND" });

      const secondOrder = await getRow("orders", order2, "status");
      const trip = await getRow("trips", tripA, "status, completed_at");

      expect(secondOrder.status).toBe("DELIVERED");
      expect(trip.status).toBe("COMPLETED");
      expect(trip.completed_at).not.toBeNull();

      const { data: history, error: historyError } = await db
        .from("order_status_history")
        .select("order_id, status, changed_by")
        .in("order_id", [order1, order2])
        .eq("status", "DELIVERED");

      expect(historyError).toBeNull();
      expect(history).toHaveLength(2);
      expect(history?.every((entry) => entry.changed_by === vehicleA)).toBe(true);

      const { data: vehicle, error: vehicleError } = await db
        .from("vehicles")
        .select("status, current_trip_id")
        .eq("user_id", vehicleA)
        .single();

      expect(vehicleError).toBeNull();
      expect(vehicle?.status).toBe("AVAILABLE");
      expect(vehicle?.current_trip_id).toBeNull();
    });

    it("rejects further updates after trip completion", async () => {
      const result = await updateDeliveryStopStatus(db, vehicleA, stop1, "ARRIVED");

      expect(result).toEqual({ ok: false, reason: "NOT_FOUND" });

      const trip = await getRow("trips", tripA, "status");
      expect(trip.status).toBe("COMPLETED");
    });
  },
);
