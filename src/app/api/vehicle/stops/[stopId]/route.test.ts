import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PATCH } from "./route";
import { getSessionUser, type Role } from "@/lib/auth/session";
import { updateDeliveryStopStatus } from "@/lib/vehicle/stopStatusService";
import { sendNotificationsAfterResponse } from "@/lib/notifications/service";

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: vi.fn(() => ({})),
}));

vi.mock("@/lib/auth/session", () => ({
  getSessionUser: vi.fn(),
}));

vi.mock("@/lib/vehicle/stopStatusService", () => ({
  updateDeliveryStopStatus: vi.fn(),
}));

vi.mock("@/lib/notifications/service", () => ({
  sendNotificationsAfterResponse: vi.fn(),
}));

const USER_ID = "11111111-1111-4111-8111-111111111111";
const STOP_ID = "22222222-2222-4222-8222-222222222222";

function signInAs(role: Role | null) {
  vi.mocked(getSessionUser).mockResolvedValue(
    role ? { id: USER_ID, email: "vehicle@ofs.test", role } : null,
  );
}

function request(body: unknown) {
  return new NextRequest("http://localhost/api/vehicle/stops/" + STOP_ID, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function context(stopId = STOP_ID) {
  return { params: Promise.resolve({ stopId }) };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(updateDeliveryStopStatus).mockResolvedValue({
    ok: false,
    reason: "NOT_FOUND",
  });
});

describe("PATCH /api/vehicle/stops/[stopId]", () => {
  it("returns 401 without a session", async () => {
    signInAs(null);

    const response = await PATCH(request({ status: "ARRIVED" }), context());

    expect(response.status).toBe(401);
    expect(updateDeliveryStopStatus).not.toHaveBeenCalled();
  });

  it.each<Role>(["CUSTOMER", "EMPLOYEE", "MANAGER"])(
    "returns 403 for %s",
    async (role) => {
      signInAs(role);

      const response = await PATCH(request({ status: "ARRIVED" }), context());

      expect(response.status).toBe(403);
      expect(updateDeliveryStopStatus).not.toHaveBeenCalled();
    },
  );

  it("rejects an invalid stop ID", async () => {
    signInAs("VEHICLE");

    const response = await PATCH(
      request({ status: "ARRIVED" }),
      context("not-a-uuid"),
    );

    expect(response.status).toBe(400);
    expect(updateDeliveryStopStatus).not.toHaveBeenCalled();
  });

  it.each(["PENDING", "EN_ROUTE", "FAILED", "arrived", "", null, 42])(
    "rejects invalid target status %j",
    async (status) => {
      signInAs("VEHICLE");

      const response = await PATCH(request({ status }), context());

      expect(response.status).toBe(400);
      expect(updateDeliveryStopStatus).not.toHaveBeenCalled();
    },
  );

  it("rejects malformed JSON", async () => {
    signInAs("VEHICLE");

    const badRequest = new NextRequest("http://localhost/api/vehicle/stops/" + STOP_ID, {
      method: "PATCH",
      body: "{invalid",
    });

    const response = await PATCH(badRequest, context());

    expect(response.status).toBe(400);
    expect(updateDeliveryStopStatus).not.toHaveBeenCalled();
  });

  it.each(["ARRIVED", "DELIVERED"] as const)(
    "updates a stop to %s",
    async (status) => {
      signInAs("VEHICLE");

      const result = {
        ok: true as const,
        stop: { id: STOP_ID, status },
        tripCompleted: status === "DELIVERED",
      };

      vi.mocked(updateDeliveryStopStatus).mockResolvedValue(result);

      const response = await PATCH(request({ status }), context());

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({
        stop: result.stop,
        tripCompleted: result.tripCompleted,
      });
      expect(updateDeliveryStopStatus).toHaveBeenCalledWith(
        expect.anything(),
        USER_ID,
        STOP_ID,
        status,
      );
      expect(sendNotificationsAfterResponse).toHaveBeenCalledOnce();
    },
  );

  it("returns 404 for a stop not assigned to the vehicle", async () => {
    signInAs("VEHICLE");

    const response = await PATCH(request({ status: "ARRIVED" }), context());

    expect(response.status).toBe(404);
    expect(sendNotificationsAfterResponse).not.toHaveBeenCalled();
  });

  it("returns 409 for an invalid status transition", async () => {
    signInAs("VEHICLE");
    vi.mocked(updateDeliveryStopStatus).mockResolvedValue({
      ok: false,
      reason: "INVALID_TRANSITION",
    });

    const response = await PATCH(request({ status: "DELIVERED" }), context());

    expect(response.status).toBe(409);
    expect(sendNotificationsAfterResponse).not.toHaveBeenCalled();
  });
});
