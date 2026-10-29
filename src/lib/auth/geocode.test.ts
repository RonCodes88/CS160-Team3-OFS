import { describe, expect, it, vi } from "vitest";
import { GeocodeError, geocodeAddress } from "./geocode";

const feature = (overrides: object = {}) => ({
  geometry: { type: "Point", coordinates: [-121.8945, 37.3361] },
  properties: { feature_type: "address", match_code: { confidence: "exact" } },
  ...overrides,
});

const respond = (body: unknown, status = 200) =>
  vi.fn(async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;

describe("geocodeAddress", () => {
  it("returns the first address match and sends a US, address-only query biased to the store", async () => {
    const fetcher = respond({ features: [feature()] });
    expect(await geocodeAddress("87 N San Pedro St, San Jose, CA 95110", { accessToken: "pk.test", fetch: fetcher }))
      .toEqual({ lat: 37.3361, lng: -121.8945 });
    const url = vi.mocked(fetcher).mock.calls[0][0] as URL;
    expect(url.searchParams.get("q")).toBe("87 N San Pedro St, San Jose, CA 95110");
    expect(url.searchParams.get("country")).toBe("us");
    expect(url.searchParams.get("types")).toBe("address");
    expect(url.searchParams.get("proximity")).toBe("-121.8811,37.3352");
  });

  it.each([
    ["no features", { features: [] }],
    ["a non-address match", { features: [feature({ properties: { feature_type: "place" } })] }],
    ["a low-confidence match", { features: [feature({ properties: { feature_type: "address", match_code: { confidence: "low" } } })] }],
    ["bad coordinates", { features: [feature({ geometry: { coordinates: [500, 37] } })] }],
  ])("returns null for %s", async (_name, body) => {
    expect(await geocodeAddress("x", { accessToken: "pk.test", fetch: respond(body) })).toBeNull();
  });

  it.each([
    [401, "UNAUTHORIZED"],
    [403, "UNAUTHORIZED"],
    [429, "RATE_LIMITED"],
    [500, "PROVIDER_ERROR"],
  ])("maps HTTP %i to %s", async (status, code) => {
    await expect(geocodeAddress("x", { accessToken: "pk.test", fetch: respond({}, status) }))
      .rejects.toMatchObject({ code });
  });

  it("requires a token", async () => {
    await expect(geocodeAddress("x", { accessToken: "", fetch: respond({}) })).rejects.toMatchObject({ code: "NOT_CONFIGURED" });
  });

  it("reports timeouts and network failures without the token-bearing URL", async () => {
    const timeout = vi.fn(async () => { throw Object.assign(new Error("https://api.mapbox.com/?access_token=secret"), { name: "TimeoutError" }); });
    const error = await geocodeAddress("x", { accessToken: "secret", fetch: timeout as unknown as typeof fetch }).catch((e) => e);
    expect(error).toBeInstanceOf(GeocodeError);
    expect(error).toMatchObject({ code: "TIMEOUT" });
    expect(error.message).not.toContain("secret");

    const offline = vi.fn(async () => { throw new TypeError("fetch failed"); });
    await expect(geocodeAddress("x", { accessToken: "pk.test", fetch: offline as unknown as typeof fetch }))
      .rejects.toMatchObject({ code: "PROVIDER_ERROR" });
  });

  it("treats an unreadable body as a provider error", async () => {
    const fetcher = vi.fn(async () => new Response("not json")) as unknown as typeof fetch;
    await expect(geocodeAddress("x", { accessToken: "pk.test", fetch: fetcher })).rejects.toMatchObject({ code: "PROVIDER_ERROR" });
  });
});
