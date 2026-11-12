import { describe, expect, it } from "vitest";
import { shouldDispatch, waitLimitMinutes } from "./dispatch";
import type { PlannedTrip } from "./batching";
const now = new Date("2026-11-09T12:00:00Z");
function trip(count = 1, weight = 100, age = 0): PlannedTrip {
  return { totalWeight: weight, orders: Array.from({ length: count }, (_, i) => ({
    orderId: String(i), totalWeight: weight / count, location: { lat: 0, lng: 0 },
    paidAt: new Date(now.getTime() - age),
  })) };
}
describe("dispatch eligibility", () => {
  it("dispatches ten orders without waiting", () => expect(shouldDispatch(trip(10, 1000), now)).toBe(true));
  it("dispatches exactly 200 pounds without waiting", () => expect(shouldDispatch(trip(1, 20000), now)).toBe(true));
  it("waits below capacity and time thresholds", () => expect(shouldDispatch(trip(9, 19999, 1199999), now)).toBe(false));
  it("dispatches at exactly twenty minutes", () => expect(shouldDispatch(trip(1, 100, 1200000), now)).toBe(true));
  it("uses the oldest timestamp even if orders are unsorted", () => {
    const value = trip(2, 100); value.orders[1].paidAt = new Date(now.getTime() - 1200000);
    expect(shouldDispatch(value, now)).toBe(true);
  });
  it("supports a custom wait limit", () => expect(shouldDispatch(trip(1, 100, 300000), now, 5)).toBe(true));
  it("never dispatches an empty trip", () => expect(shouldDispatch(trip(0, 0), now)).toBe(false));
  it.each([0, -1, NaN, Infinity])("rejects invalid wait %s", value => expect(() => shouldDispatch(trip(), now, value)).toThrow());
  it("rejects overloaded trips", () => expect(() => shouldDispatch(trip(1, 20001), now)).toThrow());
  it("defaults configuration to twenty minutes", () => expect(waitLimitMinutes(undefined)).toBe(20));
  it("reads configured minutes", () => expect(waitLimitMinutes("5")).toBe(5));
  it("rejects malformed configuration", () => expect(() => waitLimitMinutes("nope")).toThrow());
});
