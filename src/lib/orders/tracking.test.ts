import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import { getCustomerTracking } from "./tracking";

const CUSTOMER = "11111111-1111-4111-8111-111111111111";
const ORDER = "22222222-2222-4222-8222-222222222222";
const TRIP = "33333333-3333-4333-8333-333333333333";
const ETA = "2026-11-11T03:00:00.000Z";
const UPDATED = "2026-11-11T02:50:00.000Z";

const route = {
  type: "LineString",
  coordinates: [[-121.89, 37.33], [-121.88, 37.34]],
};

function point(longitude = -121.891, latitude = 37.331) {
  const value = Buffer.alloc(25);
  value.writeUInt8(1, 0);
  value.writeUInt32LE(0x20000001, 1);
  value.writeUInt32LE(4326, 5);
  value.writeDoubleLE(longitude, 9);
  value.writeDoubleLE(latitude, 17);
  return value.toString("hex");
}

type Table = "orders" | "trips" | "delivery_stops" | "vehicles";
type Reply = {
  data: Record<string, unknown> | null;
  error: { message: string } | null;
};

const defaultReplies: Record<Table, Reply> = {
  orders: {
    data: {
      id: ORDER,
      customer_id: CUSTOMER,
      status: "OUT_FOR_DELIVERY",
      trip_id: TRIP,
    },
    error: null,
  },
  trips: {
    data: { status: "OUT_FOR_DELIVERY", route_geometry: route },
    error: null,
  },
  delivery_stops: {
    data: { status: "ARRIVED", estimated_arrival: ETA },
    error: null,
  },
  vehicles: {
    data: { last_location: point(), last_update_at: UPDATED },
    error: null,
  },
};

function makeDb(overrides: Partial<Record<Table, Reply>> = {}) {
  const replies = { ...defaultReplies, ...overrides };

  const from = vi.fn((table: Table) => ({
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue(replies[table]),
  }));

  return {
    db: { from } as unknown as SupabaseClient,
    from,
  };
}

