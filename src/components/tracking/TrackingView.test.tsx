import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { CustomerTracking } from "@/lib/orders/tracking";
import { TrackingView } from "./TrackingView";

// First-render markup. Polling runs in an effect; trackingApi tests cover it.

const NOW = "2026-11-16T01:00:00.000Z";
const ROUTE = { type: "LineString", coordinates: [[-121.8801, 37.3356], [-121.8948, 37.3359]] };

const base: CustomerTracking = {
  orderId: "aad98780-7a58-48eb-896d-7c23f0e285e9",
  status: "OUT_FOR_DELIVERY",
  tripStatus: "OUT_FOR_DELIVERY",
  stopStatus: "EN_ROUTE",
  estimatedArrival: "2026-11-16T01:07:00.000Z",
  route: ROUTE,
  robotLocation: { latitude: 37.3357, longitude: -121.887, updatedAt: "2026-11-16T00:58:00.000Z" },
  destination: { latitude: 37.3361, longitude: -121.8945 },
};

const render = (overrides: Partial<CustomerTracking> = {}) =>
  renderToStaticMarkup(<TrackingView initial={{ ...base, ...overrides }} store={[-121.8811, 37.3352]} renderedAt={NOW} />);

describe("TrackingView", () => {
  it("shows the order number, status, ETA, and map while out for delivery", () => {
    const html = render();
    expect(html).toContain("Order #AAD98780");
    expect(html).toContain("Your robot is on its way.");
    expect(html).toContain("5:07 PM (about 7 min)");
    expect(html).toContain('aria-current="step"');
    expect(html).toContain("Out for delivery");
    expect(html).toContain("Loading the map...");
    expect(html).toContain("Robot location updated 2 min ago.");
    expect(html).toContain("This page refreshes automatically.");
  });

  it("explains that the map comes later for an order that isn't routed yet", () => {
    const html = render({ status: "PAID", tripStatus: null, stopStatus: null, estimatedArrival: null, route: null, robotLocation: null });
    expect(html).toContain("The map appears once your order is on a robot&#x27;s route.");
    expect(html).not.toContain("Estimated arrival");
    expect(html).not.toContain("Robot location");
  });

  it("shows a routed order's estimate before the robot leaves", () => {
    const html = render({ status: "BATCHED", tripStatus: "ROUTED", stopStatus: "PENDING", robotLocation: null });
    expect(html).toContain("Estimated arrival");
    expect(html).toContain("Loading the map...");
    expect(html).not.toContain("Robot location");
  });

  it("hides the robot once the order is delivered and stops refreshing", () => {
    const html = render({ status: "DELIVERED", stopStatus: "DELIVERED", robotLocation: null });
    expect(html).toContain("Delivered. Enjoy your groceries!");
    expect(html).toContain("This order is complete.");
    expect(html).not.toContain("Estimated arrival");
    expect(html).not.toContain('aria-current="step"');
  });

  it("handles a canceled order", () => {
    const html = render({ status: "CANCELED", tripStatus: null, stopStatus: null, estimatedArrival: null, route: null, robotLocation: null });
    expect(html).toContain("This order was canceled.");
    expect(html).toContain("no delivery for this order");
    expect(html).not.toContain("Being packed");
  });

  it("tells the customer the robot has arrived", () => {
    expect(render({ stopStatus: "ARRIVED" })).toContain("Meet it outside");
  });
});
