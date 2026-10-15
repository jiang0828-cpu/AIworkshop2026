import { z } from "zod";
import { shanghaiDate } from "../daily/shared";

export const resourceClasses = [
  { name: "身心", element: "能量" }, { name: "时间", element: "能量" },
  { name: "财务", element: "物质" }, { name: "实物", element: "物质" },
  { name: "知识", element: "信息" }, { name: "关系", element: "信息" },
] as const;
export const capitalClassSchema = z.enum(["待分类", "身心", "时间", "财务", "实物", "知识", "关系"]);
export const resourceImportanceSchema = z.enum(["待确认", "关键", "重要", "一般"]);
export const resourceAvailabilitySchema = z.enum(["待确认", "待获取", "可用", "受限", "不可用"]);
const text = z.string().trim().max(10000).default("");
export const resourceEvaluationSchema = z.object({
  actionId: z.string().min(1), reviewId: z.string().min(1), reviewVersion: z.string().datetime(),
  evaluatedAt: z.string().datetime(), actualInvestment: text, actualReturn: text,
  observation: text, adjustment: z.enum(["继续", "改进", "暂停", "重新配置"]),
});
export const resourceLedgerSchema = z.object({
  element: z.enum(["待分类", "能量", "物质", "信息"]).default("待分类"),
  capitalClass: capitalClassSchema.default("待分类"), importance: resourceImportanceSchema.default("待确认"),
  availability: resourceAvailabilitySchema.default("待确认"),
  available: text, allocation: text, boundary: text, expectedReturn: text, actualReturn: text,
  actualInvestment: text, observation: text,
  adjustment: z.enum(["待复盘", "继续", "改进", "暂停", "重新配置"]).default("待复盘"),
  nextStep: text, nextCheckDate: z.string().date().nullable().default(null),
  lastEvaluation: resourceEvaluationSchema.nullable().default(null),
}).transform((row) => ({ ...row, element: resourceClasses.find((item) => item.name === row.capitalClass)?.element || row.element }));
export type ResourceLedger = z.infer<typeof resourceLedgerSchema>;
export function readResourceLedger(payload: unknown, category = "") {
  const result = resourceLedgerSchema.parse(payload || {});
  if (result.availability === "待确认" && category === "待获取需求") result.availability = "待获取";
  return result;
}
export function resourceDue(ledger: ResourceLedger, date = shanghaiDate()) {
  return Boolean(ledger.nextCheckDate && ledger.nextCheckDate <= date);
}
export function compareResources(a: { name: string; ledger: ResourceLedger }, b: { name: string; ledger: ResourceLedger }, date = shanghaiDate()) {
  const rank = (row: ResourceLedger) => resourceDue(row, date) ? 0 : ["待获取", "不可用"].includes(row.availability) ? 1 : 2;
  const importance = ["关键", "重要", "一般", "待确认"];
  return rank(a.ledger) - rank(b.ledger) || importance.indexOf(a.ledger.importance) - importance.indexOf(b.ledger.importance) || a.name.localeCompare(b.name, "zh-CN");
}
export function resourceSummary(ledger: ResourceLedger) {
  return `分类：${ledger.element}／${ledger.capitalClass}；重要性：${ledger.importance}；可用状态：${ledger.availability}；存量：${ledger.available || "待确认"}；计划投入：${ledger.allocation || "待确认"}；预期产出：${ledger.expectedReturn || "待确认"}；边界：${ledger.boundary || "待确认"}；实际投入：${ledger.actualInvestment || "待确认"}；实际产出：${ledger.actualReturn || "待确认"}；可用情况：${ledger.observation || "待确认"}；结论：${ledger.adjustment}；下一步：${ledger.nextStep || "待确认"}；下次检查：${ledger.nextCheckDate || "未安排"}`;
}
