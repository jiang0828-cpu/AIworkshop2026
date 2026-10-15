import { z } from "zod";
import { own, type StrategyDB } from "./service";
import { subjectType, type Scene } from "./shared";
import { callModel } from "../daily/provider";
import { dailyAIConfig } from "../daily/config";
import { PROFILE_ID } from "../db";
import { effectiveScene } from "./shared";
import { buildGoalDecomposition, generateGoalDecomposition, nextGoalHorizon } from "../ai-use";

const requestSchema = z.object({ mode: z.enum(["classify", "alignment", "analysis"]),
  records: z.array(z.object({ type: z.enum(["signal", "vision", ...subjectType.options]), id: z.string().min(1) })).min(1).max(20),
  allowSensitive: z.boolean().default(false), previewOnly: z.boolean().default(false) });
const responseSchema = z.object({ suggestions: z.array(z.object({ type: z.string().max(100), id: z.string().max(150), sceneId: z.string().nullable(),
  reason: z.string().max(5000), advice: z.string().max(10000) })).max(20) });
function protectText(text: string) { return text.replace(/\b1[3-9]\d{9}\b/g, "[手机号已脱敏]").replace(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/g, "[邮箱已脱敏]").replace(/\b\d{17}[\dXx]\b/g, "[证件号已脱敏]"); }
export async function strategyAnalysis(db: StrategyDB, input: unknown) {
  const body = requestSchema.parse(input);
  const scenes: Scene[] = await db.workbenchScene.findMany({ where: { profileId: PROFILE_ID } });
  const [goals, projects, tags] = await Promise.all([db.goal.findMany({ where: { profileId: PROFILE_ID } }), db.project.findMany({ where: { profileId: PROFILE_ID } }), db.strategyRecord.findMany({ where: { profileId: PROFILE_ID, kind: "tag" } })]);
  const records = [];
  for (const selected of body.records) {
    const row = await own(db, selected.type, selected.id);
    if (!row) throw new Error("资料记录不存在");
    const serialized = protectText(JSON.stringify(row));
    const scene = effectiveScene(row, goals, projects);
    const markedSensitive = scenes.some((item) => item.id === scene && item.slot !== 0) || tags.some((tag) => { const payload = JSON.parse(tag.payload); return payload.subjectId === selected.id && payload.subjectType === selected.type && payload.sceneIds.some((id: string) => scenes.some((item) => item.id === id && item.slot !== 0)); });
    if (!body.allowSensitive && (markedSensitive || /收入|工资|薪资|家庭|孩子|疾病|病史|健康|财务|资产|组织|公司/.test(serialized))) {
      records.push({ ...selected, content: "[包含敏感资料，未授权发送]" });
    } else records.push({ ...selected, content: serialized });
  }
  if (body.previewOnly) return { records, scenes, mode: body.mode };
  const result = await callModel(dailyAIConfig(), JSON.stringify({ mode: body.mode, records, scenes }),
    '仅根据选定资料分析，不联网、不代替用户决策，不声称已执行。输出 JSON {"suggestions":[{"type":"输入类型","id":"输入ID","sceneId":"输入场景ID或null","reason":"有依据的归类或对齐理由","advice":"建议及信息缺口"}]}。被隐藏的内容不得推断。没有证据明确说明，所有结果是待确认建议。', "", 120, true);
  const parsed = responseSchema.parse(JSON.parse(result.output.replace(/^```(?:json)?\s*|\s*```$/g, "")));
  for (const suggestion of parsed.suggestions) {
    if (!body.records.some((row) => row.id === suggestion.id && row.type === suggestion.type)) throw new Error("AI 返回未知记录");
    if (suggestion.sceneId && !scenes.some((scene) => scene.id === suggestion.sceneId)) throw new Error("AI 返回未知场景");
  }
  return { ...parsed, source: dailyAIConfig().model || "AI", pending: true };
}

export async function decompositionDraft(db: StrategyDB, input: unknown) {
  const body = z.object({ goalId: z.string().min(1), previewOnly: z.boolean().default(false), allowSensitive: z.boolean().default(false) }).parse(input);
  const parent = await db.goal.findFirst({ where: { id: body.goalId, profileId: PROFILE_ID } });
  if (!parent) throw new Error("目标不存在或不属于当前档案");
  const horizon = nextGoalHorizon(parent.horizon);
  if (!horizon) throw new Error("此目标已是最小时间层级");
  const preview = await strategyAnalysis(db, { mode: "analysis", records: [{ type: "goal", id: parent.id }], previewOnly: true, allowSensitive: body.allowSensitive });
  if (body.previewOnly) return preview;
  const content = "records" in preview ? preview.records?.[0].content || "" : "";
  if (content.startsWith("[包含敏感")) return { goals: buildGoalDecomposition({ title: "待补充目标", horizon: parent.horizon }, horizon).goals, source: "人工模板", warning: "敏感内容未发送，请手动补充分解草稿" };
  const result = await generateGoalDecomposition({ goal: JSON.parse(content), targetHorizon: horizon });
  return { goals: result.data.goals, source: result.source, warning: result.error || "确认前不会创建子目标" };
}
