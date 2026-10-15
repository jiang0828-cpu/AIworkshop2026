import { describe, expect, it } from "vitest";
import { isMonthlyReview, monthReviewRange, weekReviewRange, yearReviewRange, reviewPeriod, planReviewRanges, deliveryInRange } from "./review-period";

describe("review calendar periods", () => {
  it("classifies complete years separately from months and legacy periods", () => {
    expect(yearReviewRange("2026")).toEqual({ periodStart: "2026-01-01", periodEnd: "2026-12-31" });
    expect(reviewPeriod(yearReviewRange("2024"))).toBe("yearly");
    expect(reviewPeriod({ periodStart: new Date("2026-01-01"), periodEnd: new Date("2026-12-31") })).toBe("yearly");
    expect(reviewPeriod(monthReviewRange("2026-01"))).toBe("monthly");
    expect(reviewPeriod({ periodStart: "2026-01-01", periodEnd: "2026-01-07" })).toBe("weekly");
    expect(reviewPeriod({})).toBe("weekly");
    for (const year of ["0000", "1899", "26", "2026-01", "invalid"]) expect(() => yearReviewRange(year)).toThrow();
  });
  it("uses the complete natural month including leap years", () => {
    expect(monthReviewRange("2026-10")).toEqual({ periodStart: "2026-10-01", periodEnd: "2026-10-31" });
    expect(monthReviewRange("2024-02").periodEnd).toBe("2024-02-29");
    expect(monthReviewRange("2026-02").periodEnd).toBe("2026-02-28");
    expect(monthReviewRange("2026-04").periodEnd).toBe("2026-04-30");
    expect(monthReviewRange("2026-12").periodEnd).toBe("2026-12-31");
  });
  it("keeps legacy weekly and custom ranges out of monthly reviews", () => {
    expect(isMonthlyReview({ periodStart: "2026-08-24T00:00:00.000Z", periodEnd: "2026-08-30T00:00:00.000Z" })).toBe(false);
    expect(isMonthlyReview({ periodStart: "2026-10-01T00:00:00.000Z", periodEnd: "2026-10-31T00:00:00.000Z" })).toBe(true);
    expect(isMonthlyReview({ periodStart: "2026-10-01", periodEnd: "2026-11-01" })).toBe(false);
    expect(isMonthlyReview({})).toBe(false);
    expect(isMonthlyReview({ periodStart: new Date("2026-10-01"), periodEnd: new Date("2026-10-31") })).toBe(true);
  });
  it("rejects invalid months", () => {
    for (const month of ["2026-13", "2026-00", "2026-1", "bad", "0000-01"]) expect(() => monthReviewRange(month)).toThrow();
  });
  it("defaults weeks to Monday through Sunday in Shanghai", () => {
    expect(weekReviewRange(new Date("2026-10-04T15:59:59Z"))).toEqual({ periodStart: "2026-09-28", periodEnd: "2026-10-04" });
    expect(weekReviewRange(new Date("2026-10-04T16:00:00Z"))).toEqual({ periodStart: "2026-10-05", periodEnd: "2026-10-11" });
    expect(weekReviewRange(new Date("2026-01-01T00:00:00Z"))).toEqual({ periodStart: "2025-12-29", periodEnd: "2026-01-04" });
  });
  it("pairs current and previous weeks at the Shanghai Monday boundary", () => {
    expect(planReviewRanges("weekly", new Date("2026-10-04T15:59:59Z"))).toEqual({
      current: { periodStart: "2026-09-28", periodEnd: "2026-10-04" },
      previous: { periodStart: "2026-09-21", periodEnd: "2026-09-27" },
    });
    expect(planReviewRanges("weekly", new Date("2026-10-04T16:00:00Z"))).toEqual({
      current: { periodStart: "2026-10-05", periodEnd: "2026-10-11" },
      previous: { periodStart: "2026-09-28", periodEnd: "2026-10-04" },
    });
    expect(planReviewRanges("weekly", new Date("2026-01-01T00:00:00Z")).previous).toEqual({ periodStart: "2025-12-22", periodEnd: "2025-12-28" });
  });
  it("pairs natural months and years across year and leap boundaries", () => {
    expect(planReviewRanges("monthly", new Date("2025-12-31T16:00:00Z"))).toEqual({ current: monthReviewRange("2026-01"), previous: monthReviewRange("2025-12") });
    expect(planReviewRanges("monthly", new Date("2024-03-01T00:00:00Z")).previous).toEqual(monthReviewRange("2024-02"));
    expect(planReviewRanges("yearly", new Date("2025-12-31T16:00:00Z"))).toEqual({ current: yearReviewRange("2026"), previous: yearReviewRange("2025") });
  });
  it("includes both delivery boundaries and excludes missing or invalid dates", () => {
    const range = monthReviewRange("2026-10");
    for (const value of ["2026-10-01", "2026-10-31T00:00:00.000Z", new Date("2026-10-15")]) expect(deliveryInRange(value, range)).toBe(true);
    for (const value of [null, undefined, "", "bad", "2026-09-30", "2026-11-01", "2026-10-32", new Date("bad")]) expect(deliveryInRange(value, range)).toBe(false);
    expect(deliveryInRange("2026-02-30", monthReviewRange("2026-03"))).toBe(false);
  });
});
