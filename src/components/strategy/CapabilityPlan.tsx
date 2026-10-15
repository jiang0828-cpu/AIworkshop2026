"use client";
import { useEffect, useRef, useState } from "react";
import { clientId } from "@/lib/client-id";
import { Button, Field, type ModuleProps, type Row, useStrategy } from "./Shared";
import { resourceClasses } from "@/lib/strategy/resource-shared";

export default function CapabilityPlan({ props, scope = "all" }: { props: ModuleProps; scope?: "all" | "resources" }) {
  const resourcesOnly = scope === "resources";
  const { view, post } = useStrategy(props);
  const visions = view.records.filter((row) => ["vision", "overallVision"].includes(row.kind) && !row.archived);
  const [ids, setIds] = useState<string[]>([]), [instruction, setInstruction] = useState(""), [allow, setAllow] = useState(false);
  const [preview, setPreview] = useState<Row | null>(null), [result, setResult] = useState<Row | null>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const [selected, setSelected] = useState<string[]>([]), [saved, setSaved] = useState<Record<string, string>>({}), [modes, setModes] = useState<Record<string, string>>({});
  const [filter, setFilter] = useState("全部"), [importance, setImportance] = useState("全部"), [dismissed, setDismissed] = useState<string[]>([]);
  const [element, setElement] = useState("全部"), [sceneFilter, setSceneFilter] = useState("all");
  const lock = useRef(false), requestIds = useRef<Record<string, string>>({});
  const [loadingDraft, setLoadingDraft] = useState(resourcesOnly);
  useEffect(() => {
    if (!resourcesOnly) return;
    let active = true;
    const load = () => { void fetch("/api/capability-plan").then(async (response) => {
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "读取草稿失败");
      if (active && data.draft) {
        setIds(data.draft.ids); setResult(data.draft.result); setSaved(data.draft.saved);
        setPreview({ inventory: data.draft.inventory, sources: [], supporting: [], excluded: 0 });
        requestIds.current = data.draft.requestIds;
      }
    }).catch((cause) => { if (active) setError(cause instanceof Error ? cause.message : "读取草稿失败"); })
      .finally(() => { if (active) setLoadingDraft(false); }); };
    load(); window.addEventListener("resource-draft-updated", load);
    return () => { active = false; window.removeEventListener("resource-draft-updated", load); };
  }, [resourcesOnly]);
  const reset = () => { setPreview(null); setResult(null); setSelected([]); setSaved({}); setModes({}); setDismissed([]); setError(""); requestIds.current = {}; };
  const run = async (previewOnly: boolean) => {
    if (lock.current) return; lock.current = true; setBusy(true); setError("");
    try {
      const response = await fetch("/api/capability-plan", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ids, scope, instruction, allowSensitive: allow, previewOnly, fingerprint: preview?.fingerprint }) });
      const data = await response.json(); if (!response.ok) throw new Error(data.error || "请求失败");
      if (previewOnly) setPreview(data); else { setResult(data); setSelected([]); setSaved({}); setModes({}); setDismissed([]); requestIds.current = data.requestIds || {}; }
    } catch (error) { setError(error instanceof Error ? error.message : "请求失败"); }
    finally { lock.current = false; setBusy(false); }
  };
  const rows: Row[] = result ? [...result.capabilities.map((row: Row, index: number) => ({ row, index, kind: "skill", key: `skill:${index}` })), ...result.resources.map((row: Row, index: number) => ({ row, index, kind: "resource", key: `resource:${index}` }))] : [];
  const update = (kind: string, index: number, key: string, value: unknown) => setResult((current: Row | null) => {
    const collection = kind === "skill" ? "capabilities" : "resources";
    return current && { ...current, [collection]: current[collection].map((row: Row, i: number) => i === index ? { ...row, [key]: value } : row) };
  });
  const matchTitle = (match: Row | null) => preview?.inventory.find((item: Row) => item.type === match?.type && item.id === match?.id)?.title || "未匹配已有记录";
  const save = async (keys: string[]) => {
    if (lock.current) return; lock.current = true; setBusy(true); setError("");
    try {
      for (const item of rows.filter((item) => keys.includes(item.key) && !saved[item.key])) {
        const mode = modes[item.key] || (item.row.match ? "supplement" : "new");
        const response = await fetch("/api/requirement-confirm", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ kind: item.kind, mode, requestId: requestIds.current[item.key] ||= clientId(), demand: item.row }) });
        const data = await response.json(); if (!response.ok) throw new Error(data.error || "保存失败");
        setSaved((current) => ({ ...current, [item.key]: mode === "reuse" ? "已复用" : mode === "supplement" ? "已补充" : "已新增" }));
      }
      props.notify("已确认录入所选需求");
    } catch (error) { setError(error instanceof Error ? error.message : "保存失败，未保存草稿已保留"); }
    finally {
      try { await props.reload(); } catch { props.notify("列表刷新失败，请稍后刷新"); }
      try { const response = await fetch("/api/sync", { method: "POST" }); if (!response.ok) props.notify("本地已保存，云端同步暂未完成"); } catch { props.notify("云端同步暂未完成"); }
      lock.current = false; setBusy(false);
    }
  };
  const openOriginal = (target: Row) => props.navigate({ section: "self", tab: target.type === "resource" ? "resources" : "skills", scene: "all", recordId: target.id });
  return <details className="mb-5 rounded border border-line p-4" open={resourcesOnly || undefined}><summary className="cursor-pointer text-sm font-medium text-sage">{resourcesOnly ? "AI 资源需求 · 根据个人档案与愿景" : "AI 愿景需求规划 · 能力与资源"}</summary><div className="mt-3 space-y-3">
    <p className="text-xs text-slate-500">{resourcesOnly ? "个人档案与愿景 → 匹配已有资源 → 按能量、物质、信息分类 → 手动筛选录入。" : "目标、衡量标准、时间进度 → 对照已有能力和资源 → 筛选需求 → 确认复用、补充或新增。"}未勾选内容不录入。</p>
    {loadingDraft && <p className="text-xs text-slate-500">正在读取待选草稿…</p>}
    <fieldset disabled={busy || loadingDraft} className="space-y-3"><legend className="mb-2 text-xs">选择愿景</legend>
      {resourcesOnly && <Button onClick={() => { setIds(visions.map((row) => row.id)); reset(); }}>选择全部愿景</Button>}
      {visions.map((row) => <label key={row.id} className="mr-3 inline-flex items-center gap-1 text-sm"><input className="!w-auto" type="checkbox" checked={ids.includes(row.id)} onChange={(e) => { setIds(e.target.checked ? [...ids, row.id] : ids.filter((id) => id !== row.id)); reset(); }} />{row.title}</label>)}
      {!visions.length && <p className="text-xs">请先在“我的愿景”保存核心目标、衡量标准和时间范围。</p>}
      <Field label="本轮重点与可投入条件（可选）"><textarea rows={2} maxLength={5000} value={instruction} onChange={(e) => { setInstruction(e.target.value); reset(); }} /></Field>
      <label className="flex items-center gap-2 text-xs"><input className="!w-auto" type="checkbox" checked={allow} onChange={(e) => { setAllow(e.target.checked); reset(); }} />允许本次发送个人档案、愿景和已有资料中的敏感内容（档案仍遵循字段授权）</label>
    </fieldset>
    <Button disabled={busy || loadingDraft || !ids.length} onClick={() => void run(true)}>预览愿景与已有资料</Button>
    {preview?.fingerprint && <><details><summary className="text-xs">发送范围：{preview.sources.length} 项愿景、{preview.inventory.length} 项已有资料；已排除 {preview.excluded} 项未授权资料</summary><p className="whitespace-pre-wrap text-xs">补充说明：{preview.instruction}</p>{[...preview.sources, ...preview.inventory].map((row: Row) => <div key={`${row.type}:${row.id}`} className="mt-2"><h4 className="text-sm">{row.title}</h4><pre className="max-h-48 overflow-auto whitespace-pre-wrap break-words bg-mist p-2 text-xs">{row.blocked ? row.content : JSON.stringify(JSON.parse(row.content), null, 2)}</pre></div>)}</details><Button disabled={busy || preview.instructionBlocked || preview.sources.some((row: Row) => row.blocked)} onClick={() => void run(false)}>{busy ? "正在处理…" : "确认发送并生成需求"}</Button></>}
    {error && <p role="alert" className="whitespace-pre-wrap text-sm text-rose-600">{error}</p>}
    {preview && <details><summary className="text-xs">关联背景：个人档案、经历、约束及现有目标项目任务（{preview.supporting?.length || 0} 项；另排除 {preview.excludedSupporting || 0} 项未授权资料）</summary>{preview.supporting?.map((row: Row) => <details key={`${row.type}:${row.id}`} className="mt-2"><summary className="cursor-pointer text-xs">{row.title}</summary><pre className="max-h-48 overflow-auto whitespace-pre-wrap break-words bg-mist p-2 text-xs">{JSON.stringify(JSON.parse(row.content), null, 2)}</pre></details>)}</details>}
    {result && <div className="space-y-4"><p className="whitespace-pre-wrap text-sm">{result.summary}</p>
      {resourcesOnly && <div className="flex flex-wrap items-center gap-3"><span className="text-xs text-slate-500">待选草稿已保留；只有确认项进入资源账本。编辑内容需确认录入后保存。</span><Button disabled={busy} onClick={async () => {
        if (!window.confirm("放弃本轮资源草稿？已录入资源会保留。")) return;
        if (lock.current) return; lock.current = true; setBusy(true); setError("");
        try { const response = await fetch("/api/capability-plan", { method: "DELETE" }); if (!response.ok) throw new Error("放弃草稿失败，请重试"); reset(); }
        catch (cause) { setError(cause instanceof Error ? cause.message : "放弃草稿失败"); }
        finally { lock.current = false; setBusy(false); }
      }}>放弃草稿</Button></div>}
      <div className="flex flex-wrap gap-2"><select aria-label="需求类型筛选" className="!w-auto !max-w-full" value={filter} onChange={(e) => setFilter(e.target.value)}>{(resourcesOnly ? ["全部", "已匹配", "建议新增"] : ["全部", "能力", "资源", "已匹配", "建议新增"]).map((value) => <option key={value}>{value}</option>)}</select><select aria-label="需求重要性筛选" className="!w-auto" value={importance} onChange={(e) => setImportance(e.target.value)}>{["全部", "关键", "重要", "一般"].map((value) => <option key={value}>{value}</option>)}</select>
        {resourcesOnly && <><select aria-label="资源需求分类筛选" className="!w-auto !max-w-full" value={element} onChange={(e) => setElement(e.target.value)}>{["全部", "能量", "物质", "信息"].map((value) => <option key={value}>{value}</option>)}</select><select aria-label="资源需求场景筛选" className="!w-auto !max-w-full" value={sceneFilter} onChange={(e) => setSceneFilter(e.target.value)}><option value="all">全部场景</option><option value="overall">总愿景</option>{view.scenes.map((scene) => <option key={scene.id} value={scene.id}>{scene.name}</option>)}</select></>}
        <Button primary disabled={busy || !selected.some((key) => !saved[key])} onClick={() => void save(selected)}>确认录入所选（{selected.filter((key) => !saved[key]).length}）</Button></div>
      {!rows.length && <p className="text-sm">本轮没有新增需求，可继续复用已有能力与资源。</p>}
      {rows.filter(({ kind, row }) => (filter === "全部" || filter === "能力" && kind === "skill" || filter === "资源" && kind === "resource" || filter === "已匹配" && row.match || filter === "建议新增" && !row.match) && (importance === "全部" || row.importance === importance) && (!resourcesOnly || (element === "全部" || row.element === element) && (sceneFilter === "all" || (visions.find((vision) => vision.id === row.visionId)?.sceneId || "overall") === sceneFilter))).sort((a, b) => ["关键", "重要", "一般"].indexOf(a.row.importance) - ["关键", "重要", "一般"].indexOf(b.row.importance)).map(({ row, key, kind, index }) => {
        const vision = visions.find((item) => item.id === row.visionId), mode = modes[key] || (row.match ? "supplement" : "new");
        const candidates = (preview?.inventory || []).filter((item: Row) => kind === "resource" ? item.type === "resource" : item.type !== "resource");
        const fields = kind === "skill" ? [["requirements", "具体需求"], ["gap", "能力缺口（待验证）"], ["resourceNeeds", "资源投入"], ["successCriteria", "验证标准"], ["channels", "实现渠道"], ["plan", "后续行动计划"]] : [["requirements", "需求数量与程度"], ["allocation", "建议投入"], ["boundary", "底线"], ["expectedReturn", "预期产出与验证标准"], ["nextStep", "获取或配置行动"]];
        return <div key={key} className="min-w-0 rounded border border-line p-3"><label className="flex items-start gap-2 text-sm"><input type="checkbox" className="!w-auto" disabled={busy || Boolean(saved[key])} checked={selected.includes(key)} onChange={(e) => setSelected(e.target.checked ? [...selected, key] : selected.filter((item) => item !== key))} /><span className="min-w-0 break-words">{kind === "skill" ? "能力" : `${row.element} · ${row.capitalClass || "待分类"}`} · {row.title} · {row.importance} · {vision?.sceneId ? view.scenes.find((scene) => scene.id === vision.sceneId)?.name : "总愿景"} · {saved[key] || (row.match ? "可复用／需补充" : "建议新增")}</span></label>
          <details className="mt-2"><summary className="cursor-pointer text-xs text-sage">查看依据、匹配及编辑需求</summary><div className="mt-3 space-y-3">
            <p className="whitespace-pre-wrap text-xs">愿景：{vision?.title}；{row.reason}</p><p className="whitespace-pre-wrap text-xs">匹配：{matchTitle(row.match)}。{row.matchReason}</p>
            <fieldset disabled={busy || Boolean(saved[key])} className="space-y-3"><Field label="名称"><input maxLength={300} value={row.title} onChange={(e) => update(kind, index, "title", e.target.value)} /></Field>
              {resourcesOnly && <Field label="归属愿景与场景"><select value={row.visionId} onChange={(e) => update(kind, index, "visionId", e.target.value)}>{visions.filter((vision) => ids.includes(vision.id)).map((vision) => <option key={vision.id} value={vision.id}>{vision.title}</option>)}</select></Field>}
              <Field label="重要性"><select value={row.importance} onChange={(e) => update(kind, index, "importance", e.target.value)}>{["关键", "重要", "一般"].map((value) => <option key={value}>{value}</option>)}</select></Field>
              <Field label="时间进度（何时需要）"><textarea rows={2} maxLength={5000} value={row.timing} onChange={(e) => update(kind, index, "timing", e.target.value)} /></Field>
              {kind === "resource" && <Field label="资源要素"><select disabled={Boolean(row.capitalClass && row.capitalClass !== "待分类")} value={row.element} onChange={(e) => update(kind, index, "element", e.target.value)}>{["能量", "物质", "信息"].map((value) => <option key={value}>{value}</option>)}</select></Field>}
              {kind === "resource" && <Field label="六类资本"><select value={row.capitalClass || "待分类"} onChange={(e) => { update(kind, index, "capitalClass", e.target.value); const chosen = resourceClasses.find((item) => item.name === e.target.value); if (chosen) update(kind, index, "element", chosen.element); }}><option>待分类</option>{resourceClasses.map((item) => <option key={item.name}>{item.name}</option>)}</select></Field>}
              {fields.map(([field, label]) => <Field key={field} label={label}><textarea rows={2} maxLength={5000} value={row[field] || ""} onChange={(e) => update(kind, index, field, e.target.value)} /></Field>)}
              <Field label="匹配已有记录（可手动调整）"><select value={row.match ? `${row.match.type}:${row.match.id}` : ""} onChange={(e) => { const match = candidates.find((item: Row) => `${item.type}:${item.id}` === e.target.value); update(kind, index, "match", match ? { type: match.type, id: match.id } : null); setModes((current) => ({ ...current, [key]: match ? "supplement" : "new" })); }}><option value="">未匹配，新增需求</option>{candidates.map((item: Row) => <option key={`${item.type}:${item.id}`} value={`${item.type}:${item.id}`}>{item.title} · {item.type === "evidence" ? "证据" : "已有记录"}</option>)}</select></Field>
              <Field label="确认后的处理方式"><select value={mode} onChange={(e) => setModes((current) => ({ ...current, [key]: e.target.value }))}><option value="new">新增需求{row.match ? "（确认确有不同用途）" : ""}</option>{row.match && <><option value="supplement">补充已有记录（保留原内容与证据）</option><option value="reuse">直接复用（只关联愿景，不改内容）</option></>}</select></Field>
              <p className="text-xs text-slate-500">补充只追加本轮需求，不覆盖既有评分、存量或实际产出；新增资源标记为“待获取需求”。</p>
            </fieldset>
            <Button disabled={busy || Boolean(saved[key]) || !row.title.trim()} onClick={() => void save([key])}>{saved[key] || "确认录入这一项"}</Button>
            {row.match && <Button onClick={() => openOriginal(row.match)}>查看已有记录</Button>}
            {kind === "skill" && <details><summary className="cursor-pointer text-xs">建议项目与任务</summary><p className="my-2 whitespace-pre-wrap text-xs">{row.project.name}：{row.project.description}；验收：{row.project.metric}</p><Button onClick={() => props.open({ type: "project", item: { name: row.project.name, description: row.project.description, metric: row.project.metric, sceneId: vision?.sceneId, visionId: vision?.kind === "vision" ? vision.id : null } })}>打开项目草稿</Button>{row.tasks.map((task: Row, i: number) => <div className="mt-2" key={i}><p className="text-xs">{task.title} · {task.executor}；前置：{task.dependency}；验收：{task.standard}</p><Button onClick={() => props.open({ type: "action", item: { title: task.title, standard: task.standard, purpose: `能力：${row.title}\n前置：${task.dependency}`, sceneId: vision?.sceneId } })}>打开行动草稿</Button></div>)}<Button onClick={() => props.navigate({ section: "daily" })}>到每日协同编排</Button></details>}
          </div></details></div>;
      })}
      {!resourcesOnly && <details className="border-t border-line pt-3"><summary className="cursor-pointer text-sm">清理建议（{result.cleanup.length}）：逐项核对，不自动删除</summary><p className="my-2 text-xs text-slate-500">本轮不需要不代表长期无用。先核对原内容及关联，再决定保留或处理。</p>{!result.cleanup.length && <p className="text-xs">没有充分依据建议清理现有内容。</p>}{result.cleanup.map((item: Row, index: number) => { const key = `cleanup:${index}`, record = view.records.find((row) => row.id === item.target.id && row.kind === "skill"); return <div key={key} className="space-y-2 border-t border-line py-3"><p className="text-sm">{matchTitle(item.target)} · {item.suggestion}</p><p className="whitespace-pre-wrap text-xs">{item.reason}</p>{dismissed.includes(key) ? <p className="text-xs">已处理／保留</p> : <div className="flex flex-wrap gap-2"><Button onClick={() => openOriginal(item.target)}>打开原记录核对</Button><Button onClick={() => setDismissed((current) => [...current, key])}>保留，忽略建议</Button>{record && <Button disabled={busy} onClick={async () => { if (window.confirm("确认归档这条能力？原内容、证据和行动保留，可从能力库恢复。")) { const result = await post("record", { ...record, archived: true }); if (result) setDismissed((current) => [...current, key]); } }}>确认归档能力</Button>}</div>}</div>; })}</details>}
    </div>}
  </div></details>;
}
