import { z } from "zod";
import { visionSchema } from "./shared";
import { atomic, type StrategyDB } from "./service";
import { PROFILE_ID } from "../db";
import { sceneCount } from "../scenes";

export const visionPlanSchema = z.object({ scenes: z.array(z.object({ sceneId: z.string().min(1), keywords: z.array(z.string().max(200000)).max(1000), reason: z.string().max(10000), payload: visionSchema })).min(1).max(sceneCount) });
export function normalizeVisionKeywords(value: unknown): string[] {
  const words: string[] = [];
  const visit = (item: unknown, depth = 0) => {
    if (depth > 4 || item == null) return;
    if (typeof item === "string") words.push(...item.split(/[、，,；;\n]+/).map((word) => word.trim()).filter(Boolean));
    else if (Array.isArray(item)) item.forEach((word) => visit(word, depth + 1));
    else if (typeof item === "object") {
      const row = item as Record<string, unknown>;
      const label = row.keyword ?? row.word ?? row.name ?? row.text ?? row.label ?? row.term;
      if (label !== undefined) visit(label, depth + 1);
      else Object.values(row).forEach((word) => visit(word, depth + 1));
    }
  };
  visit(value);
  return [...new Set(words)].slice(0, 1000);
}
// Normalize presentation differences only; never guess scene ownership or content.
export function parseVisionModelOutput(output: string, scenes: Array<{ id: string; name: string }>) {
  let input: unknown;
  try { input = JSON.parse(output.trim().replace(/^```(?:json)?\s*|\s*```$/g, "")); }
  catch { throw new Error("AI 返回的 JSON 不完整，请重新生成；现有愿景未修改"); }
  const object = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
  const text = (value: unknown): unknown => value == null ? "" : Array.isArray(value) && value.every((item) => typeof item === "string") ? value.join("\n") : value;
  const rows = Array.isArray(input) ? input : object(input).scenes;
  if (!Array.isArray(rows)) throw new Error("AI 未返回场景列表，请重新生成；现有愿景未修改");
  const normalized = rows.map((value) => {
    const row = object(value), payload = row.payload == null ? row : object(row.payload);
    const identifier = row.sceneId ?? row.sceneName;
    const match = scenes.find((scene) => scene.id === identifier) || scenes.find((scene) => scene.name === identifier);
    return { sceneId: match?.id || identifier,
      keywords: normalizeVisionKeywords(row.keywords),
      reason: text(row.reason), payload: Object.fromEntries(["expected", "mainGoals", "metric", "horizon", "boundary"].map((key) => [key, text(payload[key])])) };
  });
  try { return validateVisionPlan({ scenes: normalized }, scenes.map((scene) => scene.id)); }
  catch (error) {
    if (error instanceof z.ZodError) {
      const issue = error.issues[0];
      const index = typeof issue.path[1] === "number" ? issue.path[1] + 1 : null;
      throw new Error(`AI 草稿${index ? `第 ${index} 个场景` : ""}的${String(issue.path.at(-1) || "内容")}格式不符合要求，请重新生成；现有愿景未修改`);
    }
    throw error;
  }
}
export function validateVisionPlan(input: unknown, sceneIds: string[]) {
  const plan = visionPlanSchema.parse(input);
  if (plan.scenes.length !== sceneIds.length || new Set(plan.scenes.map((row) => row.sceneId)).size !== sceneIds.length || plan.scenes.some((row) => !sceneIds.includes(row.sceneId))) throw new Error("AI 返回的场景不完整或无效，请重试");
  return plan;
}
export const visionSaveSchema = z.object({ scenes: z.array(z.object({ sceneId: z.string().min(1), payload: visionSchema, previousId: z.string().nullable(), previousUpdatedAt: z.string().nullable() })).min(1).max(sceneCount) });
export async function saveVisionPlan(db: StrategyDB, input: unknown) {
  const { scenes } = visionSaveSchema.parse(input);
  if (new Set(scenes.map((row) => row.sceneId)).size !== scenes.length) throw new Error("场景不可重复");
  const allowed = await db.workbenchScene.findMany({ where: { profileId: PROFILE_ID } });
  const statements: Array<{ sql: string; values: Array<string | number | null> }> = [];
  for (const draft of scenes) {
    const scene = allowed.find((row) => row.id === draft.sceneId);
    if (!scene) throw new Error("场景不属于当前档案");
    if (!draft.payload.expected.trim()) throw new Error(`${scene.name}尚未填写期望状态，请补充或取消勾选`);
    const current = await db.strategyRecord.findFirst({ where: { profileId: PROFILE_ID, kind: "vision", sceneId: scene.id, archived: false } });
    const payload = JSON.stringify(draft.payload);
    if (current?.payload === payload) continue;
    if ((current?.id || null) !== draft.previousId || (current?.updatedAt.toISOString() || null) !== draft.previousUpdatedAt) throw new Error(`${scene.name}愿景已发生变化，请重新生成草稿后确认`);
    const id = current?.id || crypto.randomUUID(), now = Date.now(), title = current?.title || `${scene.name}愿景`;
    statements.push({ sql: 'INSERT INTO "StrategyRecord" ("id","profileId","kind","sceneId","title","payload","archived","createdAt","updatedAt") VALUES (?,?,?,?,?,?,?,?,?) ON CONFLICT("id") DO UPDATE SET "payload"=excluded."payload","updatedAt"=excluded."updatedAt"', values: [id, PROFILE_ID, "vision", scene.id, title, payload, 0, now, now] });
    statements.push({ sql: 'INSERT INTO "StrategyVersion" ("id","profileId","recordId","kind","snapshot","createdAt") VALUES (?,?,?,?,?,?)', values: [crypto.randomUUID(), PROFILE_ID, id, "vision", JSON.stringify({ id, kind: "vision", sceneId: scene.id, title, payload: draft.payload, archived: false }), now] });
  }
  await atomic(db, statements);
  return { saved: statements.length / 2 };
}
