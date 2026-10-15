import { shanghaiDate } from "./daily/shared";

export type ReviewPeriod = "weekly" | "monthly" | "yearly";
export const reviewPeriodLabels = { weekly: "周复盘", monthly: "月复盘", yearly: "年复盘" };
export type ReviewRange = { periodStart: string; periodEnd: string };

export function planReviewRanges(period: ReviewPeriod, now = new Date()) {
  const today = shanghaiDate(now);
  const current = period === "yearly" ? yearReviewRange(today.slice(0, 4)) : period === "monthly" ? monthReviewRange(today.slice(0, 7)) : weekReviewRange(now);
  const previousDay = new Date(`${current.periodStart}T00:00:00Z`);
  previousDay.setUTCDate(previousDay.getUTCDate() - 1);
  const previousDate = previousDay.toISOString().slice(0, 10);
  const previous = period === "yearly" ? yearReviewRange(previousDate.slice(0, 4)) : period === "monthly" ? monthReviewRange(previousDate.slice(0, 7)) : weekReviewRange(previousDay);
  return { current, previous };
}

export function deliveryInRange(value: unknown, range: ReviewRange) {
  const day = dateText(value);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return false;
  const parsed = new Date(`${day}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === day && day >= range.periodStart && day <= range.periodEnd;
}

export function yearReviewRange(year: string) {
  if (!/^\d{4}$/.test(year) || Number(year) < 1900) throw new Error("请选择有效的复盘年份");
  return { periodStart: `${year}-01-01`, periodEnd: `${year}-12-31` };
}

function dateText(value: unknown) {
  return value instanceof Date ? Number.isNaN(value.getTime()) ? "" : value.toISOString().slice(0, 10) : String(value || "").slice(0, 10);
}

export function reviewPeriod(review: { periodStart?: unknown; periodEnd?: unknown }): ReviewPeriod {
  const start = dateText(review.periodStart), end = dateText(review.periodEnd);
  if (/^\d{4}-01-01$/.test(start)) {
    try { if (yearReviewRange(start.slice(0, 4)).periodEnd === end) return "yearly"; } catch { /* Legacy ranges remain weekly. */ }
  }
  return isMonthlyReview(review) ? "monthly" : "weekly";
}

export function monthReviewRange(month: string) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month) || Number(month.slice(0, 4)) < 1900) throw new Error("请选择有效的复盘月份");
  const [year, number] = month.split("-").map(Number);
  const lastDay = new Date(Date.UTC(year, number, 0)).getUTCDate();
  return { periodStart: `${month}-01`, periodEnd: `${month}-${String(lastDay).padStart(2, "0")}` };
}

export function isMonthlyReview(review: { periodStart?: unknown; periodEnd?: unknown }) {
  const start = dateText(review.periodStart);
  const end = dateText(review.periodEnd);
  if (!/^\d{4}-\d{2}-01$/.test(start)) return false;
  try { return monthReviewRange(start.slice(0, 7)).periodEnd === end; } catch { return false; }
}

export function weekReviewRange(now = new Date()) {
  const date = new Date(`${shanghaiDate(now)}T00:00:00Z`);
  const day = date.getUTCDay();
  date.setUTCDate(date.getUTCDate() - (day === 0 ? 6 : day - 1));
  const periodStart = date.toISOString().slice(0, 10);
  date.setUTCDate(date.getUTCDate() + 6);
  return { periodStart, periodEnd: date.toISOString().slice(0, 10) };
}
