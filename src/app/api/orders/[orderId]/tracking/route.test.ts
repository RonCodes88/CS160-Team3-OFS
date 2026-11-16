import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "./route";
import { getSessionUser, type Role } from "@/lib/auth/session";
import { getCustomerTracking } from "@/lib/orders/tracking";

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: vi.fn(() => ({})),
}));

vi.mock("@/lib/auth/session", () => ({
  getSessionUser: vi.fn(),
}));

vi.mock("@/lib/orders/tracking", () => ({
  getCustomerTracking: vi.fn(),
}));

const USER_ID = "11111111-1111-4111-8111-111111111111";
const ORDER_ID = "22222222-2222-4222-8222-222222222222";

function signInAs(role: Role | null) {
  vi.mocked(getSessionUser).mockResolvedValue(
    role ? { id: USER_ID, email: "customer@ofs.test", role } : null,
  );
}

function request() {
  return new NextRequest(
    `http://localhost/api/orders/${ORDER_ID}/tracking`,
    { method: "GET" },
  );
}

function context(orderId = ORDER_ID) {
  return { params: Promise.resolve({ orderId }) };
}

const tracking = {
  orderId: ORDER_ID,
  status: "OUT_FOR_DELIVERY",
  tripStatus: "OUT_FOR_DELIVERY",
  stopStatus: "EN_ROUTE",
  estimatedArrival: "2026-11-10T19:30:00.000Z",
  route: {
    type: "LineString",
    coordinates: [[-121.89, 37.33], [-121.88, 37.34]],
  },
  robotLocation: {
    latitude: 37.33,
    longitude: -121.89,
    updatedAt: "2026-11-10T19:00:00.000Z",
  },
  destination: { latitude: 37.3361, longitude: -121.8945 },
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getCustomerTracking).mockResolvedValue({
    ok: false,
    reason: "NOT_FOUND",
  });
});

describe("GET /api/orders/[orderId]/tracking", () => {
  it("returns 401 without a session", async () => {
    signInAs(null);

    const response = await GET(request(), context());

    expect(response.status).toBe(401);
    expect(getCustomerTracking).not.toHaveBeenCalled();
  });

  it.each<Role>(["EMPLOYEE", "MANAGER", "VEHICLE"])(
    "returns 403 for %s",
    async (role) => {
      signInAs(role);

      const response = await GET(request(), context());

      expect(response.status).toBe(403);
      expect(getCustomerTracking).not.toHaveBeenCalled();
    },
  );

  it.each(["invalid", "", "123"])(
    "rejects invalid order ID %j",
    async (orderId) => {
      signInAs("CUSTOMER");

      const response = await GET(request(), context(orderId));

      expect(response.status).toBe(400);
      expect(getCustomerTracking).not.toHaveBeenCalled();
    },
  );

  it("returns 404 when an order does not exist", async () => {
    signInAs("CUSTOMER");

    const response = await GET(request(), context());

    expect(response.status).toBe(404);
  });

  it("returns 403 for another customer's order", async () => {
    signInAs("CUSTOMER");

    vi.mocked(getCustomerTracking).mockResolvedValue({
      ok: false,
      reason: "FORBIDDEN",
    });

    const response = await GET(request(), context());

    expect(response.status).toBe(403);
  });

  it("returns the customer's delivery tracking information", async () => {
    signInAs("CUSTOMER");

    vi.mocked(getCustomerTracking).mockResolvedValue({
      ok: true,
      tracking,
    });

    const response = await GET(request(), context());

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ tracking });

    expect(getCustomerTracking).toHaveBeenCalledWith(
      expect.anything(),
      USER_ID,
      ORDER_ID,
    );

    expect(response.headers.get("Cache-Control")).toBe(
      "private, no-store",
    );
  });

  it("handles an order without an assigned trip", async () => {
    signInAs("CUSTOMER");

    const waitingTracking = {
      orderId: ORDER_ID,
      status: "PAID",
      tripStatus: null,
      stopStatus: null,
      estimatedArrival: null,
      route: null,
      robotLocation: null,
      destination: null,
    };

    vi.mocked(getCustomerTracking).mockResolvedValue({
      ok: true,
      tracking: waitingTracking,
    });

    const response = await GET(request(), context());

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      tracking: waitingTracking,
    });
  });
});
