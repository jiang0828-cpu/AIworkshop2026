"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { AlertCircle, ArrowDown, ArrowLeft, ArrowUp, Bot, CalendarDays, Check, CheckCheck, ChevronRight, Clock3, Download, FileText, Flag, Loader2, Pause, Pencil, Play, Plus, RotateCcw, Save, Trash2, Upload, UserRound, X } from "lucide-react";
import { compareDailyTasks, dateSchema, laneLabels, nextStep, shanghaiDate, statusLabels, taskDraftSchema, taskStatus, timerSeconds, type AgentView, type DailyView, type StepView, type TaskDraft, type TaskView } from "@/lib/daily/shared";

import { otherSceneId, type SceneRow } from "@/lib/scenes";
import { clientId } from "@/lib/client-id";
import { dependencies, importanceLabels, priorityFor, quadrant, readySteps, stepReady, urgencyLabels, type Orchestration } from "@/lib/daily/workflow";
import { arrangeTimes, reservationsFor, type Reservation, type TaskSchedule } from "@/lib/daily/scheduling";
import type { TimeProposal } from "@/lib/daily/service";
import { isStandaloneTemporary, taskKindLabels, type TaskAffiliation } from "@/lib/daily/affiliation";
import DailyTaskIntake from "./DailyTaskIntake";
import DailyAgentManager from "./DailyAgentManager";
import type { IntakeEdit } from "@/lib/daily/intake";

type Command = Record<string, unknown>;
type ResponseData = { tasks?: TaskDraft[]; taskIds?: string[]; source?: string; warning?: string; saved?: number; started?: number; proposals?: TimeProposal[]; skipped?: number; replacement?: { id: string; updatedAt: string } | null };
type Post = (command: Command) => Promise<ResponseData | null>;
const priorities = ["高", "中", "低"];
const dateInput = (value: string | null) => value ? new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(value)).replace(" ", "T") : "";
const fromDateInput = (value: string) => value ? `${value}:00+08:00` : null;
const timeLabel = (value: string) => new Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Shanghai", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(value));
const durationLabel = (seconds: number) => `${Math.floor(seconds / 3600).toString().padStart(2, "0")}:${Math.floor(seconds / 60 % 60).toString().padStart(2, "0")}:${Math.floor(seconds % 60).toString().padStart(2, "0")}`;
const scheduleLabel = (schedule: TaskSchedule) => schedule.startsAt && schedule.endsAt ? `${timeLabel(schedule.startsAt)}–${timeLabel(schedule.endsAt).split(" ").at(-1)}` : "待调整时间";
function ScheduleFields({ schedule, onChange, disabled = false }: { schedule?: TaskSchedule | null; onChange: (schedule: TaskSchedule | null) => void; disabled?: boolean }) {
  const change = (value: string, start: boolean) => {
    if (!value) { onChange(null); return; }
    const at = fromDateInput(value)!;
    const span = schedule?.startsAt && schedule.endsAt ? Math.max(10 * 60000, new Date(schedule.endsAt).getTime() - new Date(schedule.startsAt).getTime()) : 30 * 60000;
    const startsAt = start ? at : schedule?.startsAt || new Date(new Date(at).getTime() - span).toISOString();
    const endsAt = start ? new Date(new Date(at).getTime() + span).toISOString() : at;
    onChange({ startsAt, endsAt, mode: "manual", reason: "手动安排，保留原截止时间", warnings: [] });
  };
  return <div className="my-3 space-y-2">
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2"><Field label="建议开始 · 北京时间"><input disabled={disabled} type="datetime-local" value={dateInput(schedule?.startsAt || null)} onChange={(event) => change(event.target.value, true)} /></Field><Field label="建议完成 · 北京时间"><input disabled={disabled} type="datetime-local" value={dateInput(schedule?.endsAt || null)} onChange={(event) => change(event.target.value, false)} /></Field></div>
    {schedule && <details className="text-xs text-slate-500"><summary className="cursor-pointer">{schedule.mode === "manual" ? "手动时段" : "安排依据"}</summary><p className="mt-2 break-words">{schedule.reason}</p></details>}
    {schedule?.warnings.map((warning) => <p key={warning} className="break-words text-xs text-amber-700">{warning}</p>)}
  </div>;
}
function AffiliationFields({ value, goals, projects, onChange, disabled = false }: { value: TaskAffiliation; goals: DailyView["goals"]; projects: DailyView["projects"]; onChange: (value: TaskAffiliation) => void; disabled?: boolean }) {
  return <div className="my-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
    <Field label="任务类型"><select disabled={disabled} value={value.kind} onChange={(event) => onChange({ ...value, kind: event.target.value as TaskAffiliation["kind"] })}>{Object.entries(taskKindLabels).map(([kind, label]) => <option key={kind} value={kind}>{label}</option>)}</select></Field>
    <Field label="所属目标"><select disabled={disabled} value={value.goalId || ""} onChange={(event) => { const goalId = event.target.value || null; const project = projects.find((row) => row.id === value.projectId); onChange({ ...value, goalId, projectId: project?.goalId && project.goalId !== goalId ? null : value.projectId }); }}><option value="">选择所属目标</option>{goals.map((goal) => <option key={goal.id} value={goal.id}>{goal.title} · {goal.horizon}</option>)}</select></Field>
    <Field label="所属项目"><select disabled={disabled} value={value.projectId || ""} onChange={(event) => { const project = projects.find((row) => row.id === event.target.value); onChange({ ...value, projectId: project?.id || null, goalId: project?.goalId || value.goalId }); }}><option value="">选择所属项目</option>{projects.filter((project) => !value.goalId || !project.goalId || project.goalId === value.goalId).map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}</select></Field>
  </div>;
}
function download(content: string, filename: string, type = "text/markdown;charset=utf-8") {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const anchor = document.createElement("a"); anchor.href = url; anchor.download = filename; anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function Button({ children, onClick, disabled = false, primary = false, title, type = "button" }: {
  children: ReactNode; onClick?: () => void; disabled?: boolean; primary?: boolean; title?: string; type?: "button" | "submit";
}) {
  return <button type={type} onClick={onClick} disabled={disabled} title={title} className={`inline-flex min-h-9 shrink-0 items-center justify-center gap-2 rounded-md border px-3 py-2 text-sm disabled:cursor-not-allowed disabled:opacity-40 ${primary ? "border-sage bg-sage text-white hover:bg-[#4e6857]" : "border-line bg-white text-slate-600 hover:bg-slate-50"}`}>{children}</button>;
}
function IconButton({ children, label, onClick, disabled }: { children: ReactNode; label: string; onClick: () => void; disabled?: boolean }) {
  return <button type="button" title={label} aria-label={label} onClick={onClick} disabled={disabled} className="grid h-8 w-8 shrink-0 place-items-center rounded-md text-slate-500 hover:bg-slate-100 disabled:opacity-30">{children}</button>;
}
function Field({ label, children }: { label: string; children: ReactNode }) { return <label className="block min-w-0 text-xs text-slate-500"><span className="mb-1.5 block">{label}</span>{children}</label>; }
function Status({ status }: { status: string }) {
  const color = status === "done" ? "bg-green-50 text-green-800" : ["failed", "blocked"].includes(status) ? "bg-red-50 text-red-700" : status === "review" ? "bg-amber-50 text-amber-800" : ["running", "queued"].includes(status) ? "bg-sky-50 text-sky-800" : "bg-slate-100 text-slate-500";
  return <span className={`inline-flex shrink-0 items-center gap-1 rounded px-2 py-1 text-xs ${color}`}>{status === "running" && <Loader2 size={12} className="animate-spin" />}{statusLabels[status] || status}</span>;
}
function Modal({ title, close, children }: { title: string; close: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow; document.body.style.overflow = "hidden";
    ref.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
      if (event.key === "Tab") {
        const elements = ref.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input, textarea, select, [tabindex="0"]');
        if (!elements?.length) return;
        const first = elements[0], last = elements[elements.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
      }
    };
    document.addEventListener("keydown", onKey);
    return () => { document.body.style.overflow = overflow; document.removeEventListener("keydown", onKey); previous?.focus(); };
  }, [close]);
  return <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/30 p-2 sm:p-6" onClick={close}>
    <div ref={ref} tabIndex={-1} role="dialog" aria-modal="true" aria-label={title} onClick={(event) => event.stopPropagation()} className="flex max-h-[92dvh] w-full max-w-4xl flex-col overflow-hidden rounded-lg border border-line bg-white shadow-xl outline-none">
      <div className="flex items-center justify-between border-b border-line px-5 py-4"><h2 className="text-base font-semibold">{title}</h2><IconButton label="关闭" onClick={close}><X size={18} /></IconButton></div>
      <div className="overflow-y-auto p-5">{children}</div>
    </div>
  </div>;
}

