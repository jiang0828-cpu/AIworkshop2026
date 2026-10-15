import { describe, expect, it } from "vitest";
import { isAuthorized, parseBasicAuth } from "./request-auth";

const expected = { email: "owner@example.com", password: "strong-password" };
const basic = (value: string) => `Basic ${btoa(value)}`;

describe("temporary Worker authentication", () => {
  it("parses a valid Basic Authentication header", () => {
    expect(parseBasicAuth(basic("owner@example.com:strong-password"))).toEqual(expected);
  });

  it("rejects missing, malformed, and incorrect credentials", () => {
    expect(isAuthorized(null, expected)).toBe(false);
    expect(isAuthorized("Bearer token", expected)).toBe(false);
    expect(isAuthorized(basic("owner@example.com:wrong"), expected)).toBe(false);
  });

  it("accepts only the configured email and password", () => {
    expect(isAuthorized(basic("owner@example.com:strong-password"), expected)).toBe(true);
  });
});
