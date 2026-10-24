import { describe, expect, it } from "vitest";
import {
  MAX_TRIP_ORDERS,
  MAX_TRIP_WEIGHT,
  distanceMeters,
  planTrips,
  type PendingOrder,
} from "./batching";

// Downtown San Jose; 0.001 deg latitude is about 111 m.
const BASE = { lat: 37.3352, lng: -121.8811 };
const T0 = new Date("2026-10-07T12:00:00Z").getTime();

let seq = 0;
function order(overrides: Partial<PendingOrder> & { minute?: number; north?: number } = {}): PendingOrder {
  const { minute = 0, north = 0, ...rest } = overrides;
  seq += 1;
  return {
    orderId: `order-${String(seq).padStart(3, "0")}`,
    paidAt: new Date(T0 + minute * 60_000),
    totalWeight: 500,
    location: { lat: BASE.lat + north * 0.001, lng: BASE.lng },
    ...rest,
  };
}

const ids = (orders: PendingOrder[]) => orders.map((o) => o.orderId);

describe("limits", () => {
  it("match the spec", () => {
    expect(MAX_TRIP_ORDERS).toBe(10);
    expect(MAX_TRIP_WEIGHT).toBe(20000);
  });
});

describe("distanceMeters", () => {
  it("is zero for the same point and symmetric", () => {
    const a = BASE;
    const b = { lat: BASE.lat + 0.01, lng: BASE.lng + 0.01 };
    expect(distanceMeters(a, a)).toBe(0);
    expect(distanceMeters(a, b)).toBeCloseTo(distanceMeters(b, a));
  });

  it("is about 111 m per 0.001 deg of latitude", () => {
    const d = distanceMeters(BASE, { lat: BASE.lat + 0.001, lng: BASE.lng });
    expect(d).toBeGreaterThan(110);
    expect(d).toBeLessThan(112);
  });
});

describe("planTrips", () => {
  it("returns no trips for an empty queue", () => {
    expect(planTrips([])).toEqual([]);
  });

  it("puts a single order in its own trip", () => {
    const o = order({ totalWeight: 1234 });
    expect(planTrips([o])).toEqual([{ orders: [o], totalWeight: 1234 }]);
  });

  it("caps a trip at 10 orders", () => {
    const queue = Array.from({ length: 11 }, (_, i) => order({ minute: i, totalWeight: 100 }));
    const trips = planTrips(queue);
    expect(trips.map((t) => t.orders.length)).toEqual([10, 1]);
    expect(ids(trips[1].orders)).toEqual([queue[10].orderId]);
  });

  it("allows a trip of exactly 200.00 lbs", () => {
    const queue = [order({ minute: 0, totalWeight: 10000 }), order({ minute: 1, totalWeight: 10000 })];
    const trips = planTrips(queue);
    expect(trips).toHaveLength(1);
    expect(trips[0].totalWeight).toBe(20000);
  });

  it("never exceeds 200.00 lbs", () => {
    const queue = [order({ minute: 0, totalWeight: 10000 }), order({ minute: 1, totalWeight: 10001 })];
    const trips = planTrips(queue);
    expect(trips.map((t) => t.totalWeight)).toEqual([10000, 10001]);
  });

  it("accepts a single full-weight 200.00 lb order", () => {
    const trips = planTrips([order({ totalWeight: 20000 })]);
    expect(trips[0].totalWeight).toBe(20000);
  });

  it("starts every trip with the oldest remaining order", () => {
    // Shuffled input; the oldest is far away from everything else.
    const oldest = order({ minute: 0, north: 50 });
    const nearby = Array.from({ length: 10 }, (_, i) => order({ minute: i + 1, north: i * 0.1 }));
    const trips = planTrips([...nearby.slice(5), oldest, ...nearby.slice(0, 5)]);
    expect(trips[0].orders[0]).toBe(oldest);
    // The second trip is seeded by the oldest order not taken by the first.
    const taken = new Set(ids(trips[0].orders));
    const nextOldest = nearby.find((o) => !taken.has(o.orderId));
    expect(trips[1].orders[0]).toBe(nextOldest);
  });

  it("fills a trip with the orders nearest the oldest order", () => {
    const seed = order({ minute: 0, north: 0 });
    const far = Array.from({ length: 5 }, (_, i) => order({ minute: 1 + i, north: 100 + i }));
    const near = Array.from({ length: 9 }, (_, i) => order({ minute: 10 + i, north: 1 + i * 0.1 }));
    const trips = planTrips([seed, ...far, ...near]);
    expect(ids(trips[0].orders)).toEqual(ids([seed, ...near]));
    expect(ids(trips[1].orders).sort()).toEqual(ids(far).sort());
  });

  it("prefers the older order when two are equally near", () => {
    const seed = order({ minute: 0 });
    const younger = order({ minute: 5, north: 1 });
    const older = order({ minute: 2, north: 1 });
    const trips = planTrips([seed, younger, older]);
    expect(ids(trips[0].orders)).toEqual(ids([seed, older, younger]));
  });

  it("skips an order that does not fit and keeps filling with lighter ones", () => {
    const seed = order({ minute: 0, totalWeight: 15000 });
    const heavyNear = order({ minute: 1, north: 1, totalWeight: 6000 });
    const lightFar = order({ minute: 2, north: 5, totalWeight: 5000 });
    const trips = planTrips([seed, heavyNear, lightFar]);
    expect(ids(trips[0].orders)).toEqual(ids([seed, lightFar]));
    expect(trips[0].totalWeight).toBe(20000);
    expect(ids(trips[1].orders)).toEqual(ids([heavyNear]));
  });

  it("assigns every order to exactly one trip", () => {
    const queue = Array.from({ length: 37 }, (_, i) =>
      order({ minute: i, north: (i * 7) % 13, totalWeight: 300 + ((i * 1777) % 9000) }),
    );
    const trips = planTrips(queue);
    const assigned = trips.flatMap((t) => ids(t.orders));
    expect(assigned.sort()).toEqual(ids(queue).sort());
    for (const trip of trips) {
      expect(trip.orders.length).toBeLessThanOrEqual(MAX_TRIP_ORDERS);
      expect(trip.totalWeight).toBeLessThanOrEqual(MAX_TRIP_WEIGHT);
      expect(trip.totalWeight).toBe(trip.orders.reduce((sum, o) => sum + o.totalWeight, 0));
    }
  });

  it("does not mutate the input queue", () => {
    const queue = [order({ minute: 3 }), order({ minute: 1 }), order({ minute: 2 })];
    const before = [...queue];
    planTrips(queue);
    expect(queue).toEqual(before);
  });

  it("is deterministic when paid times tie", () => {
    const a = order({ orderId: "b", minute: 0 });
    const b = order({ orderId: "a", minute: 0, north: 0.5 });
    expect(planTrips([a, b])[0].orders[0].orderId).toBe("a");
    expect(planTrips([b, a])[0].orders[0].orderId).toBe("a");
  });

  it("keeps queue order when paid time and order ID both tie", () => {
    // Duplicate IDs should never reach the planner, but the sort must still
    // treat them as equal and keep both orders instead of dropping one.
    const first = order({ orderId: "same", minute: 0 });
    const second = order({ orderId: "same", minute: 0, north: 0.5 });
    const [trip] = planTrips([first, second]);
    expect(trip.orders).toEqual([first, second]);
  });

  it.each([
    ["over 200.00 lbs", 20001],
    ["negative", -1],
    ["fractional", 10.5],
  ])("rejects an order whose weight is %s", (_label, totalWeight) => {
    expect(() => planTrips([order({ totalWeight })])).toThrow(RangeError);
  });
});
