"use client";
import { otherSceneId } from "@/lib/scenes";
/* eslint-disable @typescript-eslint/no-explicit-any */
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { ArrowRight, Check, Loader2, Save, X } from "lucide-react";
import type { StrategyView } from "@/lib/strategy/shared";

export type Row = Record<string, any>;
export type Navigation = { section: string; tab?: string; scene?: string; recordId?: string; goalId?: string; projectId?: string; topic?: string; status?: string; page?: string; kind?: string; date?: string; column?: string; run?: string; historyPage?: string; planId?: string };
export type ModuleProps = { data: Row | null; notify: (message: string) => void; reload: () => Promise<void>;
  navigate: (target: Navigation) => void; open: (modal: { type: string; item?: Row }) => void;
  save: (type: string, data: Row, id?: string) => Promise<void>; remove: (type: string, id: string) => void;
  target: Navigation; };
export const emptyStrategy: StrategyView = { scenes: [], records: [], versions: [], relations: [], sources: [], pins: [] };
export function useStrategy(props: Pick<ModuleProps, "data" | "notify" | "reload">, syncAfterSave = true) {
  const [working, setWorking] = useState(false);
  const busy = useRef(false);
  const view: StrategyView = props.data?.strategy || emptyStrategy;
  const post = async (action: string, data: unknown, refresh = true) => {
    if (busy.current) return null;
    busy.current = true; setWorking(true);
    try {
      const response = await fetch("/api/strategy", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, data }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "保存失败");
      if (refresh) {
        const dialog = document.querySelector<HTMLFormElement>('form[role="dialog"][data-workbench-dirty="true"]');
        if (dialog) delete dialog.dataset.workbenchDirty;
        await props.reload();
        window.dispatchEvent(new Event("workbench-saved"));
        if (syncAfterSave) {
          const sync = await fetch("/api/sync", { method: "POST" });
          if (!sync.ok) props.notify("本地已保存，云端同步暂未完成"); else props.notify("已保存");
        } else props.notify("已保存到本地，未同步远端");
      }
      return result;
    } catch (error) { props.notify(error instanceof Error ? error.message : "操作失败"); return null; }
    finally { busy.current = false; setWorking(false); }
  };
  return { view, working, post };
}
export function Button({ children, onClick, disabled = false, primary = false, type = "button" }: { children: ReactNode; onClick?: () => void; disabled?: boolean; primary?: boolean; type?: "button" | "submit" }) {
  return <button type={type} onClick={onClick} disabled={disabled} className={`inline-flex min-h-9 items-center justify-center gap-2 rounded-md border px-3 py-2 text-sm disabled:opacity-40 ${primary ? "border-sage bg-sage text-white" : "border-line bg-white text-slate-600 hover:bg-mist"}`}>{children}</button>;
}
export function Field({ label, children }: { label: string; children: ReactNode }) { return <label className="block min-w-0 text-xs text-slate-500"><span className="mb-1.5 block">{label}</span>{children}</label>; }
export function Heading({ title, action }: { title: string; action?: ReactNode }) { return <div className="mb-5 flex flex-wrap items-center justify-between gap-3"><h1 className="text-2xl font-semibold">{title}</h1>{action}</div>; }
export function Tabs({ items, active, onChange }: { items: Array<[string, string]>; active: string; onChange: (tab: string) => void }) {
  return <div className="mb-5 flex overflow-x-auto border-b border-line" role="tablist">{items.map(([key, label]) => <button key={key} type="button" role="tab" aria-selected={active === key} onClick={() => onChange(key)} className={`shrink-0 border-b-2 px-3 py-3 text-sm ${active === key ? "border-sage font-medium text-sage" : "border-transparent text-slate-500"}`}>{label}</button>)}</div>;
}
export function SceneFilter({ view, value, onChange, inline = false }: { view: StrategyView; value: string; onChange: (value: string) => void; inline?: boolean }) {
  return <div className={inline ? "shrink-0" : "mb-4"}><select aria-label="场景筛选" className={`!w-auto !max-w-full ${inline ? "" : "!py-1.5 !text-xs"}`} value={value === "unclassified" ? view.scenes.find((scene) => scene.slot === 4)?.id : value} onChange={(event) => onChange(event.target.value)}>{[["all", "全部场景"], ...view.scenes.map((scene) => [scene.id, scene.name])].map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></div>;
}
export function matchesScene(id: string | null | undefined, filter: string, view?: StrategyView) { const other = otherSceneId(view?.scenes || []); return filter === "all" || (id || other) === (filter === "unclassified" ? other : filter); }
export function SceneSelect({ view, value, onChange, required = false }: { view: StrategyView; value: string; onChange: (value: string) => void; required?: boolean }) {
  return <select aria-label="主场景" value={value} onChange={(event) => onChange(event.target.value)} required={required}><option value="">{required ? "请选择场景" : "其他（默认）"}</option>{view.scenes.map((scene) => <option key={scene.id} value={scene.id}>{scene.name}</option>)}</select>;
}
export function Empty({ children = "暂无记录" }: { children?: ReactNode }) { return <div className="border-y border-dashed border-line py-10 text-center text-sm text-slate-400">{children}</div>; }
export function Link({ children, onClick }: { children: ReactNode; onClick: () => void }) { return <button type="button" onClick={onClick} className="inline-flex items-center gap-1.5 text-xs text-sage hover:underline">{children}<ArrowRight size={14} /></button>; }

export function DetailPane({ enabled, title, onClose, children, drawer = false }: { enabled: boolean; title: string; onClose: () => void; children: ReactNode; drawer?: boolean }) {
  const [mobile, setMobile] = useState(false);
  const ref = useRef<HTMLDivElement>(null), closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const media = window.matchMedia("(max-width: 767px)");
    const update = () => setMobile(media.matches); update();
    media.addEventListener("change", update); return () => media.removeEventListener("change", update);
  }, []);
  useEffect(() => {
    if ((!mobile && !drawer) || !enabled) return;
    const previous = document.activeElement as HTMLElement | null, overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden"; ref.current?.focus();
    const key = (event: KeyboardEvent) => {
      if (document.querySelector('form[role="dialog"]')) return;
      if (event.key === "Escape") closeRef.current();
      if (event.key === "Tab") {
        const controls = [...(ref.current?.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),a[href],summary') || [])].filter(element => element.getClientRects().length);
        if (!controls?.length) return;
        const first = controls[0], last = controls[controls.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
      }
    };
    document.addEventListener("keydown", key);
    return () => { document.body.style.overflow = overflow; document.removeEventListener("keydown", key); previous?.focus(); };
  }, [mobile, enabled, drawer]);
  if ((mobile || drawer) && enabled) return createPortal(<div className={`fixed inset-0 z-20 flex min-w-0 ${drawer ? "justify-end bg-slate-900/20" : "bg-white"}`} onClick={event => { if (event.target === event.currentTarget) onClose(); }}><div ref={ref} tabIndex={-1} role="dialog" aria-modal="true" aria-label={`${title}详情`} className={`flex min-w-0 flex-col bg-white outline-none ${drawer ? "h-full w-full max-w-2xl border-l border-line" : "w-full"}`}><div className="flex items-center justify-between gap-3 border-b border-line px-5 py-4"><h2 className="min-w-0 break-words text-sm font-semibold">{title}</h2><button type="button" aria-label="返回列表" title="返回列表" onClick={onClose} className="shrink-0 p-1"><X size={18} /></button></div><div className="min-h-0 flex-1 overflow-y-auto p-5">{children}</div></div></div>, document.body);
  return <>{children}</>;
}

export function useRecordFocus(recordId: string | undefined) {
  useEffect(() => {
    if (!recordId) return;
    document.querySelector<HTMLElement>(`[data-record-id="${CSS.escape(recordId)}"]`)?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [recordId]);
}

export function EditDialog({ title, children, onClose, onSave, working, saveLabel = "保存" }: { title: string; children: ReactNode; onClose: () => void; onSave: (form: HTMLFormElement) => Promise<void>; working: boolean; saveLabel?: string }) {
  const ref = useRef<HTMLFormElement>(null);
  const [dirty, setDirty] = useState(false), [leaving, setLeaving] = useState(false);
  const close = useCallback(() => { if (working) return; if (dirty) setLeaving(true); else onClose(); }, [dirty, working, onClose]);
  const closeRef = useRef(close), dirtyRef = useRef(dirty);
  closeRef.current = close; dirtyRef.current = dirty;
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow; document.body.style.overflow = "hidden";
    ref.current?.focus();
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeRef.current();
      if (event.key === "Tab") {
        const elements = ref.current?.querySelectorAll<HTMLElement>('button:not(:disabled),input,textarea,select');
        if (!elements?.length) return;
        const first = elements[0], last = elements[elements.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
      }
    };
    const unload = (event: BeforeUnloadEvent) => { if (dirtyRef.current) event.preventDefault(); };
    document.addEventListener("keydown", key); window.addEventListener("beforeunload", unload);
    return () => { document.body.style.overflow = overflow; document.removeEventListener("keydown", key); window.removeEventListener("beforeunload", unload); previous?.focus(); };
  }, []);
  return <div className="fixed inset-0 z-40 flex items-end justify-center bg-black/25 sm:items-center sm:p-5">
    <form ref={ref} tabIndex={-1} role="dialog" aria-modal="true" aria-label={title} onChange={(event) => { setDirty(true); event.currentTarget.dataset.workbenchDirty = "true"; }} onSubmit={(event) => { event.preventDefault(); void onSave(event.currentTarget); }} className="flex max-h-[92dvh] w-full max-w-2xl flex-col overflow-hidden rounded-t-lg border border-line bg-white outline-none sm:rounded-lg">
      <div className="flex items-center justify-between border-b border-line px-5 py-4"><h2 className="font-semibold">{title}</h2><button type="button" title="关闭" aria-label="关闭" onClick={close}><X size={18} /></button></div>
      <div className="space-y-4 overflow-y-auto p-5">{children}</div>
      {leaving && <div role="alert" className="flex flex-wrap items-center gap-2 border-t border-amber-200 bg-amber-50 px-5 py-3 text-xs"><span className="mr-auto">有未保存的修改</span><Button onClick={onClose}>放弃修改</Button><Button onClick={() => setLeaving(false)}>继续编辑</Button></div>}
      <div className="flex justify-end gap-2 border-t border-line px-5 py-4"><Button onClick={close} disabled={working}>取消</Button><Button type="submit" primary disabled={working}>{working ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />}{saveLabel}</Button></div>
    </form>
  </div>;
}

