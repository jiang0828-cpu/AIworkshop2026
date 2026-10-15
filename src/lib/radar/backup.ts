import { z } from "zod";
import { kinds, schemas } from "./shared";
import { validateAnalysis } from "../research/shared";
import { publicUrl } from "../research/provider";
import { newsRunSchema, validateNews } from "./news-shared";
export const radarBackupSchema = z.object({ id: z.string().min(1), profileId: z.string().optional(), kind: z.enum(kinds), title: z.string().min(1).max(300), sceneId: z.string().nullable(), topicId: z.string().nullable(), parentId: z.string().nullable(), status: z.string().max(50), version: z.number().int().positive(), payload: z.string(), originKey: z.string().nullable(), createdAt: z.coerce.date(), updatedAt: z.coerce.date() }).superRefine((row, ctx) => {
  try {
    const payload = schemas[row.kind].parse(JSON.parse(row.payload));
    if(row.kind==="newsRun"){
      const p=newsRunSchema.parse(payload);
      for(const s of p.sources)if(s.url)publicUrl(s.url);
      validateNews({items:p.items,gaps:p.gaps},p.sources,p.cutoff);
    }
    if ("source" in payload && payload.source.url) publicUrl(payload.source.url);
    if ("conclusion" in payload) {
      for (const source of payload.sources) if (source.url) publicUrl(source.url);
      validateAnalysis({ conclusions: [payload.conclusion], gaps: payload.gaps, changes: "" }, payload.sources, payload.background, true);
    }
  } catch { ctx.addIssue({ code: "custom", message: "雷达记录、来源或引用无效" }); }
});

export function validateRadarGraph(rows: z.infer<typeof radarBackupSchema>[], batchIds: Set<string>, sceneIds: Set<string>) {
  const byId = new Map(rows.map(r => [r.id, r]));
  const origins = rows.map(r => r.originKey).filter(Boolean);
  if (byId.size !== rows.length || new Set(origins).size !== origins.length) throw new Error("雷达记录或映射标识重复");
  const requireKind = (id: string, kind: string) => { const r = byId.get(id); if (!r || r.kind !== kind) throw new Error("雷达上下游引用无效"); return r; };
  for (const row of rows) {
    const p = schemas[row.kind].parse(JSON.parse(row.payload));
    if (row.sceneId && !sceneIds.has(row.sceneId)) throw new Error("雷达场景引用无效");
    if (row.topicId) requireKind(row.topicId, "topic");
    if (row.kind === "judgement" && "currentVersionId" in p) {
      const version = requireKind(p.currentVersionId, "judgementVersion");
      if (version.parentId !== row.id) throw new Error("当前判断版本归属无效");
    }
    if ("informationIds" in p) for (const id of p.informationIds) requireKind(id, "information");
    if ("assessments" in p) for (const assessment of p.assessments) {
      const snapshot = requireKind(assessment.id, assessment.kind);
      const original = byId.get(assessment.recordId);
      if (!original || (original.id !== snapshot.id && (original.kind !== "judgement" || snapshot.parentId !== original.id))) throw new Error("综合研判观点归属无效");
    }
    if ("sources" in p && "informationIds" in p) {
      if (p.sources.length !== p.informationIds.length) throw new Error("信息快照数量不一致");
      for (const source of p.sources) {
        if (!p.informationIds.includes(source.id)) throw new Error("来源快照引用无效");
        const info = schemas.information.parse(JSON.parse(requireKind(source.id, "information").payload));
        if (source.content !== info.source.content || source.url !== info.source.url) throw new Error("信息快照与原记录不一致");
      }
    }
    if ("judgementVersionId" in p) requireKind(p.judgementVersionId, "judgementVersion");
    if ("verificationId" in p) requireKind(p.verificationId, "verification");
    if ("revisionOf" in p && p.revisionOf) requireKind(p.revisionOf, "information");
    if ("analysisId" in p && p.analysisId) requireKind(p.analysisId, "analysis");
    if (row.kind === "judgementVersion" && row.parentId) requireKind(row.parentId, "judgement");
    if ("batchId" in p && p.batchId && !batchIds.has(p.batchId)) throw new Error("后台任务引用无效");
    if ("recordIds" in p && p.recordIds.some(id => !byId.has(id))) throw new Error("报告引用无效");
  }
}
