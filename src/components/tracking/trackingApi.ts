// Browser call to the customer tracking API. The server checks the session and
// that the order belongs to this customer on every request.

import type { CustomerTracking } from "@/lib/orders/tracking";

export type TrackingResult = { ok: true; tracking: CustomerTracking } | { ok: false; status: number; message: string };

export async function fetchTracking(orderId: string): Promise<TrackingResult> {
  let response: Response;
  try {
    response = await fetch(`/api/orders/${encodeURIComponent(orderId)}/tracking`, { cache: "no-store" });
  } catch {
    return { ok: false, status: 0, message: "Couldn't reach the server. Retrying shortly." };
  }
  const body = await response.json().catch(() => null);
  if (response.ok && body?.tracking) return { ok: true, tracking: body.tracking as CustomerTracking };
  if (response.status === 401) {
    return { ok: false, status: 401, message: "Your session has ended. Log in again to keep tracking." };
  }
  const message = body?.error?.message;
  return {
    ok: false,
    status: response.status,
    message: typeof message === "string" && message ? message : "Couldn't refresh tracking. Retrying shortly.",
  };
}
