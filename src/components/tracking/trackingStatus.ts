// How the tracking page describes an order. Kept apart from the components so
// every state can be tested without a browser or a map.

import { formatTime } from "@/lib/notifications/messages";
import type { CustomerTracking } from "@/lib/orders/tracking";

export type LngLat = [longitude: number, latitude: number];

/** How often the page asks the server for fresh tracking data. */
export const POLL_MS = 15_000;

export const STATUS_STEPS = [
  { status: "PAID", label: "Paid" },
  { status: "PREPARING", label: "Being packed" },
  { status: "BATCHED", label: "Assigned to a robot" },
  { status: "OUT_FOR_DELIVERY", label: "Out for delivery" },
  { status: "DELIVERED", label: "Delivered" },
] as const;

const LABELS: Record<string, string> = {
  ...Object.fromEntries(STATUS_STEPS.map((step) => [step.status, step.label])),
  CANCELED: "Canceled",
};

export function statusLabel(status: string): string {
  return LABELS[status] ?? "Processing";
}

/** Position in STATUS_STEPS, or -1 for a canceled or unknown order. */
export function stepIndex(status: string): number {
  return STATUS_STEPS.findIndex((step) => step.status === status);
}

/** Delivered and canceled orders never change again, so polling stops. */
export function isFinished(status: string): boolean {
  return status === "DELIVERED" || status === "CANCELED";
}

/** One sentence about what is happening right now. */
export function headline(tracking: Pick<CustomerTracking, "status" | "stopStatus">): string {
  switch (tracking.status) {
    case "CANCELED":
      return "This order was canceled.";
    case "DELIVERED":
      return "Delivered. Enjoy your groceries!";
    case "OUT_FOR_DELIVERY":
      if (tracking.stopStatus === "ARRIVED") return "Your robot has arrived. Meet it outside.";
      if (tracking.stopStatus === "DELAYED") return "Your robot is running late. The arrival time below is updated.";
      return "Your robot is on its way.";
    case "BATCHED":
      return "Your order is on a robot's route and leaves the store soon.";
    case "PAID":
    case "PREPARING":
      return "We're getting your order ready. A robot is assigned within about 20 minutes.";
    default:
      return "We're checking on your order.";
  }
}

/**
 * "3:42 PM (about 7 min)" while the order is on its way, or null when there is
 * no estimate or it no longer matters.
 */
export function etaText(
  tracking: Pick<CustomerTracking, "status" | "stopStatus" | "estimatedArrival">,
  now: Date,
): string | null {
  if (tracking.status !== "BATCHED" && tracking.status !== "OUT_FOR_DELIVERY") return null;
  if (tracking.stopStatus === "ARRIVED") return null;
  const clock = formatTime(tracking.estimatedArrival);
  if (!clock) return null;
  const minutes = Math.ceil((Date.parse(tracking.estimatedArrival!) - now.getTime()) / 60_000);
  return minutes <= 0 ? `${clock} (any minute now)` : `${clock} (about ${minutes} min)`;
}

/** "just now" or "4 min ago". */
export function updatedAgo(iso: string, now: Date): string {
  const minutes = Math.floor((now.getTime() - Date.parse(iso)) / 60_000);
  return minutes < 1 ? "just now" : `${minutes} min ago`;
}

/** The route's points if it is a usable GeoJSON LineString, otherwise null. */
export function routeCoordinates(route: unknown): LngLat[] | null {
  if (typeof route !== "object" || route === null) return null;
  const { type, coordinates } = route as { type?: unknown; coordinates?: unknown };
  if (type !== "LineString" || !Array.isArray(coordinates) || coordinates.length < 2) return null;
  const points: LngLat[] = [];
  for (const point of coordinates) {
    if (!Array.isArray(point) || !Number.isFinite(point[0]) || !Number.isFinite(point[1])) return null;
    points.push([point[0], point[1]]);
  }
  return points;
}

export function toLngLat(point: { latitude: number; longitude: number } | null): LngLat | null {
  return point ? [point.longitude, point.latitude] : null;
}

/** The south-west and north-east corners that fit every point. */
export function mapBounds(points: LngLat[]): [LngLat, LngLat] {
  const lngs = points.map((p) => p[0]);
  const lats = points.map((p) => p[1]);
  return [
    [Math.min(...lngs), Math.min(...lats)],
    [Math.max(...lngs), Math.max(...lats)],
  ];
}
