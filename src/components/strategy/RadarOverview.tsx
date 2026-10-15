"use client";
import { useState } from "react";
import { shanghaiDate } from "@/lib/daily/shared";
import { radarReport, readRadar, type RadarReportRow, type Verification } from "@/lib/research/radar";
import type { ResearchView } from "@/lib/research/shared";
import { Button, Link, matchesScene, type ModuleProps, type Row } from "./Shared";
import type { StrategyView } from "@/lib/strategy/shared";

export default function RadarOverview({ batches, props }: { batches: ResearchView[]; props: ModuleProps }) {
  const today = shanghaiDate(), [month, setMonth] = useState(today.slice(0, 7));
  const strategy = props.data?.strategy as StrategyView | undefined;
  const rows: Array<RadarReportRow & { id: string; date: string; sourceType: string; sourceId: string }> = [
    ...batches.flatMap((batch) => batch.conclusions.map((c, index) => ({ title: c.title, facts: c.facts, judgement: c.relevance, response: c.nextStep, radar: c.radar, feedback: c.feedback, id: batch.id, sourceType: "research", sourceId: `${batch.id}:${index}`, date: shanghaiDate(new Date(batch.createdAt)), sources: c.citations.map((ref) => { const source = batch.sources.find((s) => s.id === ref.sourceId); return `[${ref.sourceId}] ${source?.title || "来源已删除"} ${source?.url || "手动资料"}（发布：${source?.publishedAt || "未知"}）\n${ref.quote}`; }) }))),
    ...(strategy?.records || []).filter((r) => r.kind === "signal" && !r.archived && matchesScene(r.sceneId, props.target.scene || "all")).map((r) => ({ title: r.title, facts: String(r.payload.facts || ""), judgement: String(r.payload.judgement || ""), response: String(r.payload.response || ""), radar: readRadar(r.payload.radar), feedback: (r.payload.feedback || []) as Verification[], id: r.id, sourceType: "signal", sourceId: r.id, date: String(r.payload.observedAt), sources: [String(r.payload.source || "待补充来源")] })),
  ];
  const due = rows.filter((r) => { const radar = readRadar(r.radar); return radar.reviewDate && radar.reviewDate <= today && !(r.feedback || []).some((f) => shanghaiDate(new Date(f.at)) >= radar.reviewDate); });
  const rules = rows.flatMap((r) => (r.feedback || []).filter((f) => f.rule && f.outcome !== "尚不能判断").map((f) => ({ row: r, feedback: f })));
  const open = (id: string) => props.navigate({ section: "situation", tab: "overview", recordId: id, scene: props.target.scene });
  const exportReport = () => {
    const body = radarReport(month, rows.filter((r) => r.date.startsWith(month)));
    const url = URL.createObjectURL(new Blob([body], { type: "text/markdown;charset=utf-8" }));
    const anchor = document.createElement("a"); anchor.href = url; anchor.download = `形势研判-${month}.md`; anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  return <div className="mb-4 space-y-3">
    {!!due.length && <div className="rounded bg-amber-50 p-3 text-sm">待验证 {due.length} 项：<div className="mt-2 flex flex-wrap gap-3">{due.map((r) => <Link key={`${r.sourceType}:${r.sourceId}`} onClick={() => open(r.id)}>{r.title}</Link>)}</div></div>}
    <details className="rounded border border-line p-3"><summary className="cursor-pointer text-sm text-sage">月度汇总、应变清单与研判规则</summary>
      <p className="my-3 text-xs text-slate-500">制定目标前查看方向；复盘时核对原判断；调整时到决策中心确认。汇总当前场景、最近100轮收集和手动研判，不自动生成新判断。</p>
      <div className="flex flex-wrap items-center gap-2"><input aria-label="月报月份" type="month" className="!w-auto max-w-full" value={month} onChange={(e) => setMonth(e.target.value)} /><Button disabled={!month} onClick={exportReport}>导出趋势月报</Button><Button onClick={() => props.navigate({ section: "goals" })}>校准目标</Button><Button onClick={() => props.navigate({ section: "decisions", tab: "decisions" })}>查看决策</Button></div>
      <h3 className="mb-2 mt-4 text-sm font-medium">应变建议与已确认结果</h3>
      {rows.filter((r) => readRadar(r.radar).responseType !== "观察核实").map((r) => { const links = strategy?.sources.filter((s) => s.sourceType === r.sourceType && s.sourceId === r.sourceId) || []; return <div key={`${r.sourceType}:${r.sourceId}`} className="border-b border-line py-2 text-xs"><Link onClick={() => open(r.id)}>{r.title}</Link><p className="mt-1">{readRadar(r.radar).responseType} · {r.response || "待填写应变建议"}</p>{!links.length && <p className="text-amber-800">待人工判断与确认</p>}{links.map((s) => { const target = (s.targetType === "decision" ? props.data?.decisions : props.data?.actions)?.find((t: Row) => t.id === s.targetId); return <p key={s.id}>{target ? <Link onClick={() => props.navigate({ section: s.targetType === "decision" ? "decisions" : "actions", tab: s.targetType === "decision" ? "decisions" : undefined, recordId: s.targetId })}>{s.targetType === "decision" ? "决策" : "行动"}：{String(target.title)}（{String(target.status || "待处理")}）</Link> : "关联结果已删除"}</p>; })}</div>; })}
      {!rows.some((r) => readRadar(r.radar).responseType !== "观察核实") && <p className="text-xs text-slate-400">暂无应变建议，可在研判卡选择应变方向。</p>}
      <h3 className="mb-2 mt-4 text-sm font-medium">研判规则（人工验证后沉淀）</h3>
      {rules.map(({ row, feedback }) => <p key={`${row.sourceId}:${feedback.id}`} className="mb-2 whitespace-pre-wrap break-words text-xs">{feedback.rule} <Link onClick={() => open(row.id)}>查看验证依据</Link></p>)}{!rules.length && <p className="text-xs text-slate-400">完成反馈验证后，填写有适用条件的经验规则；尚不能判断的记录不进入规则库。</p>}
    </details>
  </div>;
}
