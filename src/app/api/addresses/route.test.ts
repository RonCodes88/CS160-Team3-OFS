import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { GET, POST } from "./route";
import { createAddress, listAddresses } from "@/lib/auth/addresses";
import { GeocodeError, geocodeAddress } from "@/lib/auth/geocode";
import { getSessionUser } from "@/lib/auth/session";

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({}) }));
vi.mock("@/lib/auth/session", () => ({ getSessionUser: vi.fn() }));
vi.mock("@/lib/auth/addresses", () => ({ createAddress: vi.fn(), listAddresses: vi.fn() }));
vi.mock("@/lib/auth/geocode", async (original) => ({
  ...(await original<typeof import("@/lib/auth/geocode")>()), geocodeAddress: vi.fn(),
}));

const SAVED = {
  id: "00000000-0000-4000-8000-000000000001", label: null, line1: "87 N San Pedro St", line2: null,
  city: "San Jose", state: "CA", postalCode: "95110", isDefault: true,
};
const BODY = { line1: "87 N San Pedro St", city: "San Jose", state: "CA", postalCode: "95110" };
const post = (body: unknown, contentType = "application/json") => POST(new NextRequest("http://localhost/api/addresses", {
  method: "POST", headers: { "content-type": contentType }, body: JSON.stringify(body),
}));
const get = () => GET(new NextRequest("http://localhost/api/addresses"));

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("OFS_STORE_LATITUDE", "37.3352");
  vi.stubEnv("OFS_STORE_LONGITUDE", "-121.8811");
  vi.stubEnv("OFS_DELIVERY_RADIUS_METERS", "5000");
  vi.mocked(getSessionUser).mockResolvedValue({ id: "customer", email: "c@example.test", role: "CUSTOMER" });
  vi.mocked(listAddresses).mockResolvedValue([SAVED]);
  vi.mocked(createAddress).mockResolvedValue({ ok: true, address: SAVED });
});

describe("GET /api/addresses", () => {
  it("lists the session customer's addresses", async () => {
    const response = await get();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ addresses: [SAVED] });
    expect(listAddresses).toHaveBeenCalledWith({}, "customer");
  });

  it("requires a customer session", async () => {
    vi.mocked(getSessionUser).mockResolvedValue(null);
    expect((await get()).status).toBe(401);
    vi.mocked(getSessionUser).mockResolvedValue({ id: "staff", email: "s@example.test", role: "EMPLOYEE" });
    expect((await get()).status).toBe(403);
    expect(listAddresses).not.toHaveBeenCalled();
  });
});

describe("POST /api/addresses", () => {
  it("saves for the session customer, ignoring client coordinates and IDs", async () => {
    const response = await post({ ...BODY, customerId: "other", latitude: 0, longitude: 0 });
    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ address: SAVED });
    const [, customerId, input, deps] = vi.mocked(createAddress).mock.calls[0];
    expect(customerId).toBe("customer");
    expect(input).not.toHaveProperty("latitude");
    // The route's service-area check uses the configured 5 km radius, inclusive.
    expect(deps.isDeliverable({ lat: 37.3361, lng: -121.8945 })).toBe(true);
    expect(deps.isDeliverable({ lat: 37.7749, lng: -122.4194 })).toBe(false);
    vi.mocked(geocodeAddress).mockResolvedValue(null);
    await deps.geocode("q");
    expect(geocodeAddress).toHaveBeenCalledWith("q");
  });

  it.each([
    ["NOT_FOUND", "ADDRESS_NOT_FOUND"],
    ["OUTSIDE_AREA", "ADDRESS_OUTSIDE_AREA"],
  ] as const)("returns 422 for %s", async (reason, code) => {
    vi.mocked(createAddress).mockResolvedValue({ ok: false, reason });
    const response = await post(BODY);
    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({ error: { code } });
  });

  it("validates input and requires JSON", async () => {
    expect((await post({ ...BODY, postalCode: "abc" })).status).toBe(400);
    expect((await post(BODY, "text/plain")).status).toBe(415);
    expect(createAddress).not.toHaveBeenCalled();
  });

  it("returns 503 when Mapbox or the service area is unavailable", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(createAddress).mockRejectedValue(new GeocodeError("TIMEOUT", "slow"));
    expect((await post(BODY)).status).toBe(503);
    vi.stubEnv("OFS_DELIVERY_RADIUS_METERS", "");
    expect((await post(BODY)).status).toBe(503);
  });

  it("rejects non-customers before reading the body", async () => {
    vi.mocked(getSessionUser).mockResolvedValue({ id: "m", email: "m@example.test", role: "MANAGER" });
    expect((await post(BODY)).status).toBe(403);
    expect(createAddress).not.toHaveBeenCalled();
  });
});
