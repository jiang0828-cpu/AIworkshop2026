/* eslint-disable @typescript-eslint/no-explicit-any */
import type { PrismaClient, ResearchBatch, RadarRecord } from "@prisma/client";
import { record, owner } from "./service";
import { writeTransaction } from "../database-writes";
import { conclusionSchema, sourceSchema } from "../research/shared";
import { readRadar } from "../research/radar";

export async function insertMissing(db: PrismaClient, rows: ReturnType<typeof record>[]) {
  const existing = new Set((await db.radarRecord.findMany({ where: owner, select: { id: true } })).map((r) => r.id));
  const missing = rows.filter((r, index) => !existing.has(r.id) && rows.findIndex((x) => x.id === r.id) === index);
  if (missing.length) {
    if (typeof db.$transaction === "function") await writeTransaction(db, async (tx) => { for (const row of missing) await tx.radarRecord.create({ data: row }); });
    else for (const row of missing) await db.radarRecord.create({ data: row });
  }
}
export function batchRecords(batch: ResearchBatch, job?: RadarRecord | null, links: any[] = []) {
  const metadata = job ? JSON.parse(job.payload) : null;
  const topicId = job ? job.topicId : `radar-topic-${batch.id}`;
  const extra = { sceneId: batch.sceneId, topicId, createdAt: batch.createdAt, updatedAt: batch.updatedAt };
  const rows: ReturnType<typeof record>[] = [];
  if (!job) rows.push(record("topic", topicId!, batch.question, { question: batch.question, reviewDate: batch.followUpDate || "" }, { sceneId: batch.sceneId, status: "active", originKey: `batch-topic:${batch.id}`, createdAt: batch.createdAt }));
  const sources = JSON.parse(batch.sources).map((s: any) => sourceSchema.parse(s));
  const informationIds = sources.map((s: any) => metadata?.mode === "analyze" && metadata.informationIds.includes(s.id) ? s.id : `radar-info-${batch.id}-${s.id}`);
  sources.forEach((source: any, n: number) => {
    if (metadata?.mode === "analyze" && metadata.informationIds.includes(source.id)) return;
    if (batch.status === "failed" && source.quality === "pending") return;
    rows.push(record("information", informationIds[n], source.title || "来源资料", { source: { ...source, id: informationIds[n] }, facts: "", notes: source.note, verification: "待核验" }, { ...extra, status: "active", originKey: `source:${batch.id}:${source.id}` }));
  });
  const snapshots = sources.map((s: any, n: number) => ({ ...s, id: informationIds[n] }));
  const conclusions = JSON.parse(batch.conclusions);
  conclusions.forEach((raw: any, index: number) => {
    const conclusion = conclusionSchema.parse({ ...raw, feedback: [], citations: raw.citations.map((c: any) => ({ ...c, sourceId: informationIds[sources.findIndex((s: any) => s.id === c.sourceId)] || c.sourceId })) });
    const analysisId = `radar-analysis-${batch.id}-${index}`;
    const payload = { sources: snapshots, informationIds, background: JSON.parse(batch.background), conclusion, gaps: batch.gaps, batchId: batch.id };
    rows.push(record("analysis", analysisId, conclusion.title, payload, { ...extra, originKey: `analysis:${batch.id}:${index}` }));
    if (job) return; // New model output remains a draft until explicit confirmation.
    const judgementId = `radar-judgement-${batch.id}-${index}`, versionId = `${judgementId}-v1`;
    rows.push(record("judgement", judgementId, conclusion.title, { currentVersionId: versionId }, { ...extra, status: "pending" }));
    rows.push(record("judgementVersion", versionId, conclusion.title, { ...payload, analysisId, number: 1, confirmed: false, legacySourceType: "research", legacySourceId: `${batch.id}:${index}` }, { ...extra, parentId: judgementId, status: "pending" }));
    migrateFeedback(rows, raw.feedback || [], versionId, extra);
    migrateLinks(rows, links.filter((l) => l.sourceType === "research" && l.sourceId === `${batch.id}:${index}`), versionId, conclusion, extra);
  });
  if (!job) rows.push(record("history", `radar-history-${batch.id}`, batch.question, { sourceType: "research", sourceId: batch.id, content: JSON.stringify(batch) }, { ...extra, parentId: conclusions.length ? `radar-judgement-${batch.id}-0` : topicId, originKey: `legacy:research:${batch.id}`, status: "archived" }));
  return rows;
}
function migrateFeedback(rows: ReturnType<typeof record>[], feedback: any[], versionId: string, extra: any) {
  feedback.forEach((f, i) => {
    const id = `${versionId}-feedback-${i}`;
    rows.push(record("verification", id, "历史反馈", { judgementVersionId: versionId, actual: f.actual || "历史反馈未填写实际结果", outcome: f.outcome || "尚不能判断", reason: f.reason || "", adjustment: f.adjustment || "" }, { ...extra, parentId: versionId, status: "confirmed", createdAt: f.at ? new Date(f.at) : extra.createdAt }));
    if (f.rule && f.outcome !== "尚不能判断") rows.push(record("rule", `${id}-rule`, "历史规则（待确认条件）", { verificationId: id, content: f.rule }, { ...extra, parentId: id }));
  });
}
function migrateLinks(rows: ReturnType<typeof record>[], links: any[], versionId: string, conclusion: any, extra: any) {
  for (const link of links.filter((r) => ["action", "decision"].includes(r.targetType))) rows.push(record("response", `radar-response-${link.id}`, link.sourceTitle || conclusion.title, { judgementVersionId: versionId, purpose: "respond", category: readRadar(conclusion.radar).responseType, proposal: conclusion.nextStep, targetType: link.targetType, targetId: link.targetId }, { ...extra, parentId: versionId, status: "linked", originKey: `link:${link.id}` }));
}
export async function importLegacyRadar(db: PrismaClient) {
  const [batches, signals, versions, items, assessment, links, jobs] = await Promise.all([
    db.researchBatch.findMany({ where: owner }), db.strategyRecord.findMany({ where: { ...owner, kind: "signal" } }), db.strategyVersion.findMany({ where: owner }), db.situationItem.findMany({ where: owner }), db.situationAssessment.findMany({ where: owner }), db.recordSource.findMany({ where: owner }), db.radarRecord.findMany({ where: { ...owner, kind: "job" } }),
  ]);
  const jobBatchIds = new Set(jobs.map((j) => JSON.parse(j.payload).batchId));
  const rows = batches.filter((b) => !jobBatchIds.has(b.id)&&!b.id.startsWith("news-")).flatMap((batch) => batchRecords(batch, null, links));
  for (const signal of signals) {
    const p = JSON.parse(signal.payload), infoId = `radar-info-${signal.id}`, analysisId = `radar-analysis-${signal.id}`, judgementId = `radar-judgement-${signal.id}`, versionId = `${judgementId}-v1`;
    const extra = { sceneId: signal.sceneId, createdAt: signal.createdAt, updatedAt: signal.updatedAt };
    const source = sourceSchema.parse({ id: infoId, title: signal.title, url: null, publisher: String(p.source || "历史手动资料").slice(0, 300), publishedAt: null, collectedAt: signal.createdAt.toISOString(), content: String(p.facts || p.source || "历史记录没有独立事实，请补充资料").slice(0, 16000), quality: "manual", group: infoId, note: "历史人工资料，发布日期未知" });
    rows.push(record("information", infoId, signal.title, { source, facts: p.facts || "", notes: p.source || "", verification: p.verification || "待核验" }, { ...extra, status: signal.archived ? "archived" : "active" }));
    const conclusion = conclusionSchema.parse({ title: signal.title, facts: String(p.facts || "历史记录未单独填写事实，待补充").slice(0, 4000), relevance: String(p.judgement || p.impact || "").slice(0, 4000), nextStep: String(p.response || "").slice(0, 2000), backgroundIds: [], citations: [{ sourceId: infoId, quote: source.content.slice(0, 1200) }], evidence: p.facts ? "单一来源" : "资料不足", uncertainty: "历史手动记录；来源与判断需自行核对；完整原文保留于历史材料", radar: p.radar });
    const payload = { sources: [source], informationIds: [infoId], background: [], conclusion, gaps: "" };
    rows.push(record("analysis", analysisId, signal.title, payload, extra));
    rows.push(record("judgement", judgementId, signal.title, { currentVersionId: versionId }, { ...extra, status: signal.archived ? "archived" : "pending" }));
    rows.push(record("judgementVersion", versionId, signal.title, { ...payload, number: 1, confirmed: false, analysisId, legacySourceType: "signal", legacySourceId: signal.id }, { ...extra, parentId: judgementId, status: "pending" }));
    migrateFeedback(rows, p.feedback || [], versionId, extra); migrateLinks(rows, links.filter((l) => l.sourceType === "signal" && l.sourceId === signal.id), versionId, conclusion, extra);
    rows.push(record("history", `radar-history-${signal.id}`, signal.title, { sourceType: "signal", sourceId: signal.id, content: JSON.stringify(signal) }, { ...extra, parentId: judgementId, originKey: `legacy:signal:${signal.id}`, status: "archived" }));
  }
  for (const [type, entries] of [["situationItem", items], ["situationAssessment", assessment], ["strategyVersion", versions.filter(v => ["signal", "assessment"].includes(v.kind))]] as const) for (const row of entries) rows.push(record("history", `radar-history-${type}-${row.id}`, "历史材料，待整理", { sourceType: type, sourceId: row.id, content: JSON.stringify(row) }, { status: "archived", originKey: `legacy:${type}:${row.id}`, createdAt: row.createdAt }));
  await insertMissing(db, rows);
  return { mapped: rows.length };
}
export async function publishResearch(db: PrismaClient, batchId: string) {
  if(batchId.startsWith("news-"))return;
  const batch = await db.researchBatch.findFirst({ where: { ...owner, id: batchId, status: { in: ["review", "failed"] } } });
  if (!batch) return;
  const job = await db.radarRecord.findFirst({ where: { ...owner, kind: "job", originKey: `job:${batchId}` } });
  if (!job) {
    const links = await db.recordSource.findMany({ where: owner });
    await insertMissing(db, batchRecords(batch, null, links));
    return;
  }
  const payload = JSON.parse(job.payload);
  if (payload.published) return;
  const rows = batchRecords(batch, job);
  const existingInformation = await db.radarRecord.findMany({ where: { ...owner, kind: "information" } });
  const replacements = new Map<string, string>();
  for (const info of rows.filter(r => r.kind === "information")) {
    const source = JSON.parse(info.payload).source;
    const duplicate = existingInformation.find(r => { const old = JSON.parse(r.payload).source; return old.url === source.url && old.content === source.content; });
    if (duplicate && duplicate.id !== info.id) replacements.set(info.id, duplicate.id);
  }
  const publishedRows = rows.filter(r => !replacements.has(r.id)).map(r => {
    if (r.kind !== "analysis") return r;
    const p = JSON.parse(r.payload);
    p.informationIds = p.informationIds.map((id: string) => replacements.get(id) || id);
    p.sources = p.sources.map((source: any) => ({ ...source, id: replacements.get(source.id) || source.id }));
    p.conclusion.citations = p.conclusion.citations.map((c: any) => ({ ...c, sourceId: replacements.get(c.sourceId) || c.sourceId }));
    return { ...r, payload: JSON.stringify(p) };
  });
  await insertMissing(db, publishedRows);
  // Failed stages keep their sources; retries publish the remaining draft later.
  if (batch.status === "review") await db.radarRecord.update({ where: { id: job.id }, data: { status: "review", payload: JSON.stringify({ ...payload, published: true }) } });
}
