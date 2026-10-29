import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import { createAddress, listAddresses } from "./addresses";
import type { AddressInput } from "./addressValidation";

const INPUT: AddressInput = {
  label: null, line1: "87 N San Pedro St", line2: "Apt 4", city: "San Jose", state: "CA", postalCode: "95110",
};
const ROW = {
  id: "a1", label: null, line_1: "87 N San Pedro St", line_2: "Apt 4", city: "San Jose", state: "CA",
  postal_code: "95110", is_default: true,
};

type Result = { data?: unknown; error?: { code?: string; message: string } | null; count?: number | null };

/** A stand-in for the query builder: every chained call returns itself; awaiting gives the next result. */
function fakeDb(results: Result[]) {
  const inserts: Record<string, unknown>[] = [];
  const builder: Record<string, unknown> = {};
  for (const name of ["select", "eq", "order", "single"]) builder[name] = vi.fn(() => builder);
  builder.insert = vi.fn((row: Record<string, unknown>) => { inserts.push(row); return builder; });
  builder.then = (resolve: (value: Result) => unknown) => resolve({ error: null, ...results.shift() });
  const db = { from: vi.fn(() => builder) } as unknown as SupabaseClient;
  return { db, inserts, builder };
}

const deps = (point: { lat: number; lng: number } | null = { lat: 37.3361, lng: -121.8945 }, deliverable = true) => ({
  geocode: vi.fn(async () => point),
  isDeliverable: vi.fn(() => deliverable),
});

describe("listAddresses", () => {
  it("maps rows for the customer", async () => {
    const { db, builder } = fakeDb([{ data: [ROW] }]);
    expect(await listAddresses(db, "customer")).toEqual([{
      id: "a1", label: null, line1: "87 N San Pedro St", line2: "Apt 4", city: "San Jose", state: "CA",
      postalCode: "95110", isDefault: true,
    }]);
    expect(builder.eq).toHaveBeenCalledWith("customer_id", "customer");
  });

  it("throws on a database error", async () => {
    const { db } = fakeDb([{ error: { message: "down" } }]);
    await expect(listAddresses(db, "customer")).rejects.toThrow("down");
  });
});

describe("createAddress", () => {
  it("geocodes the full line and stores the point as EWKT, default for a first address", async () => {
    const { db, inserts } = fakeDb([{ count: 0 }, { data: ROW }]);
    const d = deps();
    expect(await createAddress(db, "customer", INPUT, d)).toMatchObject({ ok: true, address: { id: "a1", isDefault: true } });
    expect(d.geocode).toHaveBeenCalledWith("87 N San Pedro St Apt 4, San Jose, CA 95110");
    expect(inserts[0]).toMatchObject({
      customer_id: "customer", line_1: "87 N San Pedro St", postal_code: "95110",
      location: "SRID=4326;POINT(-121.8945 37.3361)", is_default: true,
    });
  });

  it("does not make later addresses the default", async () => {
    const { db, inserts } = fakeDb([{ count: 2 }, { data: { ...ROW, is_default: false } }]);
    await createAddress(db, "customer", INPUT, deps());
    expect(inserts[0].is_default).toBe(false);
  });

  it("retries as non-default when another first address won the default", async () => {
    const { db, inserts } = fakeDb([{ count: 0 }, { error: { code: "23505", message: "dup" } }, { data: ROW }]);
    expect((await createAddress(db, "customer", INPUT, deps())).ok).toBe(true);
    expect(inserts.map((row) => row.is_default)).toEqual([true, false]);
  });

  it("rejects unknown or out-of-area addresses without writing", async () => {
    const missing = fakeDb([]);
    expect(await createAddress(missing.db, "customer", INPUT, deps(null))).toEqual({ ok: false, reason: "NOT_FOUND" });
    const far = fakeDb([]);
    expect(await createAddress(far.db, "customer", INPUT, deps(undefined, false))).toEqual({ ok: false, reason: "OUTSIDE_AREA" });
    expect(missing.db.from).not.toHaveBeenCalled();
    expect(far.db.from).not.toHaveBeenCalled();
  });

  it("throws on database errors", async () => {
    await expect(createAddress(fakeDb([{ error: { message: "count failed" } }]).db, "c", INPUT, deps())).rejects.toThrow("count failed");
    await expect(createAddress(fakeDb([{ count: 1 }, { error: { message: "insert failed" } }]).db, "c", INPUT, deps()))
      .rejects.toThrow("insert failed");
  });
});
