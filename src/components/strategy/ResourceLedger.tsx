"use client";
import { useState } from "react";
import { Pencil, Plus, History, Trash2 } from "lucide-react";
import { clientId } from "@/lib/client-id";
import { resourceLedgerSchema, resourceClasses, readResourceLedger, resourceDue, compareResources } from "@/lib/strategy/resource-shared";
import { Button, EditDialog, Field, Link, type ModuleProps, type Row, useStrategy } from "./Shared";
import SelfLoop from "./SelfLoop";
import ResourceClassification from "./ResourceClassification";

const configFields = [["available", "可用存量与单位"], ["allocation", "计划投入"], ["expectedReturn", "预期产出与验收标准"], ["boundary", "使用边界与停止条件"], ["nextStep", "下一步"]];
export default function ResourceLedger({ props }: { props: ModuleProps }) {
  const { view, post, working } = useStrategy(props);
  const [capital, setCapital] = useState("全部"), [scope, setScope] = useState("全部"), [availability, setAvailability] = useState("全部");
  const [dueOnly, setDueOnly] = useState(false), [draft, setDraft] = useState<Row | null>(null), [historyId, setHistoryId] = useState("");
  const tag = (id: string) => view.records.find((row) => row.kind === "tag" && row.payload.subjectType === "resource" && row.payload.subjectId === id);
  const inScene = (type: string, id: string) => {
    const ids = view.records.find((row) => row.kind === "tag" && row.payload.subjectType === type && row.payload.subjectId === id)?.payload.sceneIds as string[] || [];
    return !props.target.scene || props.target.scene === "all" || ids.includes(props.target.scene);
  };
  const all: Row[] = (props.data?.resources || []).map((row: Row) => ({ ...row, ledger: readResourceLedger(tag(row.id)?.payload.ledger, row.category) }));
  const resources = all.filter((row) => inScene("resource", row.id) && (capital === "全部" || row.ledger.capitalClass === capital) &&
    (scope === "全部" || (scope === "待获取需求" ? row.ledger.availability === "待获取" : row.ledger.availability !== "待获取")) &&
    (availability === "全部" || row.ledger.availability === availability) && (!dueOnly || resourceDue(row.ledger))).sort((a, b) => compareResources({ name: a.name, ledger: a.ledger }, { name: b.name, ledger: b.ledger }));
  const configure = (row?: Row) => setDraft({ kind: "config", id: row?.id, requestId: clientId(), name: row?.name || "", description: row?.description || "",
    expectedUpdatedAt: row?.updatedAt || null, expectedLedgerUpdatedAt: row ? tag(row.id)?.updatedAt || null : null,
    sceneIds: row ? tag(row.id)?.payload.sceneIds || [] : props.target.scene && props.target.scene !== "all" ? [props.target.scene] : [], ledger: row?.ledger || resourceLedgerSchema.parse({}) });
  const evaluations = (id: string) => {
    const seen = new Set<string>();
    return view.versions.filter((version) => version.recordId === tag(id)?.id).flatMap((version) => {
      const snapshot = JSON.parse(version.snapshot), ledger = resourceLedgerSchema.parse(snapshot.payload?.ledger || {}), entry = ledger.lastEvaluation;
      if (!entry || seen.has(`${entry.reviewId}:${entry.reviewVersion}`)) return [];
      seen.add(`${entry.reviewId}:${entry.reviewVersion}`); return [{ ...entry, ledger }];
    });
  };
  const evaluate = (row: Row, actionId: string) => {
    const review = view.selfReviews?.find((item) => item.actionId === actionId);
    if (!review?.updatedAt) { props.notify("请先保存任务复盘"); return; }
    if (evaluations(row.id).some((entry) => entry.actionId === actionId && entry.reviewVersion === review.updatedAt)) { setHistoryId(row.id); return; }
    setDraft({ kind: "evaluation", resourceId: row.id, actionId, reviewVersion: review.updatedAt, name: row.name, reviewResult: review.result,
      expectedUpdatedAt: row.updatedAt, expectedLedgerUpdatedAt: tag(row.id)?.updatedAt || null,
      actualInvestment: "", actualReturn: "", observation: "", adjustment: "继续", available: row.ledger.available,
      availability: row.ledger.availability === "待确认" ? "" : row.ledger.availability, nextStep: review.adjustment || row.ledger.nextStep, nextCheckDate: row.ledger.nextCheckDate });
  };
  const patch = (key: string, value: unknown) => setDraft((current) => current && { ...current, [key]: value });
  const patchLedger = (key: string, value: unknown) => setDraft((current) => current && { ...current, ledger: resourceLedgerSchema.parse({ ...current.ledger, [key]: value }) });
  return <section className="space-y-4">
    <div className="flex flex-wrap items-center justify-between gap-2"><h2 className="font-medium">资源账本</h2><Button onClick={() => configure()}><Plus size={14} />新增资源</Button></div>
    <ResourceClassification props={props} />
    <div className="flex flex-wrap items-center gap-2">
      <select aria-label="六类资源筛选" className="!w-auto !max-w-full" value={capital} onChange={(e) => setCapital(e.target.value)}>{["全部", ...resourceClasses.map((item) => item.name), "待分类"].map((value) => <option key={value}>{value}</option>)}</select>
      <select aria-label="资源存量与需求筛选" className="!w-auto !max-w-full" value={scope} onChange={(e) => setScope(e.target.value)}>{["全部", "已有资源", "待获取需求"].map((value) => <option key={value}>{value}</option>)}</select>
      <select aria-label="资源可用状态筛选" className="!w-auto !max-w-full" value={availability} onChange={(e) => setAvailability(e.target.value)}>{["全部", "待确认", "待获取", "可用", "受限", "不可用"].map((value) => <option key={value}>{value}</option>)}</select>
      <label className="flex items-center gap-2 text-xs"><input type="checkbox" className="!w-auto" checked={dueOnly} onChange={(e) => setDueOnly(e.target.checked)} />待检查（{all.filter((row) => inScene("resource", row.id) && resourceDue(row.ledger)).length}）</label>
    </div>
    {!resources.length && <p className="text-sm text-slate-500">当前筛选下暂无资源。</p>}
    {[...resourceClasses.map((item) => ({ ...item, label: `${item.element} · ${item.name}` })), { name: "待分类", element: "待分类", label: "待分类" }].map((group) => {
      const members = resources.filter((row) => row.ledger.capitalClass === group.name); if (!members.length) return null;
      return <details key={group.name} open className="border-t border-line pt-3"><summary className="cursor-pointer text-sm font-medium">{group.label}（{members.length}）</summary><div className="mt-2 divide-y divide-line">
        {members.map((row) => { const ledger = row.ledger; return <details key={row.id} open={props.target.recordId === row.id || historyId === row.id || undefined} data-record-id={row.id} className="py-3">
          <summary className="cursor-pointer break-words text-sm">{row.name} <span className="text-xs text-slate-500">· {ledger.importance} · {ledger.availability} · {ledger.adjustment}{resourceDue(ledger) ? " · 待检查" : ""}{group.name === "待分类" ? ` · 原要素：${ledger.element}` : ""}</span></summary>
          <div className="mt-3 space-y-4">
            <div><div className="mb-2 flex flex-wrap items-center justify-between gap-2"><h3 className="text-xs font-medium">1 · 盘点与配置</h3><Button onClick={() => configure(row)}><Pencil size={14} />编辑配置</Button></div>
              <p className="mb-2 text-xs text-sage">{(tag(row.id)?.payload.sceneIds as string[] || []).map((id) => view.scenes.find((scene) => scene.id === id)?.name).filter(Boolean).join(" · ") || "全局"}</p>
              <dl className="grid gap-2 text-xs sm:grid-cols-2">{configFields.slice(0, 3).map(([key, label]) => <div key={key}><dt className="text-slate-500">{label}</dt><dd className="mt-1 whitespace-pre-wrap break-words">{ledger[key] || "待确认"}</dd></div>)}</dl>
              <details className="mt-2"><summary className="cursor-pointer text-xs text-slate-500">说明、边界与下一步</summary><p className="my-2 whitespace-pre-wrap break-words text-sm">{row.description || "尚未填写说明"}</p>{configFields.slice(3).map(([key, label]) => <p key={key} className="whitespace-pre-wrap break-words text-xs">{label}：{ledger[key] || "待确认"}</p>)}<p className="mt-2 text-xs">下次检查：{ledger.nextCheckDate || "未安排"}</p></details>
            </div>
            <div><h3 className="text-xs font-medium">2 · 使用／获取／维护与任务复盘</h3><SelfLoop props={props} type="resource" record={{ ...row, _ledger: ledger }} onResourceEvaluate={(actionId) => evaluate(row, actionId)} /></div>
            <div><h3 className="mb-2 text-xs font-medium">3 · 评估与更新</h3><p className="whitespace-pre-wrap break-words text-xs">实际投入：{ledger.actualInvestment || "待确认"}<br />实际产出：{ledger.actualReturn || "待确认"}<br />可用情况：{ledger.observation || "待确认"}<br />调整结论：{ledger.adjustment}<br />下一步：{ledger.nextStep || "待确认"}</p></div>
            <details open={historyId === row.id || undefined}><summary className="flex cursor-pointer items-center gap-1 text-xs text-slate-500"><History size={13} />评估与配置历史</summary>
              {!evaluations(row.id).length && <p className="mt-2 text-xs text-slate-500">尚未确认评估；完成关联任务并保存复盘后可评估更新。</p>}
              {evaluations(row.id).map((entry) => <div key={`${entry.reviewId}:${entry.reviewVersion}`} className="my-3 border-t border-line pt-2 text-xs"><p>{new Date(entry.evaluatedAt).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" })} · {entry.adjustment}</p><p className="whitespace-pre-wrap break-words">投入：{entry.actualInvestment}<br />产出：{entry.actualReturn}<br />可用情况：{entry.observation}<br />确认存量：{entry.ledger.available}<br />下一步：{entry.ledger.nextStep}</p>{props.data?.actions?.some((action: Row) => action.id === entry.actionId) ? <Link onClick={() => props.navigate({ section: "actions", recordId: entry.actionId })}>{props.data?.actions?.find((action: Row) => action.id === entry.actionId)?.title}</Link> : <span>任务已删除</span>}</div>)}
              <details className="mt-2"><summary className="cursor-pointer text-xs">历次配置</summary>{view.versions.filter((version) => version.recordId === tag(row.id)?.id).map((version) => <details key={version.id} className="my-2"><summary className="text-xs">{new Date(version.createdAt).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" })}</summary><pre className="max-h-48 overflow-auto whitespace-pre-wrap break-words bg-mist p-2 text-xs">{JSON.stringify(JSON.parse(version.snapshot).payload.ledger, null, 2)}</pre></details>)}</details>
            </details>
            <details><summary className="cursor-pointer text-xs text-slate-400">其他操作</summary><Button onClick={() => props.remove("resource", row.id)}><Trash2 size={13} />删除资源</Button></details>
          </div></details>; })}</div></details>;
    })}
    <details className="border-t border-line pt-3"><summary className="cursor-pointer text-sm">约束与待验证假设</summary>{[["constraints", "constraint", "约束"], ["assumptions", "assumption", "假设"]].map(([collection, type, label]) => <div key={type} className="my-4 space-y-3"><Button onClick={() => props.open({ type, item: { _sceneIds: props.target.scene && props.target.scene !== "all" ? [props.target.scene] : [] } })}><Plus size={14} />新增{label}</Button>{(props.data?.[collection] || []).filter((row: Row) => inScene(type, row.id)).map((row: Row) => <div key={row.id} className="border-t border-line pt-2"><p className="text-sm">{row.name || row.statement}</p><p className="whitespace-pre-wrap break-words text-xs">{row.description || row.evidence}</p><Button onClick={() => props.open({ type, item: row })}>编辑</Button><Button onClick={() => props.remove(type, row.id)}>删除</Button><SelfLoop props={props} type={type} record={row} /></div>)}</div>)}</details>
    {draft && <EditDialog title={draft.kind === "config" ? "资源盘点与配置" : `评估与确认更新：${draft.name}`} working={working} saveLabel={draft.kind === "config" ? "保存配置" : "确认评估并更新"} onClose={() => setDraft(null)} onSave={async () => {
      const result = await post(draft.kind === "config" ? "resource-save" : "resource-evaluate", draft); if (result) { setDraft(null); if (draft.kind === "evaluation") setHistoryId(draft.resourceId); }
    }}>
      {draft.kind === "config" ? <>
        <Field label="资源名称"><input required maxLength={300} value={draft.name} onChange={(e) => patch("name", e.target.value)} /></Field>
        <Field label="六类资本"><select value={draft.ledger.capitalClass} onChange={(e) => patchLedger("capitalClass", e.target.value)}><option>待分类</option>{resourceClasses.map((item) => <option key={item.name} value={item.name}>{item.element} · {item.name}</option>)}</select></Field>
        <Field label="重要性"><select value={draft.ledger.importance} onChange={(e) => patchLedger("importance", e.target.value)}>{["待确认", "关键", "重要", "一般"].map((value) => <option key={value}>{value}</option>)}</select></Field>
        <Field label="可用状态"><select value={draft.ledger.availability} onChange={(e) => patchLedger("availability", e.target.value)}>{["待确认", "待获取", "可用", "受限", "不可用"].map((value) => <option key={value}>{value}</option>)}</select></Field>
        <fieldset><legend className="mb-1.5 text-xs text-slate-500">适用场景</legend><div className="flex flex-wrap gap-3">{view.scenes.map((scene) => <label key={scene.id} className="flex items-center gap-1 text-xs"><input type="checkbox" className="!w-auto" checked={draft.sceneIds.includes(scene.id)} onChange={(e) => patch("sceneIds", e.target.checked ? [...draft.sceneIds, scene.id] : draft.sceneIds.filter((id: string) => id !== scene.id))} />{scene.name}</label>)}</div></fieldset>
        {configFields.map(([key, label]) => <Field key={key} label={label}><textarea rows={2} maxLength={10000} value={draft.ledger[key]} onChange={(e) => patchLedger(key, e.target.value)} /></Field>)}
        <Field label="下次检查日期（可选）"><input type="date" value={draft.ledger.nextCheckDate || ""} onChange={(e) => patchLedger("nextCheckDate", e.target.value || null)} /></Field>
        <details><summary className="cursor-pointer text-xs text-slate-500">资源说明</summary><Field label="说明"><textarea rows={4} maxLength={10000} value={draft.description} onChange={(e) => patch("description", e.target.value)} /></Field></details>
      </> : <>
        <details><summary className="cursor-pointer text-xs text-slate-500">已保存的任务复盘</summary><p className="mt-2 whitespace-pre-wrap break-words text-sm">{draft.reviewResult}</p><Button onClick={() => patch("actualReturn", draft.reviewResult)}>引用为实际产出</Button></details>
        {[["actualInvestment", "实际投入"], ["actualReturn", "实际产出"], ["observation", "可用情况与评估依据"]].map(([key, label]) => <Field key={key} label={label}><textarea required rows={2} maxLength={10000} value={draft[key]} onChange={(e) => patch(key, e.target.value)} /></Field>)}
        <Field label="调整结论"><select value={draft.adjustment} onChange={(e) => patch("adjustment", e.target.value)}>{["继续", "改进", "暂停", "重新配置"].map((value) => <option key={value}>{value}</option>)}</select></Field>
        <Field label="确认后的可用存量与单位"><textarea rows={2} value={draft.available} onChange={(e) => patch("available", e.target.value)} /></Field>
        <Field label="确认后的可用状态"><select required value={draft.availability} onChange={(e) => patch("availability", e.target.value)}><option value="">请选择</option>{["待获取", "可用", "受限", "不可用"].map((value) => <option key={value}>{value}</option>)}</select></Field>
        <Field label="下一步"><textarea rows={2} value={draft.nextStep} onChange={(e) => patch("nextStep", e.target.value)} /></Field>
        <Field label="下次检查日期（可选）"><input type="date" value={draft.nextCheckDate || ""} onChange={(e) => patch("nextCheckDate", e.target.value || null)} /></Field>
      </>}
    </EditDialog>}
  </section>;
}