export function SourceLinks({ view, type, id, data, navigate }: { view: StrategyView; type: string; id: string; data: Row; navigate: ModuleProps["navigate"] }) {
  return <div className="mt-3 flex flex-wrap gap-2 text-xs">{view.sources.filter((source) => source.targetType === type && source.targetId === id).map((source) => {
    if (["radar", "judgementVersion"].includes(source.sourceType)) return <Link key={source.id} onClick={() => navigate({ section: "situation", tab: "judge", recordId: source.sourceId })}>研判版本：{source.sourceTitle}</Link>;
    if (source.sourceType === "research") return <Link key={source.id} onClick={() => navigate({ section: "situation", recordId: source.sourceId.split(":")[0] })}>研判来源：{source.sourceTitle}</Link>;
    const exists = source.sourceType === "profile" ? data.profile?.id === source.sourceId : ["signal", "vision", "overallVision", "skill"].includes(source.sourceType) ? view.records.some((record) => record.id === source.sourceId) : data[source.sourceType === "evidence" ? "evidences" : `${source.sourceType}s`]?.some((row: Row) => row.id === source.sourceId);
    if (exists && ["goal", "project", "action"].includes(source.sourceType)) return <Link key={source.id} onClick={() => navigate(source.sourceType === "goal" ? { section: "goals", goalId: source.sourceId } : source.sourceType === "project" ? { section: "goals", projectId: source.sourceId } : { section: "actions", recordId: source.sourceId })}>{source.sourceTitle}</Link>;
    const tab = source.sourceType === "profile" ? "profile" : source.sourceType === "signal" ? "signals" : source.sourceType === "decision" ? "decisions" : ["vision", "overallVision", "valueRule"].includes(source.sourceType) ? "values" : ["skill", "evidence"].includes(source.sourceType) ? "skills" : source.sourceType === "experience" ? "experiences" : "resources";
    return <span key={source.id}>{exists ? <Link onClick={() => navigate({ section: source.sourceType === "signal" ? "situation" : source.sourceType === "decision" ? "decisions" : "self", tab, recordId: source.sourceId })}>{source.sourceTitle}</Link> : `来源已删除：${source.sourceTitle}`}</span>;
  })}</div>;
}

