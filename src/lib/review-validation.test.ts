import { describe, expect, it } from "vitest";
import { parseEntity, validateEntityLinks } from "./strategy/entity";

describe("review date validation", () => {
  it("accepts monthly creation and partial content updates", async () => {
    const review = parseEntity("review", { periodStart: "2026-10-01", periodEnd: "2026-10-31", wins: "Completed" });
    await expect(validateEntityLinks({} as never, "review", review, null, false)).resolves.toBeUndefined();
    await expect(validateEntityLinks({} as never, "review", { wins: "Updated" }, review, false)).resolves.toBeUndefined();
  });
  it("rejects missing, invalid and reversed ranges", async () => {
    for (const review of [{}, { periodStart: "2026-10-31", periodEnd: "2026-10-01" }, { periodStart: "invalid", periodEnd: "2026-10-31" }]) {
      await expect(validateEntityLinks({} as never, "review", review, null, false)).rejects.toThrow("复盘日期");
    }
  });
});
