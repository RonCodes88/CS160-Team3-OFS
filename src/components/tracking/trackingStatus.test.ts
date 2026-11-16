import { describe, expect, it } from "vitest";
import {
  etaText,
  headline,
  isFinished,
  mapBounds,
  routeCoordinates,
  statusLabel,
  stepIndex,
  toLngLat,
  updatedAgo,
} from "./trackingStatus";

const NOW = new Date("2026-11-16T01:00:00Z"); // 5:00 PM in San Jose
const inMinutes = (minutes: number) => new Date(NOW.getTime() + minutes * 60_000).toISOString();

describe("statusLabel and stepIndex", () => {
  it("labels every order status, including unknown ones", () => {
    expect(statusLabel("BATCHED")).toBe("Assigned to a robot");
    expect(statusLabel("CANCELED")).toBe("Canceled");
    expect(statusLabel("SOMETHING_NEW")).toBe("Processing");
  });

  it("places statuses in delivery order", () => {
    expect(stepIndex("PAID")).toBe(0);
    expect(stepIndex("DELIVERED")).toBe(4);
    expect(stepIndex("CANCELED")).toBe(-1);
  });
});

describe("isFinished", () => {
  it.each([
    ["DELIVERED", true],
    ["CANCELED", true],
    ["OUT_FOR_DELIVERY", false],
    ["PAID", false],
  ])("%s -> %s", (status, finished) => {
    expect(isFinished(status)).toBe(finished);
  });
});

describe("headline", () => {
  it.each([
    [{ status: "PAID", stopStatus: null }, "We're getting your order ready"],
    [{ status: "PREPARING", stopStatus: null }, "We're getting your order ready"],
    [{ status: "BATCHED", stopStatus: "PENDING" }, "on a robot's route"],
    [{ status: "OUT_FOR_DELIVERY", stopStatus: "EN_ROUTE" }, "Your robot is on its way."],
    [{ status: "OUT_FOR_DELIVERY", stopStatus: "DELAYED" }, "running late"],
    [{ status: "OUT_FOR_DELIVERY", stopStatus: "ARRIVED" }, "Meet it outside"],
    [{ status: "DELIVERED", stopStatus: "DELIVERED" }, "Delivered"],
    [{ status: "CANCELED", stopStatus: null }, "canceled"],
    [{ status: "MYSTERY", stopStatus: null }, "checking on your order"],
  ])("%o", (tracking, text) => {
    expect(headline(tracking)).toContain(text);
  });
});

describe("etaText", () => {
  const onTheWay = { status: "OUT_FOR_DELIVERY", stopStatus: "EN_ROUTE", estimatedArrival: inMinutes(7) };

  it("shows the store-time clock and minutes left", () => {
    expect(etaText(onTheWay, NOW)).toBe("5:07 PM (about 7 min)");
  });

  it("rounds partial minutes up", () => {
    expect(etaText({ ...onTheWay, estimatedArrival: inMinutes(0.2) }, NOW)).toBe("5:00 PM (about 1 min)");
  });

  it("says any minute now once the estimate has passed", () => {
    expect(etaText({ ...onTheWay, estimatedArrival: inMinutes(-3) }, NOW)).toBe("4:57 PM (any minute now)");
  });

  it("shows an estimate for a routed order that hasn't left yet", () => {
    expect(etaText({ ...onTheWay, status: "BATCHED", stopStatus: "PENDING" }, NOW)).toContain("about 7 min");
  });

  it.each([
    ["no estimate yet", { ...onTheWay, estimatedArrival: null }],
    ["an unreadable estimate", { ...onTheWay, estimatedArrival: "soon" }],
    ["the robot has arrived", { ...onTheWay, stopStatus: "ARRIVED" }],
    ["the order is delivered", { ...onTheWay, status: "DELIVERED" }],
    ["the order is still being packed", { ...onTheWay, status: "PAID" }],
  ])("is hidden when %s", (_, tracking) => {
    expect(etaText(tracking, NOW)).toBeNull();
  });
});

describe("updatedAgo", () => {
  it("rounds down to whole minutes", () => {
    expect(updatedAgo(inMinutes(-0.5), NOW)).toBe("just now");
    expect(updatedAgo(inMinutes(-4.9), NOW)).toBe("4 min ago");
  });
});

describe("routeCoordinates", () => {
  it("reads a GeoJSON LineString", () => {
    expect(routeCoordinates({ type: "LineString", coordinates: [[-121.88, 37.33], [-121.89, 37.34]] })).toEqual([
      [-121.88, 37.33],
      [-121.89, 37.34],
    ]);
  });

  it.each([
    ["null", null],
    ["text", "LINESTRING(...)"],
    ["another geometry type", { type: "Point", coordinates: [-121.88, 37.33] }],
    ["a single point", { type: "LineString", coordinates: [[-121.88, 37.33]] }],
    ["a malformed point", { type: "LineString", coordinates: [[-121.88, 37.33], ["x", 1]] }],
    ["a non-array point", { type: "LineString", coordinates: [[-121.88, 37.33], 5] }],
  ])("rejects %s", (_, route) => {
    expect(routeCoordinates(route)).toBeNull();
  });
});

describe("toLngLat and mapBounds", () => {
  it("converts to Mapbox's longitude-first order", () => {
    expect(toLngLat({ latitude: 37.33, longitude: -121.88 })).toEqual([-121.88, 37.33]);
    expect(toLngLat(null)).toBeNull();
  });

  it("fits every point", () => {
    expect(mapBounds([[-121.88, 37.33], [-121.9, 37.35], [-121.87, 37.34]])).toEqual([
      [-121.9, 37.33],
      [-121.87, 37.35],
    ]);
  });
});
