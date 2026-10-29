import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createAddress, getOwnedAddress, listAddresses } from "@/lib/auth/addresses";
import type { AddressInput } from "@/lib/auth/addressValidation";

// Runs the address service against a LOCAL Supabase with the migrations applied.
// Setup: `npx supabase start`, then put SUPABASE_TEST_URL and
// SUPABASE_TEST_SECRET_KEY in .env.test.local. Skipped when not configured.
try {
  process.loadEnvFile(".env.test.local");
} catch {
  // Optional file.
}

const TEST_URL = process.env.SUPABASE_TEST_URL;
const TEST_KEY = process.env.SUPABASE_TEST_SECRET_KEY;

// host.docker.internal is the developer's own machine when tests run in Docker.
if (
  TEST_URL &&
  !/^http:\/\/(localhost|127\.0\.0\.1|host\.docker\.internal)(:\d+)?\/?$/.test(TEST_URL)
) {
  throw new Error(`Refusing to run DB tests against non-local SUPABASE_TEST_URL: ${TEST_URL}`);
}

const run = randomUUID().slice(0, 8);
const INPUT: AddressInput = {
  label: "Home", line1: "87 N San Pedro St", line2: null, city: "San Jose", state: "CA", postalCode: "95110",
};
const POINT = { lat: 37.3361, lng: -121.8945 };
const deps = (point: typeof POINT | null, deliverable = true) => ({
  geocode: async () => point,
  isDeliverable: () => deliverable,
});

describe.skipIf(!TEST_URL || !TEST_KEY)("address service against Postgres", () => {
  let db: SupabaseClient;
  let customerId: string;

  beforeAll(async () => {
    db = createClient(TEST_URL!, TEST_KEY!, { auth: { persistSession: false } });
    const { data, error } = await db.from("users")
      .insert({ email: `addresses-${run}@test.local`, password_hash: "test-only" }).select("id").single();
    if (error) throw new Error(`users insert failed: ${error.message}`);
    customerId = data.id;
  });

  afterAll(async () => {
    // Addresses cascade with the user.
    if (db && customerId) await db.from("users").delete().eq("id", customerId);
  });

  it("saves the first address as the default with the geocoded point", async () => {
    const result = await createAddress(db, customerId, INPUT, deps(POINT));
    expect(result).toMatchObject({ ok: true, address: { line1: "87 N San Pedro St", isDefault: true, postalCode: "95110" } });
    const id = result.ok ? result.address.id : "";
    // Checkout reads the stored coordinates back through its own RPC.
    const owned = await getOwnedAddress(db, customerId, id);
    expect(owned?.location?.lat).toBeCloseTo(POINT.lat, 6);
    expect(owned?.location?.lng).toBeCloseTo(POINT.lng, 6);
  });

  it("saves later addresses as non-default and lists the default first", async () => {
    const result = await createAddress(db, customerId, { ...INPUT, label: "Work", line1: "211 S 1st St", postalCode: "95113" }, deps(POINT));
    expect(result).toMatchObject({ ok: true, address: { isDefault: false } });
    const list = await listAddresses(db, customerId);
    expect(list.map((a) => [a.label, a.isDefault])).toEqual([["Home", true], ["Work", false]]);
  });

  it("writes nothing for an address Mapbox can't find or outside the area", async () => {
    expect(await createAddress(db, customerId, INPUT, deps(null))).toEqual({ ok: false, reason: "NOT_FOUND" });
    expect(await createAddress(db, customerId, INPUT, deps(POINT, false))).toEqual({ ok: false, reason: "OUTSIDE_AREA" });
    expect(await listAddresses(db, customerId)).toHaveLength(2);
  });

  it("lists nothing for another customer", async () => {
    expect(await listAddresses(db, randomUUID())).toEqual([]);
  });
});
