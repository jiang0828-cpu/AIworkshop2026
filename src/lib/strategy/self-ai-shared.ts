import { z } from "zod";
import { sceneCount } from "../scenes";

export const selfAIFields: Record<string, Record<string, string>> = {
  profile: { personalityTraits: "性格特征", stage: "当前阶段", roles: "主要角色", currentPriorities: "优先事项", professionalFocus: "专业方向", stageNeeds: "阶段诉求", currentChallenges: "当前困难", directionOneToThreeYears: "未来方向" },
  overallVision: { expected: "总体期望", boundary: "重要底线" },
  vision: { expected: "期望状态", mainGoals: "主要目标", metric: "衡量标准", horizon: "时间范围", boundary: "底线" },
  skill: { improvement: "待提升项与下一步" },
  experience: { title: "标题", description: "做了什么与结果", learning: "收获" },
  evidence: { ability: "能力", evidence: "证据" },
  valueRule: { value: "价值", rule: "取舍规则", conflict: "冲突" },
  resource: { name: "资源名称", description: "可用条件与限制" },
  constraint: { name: "约束名称", description: "约束说明" },
  assumption: { statement: "假设", evidence: "已有证据" },
};
export const selfAIRequest = z.object({ type: z.enum(["profile", "overallVision", "vision", "skill", "experience", "evidence", "valueRule", "resource", "constraint", "assumption"]), id: z.string().min(1).max(150), mode: z.enum(["classify", "organize", "complete", "reflect"]), instruction: z.string().max(10000).default(""), allowSensitive: z.boolean().default(false), previewOnly: z.boolean().default(false) });
export const selfAIResponse = z.object({ fields: z.record(z.string().max(10000)), sceneIds: z.array(z.string().min(1)).max(sceneCount), explanation: z.string().max(10000), questions: z.array(z.string().max(2000)).max(8) });
export function validateSelfAI(value: unknown, type: string, mode: string, scenes: string[]) {
  const result = selfAIResponse.parse(value);
  if (Object.keys(result.fields).some((key) => !Object.hasOwn(selfAIFields[type] || {}, key))) throw new Error("AI 返回了不支持的字段");
  if (result.sceneIds.some((id) => !scenes.includes(id)) || new Set(result.sceneIds).size !== result.sceneIds.length) throw new Error("AI 返回了无效场景");
  if (["vision", "skill"].includes(type) && result.sceneIds.length > 1) throw new Error("此记录只能选择一个主场景");
  if (mode === "reflect") { result.fields = {}; result.sceneIds = []; }
  if (mode === "classify") result.fields = {};
  return result;
}
