"use client";
import { useState } from "react";
import { Button, EditDialog, Empty, Field, matchesScene, type ModuleProps, type Row, useStrategy } from "./Shared";
import SelfLoop from "./SelfLoop";
import { skillSchema } from "@/lib/strategy/shared";
import { SceneSelect } from "./Shared";

const priorities = ["关键", "重要", "一般"];
export default function CapabilityLibrary({ props }: { props: ModuleProps }) {
  const { view, post, working } = useStrategy(props);
  const [filter, setFilter] = useState("全部"), [draft, setDraft] = useState<Row | null>(null);
  const skills = view.records.filter((row) => row.kind === "skill" && !row.archived);
  const evidenceScenes = (id: string): string[] => {
    const tag = view.records.find((row) => row.kind === "tag" && row.payload.subjectType === "evidence" && row.payload.subjectId === id);
    return (tag?.payload.sceneIds || []) as string[];
  };
  const sceneNames = (ids: string[]) => view.scenes.filter((scene) => ids.includes(scene.id)).map((scene) => scene.name).join("、") || "全局（未指定场景）";
  const evidenceFor = (record: Row) => (props.data?.evidences || []).filter((e: Row) => e.id === record.payload.evidenceId || view.sources.some((link) => link.sourceType === "skill" && link.sourceId === record.id && link.targetType === "evidence" && link.targetId === e.id));
  const records = skills.filter((row) => matchesScene(row.sceneId, props.target.scene || "all", view) && (filter === "全部" || (row.payload.importance || "重要") === filter)).sort((a, b) => priorities.indexOf(String(a.payload.importance || "重要")) - priorities.indexOf(String(b.payload.importance || "重要")));
  const standalone = (props.data?.evidences || []).filter((e: Row) => !skills.some((record) => evidenceFor(record).some((item: Row) => item.id === e.id))).filter((e: Row) => {
    const tag = view.records.find((row) => row.kind === "tag" && row.payload.subjectType === "evidence" && row.payload.subjectId === e.id);
    const ids = (tag?.payload.sceneIds || []) as string[];
    return filter === "全部" && (props.target.scene === "all" || !props.target.scene || ids.includes(props.target.scene));
  });
  return <section className="mb-6 rounded border border-line p-4">
    <div className="flex flex-wrap items-center justify-between gap-2"><h2 className="text-sm font-semibold">能力库</h2><Button onClick={() => setDraft({ kind: "skill", title: "", sceneId: props.target.scene === "all" ? null : props.target.scene || null, payload: skillSchema.parse({ category: "requirement" }) })}>新增能力</Button><Button onClick={() => props.open({ type: "evidence", item: { _sceneIds: props.target.scene && props.target.scene !== "all" ? [props.target.scene] : [] } })}>新增能力证据</Button></div><p className="my-2 text-xs text-slate-500">按场景查看能力需求、评估和证据。未指定场景的全局证据仅在“全部场景”显示。编辑能力可关联同类证据，关联后在同一条目中展示。</p>
    <select aria-label="能力需求重要性筛选" className="mb-3 !w-auto" value={filter} onChange={(e) => setFilter(e.target.value)}>{["全部", ...priorities].map((value) => <option key={value}>{value}</option>)}</select>
    {!records.length && !standalone.length && <Empty>暂无能力，可新增或确认 AI 建议入库。</Empty>}
    {records.map((record) => <details key={record.id} data-record-id={record.id} className="border-t border-line py-3"><summary className="cursor-pointer text-sm">{sceneNames([record.sceneId || view.scenes.find((scene) => scene.slot === 4)?.id || ""])} · {String(record.payload.importance || "重要")} · {record.title} · {record.payload.requirementStatus as string}</summary><div className="mt-3 space-y-3">
      <p className="whitespace-pre-wrap text-xs text-slate-500">重要性依据：{String(record.payload.importanceReason || "待补充")}</p>
      <p className="whitespace-pre-wrap break-words text-sm">{String(record.payload.improvement)}</p>
      {record.payload.rating != null && <p className="text-xs">自评：{String(record.payload.rating)}/5</p>}
      <h4 className="text-xs font-medium">能力证据</h4>
      <p className="text-xs text-sage">{String(record.payload.layer || "待分类")} · 补齐方式：{String(record.payload.method || "待选择")}</p>
      {[["gap", "当前缺口"], ["resourceNeeds", "资源投入"], ["successCriteria", "验证标准"]].map(([key, label]) => record.payload[key] ? <p key={key} className="whitespace-pre-wrap text-sm">{label}：{String(record.payload[key])}</p> : null)}
      {!evidenceFor(record).length && <p className="text-xs text-slate-500">待补充证据，可在编辑中关联已有证据。</p>}
      {evidenceFor(record).map((e: Row) => <div key={e.id} className="rounded bg-mist p-3"><p className="whitespace-pre-wrap text-sm">{e.evidence}</p><Button onClick={() => props.open({ type: "evidence", item: e })}>编辑证据</Button><Button onClick={() => props.remove("evidence", e.id)}>删除证据</Button><SelfLoop props={props} type="evidence" record={e} /></div>)}
      <Button onClick={() => setDraft({ ...record, payload: skillSchema.parse(record.payload) })}>编辑需求与状态</Button>
      <SelfLoop props={props} type="skill" record={record} />
    </div></details>)}
    {standalone.map((e: Row) => <details key={e.id} data-record-id={e.id} className="border-t border-line py-3"><summary className="cursor-pointer text-sm">{sceneNames(evidenceScenes(e.id))} · {e.ability} · 已有证据</summary><div className="mt-3 space-y-3"><p className="whitespace-pre-wrap text-sm">{e.evidence}</p><Button onClick={() => props.open({ type: "evidence", item: e })}>编辑证据与场景</Button><Button onClick={() => props.remove("evidence", e.id)}>删除证据</Button><Button onClick={() => setDraft({ kind: "skill", title: e.ability, sceneId: evidenceScenes(e.id).length === 1 ? evidenceScenes(e.id)[0] : props.target.scene && props.target.scene !== "all" ? props.target.scene : null, payload: skillSchema.parse({ category: "requirement", evidenceId: e.id }) })}>补充能力需求</Button><SelfLoop props={props} type="evidence" record={e} /></div></details>)}
    <details className="mt-4 border-t border-line pt-3"><summary className="cursor-pointer text-xs">已归档能力</summary>{view.records.filter((row) => row.kind === "skill" && row.archived).map((row) => <div key={row.id} className="my-2 text-sm">{row.title}<Button disabled={working} onClick={() => void post("record", { ...row, archived: false })}>恢复能力</Button></div>)}</details>
    {draft && <EditDialog title="编辑能力需求" working={working} onClose={() => setDraft(null)} onSave={async () => { if (await post("record", draft)) setDraft(null); }}>
      <Field label="能力名称"><input required maxLength={300} value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} /></Field>
      <Field label="场景"><SceneSelect view={view} value={draft.sceneId || ""} onChange={(sceneId) => setDraft({ ...draft, sceneId: sceneId || null })} /></Field>
      <Field label="关联同类能力证据"><select value={draft.payload.evidenceId || ""} onChange={(e) => setDraft({ ...draft, payload: { ...draft.payload, evidenceId: e.target.value || null } })}><option value="">暂不关联</option>{(props.data?.evidences || []).map((e: Row) => <option key={e.id} value={e.id}>{e.ability} · {e.evidence}</option>)}</select></Field>
      <Field label="自评（可选）"><input type="number" min={1} max={5} value={draft.payload.rating ?? ""} onChange={(e) => setDraft({ ...draft, payload: { ...draft.payload, rating: e.target.value ? Number(e.target.value) : null } })} /></Field>
      <Field label="重要性"><select value={draft.payload.importance} onChange={(e) => setDraft({ ...draft, payload: { ...draft.payload, importance: e.target.value } })}>{priorities.map((value) => <option key={value}>{value}</option>)}</select></Field>
      <Field label="能力层次"><select value={draft.payload.layer} onChange={(e) => setDraft({ ...draft, payload: { ...draft.payload, layer: e.target.value } })}>{["待分类", "底层自我管理", "中层杠杆能力", "高层专业能力"].map((value) => <option key={value}>{value}</option>)}</select></Field>
      <Field label="补齐方式"><select value={draft.payload.method} onChange={(e) => setDraft({ ...draft, payload: { ...draft.payload, method: e.target.value } })}>{["待选择", "实战", "拜师", "阅读", "工具", "组合"].map((value) => <option key={value}>{value}</option>)}</select></Field>
      {[["gap", "当前缺口（优先一两项）"], ["resourceNeeds", "资源投入（时间、精力、资金、信息）"], ["successCriteria", "结果验证标准"]].map(([key, label]) => <Field key={key} label={label}><textarea rows={2} value={draft.payload[key]} onChange={(e) => setDraft({ ...draft, payload: { ...draft.payload, [key]: e.target.value } })} /></Field>)}
      <Field label="重要性依据"><textarea rows={2} value={draft.payload.importanceReason} onChange={(e) => setDraft({ ...draft, payload: { ...draft.payload, importanceReason: e.target.value } })} /></Field>
      <Field label="推进状态"><select value={draft.payload.requirementStatus} onChange={(e) => setDraft({ ...draft, payload: { ...draft.payload, requirementStatus: e.target.value } })}>{["待推进", "进行中", "已达成", "暂缓"].map((value) => <option key={value}>{value}</option>)}</select></Field>
      <Field label="需求、渠道及行动计划"><textarea rows={12} maxLength={10000} value={draft.payload.improvement} onChange={(e) => setDraft({ ...draft, payload: { ...draft.payload, improvement: e.target.value } })} /></Field>
    </EditDialog>}
  </section>;
}
