import { describe, expect, it } from "vitest";
import { formatAddressLine, parseAddressInput } from "./addressValidation";

const VALID = { line1: "87 N San Pedro St", city: "San Jose", state: "ca", postalCode: "95110" };

describe("parseAddressInput", () => {
  it("normalizes text and copies only address fields", () => {
    const parsed = parseAddressInput({
      ...VALID, line1: "  87  N San Pedro St ", line2: " ", label: "Home",
      latitude: 0, longitude: 0, customerId: "someone-else", isDefault: true,
    });
    expect(parsed).toEqual({ ok: true, value: {
      label: "Home", line1: "87 N San Pedro St", line2: null, city: "San Jose", state: "CA", postalCode: "95110",
    } });
  });

  it("accepts ZIP+4", () => {
    expect(parseAddressInput({ ...VALID, postalCode: "95110-1234" }).ok).toBe(true);
  });

  it.each([
    [null, "JSON object"],
    [[], "JSON object"],
    [{ ...VALID, line1: "" }, "street address"],
    [{ ...VALID, city: undefined }, "city"],
    [{ ...VALID, state: "California" }, "two-letter state"],
    [{ ...VALID, state: "C1" }, "two-letter state"],
    [{ ...VALID, postalCode: "9511" }, "ZIP"],
    [{ ...VALID, postalCode: "95110a" }, "ZIP"],
    [{ ...VALID, line1: 87 }, "must be text"],
    [{ ...VALID, line2: "x".repeat(121) }, "at most 120"],
  ])("rejects %j", (body, message) => {
    const parsed = parseAddressInput(body);
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.message).toContain(message);
  });
});

describe("formatAddressLine", () => {
  it("joins the parts, with an optional second line", () => {
    const address = { line1: "87 N San Pedro St", line2: null, city: "San Jose", state: "CA", postalCode: "95110" };
    expect(formatAddressLine(address)).toBe("87 N San Pedro St, San Jose, CA 95110");
    expect(formatAddressLine({ ...address, line2: "Apt 4" })).toBe("87 N San Pedro St Apt 4, San Jose, CA 95110");
  });
});
