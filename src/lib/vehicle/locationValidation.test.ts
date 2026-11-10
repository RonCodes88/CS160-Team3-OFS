import { describe, expect, it } from "vitest";
import { parseVehicleLocationBody } from "./locationValidation";

const valid = {
  latitude: 37.3349,
  longitude: -121.8881,
  batteryPercent: 85,
};

describe("vehicle location validation", () => {
  it("accepts valid coordinates and battery percentage", () => {
    expect(parseVehicleLocationBody(valid)).toEqual({
      ok: true,
      value: valid,
    });
  });

  it("accepts minimum boundaries", () => {
    expect(parseVehicleLocationBody({
      latitude: -90,
      longitude: -180,
      batteryPercent: 0,
    }).ok).toBe(true);
  });

  it("accepts maximum boundaries", () => {
    expect(parseVehicleLocationBody({
      latitude: 90,
      longitude: 180,
      batteryPercent: 100,
    }).ok).toBe(true);
  });

  it.each([
    { ...valid, latitude: -91 },
    { ...valid, latitude: 91 },
    { ...valid, latitude: "37.33" },
    { ...valid, latitude: Number.NaN },
    { ...valid, latitude: Number.POSITIVE_INFINITY },
    { ...valid, longitude: -181 },
    { ...valid, longitude: 181 },
    { ...valid, longitude: null },
    { ...valid, longitude: Number.POSITIVE_INFINITY },
    { ...valid, batteryPercent: -1 },
    { ...valid, batteryPercent: 101 },
    { ...valid, batteryPercent: 50.5 },
    { ...valid, batteryPercent: "85" },
  ])("rejects invalid location or battery values: %j", (body) => {
    expect(parseVehicleLocationBody(body).ok).toBe(false);
  });

  it.each([null, undefined, [], "invalid", 42])(
    "rejects invalid request bodies: %j",
    (body) => {
      expect(parseVehicleLocationBody(body).ok).toBe(false);
    },
  );
});
