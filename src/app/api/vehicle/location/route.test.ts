import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PATCH } from "./route";
import { getSessionUser, type Role } from "@/lib/auth/session";
import { updateVehicleLocation } from "@/lib/vehicle/locationService";

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: vi.fn(() => ({})),
}));

vi.mock("@/lib/auth/session", () => ({
  getSessionUser: vi.fn(),
}));

vi.mock("@/lib/vehicle/locationService", () => ({
  updateVehicleLocation: vi.fn(),
}));

const USER_ID = "11111111-1111-4111-8111-111111111111";

const valid = {
  latitude: 37.3349,
  longitude: -121.8881,
  batteryPercent: 85,
};

function signInAs(role: Role | null) {
  vi.mocked(getSessionUser).mockResolvedValue(
    role ? { id: USER_ID, email: "vehicle@ofs.test", role } : null,
  );
}

function request(body: unknown) {
  return new NextRequest("http://localhost/api/vehicle/location", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(updateVehicleLocation).mockResolvedValue(null);
});

describe("PATCH /api/vehicle/location", () => {
  it("returns 401 without a session", async () => {
    signInAs(null);

    const response = await PATCH(request(valid));

    expect(response.status).toBe(401);
    expect(updateVehicleLocation).not.toHaveBeenCalled();
  });

  it.each<Role>(["CUSTOMER", "EMPLOYEE", "MANAGER"])(
    "returns 403 for %s",
    async (role) => {
      signInAs(role);

      const response = await PATCH(request(valid));

      expect(response.status).toBe(403);
      expect(updateVehicleLocation).not.toHaveBeenCalled();
    },
  );

  it.each([
    { ...valid, latitude: 91 },
    { ...valid, longitude: -181 },
    { ...valid, batteryPercent: 101 },
    { ...valid, batteryPercent: 50.5 },
  ])("returns 400 for invalid input: %j", async (body) => {
    signInAs("VEHICLE");

    const response = await PATCH(request(body));

    expect(response.status).toBe(400);
    expect(updateVehicleLocation).not.toHaveBeenCalled();
  });

  it("returns 400 for malformed JSON", async () => {
    signInAs("VEHICLE");

    const badRequest = new NextRequest(
      "http://localhost/api/vehicle/location",
      {
        method: "PATCH",
        body: "{invalid",
      },
    );

    const response = await PATCH(badRequest);

    expect(response.status).toBe(400);
    expect(updateVehicleLocation).not.toHaveBeenCalled();
  });

  it("updates the signed-in vehicle's location", async () => {
    signInAs("VEHICLE");

    const updated = {
      ...valid,
      updatedAt: "2026-11-10T15:00:00.000Z",
    };

    vi.mocked(updateVehicleLocation).mockResolvedValue(updated);

    const response = await PATCH(request(valid));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ location: updated });
    expect(updateVehicleLocation).toHaveBeenCalledWith(
      expect.anything(),
      USER_ID,
      valid,
    );
  });

  it("ignores vehicle IDs supplied in the body", async () => {
    signInAs("VEHICLE");

    await PATCH(request({
      ...valid,
      vehicleId: "another-vehicle",
      userId: "another-user",
    }));

    expect(updateVehicleLocation).toHaveBeenCalledWith(
      expect.anything(),
      USER_ID,
      valid,
    );
  });

  it("returns 404 when the vehicle record does not exist", async () => {
    signInAs("VEHICLE");

    const response = await PATCH(request(valid));

    expect(response.status).toBe(404);
  });
});
