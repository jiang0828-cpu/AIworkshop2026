"use client";
import TaskSchedule from "./strategy/TaskSchedule";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Activity, AlertCircle, ArrowRight, ArrowUp, ArrowDown, Bot, CalendarDays, CheckCheck, ChevronDown, Flag, LayoutGrid, List, ListChecks, Plus, RefreshCw, Search, UserRound, X } from "lucide-react";
import { shanghaiDate, statusLabels, type DailyView } from "@/lib/daily/shared";
import { buildOverview, groupLabels, groupOrder, hasCurrentWeekReview, overviewCounts, sourceLabels, type OverviewData, type OverviewRecord, type OverviewTask, type TaskGroup, type TaskSource } from "@/lib/workbench-overview";
import { recommendedTasks } from "@/lib/strategy/shared";
import { emptyStrategy, type Navigation } from "./strategy/Shared";
import ClassificationQueue from "./strategy/ClassificationQueue";
import { resolveScene } from "@/lib/scenes";

type Destination = "actions" | "daily" | "goals" | "decisions" | "self" | "aiUse";
type Props = {
  data: OverviewData | null; setActive: (section: Destination) => void;
  open: (modal: { type: string; item?: Partial<OverviewRecord> }) => void;
  navigate: (target: Navigation) => void;
  initialScene?: string;
  reload: (showLoading?: boolean) => Promise<void>; suggestions: ReactNode;
  openTask: (task: { source: "daily" | "ai"; id: string }) => void;
};
const tones: Record<TaskGroup, { dot: string; text: string; background: string }> = {
  pending: { dot: "bg-slate-400", text: "text-slate-600", background: "bg-slate-100" },
  running: { dot: "bg-sky-500", text: "text-sky-700", background: "bg-sky-50" },
  attention: { dot: "bg-amber-500", text: "text-amber-800", background: "bg-amber-50" },
  done: { dot: "bg-sage", text: "text-sage", background: "bg-[#edf4ef]" },
};
function dueLabel(task: OverviewTask) {
  if (!task.dueAt) return "无截止时间";
  if (task.dateOnly) return task.dueAt.slice(0, 10).replaceAll("-", "/");
  return new Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Shanghai", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(task.dueAt));
}
function IconButton({ label, children, onClick, disabled = false, selected }: { label: string; children: ReactNode; onClick: () => void; disabled?: boolean; selected?: boolean }) {
  return <button type="button" title={label} aria-label={label} aria-pressed={selected} onClick={onClick} disabled={disabled}
    className={`grid h-9 w-9 shrink-0 place-items-center rounded-md disabled:opacity-40 ${selected ? "bg-[#e9f0ea] text-sage" : "text-slate-500 hover:bg-slate-100"}`}>{children}</button>;
}
function LinkButton({ children, onClick }: { children: ReactNode; onClick: () => void }) {
  return <button type="button" onClick={onClick} className="inline-flex items-center gap-1.5 text-xs font-medium text-sage hover:underline">{children}<ArrowRight size={14} /></button>;
}
function SectionTitle({ title, children }: { title: string; children?: ReactNode }) {
  return <div className="mb-4 flex flex-wrap items-center justify-between gap-2"><h2 className="text-sm font-semibold text-ink">{title}</h2>{children}</div>;
}

