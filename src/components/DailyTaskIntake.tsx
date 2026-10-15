"use client";

import { useEffect, useState } from "react";
import { Bot, ChevronDown, Loader2, Pencil, Plus, RotateCcw, Search, Trash2, X } from "lucide-react";
import { deliveryAt, intakeActions, intakeEditSchema, recommendedIntake, toIntakeEdit, type IntakeEdit } from "@/lib/daily/intake";
import { shanghaiDate, type DailyView } from "@/lib/daily/shared";
import { isRecurring } from "@/lib/recurring-tasks";
import { recurrenceLabel } from "@/lib/task-schedule";

const button = "inline-flex min-h-9 items-center justify-center gap-2 rounded-md border border-line bg-white px-3 py-2 text-sm text-slate-600 hover:bg-slate-50 disabled:opacity-40";
const labelDate = (value: string | null) => value ? new Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(value)) : "未设交付时间";
const dateInput = (value: string | null) => value ? new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(value)).replace(" ", "T") : "";

export default function DailyTaskIntake({ view, scene, working, onConfirm }: { view: DailyView; scene: string; working: boolean; onConfirm: (edits: IntakeEdit[]) => Promise<boolean> }) {
  const storageKey = `daily-intake:${view.date}`;
  const [edits, setEdits] = useState<IntakeEdit[]>(() => {
    try {
      const saved = sessionStorage.getItem(storageKey);
      if (saved) {
        const previous = intakeEditSchema.array().max(20).parse(JSON.parse(saved)).map(edit => {
          const action = view.actions.find(row => row.id === edit.actionId);
          return action && isRecurring(action) && (!edit.dueAt || shanghaiDate(new Date(edit.dueAt)) !== view.date) ? { ...edit, dueAt: toIntakeEdit(action, view.projects, view.date).dueAt } : edit;
        });
        if (sessionStorage.getItem(`${storageKey}:recurrence-v1`)) return previous;
        const recurring = recommendedIntake(view).filter(edit => isRecurring(view.actions.find(action => action.id === edit.actionId)!) && !previous.some(row => row.actionId === edit.actionId));
        return [...recurring, ...previous].slice(0, 20);
      }
    } catch { /* Unavailable storage must not prevent planning. */ }
    return recommendedIntake(view);
  });
  const [search, setSearch] = useState("");
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [error, setError] = useState("");
  const available = intakeActions(view);
  const availableIds = new Set(available.map((action) => action.id));
  const selected = edits.filter((edit) => availableIds.has(edit.actionId));
  const matches = (actionId: string, title: string) => {
    const action = view.actions.find((row) => row.id === actionId);
    const project = view.projects.find((row) => row.id === action?.projectId);
    return (scene === "all" || action?.effectiveSceneId === scene) && `${title} ${project?.name || ""} ${action?.purpose || ""}`.toLowerCase().includes(search.trim().toLowerCase());
  };
  const visible = selected.filter((edit) => matches(edit.actionId, edit.title));
  const choices = available.filter((action) => !selected.some((edit) => edit.actionId === action.id) && matches(action.id, action.title));
  useEffect(() => {
    try { sessionStorage.setItem(storageKey, JSON.stringify(edits)); sessionStorage.setItem(`${storageKey}:recurrence-v1`, "1"); } catch { /* Keep the in-memory draft when storage is full. */ }
  }, [edits, storageKey]);
  const update = (id: string, changes: Partial<IntakeEdit>) => setEdits((previous) => previous.map((edit) => edit.actionId === id ? { ...edit, ...changes } : edit));

  return <section aria-label="今日待编排清单" className="mb-6 border-y border-line py-4">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <h2 className="text-base font-semibold text-ink">待确认清单 <span className="ml-2 text-sm font-normal text-slate-500">{selected.length}/20</span></h2>
      <div className="flex flex-wrap gap-2">
        <button type="button" className={button} disabled={working} onClick={() => {
          if (selected.length && !window.confirm("重新按周期及交付时间填充会替换当前待确认清单，继续？")) return;
          setEdits(recommendedIntake(view)); setError(""); setEditing(null);
        }}><RotateCcw size={14} />按周期与交付填充</button>
        <button type="button" className={button} disabled={working} onClick={() => setAdding(!adding)}><Plus size={15} />添加项目任务</button>
      </div>
    </div>
    <div className="relative my-3"><Search size={15} className="absolute left-3 top-3 text-slate-400" /><input aria-label="搜索待编排任务" className="!pl-9" placeholder="搜索任务或项目" value={search} onChange={(event) => setSearch(event.target.value)} /></div>
    {!visible.length && <p className="py-4 text-center text-sm text-slate-400">{selected.length ? "当前筛选下没有待确认任务" : "没有待确认任务，可添加项目任务或填写临时待办"}</p>}
    {visible.map((edit) => {
      const action = view.actions.find((row) => row.id === edit.actionId)!;
      const project = view.projects.find((row) => row.id === action.projectId);
      const changed = action.updatedAt !== edit.updatedAt;
      return <div key={edit.actionId} className="border-t border-line py-3">
        <div className="flex min-w-0 items-start gap-2">
          <button type="button" aria-expanded={editing === edit.actionId} onClick={() => setEditing(editing === edit.actionId ? null : edit.actionId)} className="min-w-0 flex-1 text-left">
            <span className="block break-words text-sm font-medium">{edit.title || "未命名任务"}{isRecurring(action) && <span className="ml-2 text-xs font-normal text-sage">{recurrenceLabel(action.recurrence)} · 本次执行</span>}</span>
            <span className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-slate-500"><span>{view.scenes.find((row) => row.id === action.effectiveSceneId)?.name || "其他"}</span><span>{project?.name || "独立任务"}</span><span className={edit.dueAt && shanghaiDate(new Date(edit.dueAt)) < view.date ? "text-amber-700" : ""}>交付 {labelDate(edit.dueAt)}{!isRecurring(action) && !action.dueDate && project?.deadline && " · 项目交付"}</span><span>预计 {Math.round(edit.estimatedHours * 60)} 分钟</span></span>
          </button>
          <button type="button" title="编辑待编排任务" aria-label={`编辑待编排任务：${edit.title}`} disabled={working} className="grid h-8 w-8 shrink-0 place-items-center rounded text-slate-500 hover:bg-mist" onClick={() => setEditing(editing === edit.actionId ? null : edit.actionId)}><Pencil size={15} /></button>
          <button type="button" title="移出今日清单" aria-label={`移出今日清单：${edit.title}`} disabled={working} className="grid h-8 w-8 shrink-0 place-items-center rounded text-slate-500 hover:bg-mist" onClick={() => setEdits(selected.filter((row) => row.actionId !== edit.actionId))}><Trash2 size={15} /></button>
        </div>
        {changed && <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-amber-700"><span>原任务已变更，需更新后确认</span><button type="button" className="underline" disabled={working} onClick={() => update(edit.actionId, toIntakeEdit(action, view.projects, view.date))}>采用最新内容</button></div>}
        {editing === edit.actionId && <div className="mt-3 grid min-w-0 gap-3 border-l-2 border-sage/30 pl-3 sm:grid-cols-2">
          <label className="text-xs text-slate-500 sm:col-span-2">任务名称<input aria-label="待编排任务名称" disabled={working} maxLength={300} value={edit.title} onChange={(event) => update(edit.actionId, { title: event.target.value })} /></label>
          <label className="text-xs text-slate-500">交付时间<input aria-label="待编排交付时间" disabled={working} type="datetime-local" value={dateInput(edit.dueAt)} onChange={(event) => update(edit.actionId, { dueAt: event.target.value ? `${event.target.value}:00+08:00` : null })} /></label>
          <label className="text-xs text-slate-500">预计时长（min）<input aria-label="待编排预计时长（min）" disabled={working} type="number" min={0} max={1440} step={1} value={Number.isFinite(edit.estimatedHours) ? Math.round(edit.estimatedHours * 60) : ""} onChange={(event) => update(edit.actionId, { estimatedHours: event.target.valueAsNumber / 60 })} /></label>
          <label className="text-xs text-slate-500 sm:col-span-2">具体内容<textarea aria-label="待编排具体内容" disabled={working} rows={2} maxLength={20000} value={edit.purpose} onChange={(event) => update(edit.actionId, { purpose: event.target.value })} /></label>
          <label className="text-xs text-slate-500 sm:col-span-2">完成标准<textarea aria-label="待编排完成标准" disabled={working} rows={2} maxLength={20000} value={edit.standard} onChange={(event) => update(edit.actionId, { standard: event.target.value })} /></label>
        </div>}
      </div>;
    })}
    {adding && <div className="mt-3 border-t border-line pt-3"><div className="mb-2 flex items-center justify-between text-sm font-medium"><span>可添加任务 · {choices.length}</span><button type="button" title="收起可添加任务" aria-label="收起可添加任务" onClick={() => setAdding(false)}><X size={16} /></button></div><div className="max-h-72 overflow-y-auto">{choices.map((action) => <div key={action.id} className="flex min-w-0 items-center gap-3 border-b border-line py-2"><div className="min-w-0 flex-1"><p className="break-words text-sm">{action.title}</p><p className="mt-1 break-words text-xs text-slate-500">{view.projects.find((row) => row.id === action.projectId)?.name || "独立任务"} · {isRecurring(action) ? `${recurrenceLabel(action.recurrence)} · ${view.date}` : labelDate(deliveryAt(action, view.projects))}</p></div><button type="button" aria-label={`加入待编排：${action.title}`} title="加入待编排" className="grid h-8 w-8 shrink-0 place-items-center rounded text-sage hover:bg-mist disabled:opacity-40" disabled={working || selected.length >= 20} onClick={() => setEdits([...selected, toIntakeEdit(action, view.projects, view.date)])}><Plus size={16} /></button></div>)}{!choices.length && <p className="py-3 text-sm text-slate-400">没有符合筛选的可添加任务</p>}</div></div>}
    {error && <p role="alert" className="mt-3 text-sm text-red-700">{error}</p>}
    <div className="mt-4 flex flex-wrap items-center justify-between gap-3"><span className="text-xs text-slate-500">待确认 {selected.length} 项{visible.length !== selected.length && ` · 当前显示 ${visible.length} 项`} · 尚未保存</span><button type="button" className={`${button} !border-sage !bg-sage !text-white`} disabled={working || !selected.length} onClick={async () => {
      const parsed = intakeEditSchema.array().min(1).max(20).safeParse(selected);
      if (!parsed.success) { setError(parsed.error.issues[0].message); return; }
      if (selected.some((edit) => view.actions.find((action) => action.id === edit.actionId)?.updatedAt !== edit.updatedAt)) { setError("原项目任务已更新，请采用最新内容后重新确认"); return; }
      setError("");
      await onConfirm(parsed.data);
    }}>{working ? <Loader2 size={15} className="animate-spin" /> : <Bot size={15} />}确认清单并编排</button></div>
    <details className="mt-3 text-xs text-slate-500"><summary className="flex cursor-pointer items-center gap-1"><ChevronDown size={12} />填充范围</summary><p className="mt-2">当日周期任务，以及已逾期、当日交付的未完成项目任务；非周期任务无日期时采用项目交付时间。每批最多 20 项。移出和修改仅用于本次清单。</p></details>
  </section>;
}