export default function DailyCollaboration({ notify, reload, initialTaskId, initialDate, onDateChange }: { notify: (message: string) => void; reload: () => Promise<void>; initialTaskId?: string; initialDate?: string; onDateChange?: (date: string) => void }) {
  const [localDate, setLocalDate] = useState(shanghaiDate());
  const requestedDate = dateSchema.safeParse(initialDate);
  const date = requestedDate.success ? requestedDate.data : localDate;
  const setDate = (value: string) => {
    if (!dateSchema.safeParse(value).success) return;
    setLocalDate(value);
    onDateChange?.(value);
  };
  const [tab, setTab] = useState("tasks");
  const [view, setView] = useState<DailyView | null>(null);
  const [error, setError] = useState("");
  const [working, setWorking] = useState(false);
  const [input, setInput] = useState("");
  const [drafts, setDrafts] = useState<TaskDraft[] | null>(null);
  const [source, setSource] = useState("");
  const [replacement, setReplacement] = useState<ResponseData["replacement"]>(null);
  const [includeResults, setIncludeResults] = useState(false);
  const saveRequestId = useRef("");
  const [selectedId, setSelectedId] = useState<string | null>(initialTaskId || null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [filter, setFilter] = useState("all");
  const [kindFilter, setKindFilter] = useState("all");
  const [scene, setScene] = useState("all");
  const [timePlan, setTimePlan] = useState<TimeProposal[] | null>(null);
  const [now, setNow] = useState(new Date());
  const fileInput = useRef<HTMLInputElement>(null);
  const busy = useRef(false);
  const loadRevision = useRef(0);
  const load = useCallback(async () => {
    const revision = ++loadRevision.current;
    try {
      const response = await fetch(`/api/daily-collaboration?date=${date}`, { cache: "no-store" });
      if (!response.ok) throw new Error("无法读取每日协同，请检查数据库与网络");
      const next = await response.json() as DailyView;
      if (revision === loadRevision.current) { setView(next); setError(""); }
    } catch (cause) { if (revision === loadRevision.current) setError(cause instanceof Error ? cause.message : "读取失败"); }
  }, [date]);
  useEffect(() => {
    setView(null); setSelectedId(initialTaskId || null); setEditingId(null);
    void load();
    const poll = setInterval(() => { if (!busy.current) void load(); }, 5000);
    const clock = setInterval(() => setNow(new Date()), 1000);
    return () => { clearInterval(poll); clearInterval(clock); };
  }, [load, date, initialTaskId]);
  const post: Post = async (command) => {
    if (busy.current) return null;
    busy.current = true; setWorking(true);
    try {
      const response = await fetch("/api/daily-collaboration", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(command) });
      const result = await response.json() as ResponseData & { error?: string };
      if (!response.ok) throw new Error(result.error || "操作失败");
      if (command.action !== "orchestrate") await load();
      if (result.warning) notify(result.warning);
      return result;
    } catch (cause) { notify(cause instanceof Error ? cause.message : "操作失败"); return null; }
    finally { busy.current = false; setWorking(false); }
  };
  const orchestrate = async (taskId?: string, actionIds?: string[], actionEdits?: IntakeEdit[]) => {
    const result = await post({ action: "orchestrate", input: actionIds?.length ? "" : input, date, sceneId: scene === "all" ? null : scene, includeResults, taskId, actionIds, actionEdits });
    if (result?.tasks) { saveRequestId.current = clientId(); setDrafts(result.tasks); setSource(result.source || "规则编排"); setReplacement(result.replacement); setSelectedId(null); }
    return Boolean(result?.tasks);
  };
  const tasks = view?.plan?.tasks || [];
  const selected = tasks.find((task) => task.id === selectedId);
  const editing = tasks.find((task) => task.id === editingId);
  const filtered = tasks.filter((task) => (scene === "all" || task.effectiveSceneId === scene) && (kindFilter === "all" || (kindFilter === "unlinked" ? !task.affiliation.goalId || !task.affiliation.projectId : task.affiliation.kind === kindFilter)) && (filter === "all" || (filter === "blocked" ? ["blocked", "failed"].includes(taskStatus(task.steps)) : taskStatus(task.steps) === filter))).sort(compareDailyTasks);
  const schedulerAlive = view?.heartbeat && now.getTime() - new Date(view.heartbeat).getTime() < 240000;
  const exportJson = async () => {
    try {
      const response = await fetch("/api/daily-collaboration?export=json", { cache: "no-store" });
      if (!response.ok) throw new Error("导出失败");
      download(await response.text(), `每日任务协同-${date}.json`, "application/json");
    } catch { notify("导出失败，请检查网络"); }
  };
  const closeDrafts = useCallback(() => { if (!busy.current) setDrafts(null); }, []);
  const closeTimes = useCallback(() => { if (!busy.current) setTimePlan(null); }, []);
  const closeEdit = useCallback(() => { if (!busy.current) setEditingId(null); }, []);
  return <div className="daily-collaboration">
    <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
      <h1 className="text-2xl font-semibold text-ink">每日任务协同</h1>
      <div className="flex flex-wrap items-center gap-2">
        <input aria-label="任务日期" type="date" value={date} disabled={working || Boolean(drafts)} onChange={(event) => { if (event.target.value) setDate(event.target.value); }} className="!w-40" />
        <Button onClick={() => setDate(shanghaiDate())} disabled={working || Boolean(drafts)}><CalendarDays size={15} />今天</Button>
        <IconButton label="导出协同数据 JSON" onClick={() => void exportJson()}><Download size={17} /></IconButton>
        <IconButton label="导入协同数据 JSON" onClick={() => fileInput.current?.click()} disabled={working}><Upload size={17} /></IconButton>
        <input ref={fileInput} type="file" accept=".json,application/json" className="hidden" onChange={async (event) => {
          const file = event.target.files?.[0]; event.target.value = "";
          if (!file) return;
          if (!window.confirm("导入将替换每日协同数据。运行中任务须先结束；恢复的未完成执行需重新启动。确定导入吗？")) return;
          try { const result = await post({ action: "import", backup: JSON.parse(await file.text()) }); if (result) notify("协同数据已恢复"); }
          catch { notify("JSON 文件无效"); }
        }} />
      </div>
    </div>
    <div className="mb-5 flex flex-wrap items-center justify-between gap-3 border-b border-line">
      <div className="flex" role="tablist" aria-label="每日协同视图">
        {[["tasks", "今日任务", CalendarDays], ["agents", "Agent 管理", Bot], ["reports", "每日复盘", FileText]].map(([key, title, Icon]) => {
          const Component = Icon as typeof Bot;
          return <button key={key as string} role="tab" aria-selected={tab === key} onClick={() => setTab(key as string)} className={`flex items-center gap-1 border-b-2 px-2 py-3 text-xs sm:gap-2 sm:px-4 sm:text-sm ${tab === key ? "border-sage font-medium text-sage" : "border-transparent text-slate-500"}`}><Component size={16} />{title as string}</button>;
        })}
      </div>
      <div className="flex items-center gap-2 pb-2 text-xs text-slate-500"><span className={`h-2 w-2 rounded-full ${schedulerAlive ? "bg-green-600" : "bg-amber-500"}`} />后台{schedulerAlive ? "在线" : "未连接"}{view?.heartbeat && <span title={timeLabel(view.heartbeat)}> · {timeLabel(view.heartbeat)}</span>}</div>
    </div>
    {error && <div role="alert" className="mb-4 flex items-center gap-3 border border-red-200 bg-red-50 p-3 text-sm text-red-700"><AlertCircle size={16} />{error}<Button onClick={() => void load()}><RotateCcw size={14} />重试</Button></div>}
    {!view ? <div className="py-16 text-center text-sm text-slate-400">{error ? "数据暂不可用" : "正在读取今日计划…"}</div> : <>
      {tab === "tasks" && <>
        <div className="mb-6 grid grid-cols-2 gap-y-5 border-b border-line pb-5 sm:grid-cols-4 xl:grid-cols-6">
          {[['任务总数', view.metrics.total], ['A / B / 混合', `${view.metrics.a} / ${view.metrics.b} / ${view.metrics.mixed}`], ['完成率', `${Math.round(view.metrics.completionRate * 100)}%`], ['人工剩余', `${Math.ceil(view.metrics.remainingHumanMinutes)} 分钟`], ['阻塞任务', view.metrics.blocked], ['人工投入', `${Math.floor(view.metrics.humanSeconds / 60)} 分钟`]].map(([label, value]) => <div key={label}><div className="mb-2 text-xs text-slate-500">{label}</div><div className={`text-xl font-semibold ${label === "阻塞任务" && Number(value) > 0 ? "text-red-700" : "text-ink"}`}>{value}</div></div>)}
        </div>
        <div className="mb-4 flex flex-wrap gap-x-4 gap-y-2 text-xs text-slate-500">{view.sceneCounts.map((item) => <span key={item.id}>{item.name} {item.count}</span>)}</div>
        <div className="mb-4"><select aria-label="协同场景筛选" className="!w-auto" value={scene} onChange={(event) => { setScene(event.target.value); setSelectedId(null); }}><option value="all">全部场景</option>{view.scenes.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></div>
        <DailyTaskIntake key={date} view={view} scene={scene} working={working} onConfirm={(edits) => orchestrate(undefined, edits.map((edit) => edit.actionId), edits)} />
        <details className="mb-7">
          <summary className="mb-3 cursor-pointer text-sm font-medium text-sage">新增临时任务／自由输入</summary>
          <textarea aria-label="今日想法与待办" placeholder={"任务：…\n预期产出／完成标准：…\n截止时间与可用资料：…"} rows={3} value={input} onChange={(event) => setInput(event.target.value)} disabled={working} />
          <label className="mt-2 flex items-center gap-2 text-xs text-slate-500"><input type="checkbox" className="!w-auto" checked={includeResults} onChange={(event) => setIncludeResults(event.target.checked)} disabled={working} />引用当前场景今日已验收结果（{tasks.filter((task) => task.completedAt && (scene === "all" || task.effectiveSceneId === scene)).length} 项）</label>
          <div className="mt-3 flex flex-wrap items-center justify-between gap-3"><span className="text-xs text-slate-500">{view.configured ? "AI 编排可用" : "规则编排"}</span><Button primary onClick={() => void orchestrate()} disabled={working || !input.trim()}>{working ? <Loader2 size={15} className="animate-spin" /> : <Bot size={15} />}确认输入并编排</Button></div>
        </details>
        <h2 className="mb-3 text-base font-semibold text-ink">已编排任务</h2>
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line pb-3">
          <select aria-label="任务状态筛选" value={filter} onChange={(event) => setFilter(event.target.value)} className="!w-36">{[["all", "全部任务"], ["pending", "待执行"], ["running", "执行中"], ["queued", "排队中"], ["review", "待验收"], ["blocked", "阻塞 / 失败"], ["paused", "已暂停"], ["done", "已完成"]].map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
          <select aria-label="任务类型筛选" className="!w-auto" value={kindFilter} onChange={(event) => setKindFilter(event.target.value)}><option value="all">全部类型</option>{Object.entries(taskKindLabels).map(([kind, label]) => <option key={kind} value={kind}>{label}</option>)}<option value="unlinked">待关联目标／项目</option></select>
          <Button disabled={working || !tasks.some((task) => !task.completedAt)} onClick={async () => { const result = await post({ action: "plan-times", date, sceneId: scene === "all" ? null : scene }); if (result?.proposals?.length) setTimePlan(result.proposals); else if (result) notify("没有可重新安排的任务：已完成、执行中和手动时段会保留"); }}><CalendarDays size={14} />安排时间</Button>
          <Button onClick={async () => { if (window.confirm("启动当前场景可执行的 AI 步骤？无依赖步骤将并行，中间稿自动衔接，最终成果需验收；失败任务需单独重试。")) { const result = await post({ action: "start-all", date, aiOnly: true, sceneId: scene === "all" ? null : scene }); if (result) notify(`已启动 ${result.started || 0} 项任务的 AI 步骤`); } }} disabled={working || !tasks.some((task) => (scene === "all" || task.effectiveSceneId === scene) && readySteps(task).some((step) => step.assignee === "ai"))}><Play size={14} />AI 并行启动</Button>
        </div>
        <div className="grid min-w-0 gap-0 lg:grid-cols-[minmax(0,1fr)_minmax(320px,0.95fr)]">
          <div className="min-w-0 lg:pr-5">
            {!filtered.length && <div className="py-14 text-center text-sm text-slate-400">{tasks.length ? "此状态下暂无任务" : "今日暂无任务"}</div>}
            {filtered.map((task) => {
              const status = taskStatus(task.steps), current = nextStep(task.steps), done = task.steps.filter((step) => ["done", "produced"].includes(step.status)).length;
              return <div key={task.id} className={`border-b border-line py-4 ${selectedId === task.id ? "bg-[#f1f5f1]" : ""} ${["blocked", "failed"].includes(status) ? "border-l-2 border-l-red-500 pl-3" : "px-2"}`}>
                <div className="flex min-w-0 items-start gap-1">
                <button onClick={() => setSelectedId(task.id)} className="flex min-w-0 flex-1 items-start gap-3 text-left">
                  <span className={`mt-1 ${task.lane === "B" ? "text-sky-600" : task.lane === "mixed" ? "text-amber-600" : "text-sage"}`}>{task.lane === "A" ? <UserRound size={18} /> : <Bot size={18} />}</span>
                  <span className="min-w-0 flex-1"><span className="block break-words text-sm font-medium">{task.title}</span><span className="mt-2 flex flex-wrap items-center gap-2 text-xs text-slate-500"><span className="text-sage">{view.scenes.find((item) => item.id === task.effectiveSceneId)?.name || "其他"}</span><span>{laneLabels[task.lane]}</span><span>· {task.orchestration ? quadrant(task.orchestration) : `${priorities[task.priority - 1]}优先 · 待判断`}</span>{task.dueAt && <span className={new Date(task.dueAt) < now && status !== "done" ? "text-red-600" : ""}>· 截止 {timeLabel(task.dueAt)}</span>}</span>{task.schedule && <span className={`mt-2 block break-words text-xs ${task.schedule.warnings.length ? "text-amber-700" : "text-sage"}`}><Clock3 size={12} className="mr-1 inline" />建议 {scheduleLabel(task.schedule)}</span>}{task.orchestration && <span className="mt-2 line-clamp-2 break-words text-xs text-slate-500">产出：{task.orchestration.output}</span>}</span>
                </button>
                <IconButton label={`快捷修改：${task.title}`} disabled={working} onClick={() => setEditingId(task.id)}><Pencil size={15} /></IconButton>
                <button type="button" aria-label={`查看任务详情：${task.title}`} onClick={() => setSelectedId(task.id)} className="flex shrink-0 items-center gap-1 pt-0.5"><Status status={status} /><ChevronRight size={15} className="text-slate-400" /></button>
                </div>
                <div className="ml-8 mt-2 flex flex-wrap gap-x-2 gap-y-1 break-words text-xs text-slate-500"><span className="text-sage">{taskKindLabels[task.affiliation.kind]}</span><span>目标：{task.goalName || "待关联"}</span><span>项目：{task.projectName || "待关联"}</span></div>
                <div className="ml-7 mt-3 flex items-center gap-3"><div role="progressbar" aria-label={`${task.title}进度`} aria-valuemin={0} aria-valuemax={task.steps.length} aria-valuenow={done} className="h-1.5 flex-1 overflow-hidden rounded-sm bg-slate-100"><div className="h-full bg-sage" style={{ width: `${done / task.steps.length * 100}%` }} /></div><span className="text-xs text-slate-400">{done}/{task.steps.length}</span>
                  {readySteps(task).length > 0 && <IconButton label={current?.status === "failed" ? "重试任务" : "启动任务"} disabled={working} onClick={() => void post({ action: "start-task", id: task.id })}><Play size={16} /></IconButton>}
                  {current?.status === "running" && current.assignee === "human" && <IconButton label="暂停任务" disabled={working} onClick={() => void post({ action: "pause-step", id: current.id })}><Pause size={16} /></IconButton>}
                </div>
                {current && ["blocked", "failed"].includes(current.status) && <div className="ml-7 mt-2 break-words text-xs text-red-700">{current.blockedReason}</div>}
              </div>;
            })}
          </div>
          <aside className="hidden min-w-0 border-l border-line pl-5 lg:block">{selected ? <TaskDetail key={selected.id} task={selected} goals={view.goals} projects={view.projects} scenes={view.scenes} agents={view.agents} post={post} working={working} now={now} reload={reload} onReplan={() => void orchestrate(selected.id)} /> : <div className="flex min-h-60 items-center justify-center text-sm text-slate-400">未选择任务</div>}</aside>
        </div>
        {selected && <div className="fixed inset-0 z-20 flex flex-col bg-white lg:hidden"><div className="flex items-center gap-3 border-b border-line px-4 py-3"><IconButton label="返回任务列表" onClick={() => setSelectedId(null)}><ArrowLeft size={20} /></IconButton><span className="text-sm font-medium">任务详情</span></div><div className="min-h-0 flex-1 overflow-y-auto p-5"><TaskDetail key={selected.id} task={selected} goals={view.goals} projects={view.projects} scenes={view.scenes} agents={view.agents} post={post} working={working} now={now} reload={reload} onReplan={() => void orchestrate(selected.id)} /></div></div>}
      </>}
      {tab === "agents" && <DailyAgentManager agents={view.agents} assets={view.assets} configured={view.configured} post={post} working={working} />}
      {tab === "reports" && <Reports key={`${date}-${view.plan?.report?.generatedAt || "empty"}`} view={view} post={post} working={working} />}
    </>}
    {editing && view && <Modal title="快捷修改任务" close={closeEdit}>
      <TaskDetail key={editing.id} task={editing} goals={view.goals} projects={view.projects} scenes={view.scenes} agents={view.agents} post={post} working={working} now={now} reload={reload} onReplan={() => {}} editingOnly onSaved={() => { setEditingId(null); setSelectedId(null); notify("任务已更新"); }} />
    </Modal>}
    {drafts && <Modal title={`确认编排 · ${source}`} close={closeDrafts}><DraftEditor initial={drafts} goals={view?.goals || []} projects={view?.projects || []} date={date} reservations={reservationsFor(tasks.filter((task) => !task.completedAt && task.id !== replacement?.id))} scenes={view?.scenes || []} agents={view?.agents || []} working={working} onSave={async (tasks, startAI) => {
      const changed = tasks.some((task) => { if (!task.actionId || !task.affiliation) return false; const action = view?.actions.find((row) => row.id === task.actionId); return action && (action.goalId !== task.affiliation.goalId || action.projectId !== task.affiliation.projectId); });
      if (changed && !window.confirm("所属目标、项目的调整将同步到原行动，确认保存？")) return;
      const result = await post(replacement ? { action: "replan-task", id: replacement.id, updatedAt: replacement.updatedAt, task: tasks[0] } : { action: "save-tasks", date, tasks, input, source, requestId: saveRequestId.current });
      if (result) {
        setDrafts(null); setInput(""); notify(`已保存 ${result.saved} 项任务`);
        if (startAI) for (const id of result.taskIds || []) await post({ action: "start-task", id, aiOnly: true });
      }
    }} /></Modal>}
    {timePlan && <Modal title="确认时间安排" close={closeTimes}>
      <p className="mb-4 text-xs text-slate-500">按默认生活时段安排，保留手动时段与正在执行的任务。时间为建议，确认后不会自动启动。</p>
      {timePlan.map((row, index) => <section key={row.id} className="mb-4 border-b border-line pb-4"><h3 className="break-words text-sm font-medium">{row.title}</h3><ScheduleFields schedule={row.schedule} disabled={working} onChange={(schedule) => setTimePlan((prev) => prev!.map((item, i) => i === index ? { ...item, schedule: schedule || { startsAt: null, endsAt: null, mode: "manual", reason: "暂不安排", warnings: [] } } : item))} /></section>)}
      <div className="sticky bottom-0 flex justify-end bg-white py-3"><Button primary disabled={working} onClick={async () => { const result = await post({ action: "save-times", proposals: timePlan.map(({ id, updatedAt, schedule }) => ({ id, updatedAt, schedule })) }); if (result) { setTimePlan(null); notify(`已安排 ${result.saved} 项任务`); } }}><Check size={15} />确认安排</Button></div>
    </Modal>}
  </div>;
}

function DraftEditor({ initial, date, reservations, scenes, goals, projects, agents, working, onSave }: { initial: TaskDraft[]; date: string; reservations: Reservation[]; scenes: SceneRow[]; goals: DailyView["goals"]; projects: DailyView["projects"]; agents: AgentView[]; working: boolean; onSave: (tasks: TaskDraft[], startAI: boolean) => Promise<void> }) {
  const [tasks, setTasks] = useState(initial);
  const [validationError, setValidationError] = useState("");
  const [startAI, setStartAI] = useState(false);
  const updatePlan = (index: number, data: Partial<Orchestration>) => {
    const plan = tasks[index].orchestration;
    if (!plan) return;
    const next = { ...plan, ...data };
    update(index, { orchestration: next, ...("importance" in data || "urgency" in data ? { priority: priorityFor(next.importance, next.urgency) } : {}) });
  };
  const update = (index: number, data: Partial<TaskDraft>) => setTasks((prev) => {
    const updated = prev.map((task, i) => {
    if (i !== index) return task;
    const next = { ...task, ...data };
    if (data.steps) next.lane = data.steps.every((step) => step.assignee === "human") ? "A" : data.steps.every((step) => step.assignee === "ai") ? "B" : "mixed";
    return next;
    });
    if (["priority", "sceneId", "dueAt", "steps", "orchestration"].some((key) => key in data)) {
      try { return arrangeTimes(updated, date, scenes, reservations); }
      catch { return updated.map((task) => task.schedule?.mode === "manual" ? task : { ...task, schedule: null }); }
    }
    return updated;
  });
  const updateStep = (index: number, position: number, data: Partial<TaskDraft["steps"][number]>) => {
    const task = tasks[index];
    const steps = task.steps.map((step, p) => p === position ? { ...step, ...data } : step);
    const plan = task.orchestration ? { ...task.orchestration, steps: task.orchestration.steps.map((spec, p) => p === position && data.assignee ? { ...spec, kind: data.assignee === "human" ? "decide" as const : "produce" as const, reviewRequired: data.assignee === "human" || !task.orchestration!.steps.some((next) => next.dependsOn.includes(p)) } : spec) } : task.orchestration;
    update(index, { orchestration: plan, steps });
  };
  const reorder = (index: number, order: number[]) => {
    const task = tasks[index];
    const orchestration = task.orchestration ? { ...task.orchestration, steps: order.map((old) => ({ ...task.orchestration!.steps[old], dependsOn: task.orchestration!.steps[old].dependsOn.filter((p) => order.includes(p)).map((p) => order.indexOf(p)) })) } : null;
    if (orchestration) orchestration.steps = orchestration.steps.map((step, position) => !orchestration.steps.some((next) => next.dependsOn.includes(position)) ? { ...step, reviewRequired: true } : step);
    update(index, { steps: order.map((position) => task.steps[position]), orchestration });
  };
  const moveStep = (index: number, position: number, direction: number) => {
    const order = tasks[index].steps.map((_, p) => p);
    [order[position], order[position + direction]] = [order[position + direction], order[position]];
    reorder(index, order);
  };
  return <div>
    <div className="mb-4"><Button disabled={working} onClick={() => { try { setTasks(arrangeTimes(tasks, date, scenes, reservations)); setValidationError(""); } catch (cause) { setValidationError(cause instanceof Error ? cause.message : "请检查任务步骤"); } }}><CalendarDays size={14} />重新匹配时间</Button></div>
    {tasks.map((task, index) => <section key={index} className="mb-6 border-b border-line pb-6">
      <div className="mb-3 flex items-center gap-2"><span className="text-xs text-slate-400">{index + 1}</span><input className="min-w-0 flex-1" aria-label={`任务 ${index + 1} 标题`} value={task.title} onChange={(event) => update(index, { title: event.target.value })} /><IconButton label="移除草稿任务" onClick={() => setTasks(tasks.filter((_, i) => i !== index))}><Trash2 size={16} /></IconButton></div>
      {!isStandaloneTemporary(task) && <AffiliationFields value={task.affiliation || { kind: task.actionId ? "planned" : "temporary", goalId: null, projectId: null }} goals={goals} projects={projects} disabled={working} onChange={(affiliation) => { const project = projects.find((row) => row.id === affiliation.projectId); const goal = goals.find((row) => row.id === affiliation.goalId); update(index, { affiliation, ...(!task.actionId && (affiliation.projectId !== task.affiliation?.projectId || affiliation.goalId !== task.affiliation?.goalId) ? { sceneId: project?.sceneId || goal?.sceneId || task.sceneId } : {}) }); }} />}
      <div className="mb-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
        <Field label="任务场景"><select value={task.sceneId || otherSceneId(scenes)} onChange={(event) => update(index, { sceneId: event.target.value })}>{scenes.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></Field><Field label="任务分类"><select value={task.lane} onChange={(event) => {
          const lane = event.target.value as TaskDraft["lane"];
          const steps = task.steps.map((step, p) => ({ ...step, assignee: lane === "A" || (lane === "mixed" && p === task.steps.length - 1) ? "human" as const : "ai" as const, agentId: lane === "A" || (lane === "mixed" && p === task.steps.length - 1) ? null : agents.find((agent) => agent.enabled)?.id || null }));
          update(index, { lane, steps, orchestration: task.orchestration ? { ...task.orchestration, steps: task.orchestration.steps.map((spec, p) => ({ ...spec, kind: steps[p].assignee === "human" ? "decide" : "produce", reviewRequired: steps[p].assignee === "human" || spec.reviewRequired })) } : null });
        }}>{Object.entries(laneLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></Field>
        <Field label="优先级"><select value={task.priority} onChange={(event) => update(index, { priority: Number(event.target.value) })}>{priorities.map((label, p) => <option key={label} value={p + 1}>{label}</option>)}</select></Field>
        <div className="col-span-2 sm:col-span-1"><Field label="截止时间 · 北京时间"><input type="datetime-local" value={dateInput(task.dueAt)} onChange={(event) => update(index, { dueAt: fromDateInput(event.target.value) })} /></Field></div>
      </div>
      <ScheduleFields schedule={task.schedule} disabled={working} onChange={(schedule) => update(index, { schedule })} />
      {task.orchestration && <div className="mb-4 space-y-3"><div className="grid grid-cols-2 gap-3"><Field label="重要程度"><select value={task.orchestration.importance} onChange={(event) => updatePlan(index, { importance: Number(event.target.value) })}>{importanceLabels.map((label, p) => <option key={label} value={p + 1}>{label}</option>)}</select></Field><Field label="紧迫程度"><select value={task.orchestration.urgency} onChange={(event) => updatePlan(index, { urgency: Number(event.target.value) })}>{urgencyLabels.map((label, p) => <option key={label} value={p + 1}>{label}</option>)}</select></Field></div><Field label="预期产出与完成标准"><textarea rows={2} value={task.orchestration.output} onChange={(event) => updatePlan(index, { output: event.target.value })} /></Field><details><summary className="cursor-pointer text-xs text-sage">判断依据 · {quadrant(task.orchestration)}</summary><textarea aria-label="重要紧迫判断依据" className="mt-2" rows={2} value={task.orchestration.reason} onChange={(event) => updatePlan(index, { reason: event.target.value })} /></details></div>}
      <Field label="任务资料与备注"><textarea rows={2} value={task.notes} onChange={(event) => update(index, { notes: event.target.value })} /></Field>
      <div className="mt-4 space-y-3">{task.steps.map((step, position) => <div key={position} className="border-l-2 border-line pl-3">
        <div className="mb-2 flex items-center gap-1"><span className="text-xs text-slate-400">{position + 1}</span><input className="min-w-0 flex-1" aria-label={`任务 ${index + 1} 步骤 ${position + 1}`} value={step.title} onChange={(event) => updateStep(index, position, { title: event.target.value })} /><IconButton label="步骤上移" disabled={position === 0} onClick={() => moveStep(index, position, -1)}><ArrowUp size={14} /></IconButton><IconButton label="步骤下移" disabled={position === task.steps.length - 1} onClick={() => moveStep(index, position, 1)}><ArrowDown size={14} /></IconButton><IconButton label="移除步骤" disabled={task.steps.length <= 3} onClick={() => reorder(index, task.steps.map((_, p) => p).filter((p) => p !== position))}><Trash2 size={14} /></IconButton></div>
        <div className="grid grid-cols-[minmax(0,1fr)_100px] gap-2 sm:grid-cols-[130px_minmax(0,1fr)_100px]">
          <select aria-label={`步骤 ${position + 1} 执行人`} value={step.assignee} onChange={(event) => updateStep(index, position, { assignee: event.target.value as "human" | "ai", agentId: event.target.value === "ai" ? agents.find((agent) => agent.enabled)?.id || null : null })}><option value="human">我来执行</option><option value="ai">AI 执行</option></select>
          <select aria-label={`步骤 ${position + 1} Agent`} value={step.agentId || ""} disabled={step.assignee === "human"} onChange={(event) => updateStep(index, position, { agentId: event.target.value || null })} className="col-span-2 row-start-2 sm:col-span-1 sm:row-start-auto"><option value="">选择 Agent</option>{agents.filter((agent) => agent.enabled).map((agent) => <option key={agent.id} value={agent.id}>{agent.name}</option>)}</select>
          <input aria-label={`步骤 ${position + 1} 预计分钟`} type="number" min={1} max={1440} value={step.estimatedMinutes} onChange={(event) => updateStep(index, position, { estimatedMinutes: Number(event.target.value) })} />
        </div>
        <textarea aria-label={`步骤 ${position + 1} 资料与完成标准`} rows={2} className="mt-2" placeholder="步骤资料与完成标准" value={step.notes} onChange={(event) => updateStep(index, position, { notes: event.target.value })} />
        {task.orchestration && <details className="mt-2 text-xs"><summary className="cursor-pointer text-sage">{task.orchestration.steps[position].dependsOn.length ? `依赖步骤 ${task.orchestration.steps[position].dependsOn.map((p) => p + 1).join("、")}` : "独立，可并行"} · {step.assignee === "human" ? "人工确认／操作" : task.orchestration.steps[position].reviewRequired ? "需验收" : "中间产出自动衔接"}</summary><div className="mt-3 space-y-3"><Field label="步骤用途"><select value={task.orchestration.steps[position].kind} onChange={(event) => updatePlan(index, { steps: task.orchestration!.steps.map((spec, p) => p === position ? { ...spec, kind: event.target.value as Orchestration["steps"][number]["kind"] } : spec) })}>{(step.assignee === "ai" ? [["produce", "直接交付"], ["suggest", "提供建议"]] : [["decide", "决策确认"], ["act", "现实操作"]]).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></Field><Field label="步骤交付标准"><textarea rows={2} value={task.orchestration.steps[position].standard} onChange={(event) => updatePlan(index, { steps: task.orchestration!.steps.map((spec, p) => p === position ? { ...spec, standard: event.target.value } : spec) })} /></Field><fieldset><legend className="mb-2 text-slate-500">前置步骤</legend><div className="flex flex-wrap gap-3">{task.steps.map((_, p) => p !== position && <label key={p} className="flex items-center gap-2"><input type="checkbox" className="!w-auto" checked={task.orchestration!.steps[position].dependsOn.includes(p)} onChange={(event) => updatePlan(index, { steps: task.orchestration!.steps.map((spec, i) => i === position ? { ...spec, dependsOn: event.target.checked ? [...spec.dependsOn, p] : spec.dependsOn.filter((id) => id !== p) } : spec) })} />步骤 {p + 1}</label>)}</div></fieldset><label className="flex items-center gap-2"><input type="checkbox" className="!w-auto" checked={task.orchestration.steps[position].reviewRequired} disabled={step.assignee === "human" || !task.orchestration.steps.some((spec) => spec.dependsOn.includes(position))} onChange={(event) => updatePlan(index, { steps: task.orchestration!.steps.map((spec, p) => p === position ? { ...spec, reviewRequired: event.target.checked } : spec) })} />人工验收后推进</label></div></details>}
      </div>)}</div>
      <div className="mt-3"><Button disabled={task.steps.length >= 5} onClick={() => update(index, { steps: [...task.steps, { title: "", assignee: task.lane === "B" ? "ai" : "human", agentId: task.lane === "B" ? agents.find((agent) => agent.enabled)?.id || null : null, estimatedMinutes: 15, notes: "" }], orchestration: task.orchestration ? { ...task.orchestration, steps: [...task.orchestration.steps, { dependsOn: [task.steps.length - 1], kind: task.lane === "B" ? "produce" : "decide", reviewRequired: true, standard: task.orchestration.output }] } : null })}><Plus size={14} />步骤</Button></div>
      <div className="mt-4 space-y-2">{task.checkpoints.map((checkpoint, p) => <div key={p} className="flex flex-wrap items-center gap-2"><Flag size={14} className="text-sage" /><input aria-label="检查点标题" className="!w-auto min-w-0 flex-1" value={checkpoint.title} onChange={(event) => update(index, { checkpoints: task.checkpoints.map((item, n) => n === p ? { ...item, title: event.target.value } : item) })} /><input type="datetime-local" aria-label="检查点时间" className="!w-52" value={dateInput(checkpoint.dueAt)} onChange={(event) => update(index, { checkpoints: task.checkpoints.map((item, n) => n === p ? { ...item, dueAt: fromDateInput(event.target.value) || "" } : item) })} /><IconButton label="移除检查点" onClick={() => update(index, { checkpoints: task.checkpoints.filter((_, n) => n !== p) })}><X size={14} /></IconButton></div>)}</div>
      <div className="mt-3"><Button disabled={task.checkpoints.length >= 10} onClick={() => update(index, { checkpoints: [...task.checkpoints, { title: "进度检查", dueAt: task.dueAt || `${shanghaiDate()}T16:00:00+08:00` }] })}><Flag size={14} />检查点</Button></div>
    </section>)}
    {validationError && <p role="alert" className="mb-3 text-sm text-red-700">{validationError}</p>}
    <div className="sticky bottom-0 flex flex-wrap items-center justify-between gap-3 border-t border-line bg-white py-3"><label className="flex items-center gap-2 text-xs text-slate-600"><input type="checkbox" className="!w-auto" checked={startAI} disabled={working} onChange={(event) => setStartAI(event.target.checked)} />保存后启动 AI（中间稿自动衔接，最终成果需验收）</label><Button primary disabled={working || !tasks.length} onClick={() => { const parsed = tasks.map((task) => taskDraftSchema.safeParse(task)); const invalid = parsed.find((row) => !row.success); if (invalid && !invalid.success) { setValidationError(invalid.error.issues[0].message); return; } if (tasks.some((task) => !isStandaloneTemporary(task) && (!task.affiliation?.goalId || !task.affiliation.projectId))) { setValidationError("计划任务请选择所属目标和项目"); return; } setValidationError(""); void onSave(tasks, startAI); }}><CheckCheck size={16} />{startAI ? "确认编排并启动 AI" : `确认保存 ${tasks.length} 项任务`}</Button></div>
  </div>;
}

function TaskDetail({ task, scenes, goals, projects, agents, post, working, now, reload, onReplan, editingOnly = false, onSaved }: { task: TaskView; scenes: SceneRow[]; goals: DailyView["goals"]; projects: DailyView["projects"]; agents: AgentView[]; post: Post; working: boolean; now: Date; reload: () => Promise<void>; onReplan: () => void; editingOnly?: boolean; onSaved?: () => void }) {
  const [sceneDraft, setSceneDraft] = useState<string | undefined>(undefined);
  const [affiliationDraft, setAffiliationDraft] = useState<TaskAffiliation | undefined>(undefined);
  const [timeDraft, setTimeDraft] = useState<TaskSchedule | null | undefined>(undefined);
  const [form, setForm] = useState({ title: task.title, notes: task.notes, result: task.result, dueAt: task.dueAt, priority: task.priority });
  const mayReplan = !task.completedAt && task.steps.every((step) => ["pending", "queued", "paused", "failed"].includes(step.status) && !step.timers.length && step.runs.every((run) => run.status === "queued"));
  return <div className="min-w-0 py-4">
    {!editingOnly && <div className="mb-4 flex flex-wrap items-center justify-between gap-2"><h2 className="text-base font-semibold">任务详情</h2><div className="flex items-center gap-2"><Status status={taskStatus(task.steps)} /><IconButton label="删除任务" disabled={working} onClick={() => { if (window.confirm("删除此任务及其执行记录？")) void post({ action: "delete-task", id: task.id }); }}><Trash2 size={15} /></IconButton></div></div>}
    <AffiliationFields value={affiliationDraft || task.affiliation} goals={goals} projects={projects} onChange={setAffiliationDraft} disabled={working} />
    {!editingOnly && task.orchestration && <div className="mb-4 space-y-2 border-y border-line py-3 text-xs"><span className="font-medium text-sage">{quadrant(task.orchestration)}</span><p className="whitespace-pre-wrap break-words">产出：{task.orchestration.output}</p><details><summary className="cursor-pointer text-slate-500">重要与紧迫判断依据</summary><p className="mt-2 whitespace-pre-wrap break-words">{task.orchestration.reason}</p></details></div>}
    {!editingOnly && mayReplan && <div className="mb-4"><Button disabled={working} onClick={onReplan}><Bot size={14} />{task.orchestration ? "调整 AI 编排" : "AI 拆解与编排"}</Button></div>}
    <Field label="主场景"><select value={sceneDraft ?? task.effectiveSceneId} onChange={(event) => setSceneDraft(event.target.value)}>{task.actionId && <option value="">跟随项目／目标</option>}{scenes.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></Field><Field label="标题"><input value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} /></Field>
    <div className="my-3 grid grid-cols-2 gap-3 sm:grid-cols-[85px_minmax(0,1fr)]"><Field label="优先级"><select value={form.priority} onChange={(event) => setForm({ ...form, priority: Number(event.target.value) })}>{priorities.map((label, index) => <option key={label} value={index + 1}>{label}</option>)}</select></Field><div className="col-span-2 sm:col-span-1"><Field label="截止时间 · 北京时间"><input type="datetime-local" value={dateInput(form.dueAt)} onChange={(event) => setForm({ ...form, dueAt: fromDateInput(event.target.value) })} /></Field></div></div>
    <ScheduleFields schedule={timeDraft === undefined ? task.schedule : timeDraft} onChange={setTimeDraft} disabled={working || Boolean(task.completedAt) || task.steps.some((step) => ["running", "preparing", "queued"].includes(step.status))} />
    <Field label="任务资料与备注"><textarea rows={3} value={form.notes} onChange={(event) => setForm({ ...form, notes: event.target.value })} /></Field>
    <div className="mt-3"><Field label="任务结果记录"><textarea rows={2} value={form.result} onChange={(event) => setForm({ ...form, result: event.target.value })} /></Field></div>
    <div className="mt-3 flex flex-wrap gap-2"><Button disabled={working} onClick={async () => {
      const linksChanged = affiliationDraft && (affiliationDraft.goalId !== task.affiliation.goalId || affiliationDraft.projectId !== task.affiliation.projectId);
      if (task.actionId && (sceneDraft !== undefined || linksChanged) && !window.confirm("场景、目标或项目的调整将同步原行动，并影响其他模块和日期的关联任务，确认保存？")) return;
      if (await post({ action: "update-task", id: task.id, ...form, ...(affiliationDraft ? { affiliation: affiliationDraft, confirmActionLinks: Boolean(task.actionId && linksChanged) } : {}), ...(timeDraft !== undefined ? { schedule: timeDraft } : {}), ...(sceneDraft !== undefined ? { sceneId: sceneDraft || null, confirmActionScene: Boolean(task.actionId) } : {}) })) { setSceneDraft(undefined); setTimeDraft(undefined); setAffiliationDraft(undefined); await reload(); onSaved?.(); }
    }}><Save size={14} />{editingOnly ? "保存更新" : "保存记录"}</Button>{!editingOnly && task.actionId && taskStatus(task.steps) === "done" && !task.syncedAt && <Button disabled={working} onClick={async () => { if (await post({ action: "sync-action", id: task.id })) await reload(); }}><CheckCheck size={14} />确认同步本次完成</Button>}{!editingOnly && task.syncedAt && <span className="self-center text-xs text-sage">本次完成已同步</span>}</div>
    {!editingOnly && <><div className="my-5 border-t border-line pt-4"><h3 className="mb-3 text-sm font-semibold">执行步骤</h3>{task.steps.map((step) => <div key={step.id} className="mb-4 border-l-2 border-line pl-3"><div className="flex min-w-0 items-start justify-between gap-2"><span className="min-w-0 break-words text-sm">{step.position + 1}. {step.title}</span><Status status={step.status} /></div><div className="mt-1 text-xs text-slate-400">{step.assignee === "human" ? task.orchestration?.steps[step.position].kind === "decide" ? "本人决策确认" : "本人现实操作" : agents.find((agent) => agent.id === step.agentId)?.name || "Agent 未配置"} · 预计 {step.estimatedMinutes} 分钟</div>
      {task.orchestration && <p className="mt-2 whitespace-pre-wrap break-words text-xs text-slate-500">完成标准：{task.orchestration.steps[step.position].standard}<span className="mt-1 block">{dependencies(task, step.position).length ? `前置：步骤 ${dependencies(task, step.position).map((p) => p + 1).join("、")}` : "无前置 · 可并行"}{!stepReady(task, step.position) ? " · 等待前置产出／确认" : ""}</span></p>}
      {stepReady(task, step.position) && !["done", "produced"].includes(step.status) ? <StepDetail key={`${step.id}-${step.status}`} step={step} post={post} working={working} now={now} /> : step.result && <details className="mt-2 text-xs"><summary className="cursor-pointer text-sage">{step.status === "produced" ? "查看 AI 中间产出" : "查看已确认结果"}</summary><pre className="mt-2 max-h-72 overflow-auto whitespace-pre-wrap break-words bg-slate-50 p-2 text-xs leading-6">{step.result}</pre></details>}
      {!!step.runs.length && <details className="mt-2 text-xs"><summary className="cursor-pointer text-slate-500">执行记录 · {step.runs.length} 次</summary>{step.runs.map((run) => <div key={run.id} className="mt-2 border-t border-line pt-2"><div className="flex flex-wrap gap-2 text-slate-500"><span>第 {run.attempt} 次</span><span>{statusLabels[run.status]}</span><span>{(run.durationMs / 1000).toFixed(1)} 秒</span><span>token：{run.promptTokens === null || run.completionTokens === null ? "未知" : `${run.promptTokens} + ${run.completionTokens}`}</span></div>{run.error && <p className="mt-1 break-words text-red-600">{run.error}</p>}<details className="mt-2"><summary className="cursor-pointer">输入与配置快照</summary><pre className="mt-1 max-h-48 overflow-auto whitespace-pre-wrap break-words bg-slate-50 p-2">{run.input}\n{run.config}</pre></details>{run.output && <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap break-words bg-slate-50 p-2 leading-6">{run.output}</pre>}</div>)}</details>}
    </div>)}</div>
    {!!task.checkpoints.length && <div className="border-t border-line pt-4"><h3 className="mb-3 text-sm font-semibold">检查点</h3>{task.checkpoints.map((checkpoint) => <label key={checkpoint.id} className="mb-3 flex items-start gap-2 text-xs"><input type="checkbox" className="!w-4 shrink-0 accent-[#5e7867]" checked={checkpoint.done} disabled={working} onChange={(event) => void post({ action: "checkpoint", id: checkpoint.id, done: event.target.checked })} /><span className="min-w-0 break-words">{checkpoint.title}<span className={`mt-1 block ${!checkpoint.done && new Date(checkpoint.dueAt) < now ? "text-amber-700" : "text-slate-400"}`}>{timeLabel(checkpoint.dueAt)}</span></span></label>)}</div>}
    </>}
  </div>;
}

function StepDetail({ step, post, working, now }: { step: StepView; post: Post; working: boolean; now: Date }) {
  const [notes, setNotes] = useState(step.notes);
  const [result, setResult] = useState(step.result);
  const [reason, setReason] = useState("");
  return <div className="mt-3">
    {step.assignee === "human" && <div className="mb-3 flex items-center gap-2 text-sage"><Clock3 size={15} /><span className="font-mono text-lg tabular-nums">{durationLabel(timerSeconds(step.timers, now))}</span></div>}
    {step.status === "review" && <pre className="mb-3 max-h-80 overflow-auto whitespace-pre-wrap break-words border border-amber-100 bg-amber-50/50 p-3 text-sm leading-6">{step.result}</pre>}
    {["blocked", "failed"].includes(step.status) && <div className="mb-3 break-words text-xs text-red-700">{step.blockedReason}</div>}
    <Field label="步骤资料与备注"><textarea rows={2} value={notes} disabled={working || ["queued", "preparing"].includes(step.status) || (step.status === "running" && step.assignee === "ai")} onChange={(event) => setNotes(event.target.value)} /></Field>
    <div className="mt-3"><Field label="步骤结果"><textarea rows={3} value={result} onChange={(event) => setResult(event.target.value)} disabled={working || (step.assignee === "ai" && step.status !== "review")} /></Field></div>
    <div className="mt-3 flex flex-wrap gap-2">
      <Button disabled={working || ["queued", "preparing"].includes(step.status) || (step.status === "running" && step.assignee === "ai")} onClick={() => void post({ action: "update-step", id: step.id, notes, result })}><Save size={14} />保存步骤记录</Button>
      {["pending", "paused", "failed"].includes(step.status) && <Button primary disabled={working} onClick={async () => { if (await post({ action: "update-step", id: step.id, notes, result })) await post({ action: "start-step", id: step.id }); }}><Play size={14} />{step.status === "failed" ? "重试" : step.status === "paused" ? "继续" : "开始执行"}</Button>}
      {step.status === "running" && step.assignee === "human" && <Button disabled={working} onClick={() => void post({ action: "pause-step", id: step.id })}><Pause size={14} />暂停</Button>}
      {step.assignee === "human" && ["running", "paused"].includes(step.status) && <Button primary disabled={working} onClick={async () => { if (await post({ action: "update-step", id: step.id, notes, result })) await post({ action: "finish-step", id: step.id, result }); }}><Check size={14} />完成步骤</Button>}
      {step.status === "review" && <Button primary disabled={working} onClick={async () => { if (await post({ action: "update-step", id: step.id, notes, result })) await post({ action: "accept-step", id: step.id, result }); }}><CheckCheck size={14} />验收通过</Button>}
      {step.status === "blocked" && <Button disabled={working} onClick={() => void post({ action: "unblock-step", id: step.id })}><RotateCcw size={14} />解除阻塞</Button>}
    </div>
    {step.status !== "blocked" && <div className="mt-4"><textarea aria-label="阻塞原因或退回要求" rows={2} placeholder={step.status === "review" ? "退回要求或阻塞原因" : "阻塞原因与需要介入的事项"} value={reason} onChange={(event) => setReason(event.target.value)} /><div className="mt-2 flex flex-wrap gap-2"><Button disabled={working || !reason.trim()} onClick={() => void post({ action: "block-step", id: step.id, reason })}><AlertCircle size={14} />标记阻塞</Button>{step.status === "review" && <Button disabled={working || !reason.trim()} onClick={() => void post({ action: "reject-step", id: step.id, reason })}><RotateCcw size={14} />退回重做</Button>}</div></div>}
  </div>;
}

function Reports({ view, post, working }: { view: DailyView; post: Post; working: boolean }) {
  const report = view.plan?.report;
  const [reflection, setReflection] = useState(report?.reflection || "");
  const metrics = report ? JSON.parse(report.metrics) as DailyView["metrics"] : null;
  return <div><div className="mb-5 flex flex-wrap items-center justify-between gap-3"><h2 className="text-base font-semibold">{view.date} 复盘</h2><div className="flex gap-2">{report && <Button onClick={() => download(report.markdown, `${view.date}-每日复盘.md`)}><Download size={15} />Markdown</Button>}<Button disabled={working} primary onClick={() => void post({ action: "report", date: view.date, reflection })}><RotateCcw size={15} />{report ? "刷新日报" : "生成日报"}</Button></div></div>
    {metrics ? <><div className="mb-5 grid grid-cols-2 gap-5 border-b border-line pb-5 sm:grid-cols-4">{[["完成率", `${Math.round(metrics.completionRate * 100)}%`], ["效率得分", metrics.score ?? "暂无"], ["人工投入", `${Math.round(metrics.humanSeconds / 60)} 分钟`], ["AI 耗时", `${Math.round(metrics.aiSeconds)} 秒`]].map(([label, value]) => <div key={label}><div className="mb-2 text-xs text-slate-500">{label}</div><div className="text-xl font-semibold">{value}</div></div>)}</div><div className="mb-5 text-xs text-slate-400">生成于 {timeLabel(report!.generatedAt)}</div><pre className="mb-6 whitespace-pre-wrap break-words text-sm leading-7 text-slate-600">{report!.markdown.split("## 我的复盘")[0]}</pre></> : <div className="py-12 text-center text-sm text-slate-400">当日暂无复盘记录</div>}
    <Field label="我的复盘"><textarea rows={6} value={reflection} onChange={(event) => setReflection(event.target.value)} /></Field><div className="mt-3 flex justify-end"><Button disabled={working} onClick={() => void post({ action: "report", date: view.date, reflection })}><Save size={15} />保存复盘</Button></div>
  </div>;
}
