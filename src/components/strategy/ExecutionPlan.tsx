"use client";
/* eslint-disable @typescript-eslint/no-explicit-any */
import { useEffect, useRef, useState } from "react";
import { Check, Play, Plus, RefreshCw, Save, Sparkles } from "lucide-react";
import { shanghaiDate } from "@/lib/daily/shared";
import { clientId } from "@/lib/client-id";
import { effectiveSelection, isDeferred, nodes, type Draft, type PlanInput } from "@/lib/execution-plan/shared";
import { Button, EditDialog, Field, Link, type ModuleProps, type Row } from "./Shared";

const statuses: Record<string, string> = { draft: "草稿", generating: "生成中", reviewing: "校验中", ready: "待确认", failed: "调用失败", interrupted: "调用中断", confirmed: "已确认" };
const dayNames = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];
const fieldNames: Record<string, string> = { title: "名称", name: "名称", description: "内容", metric: "衡量标准", horizon: "时间范围", deadline: "截止日期", dueDate: "建议日期", sceneId: "主场景", visionId: "场景愿景关联", parentId: "父目标", goalId: "所属目标", projectId: "所属项目", budget: "投入", boundary: "边界", risk: "风险", stopCondition: "停止条件", purpose: "行动依据", standard: "完成标准", estimatedHours: "预计小时" };
const defaults = (): PlanInput => ({ capacity: { startDate: shanghaiDate(), weeklyHours: null, weekdays: [], budget: null, budgetNote: "" }, allowSensitive: false, signalIds: [], instruction: "" });
export default function ExecutionPlan({ props }: { props: ModuleProps }) {
  const [history, setHistory] = useState<Row[]>([]), [signals, setSignals] = useState<Row[]>([]);
  const [input, setInput] = useState<PlanInput>(defaults), [preview, setPreview] = useState<Row | null>(null), [plan, setPlan] = useState<Row | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null), [resolutions, setResolutions] = useState<Row[]>([]), [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [confirming, setConfirming] = useState(false), [batchId, setBatchId] = useState(clientId);
  const [firstTasks, setFirstTasks] = useState<string[]>([]), [date, setDate] = useState(shanghaiDate), [clearance, setClearance] = useState<Record<string, string>>({});
  const locked = useRef(false);
  const loader = useRef<(id: string) => Promise<void>>(async () => {});
  const refreshHistory = async () => {
    const response = await fetch("/api/execution-plan", { cache: "no-store" }), data = await response.json();
    if (!response.ok) throw new Error(data.error || "读取规划失败");
    setHistory(data.plans); setSignals(data.signals);
  };
  useEffect(() => { void refreshHistory().catch(cause => setError(cause.message)); }, []);
  useEffect(() => {
    if (!dirty) return;
    const handler = (event: BeforeUnloadEvent) => { event.preventDefault(); };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [dirty]);
  const apply = (data: Row) => {
    setPlan(data); setDraft(data.draft); setInput(data.input); setResolutions(data.resolutions || []); setDirty(false); setPreview(null); setFirstTasks([]);
    const url = new URL(window.location.href); url.searchParams.set("planId", data.id); window.history.replaceState(null, "", url);
    if (data.error) setError(data.error);
  };
  const post = async (body: Row): Promise<Row | null> => {
    if (locked.current) return null;
    locked.current = true; setBusy(true); setError("");
    try {
      const response = await fetch("/api/execution-plan", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const data = await response.json(); if (!response.ok) throw new Error(data.error || "操作失败");
      return data;
    } catch (cause) { setError(cause instanceof Error ? cause.message : "请求失败，当前输入保留"); return null; }
    finally { locked.current = false; setBusy(false); }
  };
  const load = async (id: string) => {
    if (dirty && !window.confirm("放弃当前未保存修改并打开此规划？")) return;
    setBusy(true); setError("");
    try {
      const response = await fetch(`/api/execution-plan?id=${encodeURIComponent(id)}`, { cache: "no-store" });
      const data = await response.json(); if (!response.ok) throw new Error(data.error || "读取失败"); apply(data);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "读取失败"); } finally { setBusy(false); }
  };
  loader.current = load;
  useEffect(() => { if (props.target.planId) void loader.current(props.target.planId); }, [props.target.planId]);
  const newPlan = () => {
    if (dirty && !window.confirm("放弃未保存修改？")) return;
    setPlan(null); setDraft(null); setInput(defaults()); setPreview(null); setDirty(false); setBatchId(clientId()); setError("");
    const url = new URL(window.location.href); url.searchParams.delete("planId"); window.history.replaceState(null, "", url);
  };
  const save = async () => {
    if (!plan) return;
    const result = await post({ action: "save", id: plan.id, revision: plan.revision, draft, capacity: input.capacity, resolutions });
    if (result) { apply(result); await refreshHistory(); window.dispatchEvent(new Event("workbench-saved")); }
    return result;
  };
  const stage = async (stage: string) => {
    let current = plan;
    if (dirty) { current = await save() || null; if (!current) return; }
    if (!current && preview) {
      current = await post({ action: "create", id: batchId, input, fingerprint: preview.fingerprint });
      if (current) { apply(current); await refreshHistory(); }
    }
    if (!current) return;
    const result = await post({ action: "stage", id: current.id, revision: current.revision, stage });
    if (result) { apply(result); await refreshHistory(); }
  };
  const editable = Boolean(plan && plan.status !== "confirmed" && !["generating", "reviewing"].includes(plan.status));
  const change = (key: string, field: string, value: any) => {
    if (!draft || !editable) return;
    setDraft({ ...draft, goals: draft.goals.map(row => row.key === key ? { ...row, [field]: value } : row), projects: draft.projects.map(row => row.key === key ? { ...row, [field]: value } : row), tasks: draft.tasks.map(row => row.key === key ? { ...row, [field]: value } : row) });
    setDirty(true);
  };
  const selected = draft ? effectiveSelection(draft) : new Set<string>();
  const summary = draft ? nodes(draft).filter(row => selected.has(row.key)).reduce((counts, node) => { counts[node.mode]++; if (isDeferred(draft, node.key)) counts.deferred++; return counts; }, { new: 0, reuse: 0, update: 0, deferred: 0 }) : null;
  const inputChange = (capacity: PlanInput["capacity"]) => { setInput({ ...input, capacity }); setPreview(null); if (plan) setDirty(true); };
  const renderNode = (node: any, type: "goal" | "project" | "action", children?: React.ReactNode) => {
    if (!plan) return null;
    const choices = plan?.context.sources.filter((source: Row) => source.type === type && !source.blocked) || [];
    const original = choices.find((source: Row) => source.recordId === node.matchId);
    let previous: Row = {};
    try { const parsed = JSON.parse(original?.content || "{}"); previous = parsed.content || parsed; } catch { /* A missing original remains visible as an unmatched suggestion. */ }
    const fields = type === "goal" ? [["description", "预期结果与路线"], ["metric", "衡量标准"]] : type === "project" ? [["description", "交付物与范围"], ["metric", "验收标准"], ["budget", "投入"], ["boundary", "边界"], ["risk", "风险"], ["stopCondition", "停止条件"]] : [["standard", "完成标准"], ["reason", "规划依据"]];
    const updates = type === "goal" ? ["title", "description", "metric", "horizon", "deadline", "sceneId", "visionId", "parentId"] : type === "project" ? ["name", "description", "metric", "budget", "boundary", "risk", "stopCondition", "sceneId", "visionId", "goalId"] : ["title", "purpose", "standard", "dueDate", "estimatedHours", "sceneId", "goalId", "projectId"];
    const project = draft!.projects.find(project => project.key === node.projectKey);
    const goal = draft!.goals.find(goal => goal.key === (type === "goal" ? node.key : type === "project" ? node.goalKey : project?.goalKey));
    const parent = (key: string | null | undefined) => { const record = nodes(draft!).find(record => record.key === key); return record ? record.mode === "new" ? `新建：${record.title}` : record.matchId : null; };
    const proposed = { ...node, name: node.title, description: type === "goal" ? `${node.description}\n规划依据：${node.reason}\n优先级：${node.priority}` : `${node.description}\n能力：${node.capabilities?.join("；")}\n资源：${node.resources?.join("；")}\n规划依据：${node.reason}`,
      parentId: parent(node.parentKey), goalId: parent(goal?.key), projectId: parent(node.projectKey),
      visionId: goal && (type === "goal" || goal.sceneId === node.sceneId) && plan.context.sources.some((source: Row) => source.type === "vision" && source.recordId === goal.visionId) ? goal.visionId : null,
      purpose: `规划依据：${node.reason}\n执行人：${node.executor}\n前置：${node.dependencies?.join("、") || "无"}\n待核实：${node.conditions?.join("；") || "无"}${isDeferred(draft!, node.key) ? `\n暂缓：${node.deferReason || "上游暂缓"}` : ""}` };
    const display = (field: string, value: unknown) => {
      if (value === null || value === undefined || value === "") return "无";
      if (field === "sceneId") return plan.context.scenes.find((scene: Row) => scene.id === value)?.name || String(value);
      if (["visionId", "goalId", "projectId", "parentId"].includes(field)) return plan.context.sources.find((source: Row) => source.recordId === value)?.title || String(value);
      if (["deadline", "dueDate"].includes(field)) return String(value).slice(0, 10);
      return String(value);
    };
    return <details key={node.key} data-plan-key={node.key} className="min-w-0 border-t border-line py-3">
      <summary className="cursor-pointer break-words text-sm font-medium">{node.title}<span className="ml-2 text-xs font-normal text-slate-500">{props.data?.strategy.scenes.find((scene: Row) => scene.id === node.sceneId)?.name} · {node.priority === 1 ? "优先" : node.priority === 2 ? "重要" : "一般"} · {node.mode === "new" ? "新增" : node.mode === "reuse" ? "复用" : "建议更新"}{!selected.has(node.key) ? " · 已排除" : isDeferred(draft!, node.key) ? " · 暂缓" : ""}</span></summary>
      <div className="mt-3 min-w-0 space-y-3">
        {editable && <div className="flex flex-wrap items-center gap-3 text-xs"><label><input className="!w-auto" type="checkbox" checked={node.selected} onChange={event => change(node.key, "selected", event.target.checked)} /> 纳入规划</label><label><input className="!w-auto" type="checkbox" checked={node.deferred} onChange={event => { change(node.key, "deferred", event.target.checked); }} /> 暂缓</label><select aria-label={`${node.title}保存方式`} className="!w-auto" value={node.mode} onChange={event => change(node.key, "mode", event.target.value)}><option value="new">新增</option><option value="reuse">复用原记录</option><option value="update">更新原记录（逐字段确认）</option></select></div>}
        <Field label="名称"><input disabled={!editable || busy} value={node.title} onChange={event => change(node.key, "title", event.target.value)} /></Field>
        {type === "project" && <Field label="所属目标"><select disabled={!editable || busy} value={node.goalKey} onChange={event => change(node.key, "goalKey", event.target.value)}>{draft!.goals.map(goal => <option key={goal.key} value={goal.key}>{goal.title}</option>)}</select></Field>}
        {type === "action" && <Field label="所属项目"><select disabled={!editable || busy} value={node.projectKey} onChange={event => change(node.key, "projectKey", event.target.value)}>{draft!.projects.map(project => <option key={project.key} value={project.key}>{project.title}</option>)}</select></Field>}
        <div className="grid gap-3 sm:grid-cols-2"><Field label="主场景"><select disabled={!editable || busy} value={node.sceneId} onChange={event => change(node.key, "sceneId", event.target.value)}>{plan.context.scenes.map((scene: Row) => <option key={scene.id} value={scene.id}>{scene.name}</option>)}</select></Field><Field label="优先级"><select disabled={!editable || busy} value={node.priority} onChange={event => change(node.key, "priority", Number(event.target.value))}>{[1, 2, 3].map(value => <option key={value} value={value}>{value === 1 ? "优先" : value === 2 ? "重要" : "一般"}</option>)}</select></Field></div>
        {editable && <Field label="匹配原记录（仅建议，需人工确认）"><select value={node.matchId || ""} onChange={event => change(node.key, "matchId", event.target.value || null)}><option value="">不匹配／新建</option>{choices.map((source: Row) => <option key={source.id} value={source.recordId}>{source.title}</option>)}</select><p className="mt-1 break-words text-xs text-slate-500">{node.matchReason || "无匹配建议"}</p></Field>}
        {node.mode === "update" && <fieldset><legend className="text-xs text-slate-500">确认更新字段（状态、成果不覆盖）</legend><div className="mt-2 space-y-2">{updates.map(field => <label key={field} className="block whitespace-pre-wrap break-words text-xs"><input className="!w-auto" type="checkbox" disabled={!editable} checked={node.updateFields.includes(field)} onChange={event => change(node.key, "updateFields", event.target.checked ? [...node.updateFields, field] : node.updateFields.filter((key: string) => key !== field))} /> {fieldNames[field]}<span className="ml-2 text-slate-500">原：{display(field, previous[field] ?? (["title", "name"].includes(field) ? original?.title : null))} → 草稿：{display(field, proposed[field])}</span></label>)}</div></fieldset>}
        {fields.map(([field, label]) => <Field key={field} label={label}><textarea rows={2} disabled={!editable || busy} value={node[field]} onChange={event => change(node.key, field, event.target.value)} /></Field>)}
        {editable && <details><summary className="cursor-pointer text-xs text-sage">调整资料依据</summary><Field label="依据资料"><select multiple size={4} disabled={busy} value={node.sources} onChange={event => change(node.key, "sources", Array.from(event.target.selectedOptions, option => option.value))}>{plan.context.sources.filter((source: Row) => !source.blocked).map((source: Row) => <option key={source.id} value={source.id}>{source.title}</option>)}</select></Field></details>}
        {type === "goal" && <><Field label="时间范围"><select disabled={!editable || busy} value={node.horizon} onChange={event => change(node.key, "horizon", event.target.value)}>{["10年", "5年", "3年", "1年", "90天", "本周"].map(value => <option key={value}>{value}</option>)}</select></Field><Field label="愿景依据"><select disabled={!editable || busy} value={node.visionId} onChange={event => change(node.key, "visionId", event.target.value)}>{plan.context.sources.filter((source: Row) => ["vision", "overallVision"].includes(source.type) && !source.blocked).map((source: Row) => <option key={source.id} value={source.recordId}>{source.title}</option>)}</select></Field></>}
        {type !== "action" && <Field label={type === "goal" ? "截止日期（远期可留空）" : "金额投入（未知留空）"}>{type === "goal" ? <input type="date" disabled={!editable || busy} value={node.deadline || ""} onChange={event => change(node.key, "deadline", event.target.value || null)} /> : <input type="number" min={0} disabled={!editable || busy} value={node.budgetAmount ?? ""} onChange={event => change(node.key, "budgetAmount", event.target.value === "" ? null : Number(event.target.value))} />}</Field>}
        {type === "project" && <><Field label="所需能力与渠道"><textarea disabled={!editable || busy} value={node.capabilities.join("\n")} onChange={event => change(node.key, "capabilities", event.target.value.split("\n").filter(Boolean))} /></Field><Field label="资源与获取渠道"><textarea disabled={!editable || busy} value={node.resources.join("\n")} onChange={event => change(node.key, "resources", event.target.value.split("\n").filter(Boolean))} /></Field><div className="flex flex-wrap gap-3"><Link onClick={() => props.navigate({ section: "self", tab: "skills" })}>能力需求录入</Link><Link onClick={() => props.navigate({ section: "self", tab: "resources" })}>资源需求录入</Link></div><details><summary className="cursor-pointer text-xs text-sage">里程碑 · {node.milestones.length}</summary>{node.milestones.map((milestone: Row, index: number) => <div key={index} className="mt-3 space-y-2"><input aria-label={`里程碑${index + 1}名称`} disabled={!editable || busy} value={milestone.title} onChange={event => change(node.key, "milestones", node.milestones.map((row: Row, i: number) => i === index ? { ...row, title: event.target.value } : row))} /><textarea aria-label={`里程碑${index + 1}标准`} disabled={!editable || busy} value={milestone.metric} onChange={event => change(node.key, "milestones", node.milestones.map((row: Row, i: number) => i === index ? { ...row, metric: event.target.value } : row))} /><input type="date" aria-label={`里程碑${index + 1}日期`} disabled={!editable || busy} value={milestone.deadline || ""} onChange={event => change(node.key, "milestones", node.milestones.map((row: Row, i: number) => i === index ? { ...row, deadline: event.target.value || null } : row))} /></div>)}</details></>}
        {type === "action" && <><div className="grid gap-3 sm:grid-cols-2"><Field label="执行人"><select disabled={!editable || busy} value={node.executor} onChange={event => change(node.key, "executor", event.target.value)}>{["人工", "AI", "混合"].map(value => <option key={value}>{value}</option>)}</select></Field><Field label="预计小时"><input disabled={!editable || busy} type="number" min={0.1} step={0.1} value={node.estimatedHours} onChange={event => change(node.key, "estimatedHours", Number(event.target.value))} /></Field></div><Field label="建议完成日期"><input disabled={!editable || busy} type="date" value={node.dueDate || ""} onChange={event => change(node.key, "dueDate", event.target.value || null)} /></Field><Field label="待核实条件（每行一项）"><textarea disabled={!editable || busy} value={node.conditions.join("\n")} onChange={event => change(node.key, "conditions", event.target.value.split("\n").filter(Boolean))} /></Field><fieldset><legend className="text-xs text-slate-500">前置任务</legend>{draft!.tasks.filter(task => task.key !== node.key).map(task => <label className="mt-1 block break-words text-xs" key={task.key}><input disabled={!editable || busy} className="!w-auto" type="checkbox" checked={node.dependencies.includes(task.key)} onChange={event => change(node.key, "dependencies", event.target.checked ? [...node.dependencies, task.key] : node.dependencies.filter((key: string) => key !== task.key))} /> {task.title}</label>)}</fieldset></>}
        {node.deferred && <Field label="暂缓原因"><textarea disabled={!editable || busy} value={node.deferReason} onChange={event => change(node.key, "deferReason", event.target.value)} /></Field>}
        <details><summary className="cursor-pointer text-xs text-slate-500">资料依据</summary><p className="mt-2 whitespace-pre-wrap break-words text-xs">{node.reason}</p>{node.sources.map((id: string) => <p className="mt-1 text-xs" key={id}>{plan.context.sources.find((source: Row) => source.id === id)?.title || "来源已删除"}</p>)}</details>
        {children && <div className="min-w-0 border-l-2 border-line pl-3">{children}</div>}
      </div>
    </details>;
  };
  return <details className="mb-5 border-y border-line py-3" id="execution-plan" open={Boolean(props.target.planId)}><summary className="cursor-pointer text-sm font-semibold">AI系统规划{plan ? ` · ${statuses[plan.status]}` : ""}</summary>
    <form className="mt-4 min-w-0 space-y-4" data-workbench-dirty={dirty ? "true" : undefined} onSubmit={event => { event.preventDefault(); void save(); }}>
      <div className="flex flex-wrap gap-2"><select aria-label="规划历史" className="!w-auto !max-w-full" disabled={busy} value={plan?.id || ""} onChange={event => event.target.value && void load(event.target.value)}><option value="">选择已有草稿</option>{history.map(row => <option key={row.id} value={row.id}>{new Date(row.updatedAt).toLocaleString("zh-CN")} · {statuses[row.status]}</option>)}</select><Button disabled={busy} onClick={newPlan}><Plus size={14} />新规划</Button>{plan && <Button disabled={busy || dirty} onClick={() => void load(plan.id)}><RefreshCw size={14} />刷新状态</Button>}</div>
{(!plan || editable) && <fieldset disabled={busy} className="space-y-3"><div className="grid gap-3 sm:grid-cols-3"><Field label="四周起始日期"><input type="date" value={input.capacity.startDate} onChange={event => inputChange({ ...input.capacity, startDate: event.target.value })} /></Field><Field label="每周可用小时（未知留空）"><input type="number" min={0.1} max={168} step={0.5} value={input.capacity.weeklyHours ?? ""} onChange={event => inputChange({ ...input.capacity, weeklyHours: event.target.value === "" ? null : Number(event.target.value) })} /></Field><Field label="90天金额上限（未知留空）"><input type="number" min={0} value={input.capacity.budget ?? ""} onChange={event => inputChange({ ...input.capacity, budget: event.target.value === "" ? null : Number(event.target.value) })} /></Field></div><fieldset><legend className="mb-2 text-xs text-slate-500">可安排日期</legend><div className="flex flex-wrap gap-3">{dayNames.map((day, index) => <label key={day} className="text-xs"><input className="!w-auto" type="checkbox" checked={input.capacity.weekdays.includes(index)} onChange={event => inputChange({ ...input.capacity, weekdays: event.target.checked ? [...input.capacity.weekdays, index] : input.capacity.weekdays.filter(value => value !== index) })} /> {day}</label>)}</div></fieldset><Field label="投入边界与补充说明"><textarea value={input.capacity.budgetNote} onChange={event => inputChange({ ...input.capacity, budgetNote: event.target.value })} /></Field></fieldset>}
      {!plan && <><label className="block text-xs"><input className="!w-auto" disabled={busy} type="checkbox" checked={input.allowSensitive} onChange={event => { setInput({ ...input, allowSensitive: event.target.checked }); setPreview(null); }} /> 授权本次发送所选健康、财务、家庭等敏感资料（沿用档案字段授权与脱敏）</label>{signals.length > 0 && <details><summary className="cursor-pointer text-xs text-sage">可选已确认研判</summary>{signals.map(signal => <label key={signal.id} className="mt-2 block text-xs"><input className="!w-auto" type="checkbox" checked={input.signalIds.includes(signal.id)} onChange={event => { setInput({ ...input, signalIds: event.target.checked ? [...input.signalIds, signal.id] : input.signalIds.filter(id => id !== signal.id) }); setPreview(null); }} /> {signal.title}</label>)}</details>}<Button disabled={busy} onClick={async () => { const data = await post({ action: "preview", input }); if (data) setPreview(data); }}><Sparkles size={14} />预览规划资料</Button></>}
      {(preview || plan) && <details className="border-t border-line pt-3" open={Boolean(preview)}><summary className="cursor-pointer text-xs text-sage">实际发送资料与缺失项</summary><div className="mt-3 max-h-80 overflow-y-auto space-y-2">{(preview || plan!.context).missing.map((item: string) => <p key={item} className="text-xs text-amber-800">{item}</p>)}{(preview || plan!.context).sources.map((source: Row) => <details key={source.id}><summary className="cursor-pointer break-words text-xs">{source.title}{source.blocked ? " · 未授权，不发送" : ""}</summary><pre className="mt-2 whitespace-pre-wrap break-words text-xs">{source.content}</pre></details>)}</div></details>}
      {(preview || (plan && !draft)) && <Button primary disabled={busy || ["generating", "reviewing"].includes(plan?.status)} onClick={() => void stage("generate")}><Sparkles size={14} />{plan ? "重试DeepSeek生成" : "确认发送并生成规划"}</Button>}
      {busy && <p role="status" className="text-xs text-slate-500">正在处理，草稿按阶段保存…</p>}
      {(preview || plan?.context)?.sentInput && <details><summary className="cursor-pointer text-xs text-sage">发送的容量与补充说明</summary><p className="mt-2 whitespace-pre-wrap break-words text-xs">{(preview || plan!.context).sentInput.capacity.budgetNote || "无投入说明"}{"\n"}{(preview || plan!.context).sentInput.instruction || "无补充说明"}</p></details>}
      {error && <p role="alert" className="whitespace-pre-wrap break-words bg-red-50 p-3 text-sm text-red-700">{error}</p>}
      {draft && plan && <><p className="whitespace-pre-wrap break-words text-sm">{draft.summary}</p><details><summary className="cursor-pointer text-xs text-sage">场景覆盖</summary>{draft.coverage.map(row => <p key={row.sceneId} className="mt-2 break-words text-xs">{plan.context.scenes.find((scene: Row) => scene.id === row.sceneId)?.name} · {row.status === "planned" ? "已规划" : "暂不开展"}：{row.reason}</p>)}</details><div>{draft.goals.filter(goal => !goal.parentKey).map(goal => {
        const renderGoal = (goal: Draft["goals"][number]): React.ReactNode => renderNode(goal, "goal", <>{draft.goals.filter(child => child.parentKey === goal.key).map(renderGoal)}{draft.projects.filter(project => project.goalKey === goal.key).map(project => renderNode(project, "project", <>{draft.tasks.filter(task => task.projectKey === project.key).map(task => renderNode(task, "action"))}</>))}</>);
        return renderGoal(goal);
      })}</div>
      {editable && <div className="flex flex-wrap gap-2"><Button disabled={busy} onClick={() => void save()}><Save size={14} />保存草稿</Button><Button disabled={busy} onClick={() => void stage("review")}><Sparkles size={14} />{plan.review ? "重新校验价值与边界" : "DeepSeek校验价值与边界"}</Button><Button disabled={busy || dirty} onClick={async () => { const result = await post({ action: "refresh", id: plan.id, revision: plan.revision }); if (result) apply(result); }}><RefreshCw size={14} />刷新资料差异</Button></div>}
      {dirty && <p className="text-xs text-amber-800">存在未保存修改；保存后重新校验才能确认。</p>}
      {plan.issues?.length > 0 && <details><summary className="cursor-pointer text-sm font-semibold">校验问题 · {plan.issues.length}项</summary>{plan.issues.map((issue: Row) => {
        const target = issue.nodeKey && nodes(draft).find(node => node.key === issue.nodeKey);
        const excluded = target && !selected.has(target.key), deferred = target && isDeferred(draft, target.key);
        return <div key={issue.id} className="border-t border-line py-3"><p className={`break-words text-sm ${issue.kind === "violation" ? "text-red-700" : "text-amber-800"}`}>{issue.origin === "ai" ? "AI" : "规则"} · {issue.kind === "violation" ? "明确底线违规" : issue.kind === "inference" ? "推断待确认" : issue.kind === "unknown" ? "条件未知" : "执行检查"}：{issue.message}{excluded ? "（已排除）" : deferred ? "（暂缓）" : ""}</p><p className="mt-1 break-words text-xs text-slate-500">{issue.advice}</p>{issue.evidence && <p className="mt-1 whitespace-pre-wrap break-words text-xs">依据：{issue.evidence.quote}</p>}{editable && issue.kind === "inference" && <Field label="人工核对及接受理由"><textarea value={resolutions.find(row => row.issueId === issue.id)?.reason || ""} onChange={event => { setResolutions([...resolutions.filter(row => row.issueId !== issue.id), { issueId: issue.id, decision: "accept", reason: event.target.value }]); setDirty(true); }} /></Field>}{editable && target && <div className="mt-2 flex flex-wrap gap-2"><Button onClick={() => change(target.key, "selected", false)}>排除条目</Button>{issue.kind !== "violation" && <Button onClick={() => { change(target.key, "deferred", true); setDraft(current => current ? { ...current, goals: current.goals.map(row => row.key === target.key ? { ...row, deferred: true, deferReason: issue.message } : row), projects: current.projects.map(row => row.key === target.key ? { ...row, deferred: true, deferReason: issue.message } : row), tasks: current.tasks.map(row => row.key === target.key ? { ...row, deferred: true, deferReason: issue.message } : row) } : current); }}>暂缓并核实</Button>}</div>}</div>;
      })}</details>}
      {plan.review && <p className="whitespace-pre-wrap break-words text-xs text-slate-500">AI复核：{plan.review.summary}</p>}
      {summary && <p className="text-sm">确认范围：新增 {summary.new} · 复用 {summary.reuse} · 更新 {summary.update} · 暂缓 {summary.deferred}</p>}
      {editable && <Button primary disabled={busy || dirty || !plan.confirmable} onClick={() => setConfirming(true)}><Check size={14} />人工确认保存（不启动）</Button>}
      {plan.status === "confirmed" && <section className="border-t border-line pt-4"><h3 className="mb-3 text-sm font-semibold">选择首批任务</h3><Field label="加入每日计划日期"><input type="date" min={shanghaiDate()} value={date} onChange={event => setDate(event.target.value)} /></Field>{plan.mapping.filter((item: Row) => item.type === "action").map((item: Row) => { const task = draft.tasks.find(task => task.key === item.key)!; return <div key={item.key} className="mt-3 border-t border-line pt-3"><label className="block break-words text-sm"><input className="!w-auto" type="checkbox" disabled={busy || (item.deferred && !item.cleared)} checked={firstTasks.includes(item.key)} onChange={event => setFirstTasks(event.target.checked ? [...firstTasks, item.key] : firstTasks.filter(key => key !== item.key))} /> {task.title} · {task.executor} · {task.estimatedHours}小时{item.deferred && !item.cleared ? " · 暂缓" : ""}</label><div className="mt-2"><Link onClick={() => props.navigate({ section: "actions", recordId: item.id })}>查看原行动</Link></div>{item.deferred && !item.cleared && <><textarea aria-label={`${task.title}核实结果`} rows={2} className="mt-2" value={clearance[item.key] || ""} onChange={event => setClearance({ ...clearance, [item.key]: event.target.value })} placeholder="实际条件、资料和核实结果" /><Button disabled={busy || !clearance[item.key]?.trim()} onClick={async () => { const result = await post({ action: "release", id: plan.id, key: item.key, reason: clearance[item.key] }); if (result) apply(result); }}>确认核实结果</Button></>}</div>; })}<div className="mt-4 flex flex-wrap gap-2"><Button primary disabled={busy || !firstTasks.length} onClick={async () => { const result = await post({ action: "select-tasks", id: plan.id, keys: firstTasks, date }); if (result) { props.notify("已加入每日协同，尚未启动；在每日协同选择启动"); await props.reload(); setFirstTasks([]); } }}><Play size={14} />加入每日计划（不启动）</Button><Button onClick={() => props.navigate({ section: "daily" })}>查看每日协同</Button></div></section>}
      </>}
      {plan && plan.logs?.length > 0 && <details><summary className="cursor-pointer text-xs text-slate-500">模型调用记录</summary>{plan.logs.map((log: Row, index: number) => <p key={index} className="mt-2 break-words text-xs">{log.stage === "generate" ? "生成" : "校验"} · {log.model} · {Math.round(log.durationMs / 1000)}秒 · 输入 {log.promptTokens ?? "未知"} / 输出 {log.completionTokens ?? "未知"} token</p>)}</details>}
    </form>
    {confirming && <EditDialog title="确认完整规划" working={busy} saveLabel="确认保存，不启动任务" onClose={() => setConfirming(false)} onSave={async () => { const result = await post({ action: "confirm", id: plan!.id, revision: plan!.revision }); if (result) { apply(result); setConfirming(false); await props.reload(); await refreshHistory(); props.notify("已保存确认规划；尚未启动任何任务"); } }}><p className="text-sm">新增 {summary?.new} · 复用 {summary?.reuse} · 更新 {summary?.update} · 暂缓 {summary?.deferred}</p><p className="text-xs text-slate-500">更新仅应用勾选字段。已完成、进行中状态和历史成果保留。暂缓任务须核实后才能启动。</p></EditDialog>}
  </details>;
}
