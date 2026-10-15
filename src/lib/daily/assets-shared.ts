import { z } from "zod";

export const assetSchema = z.object({
  kind: z.enum(["tool", "skill"]), name: z.string().trim().min(1).max(100),
  description: z.string().max(1000).default(""), instructions: z.string().max(4000).default(""),
  adapter: z.enum(["text-model", "task-context", "guidance", "unavailable"]).default("guidance"),
  enabled: z.boolean().default(true),
}).refine((asset) => asset.kind !== "skill" || asset.adapter === "guidance", "Skill 使用流程指引类型")
  .refine((asset) => asset.adapter !== "guidance" || Boolean(asset.instructions.trim()), "请填写流程或操作指引");
export type AssetDraft = z.infer<typeof assetSchema>;
export type AssetView = AssetDraft & { id: string; builtin: boolean };
export const defaultToolIds = ["local-profile:tool:text", "local-profile:tool:context"];
const snapshotSchema = z.array(z.object({ id: z.string(), kind: z.enum(["tool", "skill"]), name: z.string().max(100), instructions: z.string().max(4000), adapter: z.string().max(100) })).max(40);
export const bindingsSchema = z.object({
  toolIds: z.array(z.string().min(1).max(200)).max(20).default(defaultToolIds),
  skillIds: z.array(z.string().min(1).max(200)).max(20).default([]),
  snapshot: snapshotSchema.optional(),
}).refine((value) => new Set([...value.toolIds, ...value.skillIds]).size === value.toolIds.length + value.skillIds.length, "绑定项不能重复");
export function readBindings(value?: string) { return bindingsSchema.parse(JSON.parse(value || "{}")); }
export const capabilitiesSchema = z.string().max(200000).default("{}").superRefine((value, context) => {
  try { readBindings(value); } catch { context.addIssue({ code: "custom", message: "Tool / Skill 绑定配置无效" }); }
});