export default function MyWorkbench({ data, setActive, open, reload, suggestions, openTask, navigate, initialScene }: Props) {
  const [daily, setDaily] = useState<DailyView | null>(null);
  const [error, setError] = useState("");
  const [feedback, setFeedback] = useState("");
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);
  const [now, setNow] = useState(() => new Date());
  const [refreshing, setRefreshing] = useState(false);
  const [source, setSource] = useState<TaskSource | "all">("all");
  const [filter, setFilter] = useState<TaskGroup | "all">("all");
  const [layout, setLayout] = useState<"list" | "board">("list");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState("");
  const [limit, setLimit] = useState(12);
  const [showCompleted, setShowCompleted] = useState(false);
  const scene = initialScene === "unclassified" ? data?.strategy?.scenes.find((row) => row.slot === 4)?.id || "local-profile-scene-4" : initialScene || "all";
  const setScene = (value: string) => navigate({ section: "today", scene: value });
  const [pinning, setPinning] = useState(false);
  const fetching = useRef(false);
  const mounted = useRef(false);

  const loadDaily = useCallback(async (signal?: AbortSignal) => {
    if (fetching.current) return;
    fetching.current = true;
    try {
      const response = await fetch(`/api/daily-collaboration?date=${shanghaiDate()}`, { cache: "no-store", signal });
      if (!response.ok) throw new Error("今日协同读取失败");
      const result: DailyView = await response.json();
      if (mounted.current) { setDaily(result); setError(""); setUpdatedAt(new Date()); }
    } catch (failure) {
      if (mounted.current && !signal?.aborted) setError(failure instanceof Error ? failure.message : "今日协同读取失败");
    } finally { fetching.current = false; }
  }, []);
  useEffect(() => {
    mounted.current = true;
    const controller = new AbortController();
    void loadDaily(controller.signal);
    const poll = window.setInterval(() => { setNow(new Date()); if (!document.hidden) void loadDaily(controller.signal); }, 5000);
    const dataPoll = window.setInterval(() => { if (!document.hidden) void reload(false); }, 30000);
    const onFocus = () => { setNow(new Date()); void loadDaily(controller.signal); void reload(false); };
    window.addEventListener("focus", onFocus);
    return () => { mounted.current = false; controller.abort(); window.clearInterval(poll); window.clearInterval(dataPoll); window.removeEventListener("focus", onFocus); };
  }, [loadDaily, reload]);
  const refresh = async () => {
    setRefreshing(true);
    try { await Promise.all([loadDaily(), reload(false)]); }
    finally { if (mounted.current) setRefreshing(false); }
  };
  const tasks = buildOverview(data || {}, daily, now);
  const strategy = data?.strategy || emptyStrategy;
  const scopedTasks = tasks.filter(task => scene === "all" || task.sceneId === scene);
  const priorities = recommendedTasks(scopedTasks, strategy.pins, now);
  const movePriority = async (index: number, offset: number) => {
    if (pinning || !priorities[index + offset]) return;
    const ordered = priorities.map(task => task.key);
    [ordered[index], ordered[index + offset]] = [ordered[index + offset], ordered[index]];
    const otherPins = strategy.pins.filter(pin => pin.date === shanghaiDate(now) && !scopedTasks.some(task => task.key === pin.taskKey) && tasks.some(task => task.key === pin.taskKey && recommendedTasks([task], [], now).length > 0)).map(pin => pin.taskKey);
    if (ordered.length + otherPins.length > 3) { setError("其他场景已有置顶，请先取消置顶后调整"); return; }
    setPinning(true);
    try {
      const response = await fetch("/api/workbench-focus", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ date: shanghaiDate(now), taskKeys: [...ordered, ...otherPins] }) });
      if (!response.ok) throw new Error((await response.json()).error || "排序保存失败");
      await reload(false); setError("");
    } catch (failure) { setError(failure instanceof Error ? failure.message : "排序保存失败"); }
    finally { setPinning(false); }
  };
  const togglePin = async (task: OverviewTask) => {
    if (pinning) return;
    const keys = strategy.pins.filter((pin) => pin.date === shanghaiDate(now) && tasks.some((item) => item.key === pin.taskKey && recommendedTasks([item], [], now).length > 0)).sort((a, b) => a.position - b.position).map((pin) => pin.taskKey);
    const next = keys.includes(task.key) ? keys.filter((key) => key !== task.key) : [...keys, task.key];
    if (next.length > 3) { setError("最多置顶三项，请先取消一项置顶"); return; }
    setPinning(true);
    try {
      const response = await fetch("/api/workbench-focus", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ date: shanghaiDate(now), taskKeys: next }) });
      if (!response.ok) throw new Error((await response.json()).error || "置顶保存失败");
      await reload(false);
      setError("");
    } catch (failure) { setError(failure instanceof Error ? failure.message : "置顶保存失败"); }
    finally { setPinning(false); }
  };
  const counts = overviewCounts(scopedTasks);
  const completion = scopedTasks.length ? Math.round(counts.done / scopedTasks.length * 100) : 0;
  const needle = query.trim().toLocaleLowerCase();
  const filtered = scopedTasks.filter((task) => (showCompleted || filter === "done" || task.group !== "done") && (source === "all" || task.source === source) && (filter === "all" || task.group === filter) &&
    (!needle || [task.title, task.goal, task.project, task.owner].some((text) => text.toLocaleLowerCase().includes(needle))));
  const focusTasks = scopedTasks.filter((task) => task.group === "attention");
  const dueToday = scopedTasks.filter(task => task.group !== "done" && task.dueAt && (task.dateOnly ? task.dueAt.slice(0, 10) : shanghaiDate(new Date(task.dueAt))) === shanghaiDate(now)).length;
  const pendingSuggestions = (data?.suggestions || []).filter((item) => item.status === "待确认");
  const weekReviewed = hasCurrentWeekReview(data?.reviews, now);
  const profileDone = [data?.name, data?.stage, data?.roles, data?.goals?.length, data?.valueRules?.length, data?.evidences?.length].filter(Boolean).length;
  const isOpenRecord = (record: OverviewRecord) => !["已完成", "完成", "已取消", "归档", "已归档", "已停止"].includes(record.status || "");
  const inScene = (record: OverviewRecord) => scene === "all" || resolveScene(record, data?.goals || [], data?.projects || [], strategy.scenes).effectiveSceneId === scene;
  const projects = (data?.projects || []).filter(row => isOpenRecord(row) && inScene(row)).sort((a, b) => (a.deadline ? new Date(a.deadline).getTime() : Infinity) - (b.deadline ? new Date(b.deadline).getTime() : Infinity) || Number(b.status === "进行中") - Number(a.status === "进行中"));
  const goals = (data?.goals || []).filter(row => isOpenRecord(row) && inScene(row)).sort((a, b) => Number(b.status === "进行中") - Number(a.status === "进行中"));
  const recent = [
    ...(data?.goals || []).map((row) => ({ id: row.id, title: row.title, updatedAt: row.updatedAt, target: { section: "goals", goalId: row.id } })),
    ...(data?.projects || []).map((row) => ({ id: row.id, title: row.name, updatedAt: row.updatedAt, target: { section: "goals", projectId: row.id } })),
    ...(data?.actions || []).map((row) => ({ id: row.id, title: row.title, updatedAt: row.updatedAt, target: { section: "actions", recordId: row.id } })),
    ...strategy.records.filter((row) => ["vision", "signal", "skill"].includes(row.kind)).map((row) => ({ id: row.id, title: row.title, updatedAt: row.updatedAt, target: { section: row.kind === "signal" ? "situation" : "self", tab: row.kind === "signal" ? "signals" : row.kind === "vision" ? "values" : "skills", recordId: row.id } })),
  ].filter((row) => row.updatedAt).sort((a, b) => new Date(b.updatedAt!).getTime() - new Date(a.updatedAt!).getTime()).slice(0, 8);
  const changeFilter = (value: TaskGroup | "all") => { setFilter(value); setLimit(12); };
  const navigateTask = (task: OverviewTask) => {
    if (task.source === "action") {
      const action = data?.actions?.find((item) => item.id === task.id);
      if (action) open({ type: "action", item: action });
    } else openTask({ source: task.source, id: task.id });
  };
  const taskDetail = (task: OverviewTask) => {
    const detail = task.source === "daily" ? daily?.plan?.tasks.find((item) => item.id === task.id) : null;
    return <div className="mt-3 border-t border-line pt-3 text-xs leading-5">
      {(task.goal || task.project) && <p className="mb-2 text-sage">{[task.goal && `目标：${task.goal}`, task.project && `项目：${task.project}`].filter(Boolean).join(" · ")}</p>}
      {task.notes && <p className="mb-2 whitespace-pre-wrap break-words text-slate-600">{task.notes}</p>}
      {task.standard && <p className="mb-2 whitespace-pre-wrap break-words text-slate-600"><span className="font-medium">完成标准：</span>{task.standard}</p>}
      {task.reason && <p className="mb-2 whitespace-pre-wrap break-words text-red-700">{task.reason}</p>}
      {task.source === "daily" && detail && <ol className="mb-3 space-y-2">{[...detail.steps].sort((a, b) => a.position - b.position).map((step, index) => <li key={step.id} className="flex items-start gap-2">
        <span className={`mt-0.5 shrink-0 ${step.status === "done" ? "text-sage" : "text-slate-400"}`}>{step.status === "done" ? <CheckCheck size={14} /> : `${index + 1}.`}</span>
        <span className="min-w-0 flex-1 break-words">{step.title}<span className="mt-0.5 block text-slate-400">{step.assignee === "human" ? "我" : "AI"} · {step.estimatedMinutes} 分钟 · {statusLabels[step.status] || step.status}</span></span>
      </li>)}</ol>}
      <LinkButton onClick={() => navigateTask(task)}>{task.source === "action" ? "编辑任务" : task.source === "daily" ? "进入每日任务协同" : "进入 AI 使用中心"}</LinkButton>
      {task.group !== "done" && <button type="button" disabled={pinning} onClick={() => void togglePin(task)} className="ml-4 text-sage disabled:opacity-50">{strategy.pins.some((pin) => pin.date === shanghaiDate(now) && pin.taskKey === task.key) ? "取消今日置顶" : "置顶到今日"}</button>}
      <button type="button" onClick={() => open({ type: "aiTask", item: { title: task.title, instructions: [task.notes, task.standard].filter(Boolean).join("\n"), goalId: data?.actions?.find((row) => row.id === (task.source === "action" ? task.id : detail?.actionId))?.goalId, projectId: data?.actions?.find((row) => row.id === (task.source === "action" ? task.id : detail?.actionId))?.projectId } })} className="ml-4 text-sage">创建 AI 任务</button>
    </div>;
  };
  const taskRow = (task: OverviewTask, board = false) => {
    const tone = tones[task.group];
    const action = data?.actions?.find(row => row.id === (task.source === "action" ? task.id : daily?.plan?.tasks.find(row => row.id === task.id)?.actionId));
    return <div key={task.key} className={board ? "rounded-md border border-line bg-white p-3" : "border-b border-line py-3 last:border-b-0"}>
      <button type="button" onClick={() => setSelected(selected === task.key ? "" : task.key)} aria-expanded={selected === task.key} aria-label={`查看任务：${task.title}`}
        className={`flex w-full min-w-0 gap-3 text-left ${board ? "items-start" : "items-center"}`}>
        {!board && <span className={`grid h-8 w-8 shrink-0 place-items-center rounded-md ${tone.background} ${tone.text}`}>{task.group === "done" ? <CheckCheck size={16} /> : task.group === "attention" ? <AlertCircle size={16} /> : task.source === "daily" ? <Activity size={16} /> : task.source === "ai" ? <Bot size={16} /> : <UserRound size={16} />}</span>}
        <span className="min-w-0 flex-1">
          <span className={`block break-words text-sm font-medium ${task.group === "done" ? "text-slate-500" : "text-ink"}`}>{task.title}</span>
          <span className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-slate-500">
            {task.recordCode && <span className="break-all font-mono">{task.recordCode}</span>}
            <span className="text-sage">{strategy.scenes.find((scene) => scene.id === task.sceneId)?.name || "其他"}</span><span>{sourceLabels[task.source]}</span><span>· {task.owner}</span>{task.project && <span className="break-words">· {task.project}</span>}
            {action && <TaskSchedule recurrence={action.recurrence} estimatedHours={action.estimatedHours} />}
            <span className={task.overdue ? "font-medium text-red-700" : ""}>{task.overdue ? "已逾期 · " : "· "}{dueLabel(task)}</span>
          </span>
          {task.progress && <span className="mt-2 flex max-w-64 items-center gap-2"><span role="progressbar" aria-label={`${task.title}步骤进度`} aria-valuenow={task.progress.done} aria-valuemin={0} aria-valuemax={task.progress.total || 1} className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-100"><span className={`block h-full ${tone.dot}`} style={{ width: `${task.progress.total ? task.progress.done / task.progress.total * 100 : 0}%` }} /></span><span className="shrink-0 text-[11px] text-slate-500">{task.progress.done}/{task.progress.total} 步</span></span>}
          {board && <span className={`mt-2 inline-block rounded px-1.5 py-0.5 text-[11px] ${tone.background} ${tone.text}`}>{task.status}</span>}
        </span>
        {!board && <span className={`hidden shrink-0 rounded px-2 py-1 text-xs sm:inline-block ${tone.background} ${tone.text}`}>{task.status}</span>}
        <ChevronDown size={14} className={`mt-1 shrink-0 text-slate-400 transition-transform ${selected === task.key ? "rotate-180" : ""}`} />
      </button>
      {!board && <span className={`ml-11 mt-2 inline-block rounded px-1.5 py-0.5 text-[11px] sm:hidden ${tone.background} ${tone.text}`}>{task.status}</span>}
      {selected === task.key && taskDetail(task)}
    </div>;
  };

  return <div className="[overflow-wrap:anywhere]">
    <div className="mb-7 flex flex-wrap items-start justify-between gap-4">
      <div><div className="mb-2 flex items-center gap-2 text-xs text-slate-500"><CalendarDays size={14} />{new Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Shanghai", month: "long", day: "numeric", weekday: "long" }).format(now)}</div>
        <h1 className="text-2xl font-semibold text-ink">我的工作台</h1><p className="mt-2 text-sm text-slate-500">今日到期 {dueToday} 项 · 进行中 {counts.running} 项 · 需处理 {focusTasks.length} 项</p></div>
      <div className="flex flex-wrap items-center gap-2">
        <IconButton label="刷新工作台" onClick={() => void refresh()} disabled={refreshing}><RefreshCw size={16} className={refreshing ? "animate-spin" : ""} /></IconButton>
        <button type="button" onClick={() => open({ type: "action" })} className="inline-flex min-h-9 items-center gap-2 rounded-md border border-line bg-white px-3 py-2 text-sm text-slate-600 hover:bg-mist"><Plus size={15} />新建任务</button>
        <button type="button" onClick={() => setActive("daily")} className="inline-flex min-h-9 items-center gap-2 rounded-md bg-[#496554] px-3 py-2 text-sm text-white hover:bg-[#3c5545]"><Activity size={15} />今日编排</button>
      </div>
    </div>

    <section className="mb-5 flex flex-wrap items-center gap-2" aria-label="场景快捷筛选"><button type="button" aria-pressed={scene === "all"} onClick={() => setScene("all")} className={`border-b-2 px-3 py-2 text-xs ${scene === "all" ? "border-sage text-sage" : "border-transparent text-slate-500"}`}>全部场景</button>{strategy.scenes.map(item => <button key={item.id} type="button" aria-pressed={scene === item.id} onClick={() => setScene(scene === item.id ? "all" : item.id)} className={`border-b-2 px-3 py-2 text-xs ${scene === item.id ? "border-sage text-sage" : "border-transparent text-slate-500"}`}>{item.name}<span className="ml-1 text-slate-400">{tasks.filter(task => task.sceneId === item.id && task.group !== "done").length}</span></button>)}</section>
    <details className="mb-4"><summary className="cursor-pointer text-xs text-slate-500">场景目标与项目</summary><section aria-label="场景概览" className="mb-6 grid grid-cols-2 gap-x-5 gap-y-4 md:grid-cols-3">{strategy.scenes.map((item) => {
      const pending = tasks.filter((task) => task.sceneId === item.id && task.group !== "done");
      const belongs = (row: OverviewRecord) => resolveScene(row, data?.goals || [], data?.projects || [], strategy.scenes).effectiveSceneId === item.id;
      return <button key={item.id} type="button" aria-pressed={scene === item.id} onClick={() => setScene(scene === item.id ? "all" : item.id)} className={`border-b-2 py-3 text-left ${scene === item.id ? "border-sage" : "border-line"}`}><span className="font-medium text-sm">{item.name}</span><span className="mt-2 block text-xs text-slate-500">目标 {(data?.goals || []).filter(row => isOpenRecord(row) && belongs(row)).length} · 活跃项目 {(data?.projects || []).filter(row => isOpenRecord(row) && belongs(row)).length}</span><span className="mt-1 block text-xs text-slate-500">待推进 {pending.length} · 需处理 {pending.filter((task) => task.group === "attention").length}</span></button>;
    })}</section></details>
    {scene === "unclassified" && data && <><ClassificationQueue data={data} reload={() => reload(false)} navigate={navigate} notify={setFeedback} />{feedback && <p role="status" className="mb-4 text-xs text-sage">{feedback}</p>}</>}
    <section className="mb-6" aria-label="今日优先事项"><SectionTitle title="今日优先事项" />{priorities.length ? <div className="divide-y divide-line">{priorities.map((task, index) => {
      const pinned = strategy.pins.some(pin => pin.date === shanghaiDate(now) && pin.taskKey === task.key);
      return <div key={task.key} className="flex min-w-0 items-center gap-2 py-3">
        <span className="text-xs text-slate-400">{index + 1}</span>
        <button type="button" onClick={() => navigateTask(task)} className="min-w-0 flex-1 text-left"><span className="block break-words text-sm">{task.title}</span><span className={`mt-1 block text-xs ${task.overdue ? "text-red-700" : "text-slate-500"}`}>{pinned ? "手动排序 · " : ""}{task.overdue ? "已逾期 · " : ""}{task.status} · {dueLabel(task)}</span></button>
        <IconButton label={`上移：${task.title}`} disabled={pinning || index === 0} onClick={() => void movePriority(index, -1)}><ArrowUp size={14} /></IconButton>
        <IconButton label={`下移：${task.title}`} disabled={pinning || index === priorities.length - 1} onClick={() => void movePriority(index, 1)}><ArrowDown size={14} /></IconButton>
        <IconButton label={`${pinned ? "取消置顶" : "今日置顶"}：${task.title}`} selected={pinned} disabled={pinning} onClick={() => void togglePin(task)}><Flag size={16} /></IconButton>
      </div>;
    })}</div> : <p className="text-xs text-slate-400">暂无近期交付或需处理任务</p>}</section>
    <section aria-label="任务概览" className="mb-7 border-y border-line py-5">
      <div className="grid grid-cols-4 gap-2 sm:gap-4">{groupOrder.map((group) => <button type="button" key={group} onClick={() => changeFilter(filter === group ? "all" : group)} aria-pressed={filter === group}
        className={`rounded-md px-1 py-2 text-left transition sm:px-3 ${filter === group ? tones[group].background : "hover:bg-white"}`}>
        <span className="flex items-center gap-1.5 text-[11px] text-slate-500 sm:gap-2 sm:text-xs"><span className={`h-2 w-2 shrink-0 rounded-full ${tones[group].dot}`} />{groupLabels[group]}</span>
        <span className={`mt-2 block text-2xl font-semibold ${tones[group].text}`}>{counts[group]}</span>
      </button>)}</div>
      <div className="mt-5 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500"><span>当前场景累计完成 {counts.done}/{scopedTasks.length} · {scopedTasks.length ? `${completion}%` : "暂无任务"}</span><span>{daily?.date === shanghaiDate(now) ? `今日协同人工剩余（全部场景）${Math.ceil(daily.metrics.remainingHumanMinutes)} 分钟` : error ? "协同暂不可用" : "协同数据读取中"}</span></div>
      <div className="mt-2 flex h-2 overflow-hidden rounded-full bg-slate-100" aria-label="任务状态分布">{groupOrder.map((group) => counts[group] > 0 && <button key={group} type="button" title={`${groupLabels[group]} ${counts[group]} 项`} aria-label={`${groupLabels[group]} ${counts[group]} 项`} onClick={() => changeFilter(group)} className={`h-full ${tones[group].dot}`} style={{ width: `${counts[group] / scopedTasks.length * 100}%` }} />)}</div>
    </section>

    <div className="min-w-0 space-y-6">
      <section className="min-w-0" aria-label="统一任务视图">
        <SectionTitle title="任务总览"><div className="flex items-center gap-1"><IconButton label="列表视图" selected={layout === "list"} onClick={() => { setLayout("list"); setLimit(12); }}><List size={16} /></IconButton><IconButton label="看板视图" selected={layout === "board"} onClick={() => { setLayout("board"); setLimit(6); }}><LayoutGrid size={16} /></IconButton></div></SectionTitle>
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <label className="inline-flex items-center gap-2 whitespace-nowrap text-xs text-slate-500"><input type="checkbox" className="!h-4 !w-4 !p-0" checked={showCompleted} onChange={event => { setShowCompleted(event.target.checked); setLimit(12); }} />显示已完成</label>
          <div className="flex flex-wrap gap-1" role="group" aria-label="任务来源">{(["all", "action", "daily", "ai"] as const).map((value) => <button type="button" key={value} onClick={() => { setSource(value); setLimit(12); }} aria-pressed={source === value}
            className={`rounded-md px-2.5 py-2 text-xs ${source === value ? "bg-[#e9f0ea] font-medium text-sage" : "text-slate-500 hover:bg-slate-100"}`}>{value === "all" ? "全部来源" : sourceLabels[value]}</button>)}</div>
          <select aria-label="工作台任务状态筛选" value={filter} onChange={(event) => changeFilter(event.target.value as TaskGroup | "all")} className="!w-auto !min-w-0 !py-1.5 !text-xs"><option value="all">全部状态</option>{groupOrder.map((group) => <option key={group} value={group}>{groupLabels[group]}</option>)}</select>
          <label className="relative min-w-0 flex-1 basis-40"><Search size={14} className="absolute left-2.5 top-2.5 text-slate-400" /><input aria-label="搜索工作台任务" placeholder="搜索任务、项目或目标" value={query} onChange={(event) => { setQuery(event.target.value); setLimit(12); }} className="!py-1.5 !pl-8 !pr-8 !text-xs" />{query && <button type="button" title="清除搜索" aria-label="清除搜索" onClick={() => setQuery("")} className="absolute right-2 top-2 text-slate-400"><X size={14} /></button>}</label>
        </div>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-400"><span>{filtered.length} 项 · 全部任务 / 今日协同 / AI 使用中心</span><span>{updatedAt ? `协同更新 ${updatedAt.toLocaleTimeString("zh-CN", { hour12: false })}` : "正在读取今日协同…"}</span></div>
        {error && <div role="alert" className="mb-4 flex items-center gap-2 border-l-2 border-amber-500 bg-amber-50 p-3 text-xs text-amber-800"><AlertCircle size={15} className="shrink-0" /><span className="flex-1">{error}{daily ? "，显示上次读取结果" : "，暂未计入总览"}</span><button type="button" onClick={() => void refresh()} className="shrink-0 underline">重试</button></div>}
        {!filtered.length ? <div className="border-y border-dashed border-line py-12 text-center"><ListChecks size={24} className="mx-auto mb-3 text-slate-300" /><p className="text-sm text-slate-500">{tasks.length ? "没有匹配的任务" : "暂无任务"}</p><div className="mt-3">{tasks.length ? <LinkButton onClick={() => { setQuery(""); setSource("all"); changeFilter("all"); }}>重置筛选</LinkButton> : <LinkButton onClick={() => setActive("daily")}>添加今日任务</LinkButton>}</div></div>
          : layout === "list" ? <div className="border-t border-line">{filtered.slice(0, limit).map((task) => taskRow(task))}</div>
            : <div className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">{groupOrder.filter((group) => filter === "all" || filter === group).map((group) => {
              const items = filtered.filter((task) => task.group === group);
              return <div key={group} className="min-w-0"><div className={`mb-3 flex items-center justify-between border-t-2 px-1 py-2 text-xs font-medium ${tones[group].text} ${group === "attention" ? "border-amber-500" : group === "running" ? "border-sky-500" : group === "done" ? "border-sage" : "border-slate-300"}`}><span>{groupLabels[group]}</span><span>{items.length}</span></div><div className="space-y-2">{items.length ? items.slice(0, limit).map((task) => taskRow(task, true)) : <p className="py-8 text-center text-xs text-slate-400">暂无任务</p>}</div></div>;
            })}</div>}
        {(layout === "list" ? filtered.length > limit : groupOrder.some((group) => filtered.filter((task) => task.group === group).length > limit)) && (
          <div className="mt-4 text-center">
            <LinkButton onClick={() => setLimit(limit + (layout === "board" ? 6 : 12))}>显示更多</LinkButton>
          </div>
        )}
      </section>

      <section className="border-t border-line pt-4"><aside className="mt-4 grid min-w-0 gap-6 sm:grid-cols-2" aria-label="工作台提醒">
        <section><SectionTitle title="需要处理">{focusTasks.length > 0 && <LinkButton onClick={() => { setSource("all"); setQuery(""); changeFilter("attention"); }}>全部</LinkButton>}</SectionTitle>
          {focusTasks.length ? <div className="space-y-3">{focusTasks.slice(0, 3).map((task) => <button key={task.key} type="button" onClick={() => { setSource("all"); setQuery(""); changeFilter("attention"); setSelected(task.key); }} className="block w-full border-l-2 border-amber-400 pl-3 text-left"><span className="block break-words text-sm font-medium">{task.title}</span><span className="mt-1 block text-xs text-amber-800">{task.overdue ? "已逾期" : task.status} · {sourceLabels[task.source]}</span></button>)}</div> : <p className="flex items-center gap-2 text-xs text-slate-500"><CheckCheck size={15} className="text-sage" />暂无逾期、阻塞或待验收任务</p>}
          <div className="mt-4 space-y-2 border-t border-line pt-3"><button type="button" onClick={() => setActive("self")} className="flex w-full items-center justify-between gap-2 text-left text-xs text-slate-600"><span>待确认 AI 建议</span><span className="flex items-center gap-1">{pendingSuggestions.length}<ArrowRight size={13} /></span></button><button type="button" onClick={() => setActive("actions")} className="flex w-full items-center justify-between gap-2 text-left text-xs text-slate-600"><span>本周复盘</span><span className="flex items-center gap-1">{weekReviewed ? "已记录" : "待填写"}<ArrowRight size={13} /></span></button></div>
        </section>
        <section><SectionTitle title="近期交付项目"><LinkButton onClick={() => setActive("goals")}>目标与项目</LinkButton></SectionTitle>
          {projects.slice(0, 3).map((project) => {
            const actions = (data?.actions || []).filter((action) => action.projectId === project.id && !["已取消", "归档", "已归档"].includes(action.status || ""));
            const done = actions.filter((action) => action.status === "已完成").length;
            return <button key={project.id} type="button" onClick={() => navigate({ section: "goals", projectId: project.id })} className="mb-4 block w-full text-left"><span className="block break-words text-sm font-medium">{project.name}</span><span className="mt-1 block text-xs text-slate-500">{project.deadline ? `交付 ${project.deadline.slice(0, 10)}` : "交付日期待填写"} · {actions.length ? `任务完成 ${done}/${actions.length}` : "暂无关联任务"}</span>{actions.length > 0 && <span role="progressbar" aria-label={`${project.name}关联任务完成进度`} aria-valuenow={done} aria-valuemin={0} aria-valuemax={actions.length} className="mt-2 block h-1.5 overflow-hidden rounded-full bg-slate-100"><span className="block h-full bg-sage" style={{ width: `${done / actions.length * 100}%` }} /></span>}</button>;
          })}
          {goals.slice(0, 2).map((goal) => <button key={goal.id} type="button" onClick={() => navigate({ section: "goals", goalId: goal.id })} className="mt-3 flex w-full items-start gap-2 text-left text-xs text-slate-600"><Flag size={14} className="mt-0.5 shrink-0 text-sage" /><span className="min-w-0 break-words">{goal.title}<span className="mt-1 block text-slate-400">{goal.status}</span></span></button>)}
          {!goals.length && !projects.length && <p className="text-xs text-slate-400">暂无目标或项目</p>}
        </section>
      </aside></section>
    </div>

    <details className="mt-6 border-t border-line pt-4"><summary className="cursor-pointer text-sm text-slate-500">近期动态</summary><section className="mt-3">{recent.length ? recent.map((row) => <button key={row.id} type="button" onClick={() => navigate(row.target)} className="flex w-full items-start justify-between gap-3 border-b border-line py-3 text-left text-xs"><span className="min-w-0 break-words">{row.title}</span><time className="shrink-0 text-slate-400">{new Date(row.updatedAt!).toLocaleDateString("zh-CN", { timeZone: "Asia/Shanghai" })}</time></button>) : <p className="text-xs text-slate-400">暂无变更记录</p>}</section></details>
    <details className="mt-4 border-t border-line pt-4"><summary className="cursor-pointer text-sm text-slate-500">个人与 AI 协作</summary><section className="mt-4"><SectionTitle title="个人与 AI 协作"><LinkButton onClick={() => setActive("aiUse")}>AI 使用中心</LinkButton></SectionTitle><div className="grid grid-cols-2 gap-x-5 gap-y-4 text-xs text-slate-500 sm:grid-cols-4">
      <button type="button" onClick={() => setActive("self")} className="text-left"><span className="block">建档完整度</span><span className="mt-1.5 block font-medium text-ink">{Math.round(profileDone / 6 * 100)}%</span></button>
      <button type="button" onClick={() => setActive("aiUse")} className="text-left"><span className="block">当前身份卡</span><span className="mt-1.5 block font-medium text-ink">{data?.identityCard ? `v${data.identityCard.currentVersion} · ${data.identityCard.status}` : "尚未生成"}</span></button>
      <button type="button" onClick={() => setActive("aiUse")} className="text-left"><span className="block">最近上下文包</span><span className="mt-1.5 block font-medium text-ink">{data?.contextPackages?.[0] ? `CP-${String(data.contextPackages[0].packageNumber).padStart(4, "0")}` : "尚未生成"}</span></button>
      <button type="button" onClick={() => setActive("aiUse")} className="text-left"><span className="block">待确认档案更新</span><span className="mt-1.5 block font-medium text-ink">{pendingSuggestions.filter((item) => item.targetType === "correction").length} 条</span></button>
    </div></section>
    <section className="mt-6 border-t border-line pt-5"><SectionTitle title={`待确认的 AI 建议 · ${pendingSuggestions.length}`}><LinkButton onClick={() => setActive("self")}>认识自己</LinkButton></SectionTitle>{suggestions}</section></details>
  </div>;
}
