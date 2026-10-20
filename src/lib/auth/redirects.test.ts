import { describe, expect, it } from "vitest";
import { homeFor, safeNextPath } from "./redirects";

describe("homeFor", () => {
  it("sends customers to the shop and staff to the dashboard", () => {
    expect(homeFor("CUSTOMER")).toBe("/shop");
    expect(homeFor("EMPLOYEE")).toBe("/staff");
    expect(homeFor("MANAGER")).toBe("/staff");
    expect(homeFor("VEHICLE")).toBe("/");
  });
});

describe("safeNextPath", () => {
  it("keeps same-site paths", () => {
    expect(safeNextPath("/cart")).toBe("/cart");
    expect(safeNextPath(["/shop?q=milk", "/x"])).toBe("/shop?q=milk");
  });

  it.each([undefined, "", "cart", "https://evil.test", "//evil.test", "/\\evil.test"])("drops %s", (next) => {
    expect(safeNextPath(next)).toBeNull();
  });
});
