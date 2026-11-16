import { describe, expect, it, vi } from "vitest";
import { optimizeTripRoute } from "./optimization";
import type { Route } from "./mapbox";

// Fixed locations and departure time keep the ETA tests consistent.
const origin = { lat: 37.33, lng: -121.89 };
const destination = { lat: 37.34, lng: -121.88 };
const departureTime = new Date("2026-10-20T12:00:00.000Z");

describe("optimizeTripRoute", () => {
  it("assigns sequence 1 and an ETA using the first route leg", async () => {
    const route: Route = {
      geometry: {
        type: "LineString",
        coordinates: [
          [-121.89, 37.33],
          [-121.88, 37.34],
          [-121.89, 37.33],
        ],
      },
      distanceMeters: 2000,
      durationSeconds: 300,
      legs: [
        { distanceMeters: 1000, durationSeconds: 120 },
        { distanceMeters: 1000, durationSeconds: 180 },
      ],
    };

    const routeProvider = vi.fn().mockResolvedValue(route);

    const result = await optimizeTripRoute(
      [{ orderId: "order-1", location: destination }],
      { origin, departureTime, routeProvider },
    );

    expect(routeProvider).toHaveBeenCalledWith({
      origin,
      stops: [destination],
      returnToOrigin: true,
      departureTime,
    });

    expect(result.geometry).toEqual(route.geometry);

    expect(result.stops).toEqual([
      {
        orderId: "order-1",
        stopSequence: 1,
        estimatedArrival: "2026-10-20T12:02:00.000Z",
      },
    ]);
  });

  it("rejects a trip with no delivery stops", async () => {
    const routeProvider = vi.fn();

    await expect(
      optimizeTripRoute([], {
        origin,
        departureTime,
        routeProvider,
      }),
    ).rejects.toThrow();

    expect(routeProvider).not.toHaveBeenCalled();
  });
});

describe("optimizeTripRoute additional cases", () => {
  it("orders nearby stops first and calculates cumulative ETAs", async () => {
    const near = { lat: 37.3305, lng: -121.8895 };
    const far = destination;

    const route: Route = {
      geometry: {
        type: "LineString",
        coordinates: [
          [-121.89, 37.33],
          [-121.8895, 37.3305],
          [-121.88, 37.34],
          [-121.89, 37.33],
        ],
      },
      distanceMeters: 5000,
      durationSeconds: 360,
      legs: [
        { distanceMeters: 500, durationSeconds: 60 },
        { distanceMeters: 1500, durationSeconds: 120 },
        { distanceMeters: 3000, durationSeconds: 180 },
      ],
    };

    const routeProvider = vi.fn().mockResolvedValue(route);

    // Put the farther stop first to check that optimization reorders it.
    const result = await optimizeTripRoute(
      [
        { orderId: "far-order", location: far },
        { orderId: "near-order", location: near },
      ],
      { origin, departureTime, routeProvider },
    );

    expect(routeProvider).toHaveBeenCalledWith({
      origin,
      stops: [near, far],
      returnToOrigin: true,
      departureTime,
    });

    expect(result.stops).toEqual([
      {
        orderId: "near-order",
        stopSequence: 1,
        estimatedArrival: "2026-10-20T12:01:00.000Z",
      },
      {
        orderId: "far-order",
        stopSequence: 2,
        estimatedArrival: "2026-10-20T12:03:00.000Z",
      },
    ]);

    expect(result.geometry).toEqual(route.geometry);
    expect(result.distanceMeters).toBe(5000);
    expect(result.durationSeconds).toBe(360);
  });

  it("rejects duplicate order IDs before calling Mapbox", async () => {
    const routeProvider = vi.fn();

    await expect(
      optimizeTripRoute(
        [
          { orderId: "same-order", location: origin },
          { orderId: "same-order", location: destination },
        ],
        { origin, departureTime, routeProvider },
      ),
    ).rejects.toMatchObject({ code: "INVALID_REQUEST" });

    expect(routeProvider).not.toHaveBeenCalled();
  });

  it("rejects trips exceeding the 10-order limit", async () => {
    const routeProvider = vi.fn();

    const stops = Array.from({ length: 11 }, (_, i) => ({
      orderId: `order-${i}`,
      location: destination,
    }));

    await expect(
      optimizeTripRoute(stops, {
        origin,
        departureTime,
        routeProvider,
      }),
    ).rejects.toMatchObject({ code: "INVALID_REQUEST" });

    expect(routeProvider).not.toHaveBeenCalled();
  });

  it("rejects routes with an incorrect number of legs", async () => {
    const routeProvider = vi.fn().mockResolvedValue({
      geometry: {
        type: "LineString",
        coordinates: [
          [-121.89, 37.33],
          [-121.88, 37.34],
        ],
      },
      distanceMeters: 1000,
      durationSeconds: 60,
      legs: [
        { distanceMeters: 1000, durationSeconds: 60 },
      ],
    });

    await expect(
      optimizeTripRoute(
        [
          { orderId: "order-1", location: origin },
          { orderId: "order-2", location: destination },
        ],
        { origin, departureTime, routeProvider },
      ),
    ).rejects.toMatchObject({ code: "PROVIDER_ERROR" });
  });
});

describe("optimizeTripRoute provider response validation", () => {
  // Start with a valid route and change one field for each error case.
  const validRoute: Route = {
    geometry: {
      type: "LineString",
      coordinates: [
        [-121.89, 37.33],
        [-121.88, 37.34],
        [-121.89, 37.33],
      ],
    },
    distanceMeters: 2000,
    durationSeconds: 300,
    legs: [
      { distanceMeters: 1000, durationSeconds: 120 },
      { distanceMeters: 1000, durationSeconds: 180 },
    ],
  };

  it("rejects non-finite coordinates in route geometry", async () => {
    const routeProvider = vi.fn().mockResolvedValue({
      ...validRoute,
      geometry: {
        type: "LineString",
        coordinates: [
          [Number.NaN, 37.33],
          [-121.88, 37.34],
        ],
      },
    });

    await expect(
      optimizeTripRoute(
        [{ orderId: "order-1", location: destination }],
        { origin, departureTime, routeProvider },
      ),
    ).rejects.toMatchObject({ code: "PROVIDER_ERROR" });
  });

  it("rejects a negative total route distance", async () => {
    const routeProvider = vi.fn().mockResolvedValue({
      ...validRoute,
      distanceMeters: -100,
    });

    await expect(
      optimizeTripRoute(
        [{ orderId: "order-1", location: destination }],
        { origin, departureTime, routeProvider },
      ),
    ).rejects.toMatchObject({ code: "PROVIDER_ERROR" });
  });
});