describe("customer tracking service", () => {
  it("returns order status, ETA, route and decoded robot GPS", async () => {
    const { db, from } = makeDb();
    const result = await getCustomerTracking(db, CUSTOMER, ORDER);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("Expected tracking.");

    expect(result.tracking).toMatchObject({
      orderId: ORDER,
      status: "OUT_FOR_DELIVERY",
      tripStatus: "OUT_FOR_DELIVERY",
      stopStatus: "ARRIVED",
      estimatedArrival: ETA,
      route,
      robotLocation: {
        latitude: 37.331,
        longitude: -121.891,
        updatedAt: UPDATED,
      },
    });

    expect(from).toHaveBeenCalledTimes(4);
    expect(from.mock.results[0].value.eq).toHaveBeenCalledWith("id", ORDER);
    expect(from.mock.results[2].value.eq).toHaveBeenCalledWith("order_id", ORDER);
    expect(from.mock.results[3].value.eq).toHaveBeenCalledWith("current_trip_id", TRIP);
  });

  it("returns NOT_FOUND for an unknown order", async () => {
    const { db, from } = makeDb({
      orders: { data: null, error: null },
    });

    expect(await getCustomerTracking(db, CUSTOMER, ORDER)).toEqual({
      ok: false,
      reason: "NOT_FOUND",
    });
    expect(from).toHaveBeenCalledTimes(1);
  });

  it("forbids another customer's order before reading trip data", async () => {
    const { db, from } = makeDb({
      orders: {
        data: { ...defaultReplies.orders.data, customer_id: "another-user" },
        error: null,
      },
    });

    expect(await getCustomerTracking(db, CUSTOMER, ORDER)).toEqual({
      ok: false,
      reason: "FORBIDDEN",
    });
    expect(from).toHaveBeenCalledTimes(1);
  });

  it("handles orders that have no assigned trip", async () => {
    const { db, from } = makeDb({
      orders: {
        data: {
          id: ORDER,
          customer_id: CUSTOMER,
          status: "PAID",
          trip_id: null,
        },
        error: null,
      },
    });

    expect(await getCustomerTracking(db, CUSTOMER, ORDER)).toEqual({
      ok: true,
      tracking: {
        orderId: ORDER,
        status: "PAID",
        tripStatus: null,
        stopStatus: null,
        estimatedArrival: null,
        route: null,
        robotLocation: null,
      },
    });
    expect(from).toHaveBeenCalledTimes(1);
  });

  it("returns a routed order without an assigned robot location", async () => {
    const { db, from } = makeDb({
      orders: {
        data: {
          id: ORDER,
          customer_id: CUSTOMER,
          status: "BATCHED",
          trip_id: TRIP,
        },
        error: null,
      },
      trips: {
        data: { status: "ROUTED", route_geometry: route },
        error: null,
      },
      delivery_stops: { data: null, error: null },
    });

    const result = await getCustomerTracking(db, CUSTOMER, ORDER);
    expect(result).toEqual({
      ok: true,
      tracking: {
        orderId: ORDER,
        status: "BATCHED",
        tripStatus: "ROUTED",
        stopStatus: null,
        estimatedArrival: null,
        route,
        robotLocation: null,
      },
    });
    expect(from).toHaveBeenCalledTimes(3);
  });

  it("handles a missing trip and delivery stop", async () => {
    const { db } = makeDb({
      trips: { data: null, error: null },
      delivery_stops: { data: null, error: null },
      vehicles: { data: null, error: null },
    });

    const result = await getCustomerTracking(db, CUSTOMER, ORDER);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("Expected tracking.");

    expect(result.tracking.tripStatus).toBeNull();
    expect(result.tracking.stopStatus).toBeNull();
    expect(result.tracking.robotLocation).toBeNull();
  });

  it("handles a vehicle that has not reported a location", async () => {
    const { db } = makeDb({
      vehicles: {
        data: { last_location: null, last_update_at: null },
        error: null,
      },
    });

    const result = await getCustomerTracking(db, CUSTOMER, ORDER);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("Expected tracking.");

    expect(result.tracking.robotLocation).toBeNull();
  });

  it("ignores malformed GPS data", async () => {
    const { db } = makeDb({
      vehicles: {
        data: { last_location: "not-a-point", last_update_at: UPDATED },
        error: null,
      },
    });

    const result = await getCustomerTracking(db, CUSTOMER, ORDER);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("Expected tracking.");

    expect(result.tracking.robotLocation).toBeNull();
  });

  it("rejects GPS coordinates outside valid ranges", async () => {
    const { db } = makeDb({
      vehicles: {
        data: { last_location: point(190, 95), last_update_at: UPDATED },
        error: null,
      },
    });

    const result = await getCustomerTracking(db, CUSTOMER, ORDER);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("Expected tracking.");

    expect(result.tracking.robotLocation).toBeNull();
  });

  it("rejects a location with an unexpected coordinate system", async () => {
    const invalid = Buffer.from(point(), "hex");
    invalid.writeUInt32LE(3857, 5);

    const { db } = makeDb({
      vehicles: {
        data: {
          last_location: invalid.toString("hex"),
          last_update_at: UPDATED,
        },
        error: null,
      },
    });

    const result = await getCustomerTracking(db, CUSTOMER, ORDER);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("Expected tracking.");

    expect(result.tracking.robotLocation).toBeNull();
  });

  it.each<Table>([
    "orders",
    "trips",
    "delivery_stops",
    "vehicles",
  ])("reports database errors from %s", async (table) => {
    const { db } = makeDb({
      [table]: { data: null, error: { message: "simulated failure" } },
    });

    await expect(getCustomerTracking(db, CUSTOMER, ORDER))
      .rejects.toThrow("simulated failure");
  });
});
