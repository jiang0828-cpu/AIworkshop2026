import { z } from "zod";
import { capitalClassSchema, resourceClasses } from "./resource-shared";
const text = z.string().max(5000);
export const capabilityPlanSchema = z.object({ summary: text, capabilities: z.array(z.object({ title: z.string().min(1).max(300), visionId: z.string().min(1), layer: z.enum(["待分类", "底层自我管理", "中层杠杆能力", "高层专业能力"]).default("待分类"), method: z.enum(["待选择", "实战", "拜师", "阅读", "工具", "组合"]).default("待选择"), gap: text.default(""), resourceNeeds: text.default(""), successCriteria: text.default(""), reason: text, importance: z.enum(["关键", "重要", "一般"]).default("重要"), importanceReason: text.default("请根据愿景影响、前置依赖和近期需要手动确认"), requirements: text, channels: text, plan: text, project: z.object({ name: z.string().min(1).max(300), description: text, metric: text }), tasks: z.array(z.object({ title: z.string().min(1).max(300), standard: text, executor: z.enum(["人工", "AI", "混合"]), dependency: text })).max(6) })).min(1).max(8) });
export function parseCapabilityPlan(output: string, ids: string[]) {
  const result = capabilityPlanSchema.parse(JSON.parse(output.trim().replace(/^```(?:json)?\s*|\s*```$/g, "")));
  if (result.capabilities.some((row) => !ids.includes(row.visionId))) throw new Error("AI 引用了未选择的愿景");
  return result;
}

export const inventoryRefSchema = z.object({ type: z.enum(["skill", "evidence", "resource"]), id: z.string().min(1).max(150) });
const matching = { match: inventoryRefSchema.nullable().default(null), matchReason: text.default("未找到可确认的已有记录"), timing: text.default("时间待确认") };
export const resourceDemandSchema = z.object({ title: z.string().trim().min(1).max(300), visionId: z.string().min(1), reason: text, requirements: text, importance: z.enum(["关键", "重要", "一般"]), element: z.enum(["能量", "物质", "信息"]), capitalClass: capitalClassSchema.default("待分类"), allocation: text, boundary: text, expectedReturn: text, nextStep: text, ...matching }).transform((row) => ({ ...row, element: resourceClasses.find((item) => item.name === row.capitalClass)?.element || row.element }));
export const demandSkillSchema = capabilityPlanSchema.shape.capabilities.element.extend(matching);
export const requirementsPlanSchema = z.object({ summary: text, capabilities: z.array(demandSkillSchema).max(8), resources: z.array(resourceDemandSchema).max(12), cleanup: z.array(z.object({ target: inventoryRefSchema, reason: text.min(1), suggestion: z.enum(["重复待核对", "本轮暂不需要"]) })).max(20) });
export function parseRequirementsPlan(output: string, ids: string[], inventory: z.infer<typeof inventoryRefSchema>[]) {
  const result = requirementsPlanSchema.parse(JSON.parse(output.trim().replace(/^```(?:json)?\s*|\s*```$/g, "")));
  const known = (ref: z.infer<typeof inventoryRefSchema>) => inventory.some((row) => row.type === ref.type && row.id === ref.id);
  for (const row of [...result.capabilities, ...result.resources]) {
    if (!ids.includes(row.visionId)) throw new Error("AI 引用了未选择的愿景");
    if (row.match && !known(row.match)) throw new Error("AI 匹配了未提供的记录");
  }
  if (result.capabilities.some((row) => row.match?.type === "resource") || result.resources.some((row) => row.match && row.match.type !== "resource")) throw new Error("AI 匹配类型不一致");
  if (result.cleanup.some((row) => !known(row.target))) throw new Error("清理建议引用了未提供的记录");
  return result;
}
