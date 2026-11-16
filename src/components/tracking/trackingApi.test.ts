import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fetchTracking } from "./trackingApi";

const fetchMock = vi.fn();
const tracking = { orderId: "o1", status: "OUT_FOR_DELIVERY" };

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("fetchTracking", () => {
  it("asks for the order's tracking without caching", async () => {
    fetchMock.mockResolvedValueOnce(Response.json({ tracking }));
    expect(await fetchTracking("o1")).toEqual({ ok: true, tracking });
    expect(fetchMock).toHaveBeenCalledWith("/api/orders/o1/tracking", { cache: "no-store" });
  });

  it("asks the customer to log in again when the session ends", async () => {
    fetchMock.mockResolvedValueOnce(Response.json({ error: { message: "x" } }, { status: 401 }));
    expect(await fetchTracking("o1")).toMatchObject({ ok: false, status: 401, message: expect.stringContaining("Log in again") });
  });

  it("shows the API's error message", async () => {
    fetchMock.mockResolvedValueOnce(Response.json({ error: { message: "You cannot view this order." } }, { status: 403 }));
    expect(await fetchTracking("o1")).toEqual({ ok: false, status: 403, message: "You cannot view this order." });
  });

  it("falls back to a generic message for unreadable errors", async () => {
    fetchMock.mockResolvedValueOnce(new Response("oops", { status: 502 }));
    expect(await fetchTracking("o1")).toMatchObject({ ok: false, status: 502, message: expect.stringContaining("Retrying") });
  });

  it("reports a network failure without throwing", async () => {
    fetchMock.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    expect(await fetchTracking("o1")).toMatchObject({ ok: false, status: 0 });
  });
});
