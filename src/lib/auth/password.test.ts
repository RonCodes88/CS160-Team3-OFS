import { describe, expect, it } from "vitest";
import { hashPassword, verifyAgainstDummy, verifyPassword } from "./password";

describe("password hashing", () => {
  it("stores an Argon2id hash, never the password", async () => {
    const hash = await hashPassword("correct horse");
    expect(hash).toMatch(/^\$argon2id\$/);
    expect(hash).not.toContain("correct horse");
  });

  it("salts each hash", async () => {
    expect(await hashPassword("same")).not.toBe(await hashPassword("same"));
  });

  it("verifies the right password only", async () => {
    const hash = await hashPassword("correct horse");
    expect(await verifyPassword(hash, "correct horse")).toBe(true);
    expect(await verifyPassword(hash, "Correct horse")).toBe(false);
  });

  it("returns false for a hash it can't read", async () => {
    expect(await verifyPassword("not-a-hash", "x")).toBe(false);
  });

  it("runs the dummy check without throwing", async () => {
    await expect(verifyAgainstDummy("x")).resolves.toBeUndefined();
  });
});
