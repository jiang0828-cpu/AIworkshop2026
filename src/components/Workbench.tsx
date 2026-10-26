"use client";
/* eslint-disable @typescript-eslint/no-explicit-any */

import JSZip from "jszip";
import { useCallback, useEffect, useRef, useState } from "react";
import AIUseCenter from "./AIUseCenter";
import DailyCollaboration from "./DailyCollaboration";
import MyWorkbench from "./MyWorkbench";
import WorkspaceBackup, { BackupExportButton, useWorkspaceBackup } from "./WorkspaceBackup";
import SuperAdminSettings from "./SuperAdminSettings";
import SelfModule from "./strategy/SelfModule";
import ProfileSceneSections from "./strategy/ProfileSceneSections";
import SituationModule from "./strategy/SituationModule";
import RadarReferences from "./strategy/radar/References";
import ExecutionModule from "./strategy/ExecutionModule";
import { SceneFilter, SceneSelect, SourceLinks, type Navigation } from "./strategy/Shared";
import { matchesSceneId, resolveScene } from "@/lib/scenes";
import { goalHorizons, hierarchyIssue, parentCandidates } from "@/lib/goal-hierarchy";
import { recordAncestors, recordParentCandidates } from "@/lib/record-hierarchy";
import { reviewPeriod, reviewPeriodLabels, monthReviewRange, yearReviewRange, planReviewRanges, deliveryInRange, type ReviewPeriod } from "@/lib/review-period";
import { periodDeliveries } from "@/lib/period-deliveries";
import { periodTaskDone, recurrenceProgress } from "@/lib/recurring-tasks";
import { reviewDeliveryDraft } from "@/lib/review-delivery-draft";
import { reviewCompletedWork, type CompletedDailyWork } from "@/lib/review-completed-work";
import { otherSceneId } from "@/lib/scenes";
import { reviewSources } from "@/lib/review-links";
import ReviewScopeFields from "./ReviewScopeFields";
import DeliveryMeta from "./strategy/DeliveryMeta";
import TaskSchedule, { TaskRecurrenceInput } from "./strategy/TaskSchedule";
import { taskHours, taskMinutes } from "@/lib/task-schedule";
import { shanghaiDate } from "@/lib/daily/shared";
import { type StrategyView } from "@/lib/strategy/shared";
import {
  Activity,
  Archive,
  ArrowRight,
  Brain,
  Check,
  ChevronRight,
  Download,
  FileText,
  Flag,
  Gauge,
  Globe2,
  HeartHandshake,
  History,
  ListChecks,
  Menu,
  Newspaper,
  Pencil,
  Plus,
  RefreshCw,
  RotateCcw,
  Settings,
  Sparkles,
  TrendingUp,
  Trash2,
  Upload,
  UserRound,
  X,
  Building2,
} from "lucide-react";

type Item = Record<string, any>;
type Data = Item & { [key: string]: any };
type Section =
  | "today"
  | "situation"
  | "self"
  | "goals"
  | "actions"
  | "daily"
  | "decisions"
  | "documents"
  | "aiUse"
  | "settings";
const nav: Array<{ key: Section; label: string; icon: typeof Gauge }> = [
  { key: "today", label: "我的工作台", icon: Gauge },
  { key: "daily", label: "每日任务协同", icon: Activity },
  { key: "situation", label: "形势研判", icon: Globe2 },
  { key: "goals", label: "目标与执行", icon: Flag },
  { key: "actions", label: "任务与复盘", icon: ListChecks },
  { key: "self", label: "认识自己", icon: Brain },
  { key: "documents", label: "AI档案中心", icon: FileText },
  { key: "settings", label: "设置", icon: Settings },
];
const fieldLabels: Record<string, string> = {
  title: "标题",
  description: "描述",
  learning: "得到的学习",
  happenedAt: "发生日期",
  ability: "能力",
  evidence: "证据",
  value: "价值",
  rule: "取舍规则",
  conflict: "价值冲突",
  name: "名称",
  category: "类别",
  severity: "程度",
  statement: "判断或假设",
  metric: "衡量指标",
  budget: "投入（时间、预算或人力）",
  boundary: "项目边界",
  stopCondition: "停止条件",
  horizon: "时间范围",
  status: "状态",
  purpose: "任务目的",
  dueDate: "截止日期",
  estimatedHours: "预计投入（分钟）",
  recurrence: "任务周期",
  standard: "完成标准",
  context: "决策背景",
  criteria: "比较标准",
  reversible: "可逆性",
  facts: "已知事实",
  assumptions: "关键假设",
  gaps: "信息缺口",
  selectedOption: "最终选择",
  options: "选项",
  reviewDate: "复盘日期",
  deadline: "截止日期",
  rationale: "选择理由",
  risk: "风险",
  resultReview: "结果复盘",
  wins: "本周收获",
  goalIssue: "目标问题",
  strategyIssue: "策略问题",
  executionIssue: "执行问题",
  externalIssue: "外部条件",
  adjustment: "下周调整",
  benefit: "收益",
  cost: "代价",
  score: "评分",
  content: "研判内容",
};
const horizonAliases: Record<string, string> = {
  长期: "10年",
  中期: "5年",
  年度: "1年",
};
const matchesHorizon = (horizon: string, filter: string) =>
  filter === "全部" || horizon === filter || horizonAliases[horizon] === filter;
const configs: Record<
  string,
  { type: string; label: string; fields: string[] }
> = {
  experience: {
    type: "experience",
    label: "项目及经历",
    fields: ["title", "description", "learning", "happenedAt"],
  },
  evidence: {
    type: "evidence",
    label: "能力证据",
    fields: ["ability", "evidence", "confidence"],
  },
  valueRule: {
    type: "valueRule",
    label: "价值规则",
    fields: ["value", "priority", "rule", "conflict"],
  },
  resource: {
    type: "resource",
    label: "资源",
    fields: ["name", "description", "category"],
  },
  constraint: {
    type: "constraint",
    label: "约束",
    fields: ["name", "description", "severity"],
  },
  assumption: {
    type: "assumption",
    label: "待验证假设",
    fields: ["statement", "status", "evidence"],
  },
  goal: {
    type: "goal",
    label: "目标",
    fields: ["title", "description", "horizon", "metric", "status", "deadline"],
  },
  project: {
    type: "project",
    label: "项目",
    fields: [
      "name",
      "deadline",
      "description",
      "metric",
      "budget",
      "boundary",
      "stopCondition",
      "risk",
      "status",
    ],
  },
  action: {
    type: "action",
    label: "任务",
    fields: [
      "title",
      "purpose",
      "dueDate",
      "recurrence",
      "estimatedHours",
      "standard",
      "status",
    ],
  },
  milestone: { type: "milestone", label: "里程碑", fields: ["title", "deadline", "metric", "status"] },
  review: {
    type: "review",
    label: "复盘",
    fields: [
      "periodStart",
      "periodEnd",
      "wins",
      "goalIssue",
      "strategyIssue",
      "executionIssue",
      "externalIssue",
      "adjustment",
    ],
  },
  decision: {
    type: "decision",
    label: "重要决策",
    fields: [
      "title",
      "context",
      "criteria",
      "options",
      "facts",
      "assumptions",
      "gaps",
      "selectedOption",
      "rationale",
      "risk",
      "reviewDate",
      "status",
      "reversible",
      "resultReview",
    ],
  },
  situationItem: {
    type: "situationItem",
    label: "研判条目",
    fields: ["title", "content"],
  },
};

const arr = (data: Data | null, key: string): Item[] => data?.[key] || [];
const dateText = (value: unknown) =>
  value ? new Date(String(value)).toLocaleDateString("zh-CN") : "未设置";
const embeddedAssociation = (value: unknown, label: string, nextLabel?: string) => {
  const source = String(value || "");
  const marker = `${label}：`;
  const start = source.indexOf(marker);
  if (start < 0) return "";
  const contentStart = start + marker.length;
  const next = nextLabel ? source.indexOf(`${nextLabel}：`, contentStart) : -1;
  const lineEnd = source.indexOf("\n", contentStart);
  const end = next >= 0 && (lineEnd < 0 || next < lineEnd) ? next : lineEnd;
  return source.slice(contentStart, end < 0 ? source.length : end).trim();
};
const actionLineage = (action: Item, goals: Item[], projects: Item[]) => {
  const project = projects.find((project) => project.id === action.projectId);
  return {
    goal: goals.find((goal) => goal.id === (project?.goalId || action.goalId))?.title || embeddedAssociation(action.purpose, "关联目标", "关联项目"),
    project: project?.name || embeddedAssociation(action.purpose, "关联项目"),
  };
};

export default function Workbench() {
  const [active, setActiveState] = useState<Section>("today");
  const [target, setTarget] = useState<Navigation>({ section: "today" });
  const navigationInitialized = useRef(false);
  const [pendingNavigation, setPendingNavigation] = useState<Navigation | null>(null);
  const [aiDraft, setAiDraft] = useState<Item | null>(null);
  const [data, setData] = useState<Data | null>(null);
  const [loading, setLoading] = useState(true);
  const [mobileNav, setMobileNav] = useState(false);
  const [toast, setToast] = useState("");
  const [modal, setModal] = useState<{ type: string; item?: Item } | null>(
    null,
  );
  const notify = useCallback((message: string) => {
    setToast(message);
    window.setTimeout(() => setToast(""), 3400);
  }, []);
  const backup = useWorkspaceBackup(notify);
  const navigateDirect = useCallback((next: Navigation, push = true) => {
    if (!["decisions", "aiUse"].includes(next.section) && !nav.some((item) => item.key === next.section)) return;
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(next)) if (value) params.set(key, value);
    if (push) window.history.pushState(null, "", `/?${params}`);
    if (next.section !== "aiUse") setAiDraft(null);
    setTarget(next); setActiveState(next.section as Section); setMobileNav(false);
  }, []);
  const navigate = (next: Navigation) => {
    if (document.querySelector('form[data-workbench-dirty="true"]')) { setPendingNavigation(next); return; }
    navigateDirect(next);
  };
  const setActive = (section: Section) => navigate({ section });
  const openModal = (next: { type: string; item?: Item }) => {
    if (next.type === "aiTask") { setAiDraft(next.item || {}); navigate({ section: "aiUse", tab: "tasks", projectId: next.item?.projectId, goalId: next.item?.goalId }); }
    else setModal(next);
  };
  useEffect(() => {
    const read = () => {
      const params = new URLSearchParams(window.location.search);
      const next = Object.fromEntries(params) as Navigation;
      if (!["decisions", "aiUse"].includes(next.section) && !nav.some((item) => item.key === next.section)) next.section = "today";
      return next;
    };
    if (!navigationInitialized.current) { navigationInitialized.current = true; navigateDirect(read(), false); }
    const pop = () => {
      const next = read();
      if (document.querySelector('form[data-workbench-dirty="true"]')) {
        const previous = new URLSearchParams(Object.entries(target).filter((entry): entry is [string, string] => typeof entry[1] === "string"));
        window.history.pushState(null, "", `/?${previous}`); setPendingNavigation(next);
      } else navigateDirect(next, false);
    };
    window.addEventListener("popstate", pop);
    return () => window.removeEventListener("popstate", pop);
  }, [navigateDirect, target]);
  useEffect(() => {
    const saved = () => { if (pendingNavigation && !document.querySelector('form[data-workbench-dirty="true"]')) { navigateDirect(pendingNavigation); setPendingNavigation(null); } };
    window.addEventListener("workbench-saved", saved);
    return () => window.removeEventListener("workbench-saved", saved);
  }, [pendingNavigation, navigateDirect]);
  const load = useCallback(async (showLoading = true) => {
    if (showLoading) setLoading(true);
    try {
      const response = await fetch("/api/data", { cache: "no-store" });
      if (!response.ok) throw new Error();
      setData(await response.json());
    } catch {
      notify("读取数据失败，请确认数据库已初始化");
    } finally {
      if (showLoading) setLoading(false);
    }
  }, [notify]);
  useEffect(() => {
    void load();
  }, [load]);
  const syncOnline = async () => {
    const response = await fetch("/api/sync", { method: "POST" });
    if (!response.ok) {
      const result = await response.json().catch(() => ({}));
      if (result.error) notify(`本地已保存；线上同步未完成：${result.error}`);
    }
  };
  const save = async (type: string, payload: Item, id?: string) => {
    const requestPayload = { ...payload };
    const response = await fetch(type === "profileScene" ? "/api/strategy" : "/api/data", {
      method: type === "profileScene" ? "POST" : id ? "PATCH" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(
        type === "profileScene" ? { action: "profile-scenes-save", data: requestPayload } : id ? { type, id, data: requestPayload } : { type, data: requestPayload },
      ),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "保存失败");
    await syncOnline();
    await load(false);
    setModal(null);
    const savedForm = document.querySelector<HTMLFormElement>(modal ? 'form[role="dialog"]' : 'form[data-workbench-dirty="true"]');
    if (savedForm && type !== "profile" && type !== "profileScene") delete savedForm.dataset.workbenchDirty;
    window.dispatchEvent(new Event("workbench-saved"));
    notify("已保存");
  };
  const remove = async (type: string, id: string) => {
    if (!window.confirm("确定删除这条记录吗？此操作不可撤销。")) return;
    const response = await fetch("/api/data", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type, id }),
    });
    if (!response.ok) {
      notify("删除失败");
      return;
    }
    await syncOnline();
    await load();
    notify("已删除");
  };
  if (loading)
    return (
      <div className="min-h-screen grid place-items-center text-sm text-slate-500">
        正在打开你的工作台…
      </div>
    );
  return (
    <div className="min-h-screen md:flex">
      <aside
        className={`${mobileNav ? "block" : "hidden"} fixed inset-0 z-20 bg-white p-5 md:relative md:block md:w-64 md:shrink-0 md:border-r md:border-line`}
      >
        <div className="mb-9 flex items-center justify-between">
          <div>
            <div className="flex items-center gap-2 text-lg font-semibold tracking-tight">
              <HeartHandshake size={20} className="text-sage" />
              AI 工作台
            </div>
            <p className="mt-1 text-xs text-slate-400">
              把自己变成可协作的系统
            </p>
          </div>
          <button
            className="md:hidden"
            onClick={() => setMobileNav(false)}
            aria-label="关闭导航"
          >
            <X size={20} />
          </button>
        </div>
        <nav className="space-y-1">
          {nav.map(({ key, label, icon: Icon }) => (
            <button
              key={key}
              onClick={() => {
                navigate({ section: key });
                setMobileNav(false);
              }}
              className={`flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm transition ${(active === key || (key === "goals" && active === "decisions") || (key === "documents" && active === "aiUse")) ? "bg-[#e9f0ea] font-medium text-[#42604d]" : "text-slate-600 hover:bg-slate-50"}`}
            >
              <Icon size={17} />
              {label}
              {(active === key || (key === "goals" && active === "decisions") || (key === "documents" && active === "aiUse")) && <ChevronRight size={15} className="ml-auto" />}
            </button>
          ))}
        </nav>
        <div className="absolute bottom-5 left-5 right-5 hidden rounded-lg border border-line bg-mist p-3 text-xs text-slate-500 md:block">
          <div className="mb-1 flex items-center gap-2 font-medium text-slate-700">
            <Archive size={14} />
            本地优先
          </div>
          数据只保存在当前设备的 SQLite 中。
        </div>
      </aside>
      <main className="min-w-0 flex-1">
        <header className="flex h-16 items-center justify-between border-b border-line bg-white/80 px-5 backdrop-blur md:px-9">
          <button
            className="md:hidden"
            onClick={() => setMobileNav(true)}
            aria-label="打开导航"
          >
            <Menu size={21} />
          </button>
          <div className="hidden text-sm text-slate-400 md:block">
            {active === "decisions" ? "目标与执行" : active === "aiUse" ? "AI档案中心" : nav.find((item) => item.key === active)?.label}
          </div>
          <div className="flex items-center gap-3 text-xs text-slate-500">
            <BackupExportButton backup={backup} compact />
            <span className="hidden sm:inline">本地数据已保存</span>
            <span className="h-2 w-2 rounded-full bg-[#73a27f]" />
          </div>
        </header>
        <div className="mx-auto max-w-7xl px-5 py-7 md:px-9 md:py-10">
          {(active === "documents" || active === "aiUse") && <>
            <h1 className="mb-5 text-2xl font-semibold text-ink">AI档案中心</h1>
            <div role="tablist" aria-label="AI档案中心" className="mb-6 flex border-b border-line">
              {([{ section: "documents", label: "档案中心", icon: FileText }, { section: "aiUse", label: "AI 使用中心", icon: Sparkles }] as const).map(({ section, label, icon: Icon }) => <button key={section} id={`archive-tab-${section}`} type="button" role="tab" aria-selected={active === section} aria-controls="archive-panel" onClick={() => navigate({ section })} className={`inline-flex items-center gap-2 border-b-2 px-3 py-3 text-sm ${active === section ? "border-sage font-medium text-sage" : "border-transparent text-slate-500"}`}><Icon size={16} />{label}</button>)}
            </div>
          </>}
          {active === "today" && (
            <Today data={data} setActive={setActive} open={openModal} reload={load} navigate={navigate} initialScene={target.scene} openTask={(task) => {
              navigate({ section: task.source === "daily" ? "daily" : "aiUse", tab: "tasks", recordId: task.id });
            }} />
          )}{" "}
          {active === "situation" && (
            <SituationModule props={{ data, notify, reload: () => load(false), navigate, open: openModal, save, remove, target }} legacy={<SituationAssessment data={data} save={save} open={openModal} remove={remove} />} />
          )}{" "}
          {active === "self" && (
            <SelfModule props={{ data, notify, reload: () => load(false), navigate, open: openModal, save, remove, target }} legacy={(view, scene, renderLoop) => <Self renderLoop={renderLoop} data={data} open={openModal} remove={remove} save={save} notify={notify} load={load} view={view} scene={scene} />} />
          )}{" "}
          {(active === "goals" || active === "decisions") && (
            <ExecutionModule props={{ data, notify, reload: () => load(false), navigate, open: openModal, save, remove, target }} />
          )}{" "}
          {active === "actions" && (
            <Actions data={data} open={setModal} remove={remove} target={target} navigate={navigate} notify={notify} />
          )}{" "}
          {active === "daily" && <DailyCollaboration key={target.recordId || "daily"} notify={notify} reload={() => load(false)} initialTaskId={target.recordId} initialDate={target.date} onDateChange={(date) => navigate({ ...target, date, recordId: undefined })} />}{" "}
          {active === "documents" && <div id="archive-panel" role="tabpanel" aria-labelledby="archive-tab-documents"><Documents data={data} notify={notify} /></div>}{" "}
          {active === "aiUse" && <div id="archive-panel" role="tabpanel" aria-labelledby="archive-tab-aiUse"><AIUseCenter key={`${target.recordId || ""}:${target.tab || ""}:${target.projectId || ""}`} data={data} notify={notify} reload={() => load(false)} initialTaskId={target.recordId} initialDraft={aiDraft || (target.projectId ? { projectId: target.projectId, goalId: target.goalId || "" } : undefined)} initialTab={target.tab} /></div>}{" "}
          {active === "settings" && (
            <SettingsView data={data} save={save} notify={notify} load={load} backup={backup} />
          )}{" "}
        </div>
      </main>
      {modal && (
        <Editor
          type={modal.type}
          item={modal.item}
          data={data}
          onClose={() => setModal(null)}
          onSave={save}
        />
      )}
      {pendingNavigation && <div className="fixed inset-0 z-50 grid place-items-center bg-black/25 p-4"><div role="dialog" aria-modal="true" aria-label="未保存的修改" className="w-full max-w-md rounded-lg border border-line bg-white p-5"><h2 className="font-semibold">有未保存的修改</h2><div className="mt-5 flex flex-wrap gap-2"><Button onClick={() => { document.querySelector<HTMLFormElement>('form[data-workbench-dirty="true"]')?.requestSubmit(); }}>保存后离开</Button><Button secondary onClick={() => { const form = document.querySelector<HTMLFormElement>('form[data-workbench-dirty="true"]'); if (form) delete form.dataset.workbenchDirty; setModal(null); navigateDirect(pendingNavigation); setPendingNavigation(null); }}>放弃修改</Button><Button secondary onClick={() => setPendingNavigation(null)}>继续编辑</Button></div></div></div>}
      {toast && (
        <div className="fixed bottom-5 left-1/2 z-40 -translate-x-1/2 rounded-lg bg-ink px-4 py-3 text-sm text-white shadow-soft">
          {toast}
        </div>
      )}
    </div>
  );
}

