import { describe, expect, it } from "vitest";
import { profilePatchSchema, profileSchema } from "./schemas";

describe("profile partial updates", () => {
  it("preserves omitted fields and sensitive authorization", () => {
    const existing = profileSchema.parse({ name: "User", city: "City", sensitiveAiFields: '["organization"]' });
    const patch = profilePatchSchema.parse({ currentChallenges: "New challenge" });
    expect(patch).toEqual({ currentChallenges: "New challenge" });
    expect({ ...existing, ...patch }).toMatchObject({ name: "User", city: "City", sensitiveAiFields: '["organization"]', currentChallenges: "New challenge" });
  });

  it("allows explicit clearing but does not populate an empty patch", () => {
    expect(profilePatchSchema.parse({})).toEqual({});
    expect(profilePatchSchema.parse({ city: "", sensitiveAiFields: "[]" })).toEqual({ city: "", sensitiveAiFields: "[]" });
  });

  it("still validates submitted fields", () => {
    expect(profilePatchSchema.safeParse({ city: 1 }).success).toBe(false);
    expect(profilePatchSchema.safeParse({ sensitiveAiFields: '["password"]' }).success).toBe(false);
  });
});
