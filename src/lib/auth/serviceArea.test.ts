import { describe, expect, it } from "vitest";
import { distanceMeters } from "@/lib/delivery/batching";
import { readServiceArea, isWithinServiceArea, ServiceAreaUnavailable } from "./serviceArea";

// Test fixtures only: these values do not approve a real store location/radius.
const env = { OFS_STORE_LATITUDE: "37.3352", OFS_STORE_LONGITUDE: "-121.8811", OFS_DELIVERY_RADIUS_METERS: "1000" };

describe("required service area configuration", () => {
  it("reads explicit values, including zero coordinates", () => {
    expect(readServiceArea({ ...env, OFS_STORE_LATITUDE: "0", OFS_STORE_LONGITUDE: "0" }))
      .toEqual({ origin: { lat: 0, lng: 0 }, radiusMeters: 1000 });
  });
  it.each([{}, { ...env, OFS_STORE_LATITUDE: "" }, { ...env, OFS_STORE_LONGITUDE: " " },
    { ...env, OFS_STORE_LATITUDE: "91" }, { ...env, OFS_STORE_LONGITUDE: "181" },
    { ...env, OFS_DELIVERY_RADIUS_METERS: "0" }, { ...env, OFS_DELIVERY_RADIUS_METERS: "-5" },
    { ...env, OFS_DELIVERY_RADIUS_METERS: "Infinity" }, { ...env, OFS_STORE_LATITUDE: "abc" }])(
    "fails closed for %j", (values) => expect(() => readServiceArea(values)).toThrow(ServiceAreaUnavailable),
  );
  it("accepts inside and exact boundary; rejects outside", () => {
    const origin = { lat: 0, lng: 0 };
    const boundary = { lat: 0, lng: 0.01 };
    // Derive an exact boundary using the same distance units, avoiding an
    // approximate degree-to-meter conversion that could mask a < versus <= bug.
    const area = { origin, radiusMeters: distanceMeters(origin, boundary) };
    expect(isWithinServiceArea(origin, area)).toBe(true);
    expect(isWithinServiceArea(boundary, area)).toBe(true);
    expect(isWithinServiceArea({ lat: 0, lng: 0.011 }, area)).toBe(false);
  });
  it.each([null, { lat: NaN, lng: 0 }, { lat: 91, lng: 0 }, { lat: 0, lng: -181 }])(
    "rejects invalid address coordinates %j", (point) => {
      expect(isWithinServiceArea(point, readServiceArea(env))).toBe(false);
    },
  );
});
