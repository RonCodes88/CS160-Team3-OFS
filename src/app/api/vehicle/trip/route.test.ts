import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "./route";
import { getSessionUser, type Role } from "@/lib/auth/session";
import { getAssignedTripForVehicle } from "@/lib/vehicle/assignedTrip";

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: vi.fn(() => ({})),
}));

vi.mock("@/lib/auth/session", () => ({
  getSessionUser: vi.fn(),
}));

vi.mock("@/lib/vehicle/assignedTrip", () => ({
  getAssignedTripForVehicle: vi.fn(),
}));

const USER_ID = "11111111-1111-4111-8111-111111111111";

function signInAs(role: Role | null) {
  vi.mocked(getSessionUser).mockResolvedValue(
    role ? { id: USER_ID, email: "vehicle@ofs.test", role } : null,
  );
}

function request() {
  return new NextRequest("http://localhost/api/vehicle/trip");
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getAssignedTripForVehicle).mockResolvedValue(null);
});

describe("GET /api/vehicle/trip", () => {
  it("returns 401 without a session", async () => {
    signInAs(null);

    const response = await GET(request());

    expect(response.status).toBe(401);
    expect(getAssignedTripForVehicle).not.toHaveBeenCalled();
  });

  it.each<Role>(["CUSTOMER", "EMPLOYEE", "MANAGER"])(
    "returns 403 for %s",
    async (role) => {
      signInAs(role);

      const response = await GET(request());

      expect(response.status).toBe(403);
      expect(getAssignedTripForVehicle).not.toHaveBeenCalled();
    },
  );

  it("returns null when no trip is assigned", async () => {
    signInAs("VEHICLE");

    const response = await GET(request());

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ trip: null });
    expect(getAssignedTripForVehicle).toHaveBeenCalledWith(
      expect.anything(),
      USER_ID,
    );
  });

  it("returns the vehicle's assigned trip and ordered stops", async () => {
    signInAs("VEHICLE");

    const trip = {
      id: "22222222-2222-4222-8222-222222222222",
      status: "ROUTED",
      routeGeometry: {
        type: "LineString",
        coordinates: [[-121.89, 37.33], [-121.88, 37.34]],
      },
      stops: [
        {
          id: "stop-1",
          orderId: "order-1",
          stopSequence: 1,
          status: "PENDING",
          estimatedArrival: "2026-11-04T12:00:00.000Z",
          location: { lat: 37.33, lng: -121.89 },
        },
        {
          id: "stop-2",
          orderId: "order-2",
          stopSequence: 2,
          status: "PENDING",
          estimatedArrival: "2026-11-04T12:15:00.000Z",
          location: { lat: 37.34, lng: -121.88 },
        },
      ],
    };

    vi.mocked(getAssignedTripForVehicle).mockResolvedValue(trip);

    const response = await GET(request());

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ trip });
    expect(getAssignedTripForVehicle).toHaveBeenCalledWith(
      expect.anything(),
      USER_ID,
    );
  });
});
