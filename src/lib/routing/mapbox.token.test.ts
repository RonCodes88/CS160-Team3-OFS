import { describe, expect, it } from "vitest";
import { fetchTripRoute } from "./mapbox";

// Uses the real SDK: it rejects a malformed token while building the client,
// before any request is sent, so this runs offline.
describe("fetchTripRoute with a malformed token", () => {
  it("reports NOT_CONFIGURED instead of the SDK's raw error", async () => {
    const err = await fetchTripRoute({ stops: [{ lat: 37.3361, lng: -121.8945 }] }, { accessToken: "pk.invalid" }).catch(
      (e) => e,
    );
    expect(err).toMatchObject({ name: "RoutingError", code: "NOT_CONFIGURED" });
  });
});