export function RelatedResults({ view, type, id, data, navigate }: { view: StrategyView; type: string; id: string; data: Row; navigate: ModuleProps["navigate"] }) {
  const derived = view.sources.filter((source) => source.sourceType === type && source.sourceId === id);
  if (!derived.length) return null;
  return <div className="flex flex-wrap gap-3 border-t border-line pt-3">{derived.map((source) => {
    const record = (data[`${source.targetType}s`] || []).find((row: Row) => row.id === source.targetId);
    return record ? <Link key={source.id} onClick={() => navigate({ section: source.targetType === "decision" ? "decisions" : source.targetType === "action" ? "actions" : "goals", ...(source.targetType === "project" ? { projectId: record.id } : source.targetType === "goal" ? { goalId: record.id } : { recordId: record.id, tab: source.targetType === "decision" ? "decisions" : undefined }) })}>{record.title || record.name}</Link> : <span key={source.id} className="text-xs text-slate-400">关联结果已删除</span>;
  })}</div>;
}

export function AIAnalysis({ props, records, mode = "analysis", onDraft }: { props: Pick<ModuleProps, "data" | "notify" | "reload"> & { open?: ModuleProps["open"] }; records: Array<{ type: string; id: string }>; mode?: "analysis" | "alignment" | "classify"; onDraft?: (draft: Row) => void }) {
  const { view, post, working } = useStrategy(props);
  const [preview, setPreview] = useState<Row | null>(null), [result, setResult] = useState<Row | null>(null), [allow, setAllow] = useState(false);
  const request = async (previewOnly: boolean) => {
    const output = await post("analyze", { records, mode, previewOnly, allowSensitive: allow }, false);
    if (output) { if (previewOnly) { setPreview(output); setResult(null); } else setResult(output); }
  };
  const classify = async (suggestion: Row, index: number) => {
    const project = suggestion.type === "project" ? props.data?.projects?.find((row: Row) => row.id === suggestion.id) : null;
    const goal = project?.goalId ? props.data?.goals?.find((row: Row) => row.id === project.goalId) : null;
    const cross = Boolean(goal?.sceneId && suggestion.sceneId && goal.sceneId !== suggestion.sceneId);
    if (!window.confirm(cross ? "项目与目标主场景不一致，确认保留跨场景关联？愿景关联需重新确认。" : "确认归类此记录？愿景关联需重新确认。")) return;
    const saved = await post("classify", [{ type: suggestion.type, id: suggestion.id, sceneId: suggestion.sceneId, crossSceneConfirmed: cross }]);
    if (saved) setResult((current: Row | null) => current ? { ...current, suggestions: current.suggestions.filter((_: Row, i: number) => i !== index) } : current);
  };
  return <div>
    <Button onClick={() => void request(true)} disabled={working || !records.length}><Check size={15} />AI 分析所选记录</Button>
    {preview && <div className="mt-4 border-y border-line py-4"><div className="mb-3 flex items-center justify-between"><h3 className="text-sm font-medium">发送资料预览</h3><button type="button" onClick={() => { setPreview(null); setResult(null); }} title="关闭分析" aria-label="关闭分析"><X size={16} /></button></div>
      <label className="mb-3 flex items-start gap-2 text-xs text-slate-600"><input type="checkbox" checked={allow} onChange={(event) => { setAllow(event.target.checked); setPreview(null); setResult(null); }} className="!w-auto" />本次允许发送选定记录中的家庭、健康、财务及组织资料</label>
      <pre className="max-h-56 overflow-auto whitespace-pre-wrap break-words bg-mist p-3 text-xs leading-5">{JSON.stringify(preview.records, null, 2)}</pre>
      {!result && <div className="mt-3"><Button primary disabled={working} onClick={() => void request(false)}>{working ? "分析中…" : "确认发送并分析"}</Button></div>}
      {result && <div className="mt-3 space-y-3">{result.suggestions.map((suggestion: Row, index: number) => <div key={index} className="border-b border-line py-3"><p className="text-xs text-slate-500">待确认建议</p><textarea aria-label={`分析建议 ${index + 1}`} rows={3} value={suggestion.advice} onChange={(event) => setResult({ ...result, suggestions: result.suggestions.map((row: Row, i: number) => i === index ? { ...row, advice: event.target.value } : row) })} /><p className="mt-2 text-xs text-slate-500">{suggestion.reason}</p>
        {mode === "classify" && <div className="mt-2 flex flex-wrap gap-2"><select aria-label="建议归类场景" className="!w-auto" value={suggestion.sceneId || ""} onChange={(event) => setResult({ ...result, suggestions: result.suggestions.map((row: Row, i: number) => i === index ? { ...row, sceneId: event.target.value || null } : row) })}><option value="">其他</option>{view.scenes.map((scene) => <option key={scene.id} value={scene.id}>{scene.name}</option>)}</select><Button disabled={working} onClick={() => void classify(suggestion, index)}>确认归类</Button></div>}
        {mode !== "classify" && <Button disabled={working} onClick={() => {
          const signal = view.records.find((row) => row.id === suggestion.id && row.kind === "signal");
          if (signal && onDraft) onDraft({ ...signal, payload: { ...signal.payload, judgement: suggestion.advice } });
          else {
            const goal = (props.data?.goals || []).find((row: Row) => row.id === suggestion.id && suggestion.type === "goal");
            props.open?.({ type: "goal", item: goal ? { ...goal, description: [goal.description, `AI 对齐建议：${suggestion.advice}`].filter(Boolean).join("\n\n") } : { title: "分析建议", description: suggestion.advice, status: "待确认" } });
          }
        }}>采用为可编辑草稿</Button>}
      </div>)}</div>}
    </div>}
  </div>;
}
