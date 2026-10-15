import { z } from "zod";
import { radarSchema, feedbackSchema } from "./radar";

export const backgroundSchema = z.object({ id: z.string(), type: z.string(), title: z.string(), content: z.string().max(12000), sensitive: z.boolean() });
export const sourceSchema = z.object({ id: z.string().min(1), title: z.string().max(500), url: z.string().max(2000).nullable(), publisher: z.string().max(300), publishedAt: z.string().date().nullable(), collectedAt: z.string().datetime(), content: z.string().max(16000), quality: z.enum(["text", "snippet", "manual", "pending", "failed"]), group: z.string().max(500), original: z.boolean().default(false), note: z.string().max(1000).default("") });
export const conclusionSchema = z.object({ title: z.string().trim().min(1).max(300), facts: z.string().trim().min(1).max(4000), relevance: z.string().max(4000), nextStep: z.string().max(2000),
  backgroundIds: z.array(z.string()).max(20), citations: z.array(z.object({ sourceId: z.string(), quote: z.string().trim().min(1).max(1200) })).max(15),
  evidence: z.enum(["原始来源支持", "多源一致", "单一来源", "存在分歧", "资料不足"]), uncertainty: z.string().max(3000),
  change: z.enum(["新增", "变化", "仍待核实", "延续"]).default("新增"), radar: radarSchema.optional(), feedback: feedbackSchema.optional() });
export const analysisSchema = z.object({ conclusions: z.array(conclusionSchema).max(5), gaps: z.string().max(8000), changes: z.string().max(8000) });
export type Source = z.infer<typeof sourceSchema>;
export type Conclusion = z.infer<typeof conclusionSchema>;
export type Background = z.infer<typeof backgroundSchema>;
export type ResearchView = { id: string; sceneId: string | null; question: string; background: Background[]; queries: string[]; days: number; online: boolean; previousId: string | null; status: string; phase: number; version: number; sources: Source[]; conclusions: Conclusion[]; gaps: string; changes: string; error: string; followUpDate: string | null; createdAt: string; updatedAt: string; calls: CallLog[] };
export type CallLog = { stage: string; status: "running" | "done" | "failed"; durationMs?: number; credits?: number | null; promptTokens?: number | null; completionTokens?: number | null };
export const statuses: Record<string, string> = { queued: "排队", collecting: "收集中", analyzing: "分析中", review: "待确认", failed: "失败" };
const normalize = (text: string) => text.replace(/\s+/g, "").toLowerCase();
export function validateAnalysis(value: unknown, sources: Source[], background: Background[], allowManualLinks = false) {
  const result = analysisSchema.parse(value);
  for (const row of result.conclusions) {
    const { feedback: _feedback, ...analysis } = row; void _feedback;
    if (!allowManualLinks && /https?:\/\//i.test(JSON.stringify(analysis))) throw new Error("结论不得生成链接，请通过来源编号引用");
    if (row.backgroundIds.some((id) => !background.some((item) => item.id === id))) throw new Error("结论引用了未选定的个人资料");
    const cited = row.citations.map((citation) => {
      const source = sources.find((item) => item.id === citation.sourceId && item.content);
      if (!source || !normalize(source.content).includes(normalize(citation.quote))) throw new Error("来源编号或支持摘录无法核对，请重新分析");
      return source;
    });
    if (!cited.length && row.evidence !== "资料不足") throw new Error("结论缺少实际取得的来源");
    if (row.evidence === "多源一致" && new Set(cited.map((item) => item.group)).size < 2) row.evidence = cited.length ? "单一来源" : "资料不足";
    if (row.evidence === "原始来源支持" && !cited.some((item) => item.original)) row.evidence = "单一来源";
  }
  if (!sources.some((source) => source.content) && result.conclusions.length) throw new Error("没有资料，不能生成结论");
  return result;
}
export function dedupeSources(sources: Source[]) {
  const seen = new Set<string>(), result: Source[] = [];
  for (const source of sources) {
    const key = source.url || normalize(source.content);
    if (seen.has(key)) continue;
    seen.add(key);
    const duplicate = result.find((row) => normalize(row.title) === normalize(source.title) || (source.content.length > 100 && normalize(row.content).slice(0, 200) === normalize(source.content).slice(0, 200)));
    result.push({ ...source, group: duplicate?.group || source.group });
  }
  return result.slice(0, 15);
}
export function redact(text: string, identifiers: string[] = []) {
  let result = text.replace(/\b1[3-9]\d{9}\b/g, "[联系方式]").replace(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/g, "[邮箱]").replace(/\b\d{17}[\dXx]\b/g, "[证件号]");
  for (const id of identifiers.filter((id) => id.trim().length > 1)) result = result.split(id).join("[个人信息]");
  return result;
}
