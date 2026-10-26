import { describe, expect, it } from "vitest";
import { hashAdminPassword, verifyAdminPassword } from "./admin-auth";

describe("Worker administrator password hashing", () => {
  it("uses the production Worker iteration limit and a fresh random salt", async () => {
    const first = await hashAdminPassword("test-password-only");
    const second = await hashAdminPassword("test-password-only");
    expect(first.split("$").slice(0, 2)).toEqual(["pbkdf2-sha256", "100000"]);
    expect(first).not.toBe(second);
    expect(await verifyAdminPassword("test-password-only", first)).toBe(true);
    expect(await verifyAdminPassword("incorrect", first)).toBe(false);
  });

  it("rejects malformed hashes and weaker iteration counts", async () => {
    for (const encoded of ["", "invalid", "pbkdf2-sha256$99999$AAAA$AAAA", "pbkdf2-sha256$NaN$AAAA$AAAA", "other$100000$AAAA$AAAA"]) {
      expect(await verifyAdminPassword("test-password-only", encoded)).toBe(false);
    }
  });
});