function PageTitle({
  eyebrow,
  title,
  description,
  action,
}: {
  eyebrow: string;
  title: string;
  description: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <div className="mb-2 text-xs font-semibold uppercase tracking-[.16em] text-sage">
          {eyebrow}
        </div>
        <h1 className="text-2xl font-semibold tracking-tight text-ink md:text-3xl">
          {title}
        </h1>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-500">
          {description}
        </p>
      </div>
      {action}
    </div>
  );
}
function Button({
  children,
  onClick,
  secondary = false,
  icon,
  type = "button",
  disabled = false,
}: {
  children: React.ReactNode;
  onClick?: () => void;
  secondary?: boolean;
  icon?: React.ReactNode;
  type?: "button" | "submit";
  disabled?: boolean;
}) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={`inline-flex items-center justify-center gap-2 rounded-lg px-3.5 py-2 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-60 ${secondary ? "border border-line bg-white text-slate-700 hover:bg-mist" : "bg-[#496554] text-white hover:bg-[#3c5545]"}`}
    >
      {icon}
      {children}
    </button>
  );
}
function Panel({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section
      className={`border border-line bg-white p-5 shadow-soft md:p-6 ${className}`}
    >
      {children}
    </section>
  );
}
function Empty({ text }: { text: string }) {
  return (
    <div className="rounded-lg border border-dashed border-line bg-mist px-4 py-7 text-center text-sm text-slate-400">
      {text}
    </div>
  );
}
function RecordList({
  items,
  type,
  remove,
  onEdit,
  summary,
}: {
  items: Item[];
  type: string;
  remove: (type: string, id: string) => void;
  onEdit?: (item: Item) => void;
  summary: (item: Item) => React.ReactNode;
}) {
  return (
    <div className="space-y-2">
      {items.map((item) => (
        <div
          key={item.id}
          data-record-id={item.id}
          className="flex items-start justify-between gap-4 rounded-lg border border-line p-3"
        >
          <div className="min-w-0 text-sm">{summary(item)}</div>
          <div className="flex shrink-0 items-center gap-1">
            {onEdit && (
              <button
                type="button"
                className="p-1 text-slate-400 hover:text-sage"
                onClick={() => onEdit(item)}
                aria-label={`编辑${configs[type]?.label || "记录"}`}
                title={`编辑${configs[type]?.label || "记录"}`}
              >
                <Pencil size={15} />
              </button>
            )}
            <button
              type="button"
              className="p-1 text-slate-400 hover:text-red-600"
              onClick={() => remove(type, item.id)}
              aria-label="删除"
              title="删除"
            >
              <Trash2 size={15} />
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}

function LineageTags({
  goal,
  project,
}: {
  goal?: string;
  project?: string;
}) {
  return (
    <div className="mt-2 flex flex-wrap gap-1.5 text-[11px] leading-5">
      <span className="rounded bg-[#eef4ef] px-2 text-[#42604d]">
        目标：{goal || "未关联目标"}
      </span>
      <span className="rounded bg-mist px-2 text-slate-500">
        项目：{project || "未关联项目"}
      </span>
    </div>
  );
}

function Today({
  data,
  setActive,
  open,
  reload,
  openTask,
  navigate,
  initialScene,
}: {
  data: Data | null;
  setActive: (section: Section) => void;
  open: (modal: { type: string; item?: Item }) => void;
  reload: (showLoading?: boolean) => Promise<void>;
  openTask: (task: { source: "daily" | "ai"; id: string }) => void;
  navigate: (target: Navigation) => void;
  initialScene?: string;
}) {
  const suggestions = arr(data, "suggestions");
  return (
    <MyWorkbench data={data} setActive={setActive} open={open} reload={reload} openTask={openTask} navigate={navigate} initialScene={initialScene}
      suggestions={suggestions.filter((s) => s.status === "待确认").length ? (
          <div className="grid gap-3 md:grid-cols-2">
            {suggestions
              .filter((s) => s.status === "待确认")
              .slice(0, 4)
              .map((s) => (
                <SuggestionCard key={s.id} suggestion={s} />
              ))}
          </div>
        ) : (
          <Empty text="完成一轮访谈或复盘后，建议会在这里等待你的确认。" />
        )} />
  );
}
function SuggestionCard({ suggestion }: { suggestion: Item }) {
  const [working, setWorking] = useState(false);
  const update = async (status: "已确认" | "已拒绝") => {
    setWorking(true);
    await fetch("/api/ai", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: suggestion.id, status }),
    });
    setWorking(false);
    window.location.reload();
  };
  return (
    <div className="border border-[#d9e7da] bg-[#f5faf5] p-4">
      <div className="flex items-center gap-2 text-xs text-sage">
        <Sparkles size={14} />
        {suggestion.source}
      </div>
      <div className="mt-2 text-sm font-medium">{suggestion.title}</div>
      <p className="mt-1 text-sm leading-6 text-slate-600">
        {suggestion.content}
      </p>
      <div className="mt-3 flex gap-2">
        <Button
          onClick={() => void update("已确认")}
          icon={<Check size={14} />}
        >
          {working ? "处理中…" : "确认建议"}
        </Button>
        <Button
          secondary
          onClick={() => void update("已拒绝")}
          icon={<X size={14} />}
        >
          拒绝
        </Button>
      </div>
    </div>
  );
}
function PanelHeading({
  title,
  link,
  onClick,
}: {
  title: string;
  link?: string;
  onClick?: () => void;
}) {
  return (
    <div className="mb-5 flex items-center justify-between">
      <h2 className="font-semibold text-ink">{title}</h2>
      {link && (
        <button
          onClick={onClick}
          className="flex items-center gap-1 text-xs text-sage hover:underline"
        >
          {link}
          <ArrowRight size={13} />
        </button>
      )}
    </div>
  );
}

function ProfileGroup({ title, children }: { title: string; children: React.ReactNode }) {
  return <details open={title === "基础信息" || undefined} className="border-t border-line pt-4 first:border-t-0 first:pt-0"><summary className="cursor-pointer text-sm font-semibold text-ink">{title}</summary><fieldset className="mt-3 space-y-3"><legend className="sr-only">{title}</legend>{children}</fieldset></details>;
}

const emptySituationAssessment = {
  todayStatus: "", todaySignals: "", todayJudgement: "",
  keyEvents: "", keyEventAnalysis: "",
  trendRadar: "", trendStage: "", trendScenarios: "",
  enterpriseImpact: "", enterpriseActions: "",
  personalImpact: "", personalActions: "", sourceNotes: "",
};

type SituationTab = "today" | "events" | "trends" | "enterprise" | "personal";
type SituationFieldKey = keyof typeof emptySituationAssessment;
function currentWeekLabel(date = new Date()) {
  const target = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const day = target.getUTCDay() || 7;
  target.setUTCDate(target.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(target.getUTCFullYear(), 0, 1));
  const week = Math.ceil((((target.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
  return `${target.getUTCFullYear()}年第${String(week).padStart(2, "0")}周`;
}
const situationTabs: Array<{ key: SituationTab; label: string; question: string; primaryKey: SituationFieldKey; primaryLabel: string; template: string; icon: typeof Globe2 }> = [
  { key: "today", label: `01 本周态势（${currentWeekLabel()}）`, question: "本周整体环境怎样？", primaryKey: "todayStatus", primaryLabel: "本周简表", template: "变化：\n判断：\n下周关注：", icon: Globe2 },
  { key: "events", label: "02 重点事件", question: "本周最值得关注的一件事是什么？", primaryKey: "keyEvents", primaryLabel: "事件简表", template: "事件：\n影响：\n需要核验：", icon: Newspaper },
  { key: "trends", label: "03 趋势雷达", question: "哪一个趋势最可能改变后续判断？", primaryKey: "trendRadar", primaryLabel: "趋势简表", template: "趋势：\n可能影响：\n现在应对：", icon: TrendingUp },
  { key: "enterprise", label: "04 企业影响", question: "这对企业最直接的机会或风险是什么？", primaryKey: "enterpriseImpact", primaryLabel: "企业影响简表", template: "影响：\n机会 / 风险：\n建议动作：", icon: Building2 },
  { key: "personal", label: "05 个人影响", question: "这对我本周和下一步有什么影响？", primaryKey: "personalImpact", primaryLabel: "个人影响简表", template: "影响：\n优先行动：\n继续观察：", icon: UserRound },
];

function SituationField({ label, hint, value, onChange, rows = 4 }: { label: string; hint?: string; value: string; onChange: (value: string) => void; rows?: number }) {
  return <label className="block"><span className="text-sm font-medium text-ink">{label}</span>{hint ? <span className="mt-1 block text-xs leading-5 text-slate-500">{hint}</span> : null}<textarea value={value} rows={rows} onChange={(event) => onChange(event.target.value)} className="mt-2 w-full resize-y rounded-lg border border-line bg-white px-3 py-2 text-sm leading-6 outline-none focus:border-sage" /></label>;
}

function SituationQuickEntry({ label, template, value, onChange }: { label: string; template: string; value: string; onChange: (value: string) => void }) {
  return <div className="space-y-2"><div className="flex flex-wrap items-center justify-between gap-2"><div><div className="text-sm font-medium text-ink">{label}</div><p className="mt-1 text-xs leading-5 text-slate-500">每项写 1 句话即可，先记录关键判断，不必完成完整分析。</p></div><button type="button" onClick={() => { if (!value.trim()) onChange(template); }} disabled={Boolean(value.trim())} className="border border-line px-2.5 py-1.5 text-xs text-slate-600 transition hover:bg-mist disabled:cursor-not-allowed disabled:text-slate-300">填入三行模板</button></div><textarea value={value} rows={6} onChange={(event) => onChange(event.target.value)} placeholder={template} className="w-full resize-y rounded-lg border border-line bg-white px-3 py-2 text-sm leading-6 outline-none placeholder:text-slate-400 focus:border-sage" /></div>;
}

function SituationAssessment({ data, save, open, remove }: { data: Data | null; save: (type: string, payload: Item, id?: string) => Promise<void>; open: (modal: { type: string; item?: Item }) => void; remove: (type: string, id: string) => void }) {
  const assessment = data?.situationAssessment as Item | undefined;
  const items = arr(data, "situationItems");
  const [activeTab, setActiveTab] = useState<SituationTab>("today");
  const [form, setForm] = useState<Item>({ ...emptySituationAssessment });
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  useEffect(() => { setForm({ ...emptySituationAssessment, ...(assessment || {}) }); }, [assessment]);
  const update = (key: keyof typeof emptySituationAssessment, value: string) => setForm((current: Item) => ({ ...current, [key]: value }));
  const persist = async () => {
    setSaving(true); setMessage("");
    try {
      await save("situationAssessment", form, assessment?.id);
      setMessage("形势研判已保存到本地数据库。");
    } catch (error) { setMessage(error instanceof Error ? error.message : "保存失败，请检查输入后重试。"); }
    finally { setSaving(false); }
  };
  const active = situationTabs.find((tab) => tab.key === activeTab) || situationTabs[0];
  const activeItems = items.filter((item) => item.category === activeTab);
  const Icon = active.icon;
  return <>
    <PageTitle eyebrow="形势研判" title="把外部变化转成可判断的信号" description="记录已核实的环境、事件和影响，再决定要调整什么。此模块不会自动抓取或写入外部信息。" action={<Button onClick={() => void persist()} disabled={saving} icon={<Check size={16} />}>{saving ? "正在保存..." : "保存研判"}</Button>} />
    <form onSubmit={(event) => { event.preventDefault(); void persist(); }} className="grid gap-5 xl:grid-cols-[240px_minmax(0,1fr)]">
      <Panel className="h-fit p-3">
        <nav className="space-y-1" aria-label="形势研判子版块">
          {situationTabs.map((tab) => { const TabIcon = tab.icon; return <button key={tab.key} type="button" onClick={() => setActiveTab(tab.key)} className={`flex w-full items-center gap-2 rounded-lg px-3 py-2.5 text-left text-sm transition ${activeTab === tab.key ? "bg-[#e9f0ea] font-medium text-[#42604d]" : "text-slate-600 hover:bg-mist"}`}><TabIcon size={16} />{tab.label}<ChevronRight size={14} className={`ml-auto ${activeTab === tab.key ? "" : "text-slate-300"}`} /></button>; })}
        </nav>
      </Panel>
      <Panel>
        <div className="flex flex-wrap items-start justify-between gap-3 border-b border-line pb-5">
          <div className="flex min-w-0 gap-3"><span className="mt-0.5 rounded-lg bg-[#eef4ef] p-2 text-sage"><Icon size={18} /></span><div><div className="text-lg font-semibold text-ink">{active.label}</div><p className="mt-1 text-sm text-slate-600">核心问题：{active.question}</p></div></div>
          <span className="border border-line bg-mist px-2 py-1 text-xs text-slate-500">填写方式：三行简表</span>
        </div>
        <div className="mt-5 space-y-5">
          <SituationQuickEntry label={active.primaryLabel} template={active.template} value={String(form[active.primaryKey] || "")} onChange={(value) => update(active.primaryKey, value)} />
          <section className="border-t border-line pt-5">
            <div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-sm font-semibold text-ink">研判条目</h2><p className="mt-1 text-xs leading-5 text-slate-500">把不同信号拆成独立条目，支持随时新增、编辑和删除。</p></div><Button secondary onClick={() => open({ type: "situationItem", item: { category: activeTab } })} icon={<Plus size={15} />}>新增条目</Button></div>
            <div className="mt-4">{activeItems.length ? <RecordList items={activeItems} type="situationItem" remove={remove} onEdit={(item) => open({ type: "situationItem", item })} summary={(item) => <><div className="font-medium text-ink">{item.title}</div>{item.content ? <div className="mt-1 whitespace-pre-wrap leading-6 text-slate-500">{item.content}</div> : null}<div className="mt-2 text-xs text-slate-400">更新于 {new Date(String(item.updatedAt)).toLocaleString("zh-CN")}</div></>} /> : <Empty text="还没有研判条目。点击“新增条目”记录一条信号、判断或行动。" />}</div>
          </section>
          <details className="border-t border-line pt-4"><summary className="cursor-pointer text-sm text-slate-600">补充记录（可选）</summary><div className="mt-4 space-y-4">
            {activeTab === "today" ? <><SituationField label="关键指标与信号" value={form.todaySignals} onChange={(value) => update("todaySignals", value)} rows={3} /><SituationField label="补充判断" value={form.todayJudgement} onChange={(value) => update("todayJudgement", value)} rows={3} /></> : null}
            {activeTab === "events" ? <SituationField label="事件重要性与后续观察" value={form.keyEventAnalysis} onChange={(value) => update("keyEventAnalysis", value)} rows={3} /> : null}
            {activeTab === "trends" ? <><SituationField label="趋势阶段" value={form.trendStage} onChange={(value) => update("trendStage", value)} rows={2} /><SituationField label="情景补充" value={form.trendScenarios} onChange={(value) => update("trendScenarios", value)} rows={3} /></> : null}
            {activeTab === "enterprise" ? <SituationField label="补充行动" value={form.enterpriseActions} onChange={(value) => update("enterpriseActions", value)} rows={3} /> : null}
            {activeTab === "personal" ? <SituationField label="补充行动" value={form.personalActions} onChange={(value) => update("personalActions", value)} rows={3} /> : null}
            <SituationField label="来源与核验备注" hint="需要时再记录来源、日期或待核验点。" value={form.sourceNotes} onChange={(value) => update("sourceNotes", value)} rows={2} />
          </div></details>
        </div>
        <div className="mt-6 flex flex-wrap items-center gap-3 border-t border-line pt-4"><Button type="submit" disabled={saving} icon={<Check size={15} />}>{saving ? "正在保存..." : "保存研判"}</Button>{message ? <span role="status" className={`text-xs ${message.includes("失败") ? "text-rose-600" : "text-sage"}`}>{message}</span> : null}<span className="ml-auto text-xs text-slate-400">{assessment?.updatedAt ? `上次更新：${new Date(String(assessment.updatedAt)).toLocaleString("zh-CN")}` : "尚未保存"}</span></div>
      </Panel>
    </form>
  </>;
}

function Self({
  data,
  open: openEditor,
  remove,
  save,
  notify,
  load,
  renderLoop,
  view = "profile",
  scene = "all",
}: {
  data: Data | null;
  open: (modal: { type: string; item?: Item }) => void;
  remove: (type: string, id: string) => void;
  save: (type: string, payload: Item, id?: string) => Promise<void>;
  notify: (message: string) => void;
  load: (showLoading?: boolean) => Promise<void>;
  renderLoop?: (type: string, record: Item) => React.ReactNode;
  view?: string;
  scene?: string;
}) {
  const profile = data || {};
  const open = (modal: { type: string; item?: Item }) => openEditor({ ...modal, item: modal.item || { _sceneIds: scene === "all" ? [] : [scene] } });
  const filtered = (key: string, type: string): Item[] => arr(data, key).map((record) => {
    const tag = (data?.strategy as StrategyView | undefined)?.records.find((tag) => tag.kind === "tag" && tag.payload.subjectType === type && tag.payload.subjectId === record.id);
    const ids = tag?.payload.sceneIds as string[] || [];
    const names = ((data?.strategy as StrategyView | undefined)?.scenes || []).filter((entry) => ids.includes(entry.id)).map((entry) => entry.name);
    return { ...record, _sceneIds: ids, _sceneNames: names.length ? names.join("、") : "全局" };
  }).filter((record) => scene === "all" || !record._sceneIds.length || record._sceneIds.includes(scene));
  const [savingProfile, setSavingProfile] = useState(false);
  const [profileFeedback, setProfileFeedback] = useState("");
  const updateProfile = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const values = Object.fromEntries(form) as Item;
    const element = event.currentTarget;
    setSavingProfile(true);
    setProfileFeedback("");
    try {
      await save("profile", values, profile.id);
      delete element.dataset.workbenchDirty;
      window.dispatchEvent(new Event("workbench-saved"));
      setProfileFeedback("基础信息已保存，刷新后仍会保留。");
    } catch (error) {
      setProfileFeedback(error instanceof Error ? error.message : "保存失败，请检查输入后重试。");
    } finally {
      setSavingProfile(false);
    }
  };
  return (
    <>
      {view === "profile" && <details className="mb-4"><summary className="cursor-pointer text-xs text-slate-500">AI 访谈与档案导入导出</summary><div className="mt-3 space-y-3"><AIButton kind="questions" /><SelfDataTransfer notify={notify} load={load} /></div></details>}
      <div className="grid gap-5">
        {view === "profile" && <Panel>
          <PanelHeading title="基础档案" />
          <form onSubmit={updateProfile} onChange={(event) => { event.currentTarget.dataset.workbenchDirty = "true"; }} className="space-y-4">
            <ProfileGroup title="基础信息">
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="怎么称呼你"><input name="name" defaultValue={profile.name} placeholder="例如：林然" /></Field>
                <Field label="年龄段"><select name="ageRange" defaultValue={profile.ageRange}><option value="">请选择</option><option>18 岁以下</option><option>18-24 岁</option><option>25-29 岁</option><option>30-34 岁</option><option>35-39 岁</option><option>40-49 岁</option><option>50 岁及以上</option><option>不便说明</option></select></Field>
                <Field label="出生年份（可选）"><input name="birthYear" inputMode="numeric" maxLength={4} defaultValue={profile.birthYear} placeholder="例如：1990" /></Field>
                <Field label="性别称谓"><input name="genderIdentity" defaultValue={profile.genderIdentity} placeholder="例如：她 / 他 / 不便说明" /></Field>
                <Field label="常驻城市"><input name="city" defaultValue={profile.city} placeholder="例如：上海" /></Field>
                <Field label="最高学历"><input name="education" defaultValue={profile.education} placeholder="例如：硕士" /></Field>
              </div>
              <Field label="专业背景"><textarea name="major" defaultValue={profile.major} placeholder="专业、研究或长期积累的领域" rows={2} /></Field>
              <Field label="性格特征（可选）"><textarea name="personalityTraits" defaultValue={profile.personalityTraits} maxLength={5000} placeholder="例如：偏内向、做事细致、喜欢独立思考；可结合具体情境描述自己的特点。" rows={3} /></Field>
            </ProfileGroup>

            {profileFeedback && <p className={`text-xs ${profileFeedback.includes("已保存") ? "text-sage" : "text-rose-600"}`} role="status">{profileFeedback}</p>}
            <Button type="submit" disabled={savingProfile}>{savingProfile ? "正在保存..." : "保存基础信息"}</Button>
          </form>
          <ProfileSceneSections profile={profile} view={data?.strategy} scene={scene} save={save} reload={() => load(false)} />
        </Panel>}
        <div className="space-y-5">
          {view === "experiences" && <ListPanel
            title="项目及经历"
            type="experience"
            items={filtered("experiences", "experience")}
            open={open}
            remove={remove}
            summary={(x) => (
              <>
                <div className="font-medium">{x.title}</div>
                <div className="mt-1 text-slate-500">
                  {x.description || "尚未填写描述"}
                </div>
              {renderLoop?.("experience", x)}</>
            )}
          />}
          {view === "skills" && <ListPanel
            title="能力与证据"
            type="evidence"
            items={filtered("evidences", "evidence").filter((evidence) => !(data?.strategy?.records || []).some((record: { id: string; kind: string; archived: boolean; payload: Record<string, unknown> }) => record.kind === "skill" && !record.archived && (record.payload.evidenceId === evidence.id || data?.strategy?.sources?.some((link: { sourceType: string; sourceId: string; targetId: string }) => link.sourceType === "skill" && link.sourceId === record.id && link.targetId === evidence.id))))}
            open={open}
            remove={remove}
            summary={(x) => (
              <>
                <div className="font-medium">{x.ability}</div>
                <div className="mt-1 text-slate-500">{x.evidence}</div>
              {renderLoop?.("evidence", x)}</>
            )}
          />}
          {view === "values" && <ListPanel
            title="核心价值与取舍规则"
            type="valueRule"
            items={filtered("valueRules", "valueRule")}
            open={open}
            remove={remove}
            summary={(x) => (
              <>
                <div className="font-medium">{x.value}</div>
                <div className="mt-1 text-slate-500">
                  优先级 {x.priority} · {x.rule || "尚未定义规则"}
                </div>
              </>
            )}
          />}
          {view === "resources" && <div className="grid gap-5 md:grid-cols-2">
            <ListPanel
              title="我的资源"
              type="resource"
              items={filtered("resources", "resource")}
              open={open}
              remove={remove}
              summary={(x) => (
                <>
                  <div className="font-medium">{x.name}</div>
                  <div className="mt-1 text-slate-500">{x.description}</div>
                {renderLoop?.("resource", x)}</>
              )}
            />
            <ListPanel
              title="约束"
              type="constraint"
              items={filtered("constraints", "constraint")}
              open={open}
              remove={remove}
              summary={(x) => (
                <>
                  <div className="font-medium">{x.name}</div>
                  <div className="mt-1 text-slate-500">{x.description}</div>
                {renderLoop?.("constraint", x)}</>
              )}
            />
          </div>}
          {view === "resources" && <details><summary className="cursor-pointer text-xs text-slate-500">待验证假设</summary><div className="mt-3"><ListPanel
            title="待验证假设"
            type="assumption"
            items={filtered("assumptions", "assumption")}
            open={open}
            remove={remove}
            summary={(x) => (
              <>
                <div className="font-medium">{x.statement}</div>
                <div className="mt-1 text-slate-500">
                  {x.status} · {x.evidence || "还没有验证证据"}
                </div>
              {renderLoop?.("assumption", x)}</>
            )}
          /></div></details>}
        </div>
      </div>
    </>
  );
}

function SelfDataTransfer({ notify, load }: { notify: (message: string) => void; load: () => Promise<void> }) {
  const [working, setWorking] = useState(false);
  const importData = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    try {
      const parsed = JSON.parse(await file.text());
      if (!window.confirm("导入会替换当前认识自己模块的内容，但不会影响目标、行动、决策和 AI 使用中心。确定继续吗？")) return;
      setWorking(true);
      const response = await fetch("/api/profile-backup", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(parsed) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "导入失败");
      await load();
      notify("认识自己数据已导入");
    } catch (error) {
      notify(error instanceof Error ? error.message : "导入失败，请确认文件格式");
    } finally {
      setWorking(false);
    }
  };
  return (
    <Panel className="mb-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="font-semibold text-ink">认识自己数据</h2>
          <p className="mt-1 text-xs leading-5 text-slate-500">单独备份基础档案、经历、能力、价值、资源、约束和待验证假设。</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <a href="/api/profile-backup" className="inline-flex items-center gap-2 rounded-lg border border-line px-3.5 py-2 text-sm font-medium text-slate-700 hover:bg-mist" aria-label="导出认识自己数据">
            <Download size={15} /> 导出 JSON
          </a>
          <label className={`inline-flex cursor-pointer items-center gap-2 rounded-lg border border-line px-3.5 py-2 text-sm font-medium text-slate-700 hover:bg-mist ${working ? "cursor-wait opacity-60" : ""}`}>
            <Upload size={15} /> {working ? "正在导入..." : "导入 JSON"}
            <input type="file" accept="application/json,.json" onChange={importData} disabled={working} className="hidden" />
          </label>
        </div>
      </div>
    </Panel>
  );
}
function ListPanel({
  title,
  type,
  items,
  open,
  remove,
  summary,
}: {
  title: string;
  type: string;
  items: Item[];
  open: (m: { type: string; item?: Item }) => void;
  remove: (type: string, id: string) => void;
  summary: (x: Item) => React.ReactNode;
}) {
  return (
    <Panel>
      <PanelHeading title={title} />
      <div className="mb-4">
        {items.length ? (
          <RecordList
            items={items}
            type={type}
            remove={remove}
            onEdit={(item) => open({ type, item })}
            summary={(item) => <>{item._sceneNames !== undefined && <button type="button" className="mb-2 rounded border border-line px-2 py-1 text-xs text-sage hover:bg-mist" onClick={() => open({ type, item })} aria-label={`选择场景：${item._sceneNames}`}>场景：{item._sceneNames} · 修改</button>}{summary(item)}</>}
          />
        ) : (
          <Empty text="暂无记录" />
        )}
      </div>
      <Button
        secondary
        onClick={() => open({ type })}
        icon={<Plus size={15} />}
      >
        新增{configs[type]?.label || "记录"}
      </Button>
    </Panel>
  );
}

export function LegacyGoals({
  data,
  open,
  remove,
  reload,
}: {
  data: Data | null;
  open: (m: { type: string; item?: Item }) => void;
  remove: (type: string, id: string) => void;
  reload: () => Promise<void>;
}) {
  const goals = arr(data, "goals");
  const projects = arr(data, "projects");
  const actions = arr(data, "actions");
  const [selectedGoalId, setSelectedGoalId] = useState("");
  const [selectedProjectId, setSelectedProjectId] = useState("");
  const [horizonFilter, setHorizonFilter] = useState("全部");
  const [decomposition, setDecomposition] = useState<Item | null>(null);
  const [decomposing, setDecomposing] = useState(false);
  const [decompositionError, setDecompositionError] = useState("");
  const visibleGoals = goals.filter((goal) => matchesHorizon(goal.horizon, horizonFilter));
  useEffect(() => {
    if (!selectedGoalId && visibleGoals[0]?.id) setSelectedGoalId(visibleGoals[0].id);
    if (selectedGoalId && !visibleGoals.some((goal) => goal.id === selectedGoalId)) {
      setSelectedGoalId(visibleGoals[0]?.id || "");
      setSelectedProjectId("");
    }
  }, [visibleGoals, selectedGoalId]);
  const selectedGoal = visibleGoals.find((goal) => goal.id === selectedGoalId);
  const goalProjects = projects.filter((project) => project.goalId === selectedGoalId);
  const selectedProject = goalProjects.find((project) => project.id === selectedProjectId);
  const projectActions = actions.filter((action) => action.projectId === selectedProjectId);
  const chooseGoal = (id: string) => { setSelectedGoalId(id); setSelectedProjectId(""); };
  const nextGoalHorizon = (horizon: string) => ({ "长期": "5年", "10年": "5年", "5年": "3年", "3年": "1年", "年度": "1年", "1年": "90天", "90天": "本周", "本月": "本周" } as Record<string, string>)[horizon] || "";
  const decomposeGoal = async () => {
    if (!selectedGoal) return;
    setDecomposing(true); setDecompositionError("");
    try {
      const response = await fetch("/api/ai-use", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "goal-decompose", goalId: selectedGoal.id, targetHorizon: nextGoalHorizon(selectedGoal.horizon) }) });
      const result = await response.json() as Item;
      if (!response.ok) throw new Error(result.error || "目标分解失败");
      setDecomposition(result);
    } catch (error) { setDecompositionError(error instanceof Error ? error.message : "目标分解失败"); }
    finally { setDecomposing(false); }
  };
  const confirmDecomposition = async () => {
    if (!decomposition?.goals?.length || !selectedGoal) return;
    if (!window.confirm(`确认将 ${decomposition.goals.length} 个${decomposition.targetHorizon}子目标写入数据库吗？`)) return;
    setDecomposing(true); setDecompositionError("");
    try {
      for (const goal of decomposition.goals as Item[]) {
        const response = await fetch("/api/data", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ type: "goal", data: { title: goal.title, description: goal.description, horizon: goal.horizon, metric: goal.metric, status: "进行中", parentId: selectedGoal.id } }) });
        if (!response.ok) { const result = await response.json() as Item; throw new Error(result.error || "子目标保存失败"); }
      }
      setDecomposition(null); await reload();
    } catch (error) { setDecompositionError(error instanceof Error ? error.message : "子目标保存失败"); }
    finally { setDecomposing(false); }
  };
  return (
    <>
      <PageTitle
        eyebrow="目标与项目"
        title="让方向拥有下一步"
        description="目标不是愿望清单，而是带有指标、边界和停止条件的假设。"
        action={
          <Button
            onClick={() => open({ type: "goal" })}
            icon={<Plus size={16} />}
          >
            新建目标
          </Button>
        }
      />
      <Panel className="mb-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <div className="text-xs font-semibold uppercase tracking-[.12em] text-sage">第一层 · 目标</div>
            <h2 className="mt-1 font-semibold text-ink">先选定要实现的结果</h2>
            <p className="mt-1 text-sm leading-6 text-slate-500">目标定义方向和验收结果，项目与任务都会围绕当前选择展开。</p>
          </div>
          <div className="flex gap-2">
            <select value={horizonFilter} onChange={(event) => setHorizonFilter(event.target.value)} aria-label="按目标周期筛选" className="w-28 shrink-0">
              <option value="全部">全部周期</option>
              <option value="10年">10 年</option>
              <option value="5年">5 年</option>
              <option value="3年">3 年</option>
              <option value="1年">1 年</option>
              <option value="90天">90 天</option>
              <option value="本月">本月</option>
              <option value="本周">本周</option>
            </select>
            <select value={selectedGoalId} onChange={(event) => chooseGoal(event.target.value)} aria-label="选择目标" className="min-w-0 flex-1 lg:w-80">
              <option value="">请选择目标</option>
              {visibleGoals.map((goal) => <option key={goal.id} value={goal.id}>{goal.title} · {goal.horizon}</option>)}
            </select>
            <Button secondary onClick={() => open({ type: "goal", item: horizonFilter === "全部" ? undefined : { horizon: horizonFilter } })} icon={<Plus size={15} />}>新建目标</Button>
            <Button secondary disabled={!selectedGoal || !nextGoalHorizon(selectedGoal.horizon)} onClick={() => void decomposeGoal()} icon={<Sparkles size={15} />}>AI 自动分解</Button>
          </div>
        </div>
        {visibleGoals.length ? (
          <div className="mt-4 flex flex-wrap items-center gap-2 text-xs text-slate-500">
            <span className="rounded bg-mist px-2 py-1">已筛选 {visibleGoals.length} 个目标</span>
            {selectedGoal && <span>当前：{selectedGoal.title} · {selectedGoal.horizon}</span>}
          </div>
        ) : <div className="mt-5"><Empty text={goals.length ? `暂无 ${horizonFilter} 目标。` : "先创建一个可衡量的目标。"} /></div>}
        {decomposition ? (
          <div className="mt-5 border border-[#d9e7da] bg-[#f5faf5] p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="text-sm font-semibold">AI 分解预览：{decomposition.targetHorizon}目标</div>
                <p className="mt-1 text-xs leading-5 text-slate-500">来源：{decomposition.source}。以下内容尚未写入数据库，确认后才会创建子目标。</p>
              </div>
              <button className="p-1 text-slate-400 hover:text-slate-700" onClick={() => setDecomposition(null)} aria-label="关闭分解预览" title="关闭分解预览"><X size={16} /></button>
            </div>
            <div className="mt-3 space-y-2">
              {(decomposition.goals || []).map((goal: Item, index: number) => <div key={`${goal.title}-${index}`} className="border border-line bg-white p-3"><div className="text-sm font-medium">{goal.title}</div><div className="mt-1 text-xs leading-5 text-slate-500">{goal.description || "未填写描述"}</div><div className="mt-1 text-xs text-slate-400">周期：{goal.horizon} · 指标：{goal.metric || "未定义"}</div></div>)}
            </div>
            {decompositionError ? <p className="mt-3 text-xs text-rose-600">{decompositionError}</p> : null}
            <div className="mt-3 flex flex-wrap gap-2"><Button onClick={() => void confirmDecomposition()} disabled={decomposing} icon={<Check size={15} />}>{decomposing ? "正在保存..." : "确认创建子目标"}</Button><Button secondary onClick={() => void decomposeGoal()} disabled={decomposing} icon={<Sparkles size={15} />}>重新生成</Button></div>
          </div>
        ) : null}
      </Panel>
      <div className="grid gap-5 xl:grid-cols-[1.05fr_1fr]">
        <Panel>
          <div className="mb-5">
            <div className="text-xs font-semibold uppercase tracking-[.12em] text-sage">第二层 · 项目</div>
            <h2 className="mt-1 font-semibold text-ink">{selectedGoal ? `“${selectedGoal.title}”下的项目` : "先选择目标"}</h2>
            <p className="mt-1 text-sm leading-6 text-slate-500">项目是为目标交付结果的有边界工作包。</p>
          </div>
          {selectedGoal ? (goalProjects.length ? (
            <RecordList items={goalProjects} type="project" remove={remove} onEdit={(item) => { setSelectedProjectId(item.id); open({ type: "project", item }); }} summary={(item) => (
              <>
                <button onClick={() => setSelectedProjectId(item.id)} className={`w-full text-left ${item.id === selectedProjectId ? "text-sage" : ""}`}><div className="font-medium">{item.name}</div></button>
                <div className="mt-1 text-slate-500">{item.description || "未填写描述"}</div>
                <LineageTags goal={selectedGoal?.title} project={item.name} />
                <div className="mt-2 text-xs text-slate-400">{item.status} · 指标：{item.metric || "未定义"}</div>
              </>
            )} />
          ) : <Empty text="这个目标下还没有项目。" />) : <Empty text="选择目标后查看对应项目。" />}
          <div className="mt-4"><Button secondary onClick={() => selectedGoal ? open({ type: "project", item: { goalId: selectedGoalId } }) : open({ type: "goal" })} icon={<Plus size={15} />}>{selectedGoal ? "为此目标新增项目" : "先新建目标"}</Button></div>
        </Panel>
        <Panel>
          <div className="mb-5">
            <div className="text-xs font-semibold uppercase tracking-[.12em] text-sage">第三层 · 任务</div>
            <h2 className="mt-1 font-semibold text-ink">{selectedProject ? `“${selectedProject.name}”下的任务` : "先选择项目"}</h2>
            <p className="mt-1 text-sm leading-6 text-slate-500">任务就是唯一的可执行、可验收记录，完成后会为目标产生证据；每日协同复用同一条任务。</p>
            {selectedGoal && goalProjects.length ? (
              <select
                value={selectedProjectId}
                onChange={(event) => setSelectedProjectId(event.target.value)}
                aria-label="选择任务所属项目"
                className="mt-3 w-full min-w-0 rounded-lg border border-line bg-white px-3 py-2 text-sm outline-none focus:border-sage"
              >
                <option value="">请选择项目</option>
                {goalProjects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
              </select>
            ) : null}
          </div>
          {selectedProject ? (projectActions.length ? (
            <RecordList items={projectActions} type="action" remove={remove} onEdit={(item) => open({ type: "action", item })} summary={(item) => (
              <>
                <div className="font-medium">{item.title}</div>
                <div className="mt-1 text-slate-500">{item.purpose || "未填写目的"}</div>
                <LineageTags goal={selectedGoal?.title} project={selectedProject?.name} />
                <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-slate-400"><span>{item.status} · 截止 {dateText(item.dueDate)}</span><TaskSchedule recurrence={item.recurrence} estimatedHours={item.estimatedHours} /></div>
              </>
            )} />
          ) : <Empty text="这个项目下还没有任务。" />) : <Empty text="选择项目后查看对应任务。" />}
          <div className="mt-4"><Button secondary disabled={Boolean(selectedGoal && goalProjects.length && !selectedProject)} onClick={() => selectedProject ? open({ type: "action", item: { goalId: selectedGoalId, projectId: selectedProjectId } }) : selectedGoal ? open({ type: "project", item: { goalId: selectedGoalId } }) : open({ type: "goal" })} icon={<Plus size={15} />}>{selectedProject ? "为此项目新增任务" : selectedGoal && goalProjects.length ? "请先选择项目" : selectedGoal ? "先新增项目" : "先新建目标"}</Button></div>
        </Panel>
      </div>
      <div className="hidden">
      <div className="grid gap-5 xl:grid-cols-[1.1fr_1fr]">
        <Panel>
          <PanelHeading title="长期方向与目标" />
          {arr(data, "goals").length ? (
            <RecordList
              items={arr(data, "goals")}
              type="goal"
              remove={remove}
              onEdit={(item) => open({ type: "goal", item })}
              summary={(x) => (
                <>
                  <div className="flex items-center gap-2 font-medium">
                    {x.title}
                    <span className="rounded bg-mist px-2 py-0.5 text-xs text-sage">
                      {x.horizon}
                    </span>
                  </div>
                  <div className="mt-1 text-slate-500">
                    {x.description || "未填写描述"}
                  </div>
                  <div className="mt-2 text-xs text-slate-400">
                    指标：{x.metric || "未定义"} · {x.status} · 截止{" "}
                    {dateText(x.deadline)}
                  </div>
                </>
              )}
            />
          ) : (
            <Empty text="从一个重要但可衡量的方向开始。" />
          )}
        </Panel>
        <Panel>
          <PanelHeading title="项目与里程碑" />
          {projects.length ? (
            <RecordList
              items={projects}
              type="project"
              remove={remove}
              onEdit={(item) => open({ type: "project", item })}
              summary={(x) => (
                <>
                  <div className="font-medium">{x.name}</div>
                  <div className="mt-1 text-slate-500">
                    {x.description || "未填写描述"}
                  </div>
                  <div className="mt-2 text-xs text-slate-400">
                    {x.status} · 指标：{x.metric || "未定义"}
                  </div>
                  <div className="mt-3 grid gap-1 text-xs leading-5 text-slate-500 sm:grid-cols-2">
                    <span>投入：{x.budget || "未填写"}</span>
                    <span>边界：{x.boundary || "未填写"}</span>
                    <span>停止条件：{x.stopCondition || "未填写"}</span>
                    <span>风险：{x.risk || "未填写"}</span>
                  </div>
                </>
              )}
            />
          ) : (
            <Empty text="把目标拆成一个有边界的项目。" />
          )}
          <div className="mt-4">
            <Button
              secondary
              onClick={() => open({ type: "project" })}
              icon={<Plus size={15} />}
            >
              新增项目
            </Button>
          </div>
        </Panel>
      </div>
      </div>
      <Panel className="mt-5">
        <PanelHeading title="投入与边界检查" />
        {projects.length ? (
          <div className="divide-y divide-line border-y border-line">
            {projects.map((project) => (
              <div key={project.id} className="py-4 first:pt-0 last:pb-0">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <div className="font-medium">{project.name}</div>
                    <LineageTags goal={goals.find((goal) => goal.id === project.goalId)?.title} project={project.name} />
                  </div>
                  <button
                    onClick={() => open({ type: "project", item: project })}
                    className="shrink-0 p-1 text-slate-400 hover:text-sage"
                    aria-label="编辑项目投入与边界"
                    title="编辑项目投入与边界"
                  >
                    <Pencil size={15} />
                  </button>
                </div>
                <dl className="mt-3 grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
                  <div><dt className="text-xs text-slate-400">投入</dt><dd className="mt-1 break-words text-slate-600">{project.budget || "未填写"}</dd></div>
                  <div><dt className="text-xs text-slate-400">项目边界</dt><dd className="mt-1 break-words text-slate-600">{project.boundary || "未填写"}</dd></div>
                  <div><dt className="text-xs text-slate-400">停止条件</dt><dd className="mt-1 break-words text-slate-600">{project.stopCondition || "未填写"}</dd></div>
                  <div><dt className="text-xs text-slate-400">主要风险</dt><dd className="mt-1 break-words text-slate-600">{project.risk || "未填写"}</dd></div>
                </dl>
              </div>
            ))}
          </div>
        ) : (
          <Empty text="新增项目后，可在这里维护投入、边界、风险和停止条件。" />
        )}
      </Panel>
    </>
  );
}
function Actions({
  data,
  open,
  remove,
  target,
  navigate,
  notify,
}: {
  data: Data | null;
  open: (m: { type: string; item?: Item }) => void;
  remove: (type: string, id: string) => void;
  target: Navigation;
  navigate: (target: Navigation) => void;
  notify: (message: string) => void;
}) {
  const scenes = data?.strategy?.scenes || [];
  const scopedActions = arr(data, "actions").filter((row) => matchesSceneId(row.effectiveSceneId, target.scene || "all", scenes) && (!target.projectId || row.projectId === target.projectId) && (!target.goalId || (row.goalId || arr(data, "projects").find(project => project.id === row.projectId)?.goalId) === target.goalId) && (!target.recordId || row.id === target.recordId));
  const goals = arr(data, "goals");
  const projects = arr(data, "projects");
  const monthly = target.tab === "monthly";
  const yearly = target.tab === "yearly";
  const period: ReviewPeriod = yearly ? "yearly" : monthly ? "monthly" : "weekly";
  const periodLabel = yearly ? "年" : monthly ? "月" : "周";
  const summaryTitle = yearly ? "去年总结" : `上${periodLabel}总结`;
  const planDate = target.date ? new Date(`${target.date}T12:00:00+08:00`) : new Date();
  const { current: currentRange, previous: previousRange } = planReviewRanges(period, Number.isNaN(planDate.getTime()) ? new Date() : planDate);
  const periodGoals = goals.filter((goal) => deliveryInRange(goal.deadline, currentRange) && matchesSceneId(goal.effectiveSceneId || goal.sceneId, target.scene || "all", scenes) && (!target.goalId || goal.id === target.goalId));
  const sources = data?.strategy?.sources || [];
  const scopedReviews = arr(data, "reviews").filter(review => {
    if (reviewPeriod(review) !== period) return false;
    const links = reviewSources(sources, review.id);
    const linked: Item[] = links.flatMap(source => arr(data, source.sourceType === "project" ? "projects" : source.sourceType === "dailyTask" ? "dailyReviewTasks" : "actions").filter(row => row.id === source.sourceId).map(row => ({ ...row, linkedProjectId: source.sourceType === "project" ? row.id : row.projectId })));
    if (target.projectId && !linked.some(row => row.linkedProjectId === target.projectId)) return false;
    if (target.goalId && !linked.some(row => (row.goalId || projects.find(project => project.id === row.linkedProjectId)?.goalId) === target.goalId)) return false;
    return !target.scene || target.scene === "all" || linked.some(row => matchesSceneId(row.effectiveSceneId || row.sceneId, target.scene!, scenes));
  });
  const eligibleProjects = projects.filter(project => matchesSceneId(project.effectiveSceneId || project.sceneId, target.scene || "all", scenes) && (!target.projectId || project.id === target.projectId) && (!target.goalId || project.goalId === target.goalId));
  const current = periodDeliveries(eligibleProjects as (Item & { id: string })[], scopedActions as (Item & { id: string })[], currentRange);
  const previous = periodDeliveries(eligibleProjects as (Item & { id: string })[], scopedActions as (Item & { id: string })[], previousRange);
  const dailyReviewTasks = arr(data, "dailyReviewTasks").filter(row => matchesSceneId(row.effectiveSceneId, target.scene || "all", scenes) && (!target.projectId || row.projectId === target.projectId) && (!target.goalId || row.goalId === target.goalId) && (!target.recordId || row.actionId === target.recordId));
  const completedWork = reviewCompletedWork(scopedActions as (Item & { id: string })[], dailyReviewTasks as CompletedDailyWork[], previousRange, otherSceneId(scenes));
  const completedActionIds = new Set(completedWork.filter(work => work.sourceType === "action").map(work => work.sourceId));
  const reviewTasks = [...previous.tasks, ...scopedActions.filter(action => completedActionIds.has(action.id) && !previous.tasks.some(task => task.id === action.id))];
  const actions = current.tasks;
  const reviews = scopedReviews.filter(review => deliveryInRange(review.periodStart, previousRange) && deliveryInRange(review.periodEnd, previousRange));
  const history = scopedReviews.filter(review => !reviews.includes(review));
  const reviewableProjects = eligibleProjects.filter(project => previous.projects.some(row => row.project.id === project.id) || reviewTasks.some(task => task.projectId === project.id));
  const reviewableActions = reviewTasks;
  const completedDailyIds = completedWork.filter(work => work.sourceType === "dailyTask").map(work => work.sourceId);
  const canReview = reviewableProjects.length + reviewableActions.length + completedDailyIds.length > 0;
  const reviewSourceCollection = (type: string) => type === "project" ? "projects" : type === "dailyTask" ? "dailyReviewTasks" : "actions";
  const reviewSummary = (x: Item) => <>
    <div className="font-medium">{dateText(x.periodStart)} - {dateText(x.periodEnd)}</div>
    <div className="mt-1 whitespace-pre-wrap break-words text-slate-500">{x.wins || "尚未填写收获"}</div>
    {["goalIssue", "strategyIssue", "executionIssue", "externalIssue"].some(field => x[field]) && <details className="mt-2"><summary className="cursor-pointer text-xs text-slate-500">问题与原因</summary><dl className="mt-2 space-y-2">{["goalIssue", "strategyIssue", "executionIssue", "externalIssue"].filter(field => x[field]).map(field => <div key={field}><dt className="text-xs text-slate-400">{fieldLabels[field]}</dt><dd className="whitespace-pre-wrap break-words">{x[field]}</dd></div>)}</dl></details>}
    <div className="mt-2 text-xs text-sage">调整：{x.adjustment || "尚未填写"}</div>
    <div className="mt-2 flex flex-wrap gap-2 text-xs">{reviewSources(sources, x.id).map(source => {
      const record = arr(data, reviewSourceCollection(source.sourceType)).find(row => row.id === source.sourceId);
      return <button key={`${source.sourceType}:${source.sourceId}`} type="button" disabled={!record} className="break-words text-left text-sage disabled:text-slate-400" onClick={() => source.sourceType === "project" ? navigate({ section: "goals", tab: "projects", projectId: source.sourceId }) : source.sourceType === "dailyTask" ? navigate({ section: "daily", recordId: source.sourceId, date: record?.plan?.date }) : open({ type: "action", item: record })}>{record?.name || record?.title || source.sourceTitle}{!record ? "（来源已删除）" : ""}</button>;
    })}{!reviewSources(sources, x.id).length && <span className="text-slate-400">历史复盘 · 尚未关联项目任务</span>}</div>
    <RadarReferences targetType="review" targetId={String(x.id)} navigate={navigate} notify={notify} />
  </>;
  return (
    <>
      <PageTitle
        eyebrow="任务与复盘"
        title="计划与复盘"
        description="按交付时间查看当周、当月、当年计划，总结上周、上月、去年的结果与调整。"
      />
      {data?.strategy && <SceneFilter view={data.strategy} value={target.scene || "all"} onChange={(scene) => navigate({ ...target, scene })} />}
      <div className="mb-4 flex flex-wrap gap-2" role="group" aria-label="计划与复盘周期">
        {[["weekly", "周计划与复盘"], ["monthly", "月计划与复盘"], ["yearly", "年计划与复盘"]].map(([value, label]) => <button key={value} type="button" aria-pressed={period === value} onClick={() => navigate({ ...target, tab: value, date: undefined })} className={`rounded px-3 py-2 text-sm ${period === value ? "bg-sage text-white" : "bg-slate-100 text-slate-600"}`}>{label}</button>)}
      </div>
      <div className="mb-4 flex flex-wrap items-center gap-3 text-sm"><label className="flex items-center gap-2">计划日期<input aria-label="计划日期" className="!w-auto" type="date" value={target.date || shanghaiDate(new Date())} onChange={event => { if (event.target.value) navigate({ ...target, date: event.target.value }); }} /></label>{target.date && <button type="button" className="text-xs text-sage" onClick={() => navigate({ ...target, date: undefined })}>回到当前</button>}</div>
      {(eligibleProjects.some(row => !row.deadline) || scopedActions.some(row => !row.dueDate)) && <details className="mb-5 border-y border-line py-3"><summary className="cursor-pointer text-sm text-amber-800">待填写交付日期 · {eligibleProjects.filter(row => !row.deadline).length} 个项目、{scopedActions.filter(row => !row.dueDate).length} 个任务</summary><div className="mt-3 divide-y divide-line">{[...eligibleProjects.filter(row => !row.deadline).map(row => ({ row, type: "project" })), ...scopedActions.filter(row => !row.dueDate).map(row => ({ row, type: "action" }))].map(({ row, type }) => <button key={`${type}:${row.id}`} type="button" className="flex w-full min-w-0 items-center justify-between gap-3 py-3 text-left text-sm" onClick={() => open({ type, item: row })}><span className="min-w-0 break-words"><span className="mr-2 break-all font-mono text-xs text-slate-400">{row.recordCode}</span>{row.name || row.title}</span><Pencil size={14} className="shrink-0 text-sage" /></button>)}</div></details>}
      <div className="grid items-start gap-5 xl:grid-cols-[1.2fr_1fr]">
        <Panel>
          <PanelHeading title={`当${periodLabel}计划`} />
          <p className="-mt-3 mb-4 text-xs text-slate-500">{currentRange.periodStart} 至 {currentRange.periodEnd}</p>
          <details className="mb-4 border-b border-line pb-4">
            <summary className="cursor-pointer text-sm font-medium text-sage">{periodLabel}目标 · {periodGoals.length} 项</summary>
            <div className="mt-4">
              <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h3 className="font-semibold text-ink">{periodLabel}目标</h3>
                  <p className="mt-1 text-sm text-slate-500">本{periodLabel}最重要的结果，明确完成标准和截止日期。</p>
                </div>
                <Button secondary onClick={() => open({ type: "goal", item: { horizon: yearly ? "1年" : monthly ? "本月" : "本周", deadline: currentRange.periodEnd, sceneId: target.scene && target.scene !== "all" && target.scene !== "unclassified" ? target.scene : null } })} icon={<Plus size={15} />}>
                  新增{periodLabel}目标
                </Button>
              </div>
              {periodGoals.length ? (
                <RecordList
                  items={periodGoals}
                  type="goal"
                  remove={remove}
                  onEdit={(item) => open({ type: "goal", item })}
                  summary={(goal) => (
                    <>
                      <div className="font-medium">{goal.title}</div>
                      <div className="mt-1 text-slate-500">{goal.description || "尚未填写描述"}</div>
                      <div className="mt-2 text-xs text-slate-400">指标：{goal.metric || "未定义"} · {goal.status} · 截止 {dateText(goal.deadline)}</div>
                      <button type="button" className="mt-2 inline-flex items-center gap-1 text-xs text-sage" onClick={() => navigate({ section: "goals", goalId: goal.id, scene: target.scene })}>查看项目与任务<ArrowRight size={13} /></button>
                    </>
                  )}
                />
              ) : (
                <Empty text={`新增一个本${periodLabel}最重要的可衡量结果，再拆解为项目和任务。`} />
              )}
            </div>
          </details>
          <div className="mb-3 space-y-2 border-b border-line pb-3">
            {current.projects.map(({ project, tasks, milestones }) => {
              return <div key={project.id} data-period-project-id={project.id} className="border-b border-line py-2 text-sm last:border-0">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <button type="button" className="min-w-0 break-words text-left text-sage" onClick={() => navigate({ section: "goals", tab: "projects", projectId: project.id })}>{project.name}</button>
                  <span className="text-xs text-slate-500">当期任务 {tasks.filter(periodTaskDone).length}/{tasks.length}</span>
                  <button type="button" title="编辑项目" aria-label={`编辑项目 ${project.name}`} className="text-sage" onClick={() => open({ type: "project", item: project })}><Pencil size={14} /></button>
                  <button type="button" title="删除项目" aria-label={`删除项目 ${project.name}`} className="text-slate-400 hover:text-red-600" onClick={() => remove("project", project.id)}><Trash2 size={14} /></button>
                  <button type="button" className="text-xs text-sage" onClick={() => open({ type: "action", item: { projectId: project.id, goalId: project.goalId, dueDate: currentRange.periodEnd } })}>新增任务</button>
                </div>
                <DeliveryMeta code={project.recordCode} date={project.deadline} />
                {milestones.map((milestone, index) => <p key={milestone.id || index} className="mt-1 break-words text-xs text-slate-500">里程碑交付 {dateText(milestone.deadline)} · {milestone.title} · {milestone.status}</p>)}
              </div>;
            })}
            <div className="flex flex-wrap gap-2">
              <Button secondary onClick={() => open({ type: "project", item: { sceneId: target.scene && target.scene !== "all" && target.scene !== "unclassified" ? target.scene : null, goalId: target.goalId, deadline: currentRange.periodEnd } })} icon={<Plus size={15} />}>新建项目</Button>
              <Button secondary onClick={() => open({ type: "action", item: { sceneId: target.scene && target.scene !== "all" && target.scene !== "unclassified" ? target.scene : null, projectId: target.projectId, goalId: target.goalId, dueDate: currentRange.periodEnd } })} icon={<Plus size={15} />}>新增任务</Button>
            </div>
          </div>
          {actions.length ? (
            <div className="space-y-2">
              {actions.map((a) => {
                const { goal, project } = actionLineage(a, goals, projects);
                return (
                  <div
                    key={a.id}
                    data-period-task-id={a.id}
                    className="flex items-center gap-3 border-b border-line py-3 last:border-0"
                  >
                  <button
                    onClick={async () => {
                      if (a.recurrenceSummary) {
                        const today = shanghaiDate();
                        const pending = a.recurrenceSummary.dates.filter(date => !a.recurrenceSummary!.completedDates.includes(date));
                        navigate({ section: "daily", date: pending.find(date => date >= today) || pending.at(-1) || a.recurrenceSummary.dates.at(-1) });
                        return;
                      }
                      const response = await fetch("/api/data", {
                        method: "PATCH",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({
                          type: "action",
                          id: a.id,
                          data: {
                            status: a.status === "已完成" ? "待开始" : "已完成",
                            completedAt:
                              a.status === "已完成"
                                ? null
                                : new Date().toISOString(),
                          },
                        }),
                      });
                      if (!response.ok) { const result = await response.json(); notify(result.error || "更新失败"); return; }
                      window.location.reload();
                    }}
                    className={`grid h-5 w-5 shrink-0 place-items-center rounded border ${periodTaskDone(a) ? "border-sage bg-sage text-white" : "border-slate-300"}`}
                    aria-label={a.recurrenceSummary ? `查看周期执行：${a.title}` : "切换完成状态"}
                    title={a.recurrenceSummary ? "查看本次每日执行" : "切换完成状态"}
                  >
                    {a.recurrenceSummary ? <RefreshCw size={13} /> : a.status === "已完成" && <Check size={13} />}
                  </button>
                  <div className="min-w-0 flex-1">
                    <div
                      className={`text-sm font-medium ${periodTaskDone(a) ? "text-slate-400 line-through" : ""}`}
                    >
                      {a.title}
                    </div>
                    <DeliveryMeta code={a.recordCode} date={a.dueDate} />
                    {a.recurrenceSummary && <details className="my-1 text-xs text-sage"><summary className="cursor-pointer">{recurrenceProgress(a.recurrenceSummary)}</summary><div className="mt-2 flex flex-wrap gap-2">{a.recurrenceSummary.dates.map(date => <button key={date} type="button" className="rounded border border-line px-2 py-1" onClick={() => navigate({ section: "daily", date })}>{date.slice(5)} · {a.recurrenceSummary!.completedDates.includes(date) ? "已完成" : "待完成"}</button>)}</div></details>}
                    <span className="text-xs text-sage">{scenes.find((scene: { id: string; name: string }) => scene.id === a.effectiveSceneId)?.name || "其他"}</span>
                    <LineageTags goal={goal} project={project} />
                    {data?.strategy && <SourceLinks view={data.strategy} type="action" id={a.id} data={data} navigate={navigate} />}
                    <div className="mt-1 text-xs text-slate-400">
                      {a.purpose || "未填写目的"} ·{" "}
                      <TaskSchedule recurrence={a.recurrence} estimatedHours={a.estimatedHours} />
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    <button
                      onClick={() => open({ type: "action", item: a })}
                      className="p-1 text-slate-400 hover:text-sage"
                      aria-label="编辑任务"
                      title="编辑任务"
                    >
                      <Pencil size={15} />
                    </button>
                    <button
                      onClick={() => remove("action", a.id)}
                      className="p-1 text-slate-400 hover:text-red-600"
                      aria-label="删除任务"
                      title="删除任务"
                    >
                      <Trash2 size={15} />
                    </button>
                  </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <Empty text={`本${periodLabel}暂无到期任务；可在目标与执行中调整交付日期。`} />
          )}
          <p className="mt-3 text-xs text-slate-400">项目按交付日期，普通任务按截止日期，周期任务按重复日期归入计划；周期完成次数来自每日执行记录。</p>
        </Panel>
        <Panel>
          <PanelHeading title={summaryTitle} />
          <p className="mb-3 text-xs text-slate-500">{previousRange.periodStart} — {previousRange.periodEnd}</p>
          <div className="mb-4 border-b border-line pb-3">
            <p className="text-sm text-slate-600">上期交付：{previous.projects.length} 个项目 · {previous.tasks.length} 项任务 · 已完成 {previous.tasks.filter(periodTaskDone).length} 项</p>
            <p className="mt-3 text-xs text-slate-500">上期实际完成 {completedWork.length} 项工作 · {completedWork.reduce((count, work) => count + work.entries.length, 0)} 条完成记录</p>
            {scenes.map((scene: { id: string; name: string }) => {
              const tasks = reviewTasks.filter(action => (action.effectiveSceneId || otherSceneId(scenes)) === scene.id);
              const extra = completedWork.filter(work => work.sceneId === scene.id && work.sourceType === "dailyTask");
              const sceneProjects = previous.projects.filter(({ project }) => (project.effectiveSceneId || project.sceneId || otherSceneId(scenes)) === scene.id);
              if (!tasks.length && !extra.length && !sceneProjects.length) return null;
              return <details key={scene.id} data-review-scene={scene.id} className="mt-3 border-t border-line pt-3" open>
              <summary className="cursor-pointer text-sm font-medium text-sage">{scene.name} · {sceneProjects.length} 个项目 · {tasks.length + extra.length} 项工作</summary>
            {sceneProjects.map(({ project, milestones }) => <div key={project.id} data-period-project-id={project.id} className="mt-2 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <button type="button" className="min-w-0 flex-1 break-words text-left text-sage" onClick={() => navigate({ section: "goals", tab: "projects", projectId: project.id })}>{project.name}</button>
                <button type="button" title="编辑项目" aria-label={`编辑项目 ${project.name}`} className="text-sage" onClick={() => open({ type: "project", item: project })}><Pencil size={14} /></button>
                <button type="button" title="删除项目" aria-label={`删除项目 ${project.name}`} className="text-slate-400 hover:text-red-600" onClick={() => remove("project", project.id)}><Trash2 size={14} /></button>
                <button type="button" className="text-xs text-sage" onClick={() => open({ type: "action", item: { projectId: project.id, goalId: project.goalId, dueDate: previousRange.periodEnd } })}>新增任务</button>
              </div>
              <DeliveryMeta code={project.recordCode} date={project.deadline} />
              {milestones.map((milestone, index) => <p key={milestone.id || index} className="mt-1 break-words text-xs text-slate-500">里程碑交付 {dateText(milestone.deadline)} · {milestone.title} · {milestone.status}</p>)}
            </div>)}
              {tasks.map(action => {
                const work = completedWork.find(work => work.sourceType === "action" && work.sourceId === action.id);
                return <div key={action.id} data-period-task-id={action.id} className="mt-2 border-b border-line py-2 text-sm last:border-0"><div className="flex items-start gap-2"><button type="button" className="min-w-0 flex-1 text-left" onClick={() => open({ type: "action", item: action })}>
                <span className="block break-words font-medium">{action.title}</span>
                {action.recurrenceSummary && <span className="mt-1 block text-xs text-sage">{recurrenceProgress(action.recurrenceSummary)}</span>}
                <span className="text-xs text-slate-500">截止 {dateText(action.dueDate)} · {action.status || "待开始"}{!action.projectId ? " · 未关联项目" : !projects.some(project => project.id === action.projectId) ? " · 项目已删除" : ""}</span>
                {action.standard && <span className="mt-1 block break-words text-xs text-slate-500">完成标准：{action.standard}</span>}
              </button><button type="button" aria-label={`编辑任务 ${action.title}`} title="编辑任务" className="shrink-0 p-1 text-sage" onClick={() => open({ type: "action", item: action })}><Pencil size={14} /></button><button type="button" aria-label={`删除任务 ${action.title}`} title="删除任务" className="shrink-0 p-1 text-slate-400 hover:text-red-600" onClick={() => remove("action", action.id)}><Trash2 size={14} /></button></div>
                {work && <details className="mt-2"><summary className="cursor-pointer text-xs text-sage">每日完成记录 · {work.entries.length} 次</summary>{work.entries.map(entry => <p key={entry.id} className="mt-1 whitespace-pre-wrap break-words text-xs text-slate-500">{entry.date} · {entry.result || "已完成，未填写结果"}</p>)}</details>}
              </div>; })}
              {extra.map(work => <div key={work.sourceId} data-completed-daily-id={work.sourceId} className="mt-2 border-b border-line py-2 text-sm last:border-0"><button type="button" className="break-words text-left text-sage" onClick={() => navigate({ section: "daily", recordId: work.sourceId, date: work.entries[0].planDate })}>{work.title}</button>{work.entries.map(entry => <p key={entry.id} className="mt-1 whitespace-pre-wrap break-words text-xs text-slate-500">{entry.date} · {entry.result || "已完成，未填写结果"}</p>)}</div>)}
              </details>;
            })}
            {!previous.projects.length && !reviewTasks.length && !completedWork.length && <p className="mt-2 text-xs text-slate-400">上期暂无交付事项或已完成工作。</p>}
            <div className="mt-3 flex flex-wrap gap-2">
              <Button secondary icon={<Plus size={15} />} onClick={() => open({ type: "project", item: { deadline: previousRange.periodEnd, goalId: target.goalId, sceneId: target.scene && target.scene !== "all" && target.scene !== "unclassified" ? target.scene : null } })}>新建项目</Button>
              <Button secondary icon={<Plus size={15} />} onClick={() => open({ type: "action", item: { dueDate: previousRange.periodEnd, projectId: target.projectId, goalId: target.goalId, sceneId: target.scene && target.scene !== "all" && target.scene !== "unclassified" ? target.scene : null } })}>新增任务</Button>
            </div>
          </div>
          {reviews.length ? (
            <RecordList
              items={reviews}
              type="review"
              remove={remove}
              onEdit={(item) => open({ type: "review", item })}
              summary={reviewSummary}
            />
          ) : (
            <Empty text={canReview ? `${summaryTitle}将按项目任务生成草稿，可修改后保存。` : `尚未记录${summaryTitle}；可补充上期项目和任务。`} />
          )}
          <div className="mt-4">
            <Button
              secondary
              disabled={!reviews.length && !canReview}
              onClick={() => open({ type: "review", item: reviews[0] || { ...previousRange, ...reviewDeliveryDraft(reviewableProjects as (Item & { id: string })[], reviewableActions as (Item & { id: string })[], previousRange, completedWork, scenes), _deliveryAutoFill: true, _reviewType: period, _projectIds: reviewableProjects.map(row => row.id), _actionIds: reviewableActions.map(action => action.id), _dailyTaskIds: completedDailyIds } })}
              icon={reviews.length ? <Pencil size={15} /> : <Plus size={15} />}
            >
              {reviews.length ? "编辑" : "填写"}{summaryTitle}
            </Button>
            {!reviews.length && !canReview && <p className="mt-2 text-xs text-slate-500">上期暂无交付事项或已完成工作，可先添加项目任务或在每日协同记录工作。</p>}
          </div>
          {history.length > 0 && <details className="mt-5 border-t border-line pt-3">
            <summary className="cursor-pointer text-sm text-slate-500">其他周期记录（{history.length}）</summary>
            <RecordList items={history} type="review" remove={remove} onEdit={(item) => open({ type: "review", item })} summary={reviewSummary} />
          </details>}
        </Panel>
      </div>
    </>
  );
}

export function LegacyDecisions({
  data,
  open,
  remove,
}: {
  data: Data | null;
  open: (m: { type: string; item?: Item }) => void;
  remove: (type: string, id: string) => void;
}) {
  const decisions = arr(data, "decisions");
  return (
    <>
      <PageTitle
        eyebrow="决策中心"
        title="把选择留成一条可复盘的证据链"
        description="AI 可以帮助整理事实、假设和风险，但最终选择始终由你确认。"
        action={
          <Button
            onClick={() => open({ type: "decision" })}
            icon={<Plus size={16} />}
          >
            新建重要决策
          </Button>
        }
      />
      <div className="grid gap-5 lg:grid-cols-2">
        {decisions.length ? (
          decisions.map((d) => (
            <Panel key={d.id}>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-lg font-semibold">{d.title}</div>
                  <div className="mt-1 text-xs text-slate-400">
                    {d.status} · 复盘日期 {dateText(d.reviewDate)}
                  </div>
                </div>
                <button
                  onClick={() => remove("decision", d.id)}
                  className="text-slate-400 hover:text-red-600"
                  aria-label="删除决策"
                >
                  <Trash2 size={16} />
                </button>
              </div>
              <div className="mt-5 grid grid-cols-2 gap-3 text-sm">
                <div className="rounded bg-mist p-3">
                  <div className="text-xs text-slate-400">最终选择</div>
                  <div className="mt-1 font-medium">
                    {d.selectedOption || "尚未决定"}
                  </div>
                </div>
                <div className="rounded bg-mist p-3">
                  <div className="text-xs text-slate-400">可逆性</div>
                  <div className="mt-1 font-medium">
                    {d.reversible === false ? "不可逆" : "可逆"}
                  </div>
                </div>
              </div>
              <p className="mt-4 text-sm leading-6 text-slate-600">
                {d.context || "尚未填写决策背景。"}
              </p>
              <div className="mt-4 border-t border-line pt-3 text-xs text-slate-500">
                事实：{d.facts || "未填写"}
                <br />
                假设：{d.assumptions || "未填写"}
                <br />
                信息缺口：{d.gaps || "未填写"}
              </div>
            </Panel>
          ))
        ) : (
          <Panel className="lg:col-span-2">
            <Empty text="当一个选择足够重要，就值得记录当时知道什么、相信什么，以及准备承担什么。" />
          </Panel>
        )}
      </div>
    </>
  );
}

function AIButton({ kind }: { kind: "questions" | "analysis" }) {
  const [working, setWorking] = useState(false);
  const [message, setMessage] = useState("");
  return (
    <div className="flex flex-col items-start gap-2">
      <Button
        secondary
        onClick={async () => {
          setWorking(true);
          try {
            const response = await fetch("/api/ai", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                kind,
                scope: ["个人基础档案", "目标", "约束", "待验证假设"],
              }),
            });
            const result = await response.json();
            if (!response.ok) throw new Error(result.error || "AI 请求失败");
            setMessage(result.error || (result.configured ? "AI 建议已生成，正在等待确认" : "未配置 AI，已生成规则模板问题"));
          } catch (error) {
            setMessage(error instanceof Error ? error.message : "AI 请求失败，请稍后重试");
          } finally {
            setWorking(false);
          }
          window.setTimeout(() => setMessage(""), 4000);
        }}
        icon={<Sparkles size={16} />}
      >
        {working
          ? "生成中…"
          : kind === "questions"
            ? "生成下一轮访谈"
            : "请求分析"}
      </Button>
      {message && <span className="text-xs text-slate-500">{message}</span>}
      <span className="text-xs text-slate-400">将发送：个人基础档案、目标、约束、待验证假设；脱敏规则在设置中配置。</span>
    </div>
  );
}

function Documents({
  data,
  notify,
}: {
  data: Data | null;
  notify: (message: string) => void;
}) {
  const [key, setKey] = useState("profile");
  const [content, setContent] = useState("");
  const [version, setVersion] = useState<Item | null>(null);
  const [history, setHistory] = useState(false);
  const docs = [
    { key: "profile", title: "个人基础档案", file: "01-个人基础档案.md" },
    { key: "decisions", title: "重要决策记录", file: "05-重要决策记录.md" },
    { key: "goals", title: "目标与项目", file: "02-目标与项目.md" },
    { key: "instruction", title: "AI 协作说明书", file: "03-AI协作说明书.md" },
    { key: "actions", title: "行动与复盘", file: "04-行动与复盘.md" },
  ];
  const loadDoc = async (docKey: string) => {
    const response = await fetch(`/api/documents?key=${docKey}`);
    setContent(await response.text());
    setVersion(null);
  };
  useEffect(() => {
    void loadDoc(key);
  }, [key]);
  const save = async (regenerate = false) => {
    const response = await fetch("/api/documents", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        key,
        content: regenerate ? undefined : content,
        source: regenerate ? "重新生成" : "用户编辑",
      }),
    });
    const v = await response.json();
    setVersion(v);
    if (regenerate) setContent(v.content);
    notify("文档版本已保存");
  };
  const restore = async () => {
    if (!version?.id) return;
    const response = await fetch("/api/documents", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: version.id }),
    });
    const restored = await response.json();
    if (!response.ok) {
      notify(restored.error || "恢复版本失败");
      return;
    }
    setContent(restored.content);
    setVersion(restored);
    notify("已恢复为新的文档版本");
  };
  const download = () => {
    const blob = new Blob([content], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = docs.find((d) => d.key === key)?.file || "document.md";
    a.click();
    URL.revokeObjectURL(url);
  };
  const zip = async () => {
    const archive = new JSZip();
    for (const doc of docs) {
      const res = await fetch(`/api/documents?key=${doc.key}`);
      archive.file(doc.file, await res.text());
    }
    const blob = await archive.generateAsync({ type: "blob" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "我的AI工作台.zip";
    a.click();
    URL.revokeObjectURL(url);
    notify("五份档案已打包下载");
  };
  return (
    <>
      <PageTitle
        eyebrow="档案中心"
        title="五份档案，持续长成"
        description="档案由结构化数据生成，也可以手动编辑。每次保存都会留下版本记录。"
        action={
          <div className="flex flex-wrap gap-2">
            <Button
              secondary
              onClick={() => {
                window.location.assign(`/documents/compare?key=${key}`);
              }}
              icon={<History size={15} />}
            >
              查看差异
            </Button>
            <Button secondary onClick={download} icon={<Download size={15} />}>
              下载当前
            </Button>
            <Button onClick={zip} icon={<Archive size={15} />}>
              下载 ZIP
            </Button>
          </div>
        }
      />
      <div className="grid gap-5 xl:grid-cols-[250px_1fr]">
        <Panel className="h-fit p-3">
          <div className="space-y-1">
            {docs.map((doc) => (
              <button
                key={doc.key}
                onClick={() => setKey(doc.key)}
                className={`w-full rounded-lg px-3 py-3 text-left text-sm ${key === doc.key ? "bg-[#e9f0ea] font-medium text-[#42604d]" : "text-slate-600 hover:bg-mist"}`}
              >
                <div>{doc.title}</div>
                <div className="mt-1 text-xs text-slate-400">{doc.file}</div>
              </button>
            ))}
          </div>
          <button
            onClick={() => setHistory(!history)}
            className="mt-3 flex w-full items-center gap-2 border-t border-line px-3 pt-3 text-xs text-slate-500"
          >
            <History size={14} />
            版本历史
          </button>
          {history && (
            <div className="mt-3 max-h-52 space-y-2 overflow-auto px-2">
              {arr(data, "documentVersions")
                .filter((v) => v.documentKey === key)
                .map((v) => (
                  <button
                    key={v.id}
                    onClick={() => {
                      setContent(v.content);
                      setVersion(v);
                    }}
                    className="block w-full text-left text-xs text-slate-500 hover:text-sage"
                  >
                    {dateText(v.createdAt)} · {v.source}
                  </button>
                ))}
            </div>
          )}
        </Panel>
        <Panel>
          <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
            <div>
              <div className="font-semibold">
                {docs.find((d) => d.key === key)?.title}
              </div>
              <div className="mt-1 text-xs text-slate-400">
                结构化数据可随时重新生成，手动编辑不会覆盖历史。
              </div>
            </div>
            <div className="flex gap-2">
              <Button
                secondary
                onClick={() => void save(true)}
                icon={<RotateCcw size={15} />}
              >
                重新生成
              </Button>
              <Button
                onClick={() => void save(false)}
                icon={<Check size={15} />}
              >
                保存版本
              </Button>
              {version && (
                <Button secondary onClick={() => void restore()} icon={<RotateCcw size={15} />}>
                  恢复为新版本
                </Button>
              )}
            </div>
          </div>
          <textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            className="min-h-[560px] w-full rounded-lg border border-line bg-[#fcfdfb] p-5 font-mono text-sm leading-7 outline-none focus:border-sage"
            aria-label="Markdown 文档编辑器"
          />
          {version && (
            <div className="mt-3 text-xs text-sage">
              当前版本：{dateText(version.createdAt)} · {version.source}
            </div>
          )}
        </Panel>
      </div>
    </>
  );
}

function SettingsView({
  data,
  save,
  notify,
  load,
  backup,
}: {
  data: Data | null;
  save: (type: string, payload: Item, id?: string) => Promise<void>;
  notify: (message: string) => void;
  load: () => Promise<void>;
  backup: ReturnType<typeof useWorkspaceBackup>;
}) {
  const [ai, setAi] = useState<Item | null>(data?.aiInstruction || {});
  useEffect(() => {
    setAi(data?.aiInstruction || {});
  }, [data]);
  const status = Boolean((data as Item | null)?.aiConfigured);
  const update = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    await save(
      "instruction",
      Object.fromEntries(new FormData(event.currentTarget)),
    );
  };
  const clear = async () => {
    if (!window.confirm("确定清空全部本地数据吗？此操作不可撤销。")) return;
    const res = await fetch("/api/data", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "all" }),
    });
    if (res.ok) {
      notify("数据已清空");
      await load();
    }
  };
  return (
    <>
      <PageTitle
        eyebrow="设置"
        title="让工作台更像你的工作台"
        description="偏好保存在本地。API 密钥永远不进入浏览器、数据库或导出文件。"
      />
      <WorkspaceBackup backup={backup} reload={load} />
      <div className="mb-5">
        <SuperAdminSettings />
      </div>
      <div className="grid gap-5 lg:grid-cols-2">
        <Panel>
          <PanelHeading title="AI 功能状态" />
          <div
            className={`flex items-center gap-3 rounded-lg p-4 ${status ? "bg-[#edf7ef]" : "bg-mist"}`}
          >
            <div
              className={`h-2.5 w-2.5 rounded-full ${status ? "bg-green-500" : "bg-slate-400"}`}
            />
            <div>
              <div className="text-sm font-medium">
                {status ? "已配置服务端 AI" : "未配置 AI，当前使用规则模板"}
              </div>
              <div className="mt-1 text-xs text-slate-500">
                模型配置来自服务端环境变量，浏览器不会读取密钥。
              </div>
            </div>
          </div>
          <div className="mt-5 space-y-3 text-sm">
            <div className="flex justify-between border-b border-line pb-3">
              <span className="text-slate-500">模型</span>
              <span>{"服务端 AI_MODEL 或默认模型"}</span>
            </div>
            <div className="flex justify-between border-b border-line pb-3">
              <span className="text-slate-500">发送前确认</span>
              <span>每次请求显示字段范围</span>
            </div>
          </div>
        </Panel>
        <Panel>
          <PanelHeading title="AI 协作偏好" />
          <form onSubmit={update} className="space-y-4">
            <Field label="回答语言">
              <input name="language" defaultValue={ai?.language || "中文"} />
            </Field>
            <Field label="回答长度">
              <select
                name="answerLength"
                defaultValue={ai?.answerLength || "适中"}
              >
                <option>简洁</option>
                <option>适中</option>
                <option>详细</option>
              </select>
            </Field>
            <Field label="输出结构">
              <input
                name="structure"
                defaultValue={ai?.structure || "先结论，后依据"}
              />
            </Field>
            <Field label="AI 角色">
              <textarea
                name="aiRole"
                defaultValue={ai?.aiRole || "提问者、分析者和记录助手"}
                rows={2}
              />
            </Field>
            <Field label="允许委托">
              <textarea
                name="delegate"
                defaultValue={ai?.delegate}
                rows={2}
                placeholder="例如：整理资料、生成草稿"
              />
            </Field>
            <Field label="必须确认事项">
              <textarea
                name="mustConfirm"
                defaultValue={ai?.mustConfirm || "重要目标、决策和对外行动"}
                rows={2}
                placeholder="例如：重要目标、决策和对外行动"
              />
            </Field>
            <Field label="隐私及脱敏规则">
              <textarea
                name="privacyOptions"
                defaultValue={ai?.privacyOptions || "姓名和联系方式脱敏"}
                rows={2}
              />
            </Field>
            <Button type="submit" icon={<Check size={15} />}>
              保存偏好
            </Button>
          </form>
        </Panel>
        <Panel>
          <PanelHeading title="数据管理" />
          <button
            onClick={clear}
            disabled={Boolean(backup.busy)}
            className="mt-6 inline-flex items-center gap-2 text-sm text-red-600 hover:underline"
          >
            <Trash2 size={15} />
            清空全部本地数据
          </button>
        </Panel>
      </div>
    </>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-medium text-slate-600">
        {label}
      </span>
      {children}
    </label>
  );
}
function Editor({
  type,
  item,
  data,
  onClose,
  onSave,
}: {
  type: string;
  item?: Item;
  data: Data | null;
  onClose: () => void;
  onSave: (type: string, payload: Item, id?: string) => Promise<void>;
}) {
  const config = configs[type];
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false), [leaving, setLeaving] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  const strategy = data?.strategy as StrategyView | undefined;
  const editorGoals = arr(data, "goals");
  const editorProjectsAll = arr(data, "projects");
  const inferredGoalId = String(item?.goalId || editorGoals.find((goal) => goal.title === embeddedAssociation(item?.purpose, "关联目标", "关联项目"))?.id || "");
  const inferredProjectId = String(item?.projectId || editorProjectsAll.find((project) => project.name === embeddedAssociation(item?.purpose, "关联项目"))?.id || "");
  const [actionGoalId, setActionGoalId] = useState(inferredGoalId);
  const [actionProjectId, setActionProjectId] = useState(inferredProjectId);
  const [projectGoalId, setProjectGoalId] = useState(String(item?.goalId || ""));
  const initialScene = item?.sceneId ?? (type === "goal" && item?.id ? item.effectiveSceneId || strategy?.scenes.find(scene => scene.slot === 4)?.id || "" : type === "action" || item?.id ? "" : editorGoals.find((goal) => goal.id === (item?.goalId || item?.parentId))?.sceneId || "");
  const [sceneId, setSceneId] = useState(String(initialScene));
  const [parentGoalId, setParentGoalId] = useState(String(item?.parentId || ""));
  const [parentRecordId, setParentRecordId] = useState(String(item?.parentId || ""));
  const [goalHorizon, setGoalHorizon] = useState(String(item?.horizon || "10年"));
  const [visionId, setVisionId] = useState(String(item?.visionId ?? (item?.id ? "" : editorGoals.find((goal) => goal.id === (item?.goalId || item?.parentId))?.visionId || "")));
  const tag = strategy?.records.find((record) => record.kind === "tag" && record.payload.subjectType === type && record.payload.subjectId === item?.id);
  const [sceneIds, setSceneIds] = useState<string[]>(tag?.payload.sceneIds as string[] || item?._sceneIds || []);
  const editorReviewPeriod: ReviewPeriod = item?._reviewType || reviewPeriod(item || {});
  const monthlyReview = type === "review" && editorReviewPeriod === "monthly";
  const yearlyReview = type === "review" && editorReviewPeriod === "yearly";
  const [reviewMonth, setReviewMonth] = useState(String(item?.periodStart || shanghaiDate()).slice(0, 7));
  const [reviewYear, setReviewYear] = useState(String(item?.periodStart || shanghaiDate()).slice(0, 4));
  const originalReviewSources = reviewSources(strategy?.sources || [], item?.id);
  const [reviewProjectIds, setReviewProjectIds] = useState<string[]>((item?._projectIds || originalReviewSources.filter(source => source.sourceType === "project").map(source => source.sourceId)).filter((id: string) => editorProjectsAll.some(project => project.id === id)));
  const [reviewActionIds, setReviewActionIds] = useState<string[]>(item?.id ? originalReviewSources.filter(source => source.sourceType === "action" && arr(data, "actions").some(action => action.id === source.sourceId)).map(source => source.sourceId) : arr(data, "actions").filter(action => item?._actionIds ? item._actionIds.includes(action.id) : (item?._projectIds || []).includes(action.projectId)).map(action => action.id));
  const [reviewScopeChanged, setReviewScopeChanged] = useState(false);
  const [reviewDailyIds, setReviewDailyIds] = useState<string[]>((item?._dailyTaskIds || originalReviewSources.filter(source => source.sourceType === "dailyTask").map(source => source.sourceId)).filter((id: string) => arr(data, "dailyReviewTasks").some(task => task.id === id)));
  const reviewDraftRange = useCallback(() => {
    try {
      if (monthlyReview) return monthReviewRange(reviewMonth);
      if (yearlyReview) return yearReviewRange(reviewYear);
      const fields = formRef.current ? new FormData(formRef.current) : null;
      return { periodStart: String(fields?.get("periodStart") || item?.periodStart || "").slice(0, 10), periodEnd: String(fields?.get("periodEnd") || item?.periodEnd || "").slice(0, 10) };
    } catch { return undefined; }
  }, [monthlyReview, yearlyReview, reviewMonth, reviewYear, item?.periodStart, item?.periodEnd]);
  const makeReviewDraft = useCallback(() => {
    const range = reviewDraftRange();
    const selectedActions = arr(data, "actions").filter(action => reviewActionIds.includes(action.id)) as (Item & { id: string })[];
    const daily = arr(data, "dailyReviewTasks").filter(task => task.actionId && reviewActionIds.includes(task.actionId) || reviewDailyIds.includes(task.id)) as CompletedDailyWork[];
    const scenes = data?.strategy?.scenes || [];
    const work = range ? reviewCompletedWork(selectedActions, daily, range, otherSceneId(scenes)) : [];
    return reviewDeliveryDraft(arr(data, "projects").filter(project => reviewProjectIds.includes(project.id)) as (Item & { id: string })[], selectedActions, range, work, scenes);
  }, [data, reviewProjectIds, reviewActionIds, reviewDailyIds, reviewDraftRange]);
  const autoReviewFields = useRef<ReturnType<typeof reviewDeliveryDraft> | null>(item?._deliveryAutoFill ? { wins: item.wins || "", executionIssue: item.executionIssue || "", adjustment: item.adjustment || "" } : null);
  useEffect(() => {
    if (type !== "review" || !autoReviewFields.current || !formRef.current) return;
    const draft = makeReviewDraft();
    for (const field of Object.keys(draft) as (keyof typeof draft)[]) {
      const input = formRef.current.elements.namedItem(field) as HTMLTextAreaElement | null;
      if (input && input.value === autoReviewFields.current[field] && input.value !== draft[field]) {
        input.value = draft[field];
        formRef.current.dataset.workbenchDirty = "true";
      }
    }
    autoReviewFields.current = draft;
  }, [type, makeReviewDraft]);
  let reviewMonthRange: ReturnType<typeof monthReviewRange> | null = null;
  try { reviewMonthRange = monthReviewRange(reviewMonth); } catch { /* Incomplete month input remains editable. */ }
  let reviewYearRange: ReturnType<typeof yearReviewRange> | null = null;
  try { reviewYearRange = yearReviewRange(reviewYear); } catch { /* Incomplete year input remains editable. */ }
  const editorLabel = type === "review" ? reviewPeriodLabels[editorReviewPeriod] : config?.label;
  const close = () => { if (saving) return; if (formRef.current?.dataset.workbenchDirty) setLeaving(true); else onClose(); };
  const closeRef = useRef(close); closeRef.current = close;
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null, overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden"; formRef.current?.focus();
    const key = (event: KeyboardEvent) => {
      if (document.querySelector('[aria-label="未保存的修改"]')) return;
      if (event.key === "Escape") closeRef.current();
      if (event.key === "Tab") {
        const elements = [...(formRef.current?.querySelectorAll<HTMLElement>('button:not(:disabled),input,select,textarea') || [])].filter((element) => element.getClientRects().length);
        if (!elements.length) return;
        const first = elements[0], last = elements[elements.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
      }
    };
    const listener = (event: BeforeUnloadEvent) => { if (formRef.current?.dataset.workbenchDirty) event.preventDefault(); };
    window.addEventListener("beforeunload", listener); document.addEventListener("keydown", key);
    return () => { window.removeEventListener("beforeunload", listener); document.removeEventListener("keydown", key); document.body.style.overflow = overflow; previous?.focus(); };
  }, []);
  const isEditing = Boolean(item?.id);
  if (!config) return null;
  const fillReviewDraft = () => {
    if (!reviewProjectIds.length && !reviewActionIds.length && !reviewDailyIds.length) { setError("请先选择项目、任务或每日完成工作"); return; }
    const draft = makeReviewDraft();
    const fields = Object.keys(draft) as (keyof typeof draft)[];
    const edited = fields.some(field => {
      const input = formRef.current?.elements.namedItem(field) as HTMLTextAreaElement | null;
      return input?.value.trim() && input.value !== autoReviewFields.current?.[field];
    });
    if (edited && !window.confirm("将按所选项目任务重新填充成果、执行问题和下一周期调整，替换这三项的现有内容。继续？")) return;
    for (const field of fields) {
      const input = formRef.current?.elements.namedItem(field) as HTMLTextAreaElement | null;
      if (input) input.value = draft[field];
    }
    autoReviewFields.current = draft;
    if (formRef.current) formRef.current.dataset.workbenchDirty = "true";
    setError("");
  };
  const editorProjects = editorProjectsAll.filter((project) => !actionGoalId || project.goalId === actionGoalId || !project.goalId);
  const hierarchyFallback = strategy?.scenes.find((scene) => scene.slot === 4)?.id || "local-profile-scene-4";
  const parentOptions = parentCandidates({ id: item?.id || "draft", sceneId: sceneId || null, horizon: goalHorizon }, editorGoals as (Item & { id: string })[], hierarchyFallback);
  const currentParent = editorGoals.find((row) => row.id === parentGoalId);
  const parentIssue = currentParent ? hierarchyIssue({ id: item?.id || "draft", sceneId: sceneId || null, horizon: goalHorizon }, currentParent as Item & { id: string }, hierarchyFallback) : parentGoalId ? "上级目标已删除" : "";
  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (saving) return;
    const form = new FormData(event.currentTarget);
    const payload: Item = Object.fromEntries(form);
    delete payload._periodic;
    delete payload._frequency;
    if (type === "review") {
      if (yearlyReview) {
        try { Object.assign(payload, yearReviewRange(reviewYear)); }
        catch { setError("请选择有效的复盘年份"); return; }
      }
      if (monthlyReview) {
        try { Object.assign(payload, monthReviewRange(reviewMonth)); }
        catch { setError("请选择有效的复盘月份"); return; }
      }
      if (!payload.periodStart || !payload.periodEnd || payload.periodStart > payload.periodEnd) { setError("请填写有效的复盘日期，结束日期不能早于开始日期"); return; }
      if (!item?.id || reviewScopeChanged) {
        if (!reviewProjectIds.length && !reviewActionIds.length && !reviewDailyIds.length) { setError("请选择项目、任务或每日完成工作，再填写复盘"); return; }
        payload._reviewScope = { projectIds: reviewProjectIds, actionIds: reviewActionIds, dailyTaskIds: reviewDailyIds };
      }
    }
    for (const field of config.fields.filter((name) => ["priority", "confidence", "score", "estimatedHours"].includes(name))) {
      if (!payload[field])
        payload[field] =
          field === "estimatedHours"
            ? 1
            : field === "confidence"
              ? 3
              : field === "priority"
                ? 3
                : 0;
      else payload[field] = Number(payload[field]);
    }
    if (type === "action") {
      try { payload.estimatedHours = taskHours(Number(form.get("estimatedHours"))); }
      catch (error) { setError(error instanceof Error ? error.message : "请填写有效的分钟数"); return; }
      payload.goalId = actionGoalId || null;
      payload.projectId = actionProjectId || null;
    }
    if (type === "project") payload.goalId = projectGoalId || null;
    if (type === "project" || type === "action") payload.parentId = parentRecordId || null;
    if (["goal", "project", "decision"].includes(type)) { payload.sceneId = sceneId || null; payload.visionId = visionId || null; }
    if (type === "action") payload.sceneId = sceneId || null;
    if (type === "goal") { payload.parentId = parentGoalId || null; payload.horizon = goalHorizon; }
    if (type === "decision") { payload.goalId = payload.goalId || null; payload.signalId = item?.signalId || null; payload.reversible = payload.reversible === "true"; }
    if (type === "milestone") payload.projectId = item?.projectId;
    if (["experience", "evidence", "valueRule", "resource", "constraint", "assumption"].includes(type)) payload._sceneIds = sceneIds;
    if (item?._source && !item.id) payload._source = item._source;
    if (type === "project") {
      const parentScene = editorGoals.find((goal) => goal.id === projectGoalId)?.sceneId;
      if (parentScene && sceneId && parentScene !== sceneId) {
        if (!window.confirm("项目与目标属于不同场景，确认保留跨场景关联？")) return;
        payload.crossSceneConfirmed = true;
      }
    }
    setSaving(true); setError("");
    try {
      await onSave(config.type, payload, item?.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : "保存失败");
    } finally { setSaving(false); }
  };
  return (
    <div className="fixed inset-0 z-30 flex items-end justify-center bg-slate-900/20 p-0 sm:items-center sm:p-5">
      <div className="max-h-[92vh] w-full max-w-xl overflow-y-auto rounded-t-lg border border-line bg-white p-5 shadow-soft sm:rounded-lg sm:p-6">
        <div className="mb-5 flex items-center justify-between">
          <div>
            <div className="text-lg font-semibold">
              {isEditing ? "编辑" : "新增"}
              {editorLabel}
            </div>
          </div>
          <button onClick={close} aria-label="关闭">
            <X size={20} />
          </button>
        </div>
        <form ref={formRef} tabIndex={-1} role="dialog" aria-modal="true" aria-label={editorLabel} onSubmit={submit} onChange={(event) => { event.currentTarget.dataset.workbenchDirty = "true"; }} className="space-y-4 outline-none">
          {["project", "action"].includes(type) && <p className="break-all text-xs text-slate-500">编号：<span className="font-mono">{item?.recordCode || "保存后自动生成"}</span></p>}
          {monthlyReview && <Field label="复盘月份"><input type="month" required min="1900-01" value={reviewMonth} onChange={(event) => setReviewMonth(event.target.value)} /><p className="mt-1 text-xs text-slate-400">{reviewMonthRange ? `${reviewMonthRange.periodStart} 至 ${reviewMonthRange.periodEnd}` : "请选择有效月份"}</p></Field>}
          {yearlyReview && <Field label="复盘年份"><input type="number" required min="1900" max="9999" value={reviewYear} onChange={event => setReviewYear(event.target.value)} /><p className="mt-1 text-xs text-slate-400">{reviewYearRange ? `${reviewYearRange.periodStart} 至 ${reviewYearRange.periodEnd}` : "请选择有效年份"}</p></Field>}
          {type === "review" && <>
            {item?.id && !originalReviewSources.length && <p className="text-xs text-slate-500">历史复盘，可补充关联项目任务。</p>}
            {originalReviewSources.filter(source => !arr(data, source.sourceType === "project" ? "projects" : source.sourceType === "dailyTask" ? "dailyReviewTasks" : "actions").some(row => row.id === source.sourceId)).map(source => <p key={source.sourceId} className="break-words text-xs text-slate-400">{source.sourceTitle}（来源已删除）</p>)}
            <ReviewScopeFields projects={editorProjectsAll as { id: string; name?: string }[]} actions={arr(data, "actions") as { id: string; title?: string }[]} dailyTasks={arr(data, "dailyReviewTasks").filter(task => !arr(data, "actions").some(action => action.id === task.actionId)) as CompletedDailyWork[]} dailyTaskIds={reviewDailyIds} onDailyChange={ids => { setReviewDailyIds(ids); setReviewScopeChanged(true); }} projectIds={reviewProjectIds} actionIds={reviewActionIds} onChange={(projectIds, actionIds) => { setReviewProjectIds(projectIds); setReviewActionIds(actionIds); setReviewScopeChanged(true); }} />
            <Button secondary icon={<RefreshCw size={15} />} onClick={fillReviewDraft}>按项目任务填充</Button>
          </>}
          {strategy && ["goal", "project", "decision"].includes(type) && <div className="grid gap-3 sm:grid-cols-2"><Field label="主场景"><SceneSelect view={strategy} value={sceneId} required={type === "goal"} onChange={(value) => { setSceneId(value); setVisionId(""); }} /></Field><Field label="关联愿景"><select value={visionId} onChange={(event) => setVisionId(event.target.value)}><option value="">未关联愿景</option>{strategy.records.filter((record) => record.kind === "vision" && (!record.archived || record.id === visionId) && record.sceneId === sceneId).map((record) => <option key={record.id} value={record.id}>{record.title}{record.archived ? "（已归档）" : ""}</option>)}</select></Field></div>}
          {type === "goal" && <><Field label="时间跨度"><select name="horizon" value={goalHorizon} onChange={(event) => setGoalHorizon(event.target.value)}>{!goalHorizons.includes(goalHorizon) && <option value={goalHorizon}>{goalHorizon || "未设置"}</option>}{goalHorizons.map((value) => <option key={value}>{value}</option>)}</select></Field><Field label="上级目标"><select name="parentId" value={parentGoalId} onChange={(event) => { setParentGoalId(event.target.value); const parent = editorGoals.find((row) => row.id === event.target.value); if (parent && !isEditing) { setSceneId(parent.sceneId || ""); setVisionId(parent.visionId || ""); } }}><option value="">顶层目标（无上级）</option>{parentGoalId && !parentOptions.some((row) => row.id === parentGoalId) && <option value={parentGoalId}>{currentParent?.title || "来源已删除"} · 当前关联待调整</option>}{parentOptions.map((parent) => <option key={parent.id} value={parent.id}>{parent.horizon} · {parent.title}</option>)}</select>{parentIssue && <p role="status" className="mt-2 text-xs text-amber-700">{parentIssue}</p>}</Field></>}
          {type === "decision" && <Field label="关联目标"><select name="goalId" defaultValue={item?.goalId || ""}><option value="">未关联目标</option>{editorGoals.map((goal) => <option key={goal.id} value={goal.id}>{goal.title}</option>)}</select></Field>}
          {strategy && type === "action" && <Field label="主场景"><select aria-label="任务主场景" value={sceneId} onChange={(event) => setSceneId(event.target.value)}><option value="">跟随项目／目标（无关联为其他）</option>{strategy.scenes.map((scene) => <option key={scene.id} value={scene.id}>{scene.name}</option>)}</select><p className="mt-1 text-xs text-slate-400">当前归属：{strategy.scenes.find((scene) => scene.id === resolveScene({ id: item?.id || "draft", sceneId: sceneId || null, goalId: actionGoalId, projectId: actionProjectId }, editorGoals as never[], editorProjects as never[], strategy.scenes).effectiveSceneId)?.name || "其他"}</p></Field>}
          {strategy && ["experience", "evidence", "valueRule", "resource", "constraint", "assumption"].includes(type) && <fieldset><legend className="mb-2 text-xs text-slate-500">适用场景（不选为全局）</legend><div className="flex flex-wrap gap-3">{strategy.scenes.map((scene) => <label key={scene.id} className="flex items-center gap-1.5 text-xs"><input type="checkbox" className="!w-auto" checked={sceneIds.includes(scene.id)} onChange={(event) => setSceneIds(event.target.checked ? [...sceneIds, scene.id] : sceneIds.filter((id) => id !== scene.id))} />{scene.name}</label>)}</div></fieldset>}
          {type === "project" && (
            <Field label="所属目标">
              <select
                value={projectGoalId}
                onChange={(event) => { setProjectGoalId(event.target.value); if (!isEditing) { setSceneId(editorGoals.find((goal) => goal.id === event.target.value)?.sceneId || ""); setVisionId(editorGoals.find((goal) => goal.id === event.target.value)?.visionId || ""); } }}
                className="w-full rounded-lg border border-line bg-white px-3 py-2 text-sm outline-none focus:border-sage"
              >
                <option value="">未关联目标</option>
                {editorGoals.map((goal) => <option key={goal.id} value={goal.id}>{goal.title} · {goal.horizon}</option>)}
              </select>
            </Field>
          )}
          {type === "action" && (
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="所属目标">
                <select
                  value={actionGoalId}
                  onChange={(event) => {
                    setActionGoalId(event.target.value);
                    setActionProjectId("");
                  }}
                  className="w-full rounded-lg border border-line bg-white px-3 py-2 text-sm outline-none focus:border-sage"
                >
                  <option value="">未关联目标</option>
                  {editorGoals.map((goal) => <option key={goal.id} value={goal.id}>{goal.title} · {goal.horizon}</option>)}
                </select>
              </Field>
              <Field label="所属项目">
                <select
                  value={actionProjectId}
                  onChange={(event) => setActionProjectId(event.target.value)}
                  className="w-full rounded-lg border border-line bg-white px-3 py-2 text-sm outline-none focus:border-sage"
                >
                  <option value="">未关联项目</option>
                  {editorProjects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
                </select>
              </Field>
            </div>
          )}
          {type === "project" && <Field label="上级项目">
            <select value={parentRecordId} onChange={event => setParentRecordId(event.target.value)}>
              <option value="">顶层项目（无上级）</option>
              {(() => {
                const rows = editorProjectsAll as (Item & { id: string })[];
                const candidate = { id: item?.id || "draft", goalId: projectGoalId };
                const options = recordParentCandidates(candidate, rows, type);
                const current = rows.find(row => row.id === parentRecordId);
                return <>{parentRecordId && !options.some(row => row.id === parentRecordId) && <option value={parentRecordId}>{current?.name || current?.title || "上级已删除"} · 当前关联待调整</option>}{options.map(row => <option key={row.id} value={row.id}>{[...recordAncestors(row, rows), row].map(node => node.name || node.title).join(" / ")}</option>)}</>;
              })()}
            </select>
          </Field>}
          {type === "situationItem" && (
            <Field label="所属研判模块">
              <select name="category" defaultValue={item?.category || "today"} className="w-full rounded-lg border border-line bg-white px-3 py-2 text-sm outline-none focus:border-sage">
                {situationTabs.map((tab) => <option key={tab.key} value={tab.key}>{tab.label}</option>)}
              </select>
            </Field>
          )}
          {config.fields.filter((field) => !(type === "goal" && field === "horizon") && !((monthlyReview || yearlyReview) && ["periodStart", "periodEnd"].includes(field)) && !["description", "learning", "conflict", "budget", "boundary", "stopCondition", "risk", "criteria", "facts", "assumptions", "gaps", "rationale", "resultReview"].includes(field)).map((field) => (
            type === "action" && field === "recurrence" ? <fieldset key={field}>
              <legend className="mb-1.5 text-xs font-medium text-slate-600">任务周期</legend>
              <TaskRecurrenceInput value={item?.recurrence || "none"} />
            </fieldset> :
            <Field key={field} label={(type === "project" && field === "deadline") || (type === "action" && field === "dueDate") ? "交付日期" : type === "review" && field === "wins" ? "项目成果" : type === "review" && field === "adjustment" ? "下一周期调整" : fieldLabels[field] || field}>
              <InputFor field={field} value={item?.[field]} required={(type === "project" && field === "deadline") || (type === "action" && ["dueDate", "estimatedHours"].includes(field))} />
            </Field>
          ))}
          <details className="border-t border-line pt-3"><summary className="cursor-pointer text-sm text-sage">详细信息</summary><div className="mt-4 space-y-4">{config.fields.filter((field) => ["description", "learning", "conflict", "budget", "boundary", "stopCondition", "risk", "criteria", "facts", "assumptions", "gaps", "rationale", "resultReview"].includes(field)).map((field) => <Field key={field} label={fieldLabels[field] || field}><InputFor field={field} value={item?.[field]} /></Field>)}</div></details>
          {error && (
            <div className="rounded bg-red-50 p-3 text-sm text-red-700">
              {error}
            </div>
          )}
          {leaving && <div role="alert" className="flex flex-wrap items-center gap-2 bg-amber-50 p-3 text-xs"><span>有未保存的修改</span><Button secondary onClick={onClose}>放弃修改</Button><Button secondary onClick={() => setLeaving(false)}>继续编辑</Button></div>}
          <div className="flex justify-end gap-2 border-t border-line pt-4">
            <Button secondary onClick={close} disabled={saving}>
              取消
            </Button>
            <Button type="submit" icon={<Check size={15} />} disabled={saving}>
              {saving ? "保存中…" : "保存"}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
function InputFor({ field, value, required = false }: { field: string; value?: unknown; required?: boolean }) {
  if (field === "reversible") return <select name={field} defaultValue={value === false ? "false" : "true"}><option value="true">可逆</option><option value="false">不可逆</option></select>;
  const dateValue = value == null ? "" : String(value).slice(0, 10);
  const common = {
    name: field,
    defaultValue: value == null ? "" : String(value),
  };
  if (
    [
      "description",
      "learning",
      "rule",
      "conflict",
      "evidence",
      "statement",
      "purpose",
      "standard",
      "metric",
      "context",
      "options",
      "facts",
      "assumptions",
      "gaps",
      "rationale",
      "risk",
      "wins",
      "goalIssue",
      "strategyIssue",
      "executionIssue",
      "externalIssue",
      "adjustment",
      "benefit",
      "cost",
      "boundary",
      "stopCondition",
      "budget",
      "aiRole",
      "delegate",
      "content",
      "criteria",
      "resultReview",
    ].includes(field)
  )
    return (
      <textarea
        {...common}
        rows={3}
        className="w-full rounded-lg border border-line bg-white px-3 py-2 text-sm outline-none focus:border-sage"
      />
    );
  if (
    ["happenedAt", "dueDate", "deadline", "periodStart", "periodEnd", "reviewDate"].includes(
      field,
    )
  )
    return (
      <input
        name={field}
        defaultValue={dateValue}
        type="date"
        required={required}
        className="w-full rounded-lg border border-line bg-white px-3 py-2 text-sm outline-none focus:border-sage"
      />
    );
  if (["priority", "confidence", "score", "estimatedHours"].includes(field))
    return (
      <input
        {...common}
        type="number"
        required={required}
        defaultValue={field === "estimatedHours" ? (value == null ? 60 : taskMinutes(Number(value)) || 1) : common.defaultValue}
        min={field === "estimatedHours" ? "1" : "0"}
        max={
          field === "confidence" ? "5" : field === "priority" ? "5" : field === "estimatedHours" ? "6000000" : undefined
        }
        step="1"
        className="w-full rounded-lg border border-line bg-white px-3 py-2 text-sm outline-none focus:border-sage"
      />
    );
  if (field === "horizon")
    return (
      <select
        {...common}
        className="w-full rounded-lg border border-line bg-white px-3 py-2 text-sm outline-none focus:border-sage"
      >
        <option>10年</option>
        <option>5年</option>
        <option>3年</option>
        <option>1年</option>
        <option>年度</option>
        <option>90天</option>
        <option>本月</option>
        <option>本周</option>
      </select>
    );
  if (field === "status")
    return (
      <select
        {...common}
        className="w-full rounded-lg border border-line bg-white px-3 py-2 text-sm outline-none focus:border-sage"
      >
        <option>待开始</option>
        <option>进行中</option>
        <option>已完成</option>
        <option>待确认</option>
        <option>待决定</option>
        <option>未开始</option>
        <option>已拒绝</option>
        {value && !["待开始", "进行中", "已完成", "待确认", "待决定", "未开始", "已拒绝"].includes(String(value)) ? <option>{String(value)}</option> : null}
      </select>
    );
  return (
    <input
      {...common}
      className="w-full rounded-lg border border-line bg-white px-3 py-2 text-sm outline-none focus:border-sage"
    />
  );
}
