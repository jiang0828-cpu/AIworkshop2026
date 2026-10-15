/* eslint-disable @typescript-eslint/no-explicit-any */
import { z } from "zod";
import type { PrismaClient, RadarRecord } from "@prisma/client";
import { PROFILE_ID } from "../db";
import { own, validateScene } from "../strategy/service";
import { writeTransaction } from "../database-writes";
import { validateAnalysis, type Source } from "../research/shared";
import { canRespond, readRadar, radarReport } from "../research/radar";
import { kinds, schemas, saveSchema, periodRange, type Kind, type RadarRow } from "./shared";
import { shanghaiDate } from "../daily/shared";
import { matchesSceneId, otherSceneId } from "../scenes";

export const owner = { profileId: PROFILE_ID };
export const view = (row: RadarRecord): RadarRow => JSON.parse(JSON.stringify({ ...row, payload: JSON.parse(row.payload) }));
export async function owned(db: PrismaClient, id: string, kind?: Kind) {
  const row = await db.radarRecord.findFirst({ where: { ...owner, id, ...(kind ? { kind } : {}) } });
  if (!row) throw new Error("记录不存在或不属于当前档案");
  return row;
}
export function record(kind: Kind, id: string, title: string, payload: any, extra: Partial<RadarRecord> = {}) {
  return { id, ...owner, kind, title: title.slice(0, 300), sceneId: null, topicId: null, parentId: null, status: "draft", version: 1, originKey: null, createdAt: new Date(), updatedAt: new Date(), ...extra, payload: JSON.stringify(schemas[kind].parse(payload)) };
}
const read = (row: RadarRecord) => JSON.parse(row.payload);
async function versioned(db: PrismaClient, input: unknown, kind?: Kind) {
  const body = z.object({ id: z.string(), version: z.number().int().positive(), requestId: z.string().uuid() }).passthrough().parse(input);
  const row = await owned(db, body.id, kind);
  if (row.version !== body.version) throw new Error("记录已更新，请刷新后重试；输入尚未丢失");
  return { body, row };
}
export async function saveRadar(db: PrismaClient, kind: Kind, input: unknown) {
  if (!["topic", "information", "analysis", "response", "verification", "rule", "reference"].includes(kind)) throw new Error("此类型必须使用确认或生成操作");
  const body = saveSchema.parse(input), payload: any = schemas[kind].parse(body.payload);
  await validateScene(db, body.sceneId);
  if (body.topicId) await owned(db, body.topicId, "topic");
  const id = body.id || `radar-${body.requestId}`;
  const previous = await db.radarRecord.findFirst({ where: { ...owner, id } });
  if (previous && !body.id) {
    if (previous.kind !== kind) throw new Error("重复请求的类型不一致");
    return { id };
  }
  if (body.id && (!previous || previous.kind !== kind || previous.version !== body.version)) throw new Error("记录已更新或不存在，请刷新后重试");
  if (previous && (["verification", "reference"].includes(kind) || previous.status === "linked" || kind === "analysis" && previous.status === "confirmed")) throw new Error("已确认快照不可覆盖，请新建修订");
  if (kind === "information") {
    if (payload.source.url) { const { publicUrl } = await import("../research/provider"); publicUrl(payload.source.url); }
    if (!payload.source.content.trim() && !payload.source.url) throw new Error("请填写来源正文或公开网页链接");
    if (!payload.source.content.trim()) payload.source.quality = "pending";
    // Information changes become new independent snapshots; citations never drift.
    if (previous) payload.revisionOf = previous.id;
    if (!previous) {
      const information = await db.radarRecord.findMany({ where: { ...owner, kind: "information" } });
      const same = information.find((r) => { const saved=read(r),source = saved.source; return source.content === payload.source.content && source.url === payload.source.url&&JSON.stringify(saved.observation)===JSON.stringify(payload.observation); });
      if (same) return { id: same.id, reused: true };
    }
  }
  if (kind === "analysis") {
    const revision = payload.revisionJudgementId ? await owned(db, payload.revisionJudgementId, "judgement") : null;
    const sources: Source[] = [];
    for (const infoId of payload.informationIds) { const info = await owned(db, infoId, "information"); sources.push({ ...read(info).source, id: info.id }); }
    payload.sources = sources;
    // Manual analysis does not get to submit arbitrary private background.
    payload.background = previous ? read(previous).background : revision ? read(await owned(db, read(revision).currentVersionId, "judgementVersion")).background : [];
    payload.conclusion.feedback = [];
    payload.conclusion = validateAnalysis({ conclusions: [payload.conclusion], gaps: payload.gaps, changes: "" }, sources, payload.background, true).conclusions[0];
  }
  if (["response", "verification", "reference"].includes(kind)) {
    const judgement = await owned(db, payload.judgementVersionId, "judgementVersion");
    body.sceneId = judgement.sceneId; body.topicId = judgement.topicId;
    if (kind === "reference") {
      await own(db, payload.targetType, payload.targetId);
      const links = await db.radarRecord.findMany({ where: { ...owner, kind: "reference", parentId: payload.judgementVersionId } });
      const same = links.find((r) => read(r).targetId === payload.targetId && read(r).targetType === payload.targetType);
      if (same) return { id: same.id };
    }
    if (kind === "response") {
      if (payload.purpose === "verify") payload.targetType = "action";
      if (payload.targetId) await own(db, payload.targetType, payload.targetId);
      if (payload.adjustmentType !== "none") await own(db, payload.adjustmentType, payload.adjustmentId);
      if (!previous) payload.targetId = ""; // Existing execution records are linked only at explicit confirmation.
    }
  }
  if (kind === "rule") {
    const verification = await owned(db, payload.verificationId, "verification");
    if (read(verification).outcome === "尚不能判断") throw new Error("尚不能判断的反馈不能沉淀已验证规则");
    body.sceneId = verification.sceneId; body.topicId = verification.topicId;
    payload.revisions = previous ? [...read(previous).revisions, { content: read(previous).content, conditions: read(previous).conditions, exceptions: read(previous).exceptions, at: previous.updatedAt.toISOString() }] : [];
  }
  const targetId = previous && kind === "information" ? `radar-${body.requestId}` : id;
  const data = record(kind, targetId, body.title, payload, { sceneId: body.sceneId, topicId: body.topicId, parentId: payload.judgementVersionId || payload.verificationId || null, ...(kind === "reference" ? { status: "active" } : {}) });
  if (previous && kind === "information") {
    const replay = await db.radarRecord.findFirst({ where: { ...owner, id: targetId } });
    if (replay) {
      if (replay.kind !== kind || replay.payload !== data.payload || replay.title !== data.title) throw new Error("重复请求的内容不一致");
      return { id: targetId };
    }
  }
  if (previous && kind !== "information") {
    const changed = await db.radarRecord.updateMany({ where: { ...owner, id, version: body.version }, data: { title: data.title, payload: data.payload, sceneId: data.sceneId, topicId: data.topicId, status: kind === "rule" ? "draft" : previous.status, version: { increment: 1 } } });
    if (!changed.count) throw new Error("记录已更新，请刷新后重试");
  } else await db.radarRecord.create({ data });
  return { id: targetId };
}
export async function confirmJudgement(db: PrismaClient, input: unknown) {
  const request = z.object({ requestId: z.string().uuid(), id: z.string(), version: z.number(), judgementId: z.string().optional(), judgementVersion: z.number().optional() }).parse(input);
  const versionId = `radar-version-${request.requestId}`;
  const exists = await db.radarRecord.findFirst({ where: { ...owner, id: versionId } });
  if (exists) return { id: exists.parentId, versionId };
  const analysis = await owned(db, request.id, "analysis");
  if (analysis.status === "confirmed") {
    const existing = await db.radarRecord.findFirst({ where: { ...owner, originKey: `analysis:${analysis.id}` } });
    if (existing) return { id: existing.parentId, versionId: existing.id };
  }
  if (analysis.status === "archived") throw new Error("已归档分析不能确认，请先创建新的分析稿");
  if (analysis.version !== request.version) throw new Error("记录已更新，请刷新后重试；输入尚未丢失");
  const payload = schemas.analysis.parse(read(analysis));
  const previousId = request.judgementId || payload.revisionJudgementId;
  const previous = previousId ? await owned(db, previousId, "judgement") : null;
  if (previous && previous.version !== (request.judgementVersion || payload.revisionVersion)) throw new Error("原研判已修订，请刷新后重试");
  const judgementId = previous?.id || `radar-judgement-${request.requestId}`;
  const snapshot = record("judgementVersion", versionId, analysis.title, { ...payload, analysisId: analysis.id, number: previous ? previous.version + 1 : 1, confirmed: true }, { parentId: judgementId, sceneId: analysis.sceneId, topicId: analysis.topicId, status: "confirmed", originKey: `analysis:${analysis.id}` });
  await writeTransaction(db, async (tx) => {
    await tx.radarRecord.create({ data: snapshot });
    if (previous) await tx.radarRecord.update({ where: { id: previous.id }, data: { payload: JSON.stringify({ currentVersionId: versionId }), version: previous.version + 1, title: analysis.title } });
    else await tx.radarRecord.create({ data: record("judgement", judgementId, analysis.title, { currentVersionId: versionId }, { sceneId: analysis.sceneId, topicId: analysis.topicId, status: "active" }) });
    await tx.radarRecord.update({ where: { id: analysis.id }, data: { status: "confirmed", version: analysis.version + 1 } });
  });
  return { id: judgementId, versionId };
}
export async function confirmResponse(db: PrismaClient, input: unknown) {
  const raw = z.object({ id: z.string(), requestId: z.string().uuid(), version: z.number(), existingId: z.string().optional() }).parse(input);
  const current = await owned(db, raw.id, "response");
  if (current.status === "linked") return { id: read(current).targetId, type: read(current).targetType };
  if (current.status === "archived") throw new Error("已归档建议不能转为执行记录");
  const { row } = await versioned(db, raw, "response"), payload = schemas.response.parse(read(row));
  const snapshot = await owned(db, payload.judgementVersionId, "judgementVersion"), judgement = schemas.judgementVersion.parse(read(snapshot));
  if (payload.purpose === "respond" && (!judgement.confirmed || !canRespond(judgement.conclusion.radar) || ["资料不足", "存在分歧"].includes(judgement.conclusion.evidence))) throw new Error("依据或置信度不足，请先安排核实任务");
  const type = payload.purpose === "verify" ? "action" : payload.targetType;
  const targetId = raw.existingId || `radar-target-${row.id}`;
  if (raw.existingId) await own(db, type, raw.existingId);
  const radar = readRadar(judgement.conclusion.radar);
  const context = `${payload.proposal}\n\n事实：${judgement.conclusion.facts}\n推断：${judgement.conclusion.relevance}\n时间窗：${radar.window}\n底线：${radar.bottomLine}\n触发条件：${radar.trigger}\n可逆措施：${payload.reversibleStep}\n停止条件：${payload.stopCondition}\n观察指标：${radar.indicator}\n调整对象：${payload.adjustmentType} ${payload.adjustmentId}`;
  await writeTransaction(db, async (tx) => {
    if (!raw.existingId) {
      if (type === "decision") await tx.decision.create({ data: { id: targetId, ...owner, sceneId: row.sceneId, title: row.title, context, facts: judgement.conclusion.facts, assumptions: judgement.conclusion.relevance, gaps: judgement.conclusion.uncertainty, risk: radar.bottomLine, reversible: true } });
      else await tx.action.create({ data: { id: targetId, ...owner, sceneId: row.sceneId, title: row.title, purpose: context, standard: payload.standard || judgement.conclusion.uncertainty || radar.expected, dueDate: payload.dueDate ? new Date(`${payload.dueDate}T00:00:00+08:00`) : null } });
    }
    await tx.recordSource.create({ data: { id: `radar-source-${row.id}`, ...owner, sourceType: "radar", sourceId: snapshot.id, sourceTitle: snapshot.title, targetType: type, targetId } });
    await tx.radarRecord.update({ where: { id: row.id }, data: { status: "linked", version: row.version + 1, payload: JSON.stringify({ ...payload, targetType: type, targetId }) } });
  });
  return { id: targetId, type };
}
export async function setRadarStatus(db: PrismaClient, input: unknown) {
  const { body, row } = await versioned(db, input);
  const status = z.enum(["archived", "active", "disabled"]).parse(body.status);
  if (["judgementVersion", "verification", "report", "job", "history", "reference"].includes(row.kind)) throw new Error("历史快照不允许修改状态");
  if (status === "active" && row.kind === "rule") {
    const rule = schemas.rule.parse(read(row));
    if (!rule.conditions.trim()) throw new Error("请填写规则适用条件后确认入库");
  } else if (status !== "archived" && !["topic", "rule", "judgement"].includes(row.kind)) throw new Error("不支持此状态转换");
  await db.radarRecord.update({ where: { id: row.id }, data: { status, version: row.version + 1 } });
  return { id: row.id };
}
export async function generateRadarReport(db: PrismaClient, input: unknown) {
  const body = z.object({ requestId: z.string().uuid(), period: z.enum(["week", "month", "quarter", "year"]), day: z.string().date(), sceneId: z.string().nullable().default(null), topicId: z.string().nullable().default(null) }).parse(input);
  const id = `radar-report-${body.requestId}`;
  if (await db.radarRecord.findFirst({ where: { ...owner, id } })) return { id };
  if (body.sceneId) await validateScene(db, body.sceneId); if (body.topicId) await owned(db, body.topicId, "topic");
  const range = periodRange(body.period, body.day);
  const other = otherSceneId(await db.workbenchScene.findMany({ where: owner }));
  const filter = { ...owner, ...(body.sceneId === other ? { OR: [{ sceneId: null }, { sceneId: other }] } : body.sceneId ? { sceneId: body.sceneId } : {}), ...(body.topicId ? { topicId: body.topicId } : {}) };
  const events = await db.radarRecord.findMany({ where: { ...filter, kind: { in: ["judgementVersion", "verification", "response"] }, createdAt: { gte: range.from, lt: range.to } }, orderBy: { createdAt: "desc" } });
  const versionIds = [...new Set(events.map((r) => r.kind === "judgementVersion" ? r.id : read(r).judgementVersionId))];
  const versions = await db.radarRecord.findMany({ where: { ...owner, id: { in: versionIds } }, orderBy: { createdAt: "desc" } });
  const summary = versions.slice(0, 5).map((r) => ({ id: r.id, title: r.title, text: read(r).conclusion.relevance }));
  const title = `${range.start} ${ { week: "周报", month: "月报", quarter: "季报", year: "年报" }[body.period]}`;
  const markdown = radarReport(title, versions.map((row) => { const p = schemas.judgementVersion.parse(read(row)); return { title: row.title, facts: p.conclusion.facts, judgement: p.conclusion.relevance, response: p.conclusion.nextStep, radar: p.conclusion.radar, sources: p.sources.map((s) => `${s.id} ${s.title} ${s.url || "手动资料"} 发布：${s.publishedAt || "未知"}`), feedback: events.filter((e) => e.kind === "verification" && read(e).judgementVersionId === row.id).map((e) => { const v = schemas.verification.parse(read(e)); return { id: e.id, at: e.createdAt.toISOString(), actual: v.actual, outcome: v.outcome, reason: v.reason, adjustment: `${v.adjustment}；措施效果：${v.effectiveness} ${v.effectEvidence}`, rule: "" }; }) }; }));
  const responses = events.filter((e) => e.kind === "response");
  const unfinished = await db.radarRecord.findMany({ where: { ...filter, kind: "response", status: "draft", createdAt: { lt: range.from } }, orderBy: { createdAt: "desc" } });
  responses.push(...unfinished);
  const periodRecords = await db.radarRecord.findMany({ where: { ...filter, kind: { in: ["information", "analysis", "rule"] }, createdAt: { gte: range.from, lt: range.to } }, orderBy: { createdAt: "desc" } });
  const inputs = `\n\n## 本期资料与分析\n${periodRecords.map(r => { const p = read(r); return `- ${r.kind === "information" ? "信息" : r.kind === "analysis" ? "分析草稿" : "规则"}：${r.title} [${r.id}]${r.kind === "information" ? `；${p.facts || "事实摘录未填写"}；来源：${p.source.url || p.source.publisher}；发布：${p.source.publishedAt || "未知"}` : ""}`; }).join("\n") || "本期无新增资料"}`;
  const appendix = `\n\n## 应变与遗留事项\n${responses.map((r) => `- ${r.title}：${r.status === "linked" ? "已确认关联，执行状态请查看原记录" : "待确认"}；${read(r).proposal}`).join("\n") || "本期无新增应变记录"}\n\n统计范围：${range.start} 至 ${range.end}（结束日不含），Asia/Shanghai。包含本期判断及本期反馈所引用的旧判断。`;
  await db.radarRecord.create({ data: record("report", id, title, { period: body.period, start: range.start, end: range.end, summary, markdown: `# 摘要\n${summary.map((s) => `- ${s.title}：${s.text}`).join("\n")}\n\n${markdown}${inputs}${appendix}`, recordIds: [...new Set([...events.map((r) => r.id), ...versionIds, ...periodRecords.map(r => r.id), ...unfinished.map(r => r.id)])] }, { sceneId: body.sceneId, topicId: body.topicId, status: "confirmed" }) });
  return { id };
}
export async function listRadar(db: PrismaClient, params: URLSearchParams) {
  const kind = z.enum(kinds).parse(params.get("kind") || "information");
  const requestedPage = Number(params.get("page"));
  const page = Number.isSafeInteger(requestedPage) && requestedPage > 0 ? requestedPage : 1, size = 30;
  const filter: any = { ...owner, kind };
  if(kind==="information"&&params.get("collection")==="surroundings")filter.payload={contains:'"observation":'};
  if (params.get("scene") && params.get("scene") !== "all") {
    const other = otherSceneId(await db.workbenchScene.findMany({ where: owner }));
    if (["unclassified", other].includes(params.get("scene")!)) filter.OR = [{ sceneId: null }, { sceneId: other }];
    else filter.sceneId = params.get("scene");
  }
  if (params.get("topic")) filter.topicId = params.get("topic");
  if (params.get("status")) filter.status = params.get("status"); else filter.status = { not: "archived" };
  const [rows, total, topics] = await Promise.all([db.radarRecord.findMany({ where: filter, skip: (page - 1) * size, take: size, orderBy: [{ createdAt: "desc" }, { id: "desc" }] }), db.radarRecord.count({ where: filter }), db.radarRecord.findMany({ where: { ...owner, kind: "topic", status: { not: "archived" } }, orderBy: { createdAt: "desc" } })]);
  const versionIds = [...new Set(rows.filter((r) => r.kind === "judgement").map((r) => read(r).currentVersionId))];
  const versions = await db.radarRecord.findMany({ where: { ...owner, id: { in: versionIds } } });
  const hydrated = rows.map((r) => ({ ...view(r), ...(r.kind === "judgement" ? { snapshot: versions.find((v) => v.id === read(r).currentVersionId) ? view(versions.find((v) => v.id === read(r).currentVersionId)!) : null } : {}) }));
  return { rows: hydrated, total, page, size, topics: topics.map(view) };
}
export async function radarDetail(db: PrismaClient, id: string) {
  const row = await owned(db, id), related = await db.radarRecord.findMany({ where: { ...owner, OR: [{ parentId: id }, { id: row.parentId || "" }] }, orderBy: { createdAt: "desc" } });
  const p = read(row);
  const upstream = [...(p.informationIds || []), ...(p.recordIds || []), ...(p.analysisId ? [p.analysisId] : []), ...(row.topicId ? [row.topicId] : [])];
  if (upstream.length) related.push(...await db.radarRecord.findMany({ where: { ...owner, id: { in: upstream } } }));
  if (["information", "analysis"].includes(row.kind)) {
    const candidates = await db.radarRecord.findMany({ where: { ...owner, kind: { in: ["analysis", "judgementVersion"] } } });
    related.push(...candidates.filter(r => row.kind === "information" ? read(r).informationIds?.includes(id) : read(r).analysisId === id));
  }
  if (row.kind === "judgement") { const version = await owned(db, p.currentVersionId, "judgementVersion"); related.push(...await db.radarRecord.findMany({ where: { ...owner, parentId: version.id }, orderBy: { createdAt: "desc" } })); }
  let target = null;
  if (row.kind === "response" && p.targetId) { try { target = await own(db, p.targetType, p.targetId); } catch { target = { deleted: true }; } }
  return { row: view(row), related: [...new Map(related.filter(r => r.id !== id).map(r => [r.id, r])).values()].map(view), target };
}
export async function dueRadar(db: PrismaClient, params: URLSearchParams) {
  const scenes = await db.workbenchScene.findMany({ where: owner });
  const all = await db.radarRecord.findMany({ where: { ...owner, kind: { in: ["topic", "judgement", "judgementVersion", "verification"] } }, orderBy: { createdAt: "desc" } });
  const today = shanghaiDate(), result: RadarRow[] = [];
  for (const row of all.filter((r) => ["topic", "judgement"].includes(r.kind) && r.status !== "archived" && matchesSceneId(r.sceneId, params.get("scene") || "all", scenes) && (!params.get("topic") || r.topicId === params.get("topic") || r.id === params.get("topic")))) {
    if (row.kind === "topic") { const date = read(row).reviewDate; if (date && date <= today) result.push(view(row)); continue; }
    const snapshot = all.find((r) => r.id === read(row).currentVersionId);
    if (!snapshot) continue;
    const last = all.find((r) => r.kind === "verification" && r.parentId === snapshot.id);
    const date = last ? read(last).nextDate : readRadar(read(snapshot).conclusion.radar).reviewDate;
    if (date && date <= today) result.push(view(row));
  }
  return { rows: result };
}
