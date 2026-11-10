import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { updateVehicleLocation } from "./locationService";

try {
  process.loadEnvFile(".env.test.local");
} catch {
}

const TEST_URL = process.env.SUPABASE_TEST_URL;
const TEST_KEY = process.env.SUPABASE_TEST_SECRET_KEY;

if (
  TEST_URL &&
  !/^http:\/\/(localhost|127\.0\.0\.1|host\.docker\.internal)(:\d+)?\/?$/.test(TEST_URL)
) {
  throw new Error("Vehicle tests require a local database.");
}

describe.skipIf(!TEST_URL || !TEST_KEY)(
  "vehicle location updates against local Postgres",
  () => {
    let db: SupabaseClient;
    let userA: string;
    let userB: string;

    const created: Array<{ table: string; id: string }> = [];

    async function insert(table: string, row: object) {
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

    async function readVehicle(userId: string) {
      const { data, error } = await db
        .from("vehicles")
        .select("last_location, battery_percent, last_update_at")
        .eq("user_id", userId)
        .single();

      if (error) throw new Error(error.message);
      return data;
    }

    beforeAll(async () => {
      db = createClient(TEST_URL!, TEST_KEY!, {
        auth: { persistSession: false },
      });

      const run = randomUUID().slice(0, 8);

      userA = await insert("users", {
        email: `vehicle29-a-${run}@test.local`,
        password_hash: "test-only",
        role: "VEHICLE",
      });

      userB = await insert("users", {
        email: `vehicle29-b-${run}@test.local`,
        password_hash: "test-only",
        role: "VEHICLE",
      });

      await insert("vehicles", {
        user_id: userA,
        status: "AVAILABLE",
        battery_percent: 50,
      });

      await insert("vehicles", {
        user_id: userB,
        status: "AVAILABLE",
        battery_percent: 40,
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

    it("stores location, battery and update time", async () => {
      const input = {
        latitude: 37.3349,
        longitude: -121.8881,
        batteryPercent: 85,
      };

      const start = Date.now();
      const result = await updateVehicleLocation(db, userA, input);

      expect(result).not.toBeNull();
      expect(result).toMatchObject(input);

      if (!result) throw new Error("Expected vehicle update.");

      const saved = await readVehicle(userA);

      expect(saved.battery_percent).toBe(85);
      expect(saved.last_location).toBeTruthy();

      const point = Buffer.from(saved.last_location, "hex");
      expect(point.length).toBe(25);
      expect(point.readUInt8(0)).toBe(1);
      expect(point.readUInt32LE(1)).toBe(0x20000001);
      expect(point.readUInt32LE(5)).toBe(4326);
      expect(point.readDoubleLE(9)).toBeCloseTo(input.longitude, 6);
      expect(point.readDoubleLE(17)).toBeCloseTo(input.latitude, 6);
      expect(Date.parse(saved.last_update_at)).toBe(
        Date.parse(result.updatedAt),
      );
      expect(Date.parse(result.updatedAt)).toBeGreaterThanOrEqual(start);
      expect(Date.parse(result.updatedAt)).toBeLessThanOrEqual(Date.now());
    });

    it("does not change another vehicle's data", async () => {
      const other = await readVehicle(userB);

      expect(other.battery_percent).toBe(40);
      expect(other.last_location).toBeNull();
      expect(other.last_update_at).toBeNull();
    });

    it("replaces previous GPS coordinates and battery level", async () => {
      const before = await readVehicle(userA);

      const result = await updateVehicleLocation(db, userA, {
        latitude: 37.35,
        longitude: -121.90,
        batteryPercent: 0,
      });

      expect(result).toMatchObject({
        latitude: 37.35,
        longitude: -121.90,
        batteryPercent: 0,
      });

      const after = await readVehicle(userA);

      expect(after.battery_percent).toBe(0);
      expect(after.last_location).not.toEqual(before.last_location);
    });

    it("returns null when no vehicle record matches", async () => {
      const result = await updateVehicleLocation(db, randomUUID(), {
        latitude: 37.33,
        longitude: -121.88,
        batteryPercent: 100,
      });

      expect(result).toBeNull();
    });
  },
);
