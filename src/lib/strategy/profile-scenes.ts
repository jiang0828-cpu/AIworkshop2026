import { z } from "zod";
import { sceneCount } from "../scenes";
import { profileSchema } from "../schemas";
import { sceneDetailKeys } from "./profile-scene-layout";

export const profileGroups = [
  { title: "当前身份", fields: [
    ["industry", "行业"], ["organization", "公司 / 组织"], ["employmentStatus", "职业状态"],
    ["jobTitle", "职位 / 头衔"], ["roles", "当前角色"], ["responsibilities", "主要职责"], ["professionalFocus", "专业重点"],
  ] },
  { title: "人生阶段", fields: [
    ["stage", "当前阶段"], ["stageTransition", "阶段变化背景"], ["currentPriorities", "当前优先事项"],
    ["stageNeeds", "阶段诉求"], ["currentChallenges", "当前困难"], ["directionOneToThreeYears", "未来 1-3 年方向"], ["successDefinition", "成功状态的定义"],
  ] },
  { title: "现实情况", fields: [
    ["familyResponsibilities", "家庭责任"], ["healthEnergy", "健康 / 精力状态"], ["incomeRange", "收入范围"],
    ["financialPressure", "财务压力"], ["behaviorPatterns", "行为模式"], ["riskPreference", "风险偏好"],
  ] },
] as const;

const legacyProfileSceneSchema = profileSchema.pick({
  industry: true, organization: true, employmentStatus: true, jobTitle: true, roles: true, responsibilities: true, professionalFocus: true,
  stage: true, stageTransition: true, currentPriorities: true, stageNeeds: true, currentChallenges: true, directionOneToThreeYears: true, successDefinition: true,
  familyResponsibilities: true, healthEnergy: true, incomeRange: true, financialPressure: true, behaviorPatterns: true, riskPreference: true,
}).strict();
export const profileSceneSchema = legacyProfileSceneSchema.extend({ sceneDetails: z.record(z.enum(sceneDetailKeys), z.string().trim().max(5000)).optional() });
export type ProfileSceneFields = z.infer<typeof profileSceneSchema>;
export const profileScenesSaveSchema = z.object({
  global: legacyProfileSceneSchema.extend({ sensitiveAiFields: profileSchema.shape.sensitiveAiFields }).partial().optional(),
  scenes: z.array(z.object({ sceneId: z.string().min(1).max(150), fields: profileSceneSchema })).max(sceneCount),
}).refine(input => new Set(input.scenes.map(row => row.sceneId)).size === input.scenes.length, "场景不能重复");
export function profileSceneFields(value: Record<string, unknown>): ProfileSceneFields {
  return profileSceneSchema.parse({ ...Object.fromEntries(profileGroups.flatMap(group => group.fields.map(([key]) => [key, value[key] ?? ""]))), ...(value.sceneDetails !== undefined ? { sceneDetails: value.sceneDetails } : {}) });
}
