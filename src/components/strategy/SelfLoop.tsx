"use client";
import { useState } from "react";
import { clientId } from "@/lib/client-id";
import { Button, EditDialog, Field, Link, SceneSelect, useStrategy, type ModuleProps, type Row } from "./Shared";

export const selfGuides: Record<string, [string, string]> = {
  profile: ["记录当前处境，明确自己的角色和优先事项。", "当前阶段：职业转型期。主要角色：产品经理、家长。优先事项：完成作品集，保障固定陪伴时间。只填当前有用的信息。"],
  experiences: ["记录做过的项目和重要经历，沉淀成果、收获与能力证据。", "项目：完成一次用户调研。做了什么：组织 5 次访谈。结果：形成需求清单。学到什么：先问事实，再问判断。可将收获沉淀为能力证据。"],
  values: ["写清想达到的状态，从一个小行动开始。", "未来三个月能独立完成客户访谈；以完成 5 次访谈为标准；底线是不占用固定休息时间。第一步：本周完成一次访谈。"],
  skills: ["对照愿景与任务，找出能力缺口，安排练习，用结果补充证据并调整。", "需求访谈属于专业能力。已有两次访谈证据，缺口是追问；采用实战与拜师，每周投入两小时，以一次访谈摘要通过反馈为标准，完成后复盘。自评可不填。"],
  resources: ["按能量、物质、信息盘点资源，配置投入，通过行动结果复盘调整。", "信息资源：已有访谈提纲。可用两份，本次投入一份；底线是不泄露客户信息。安排一次访谈，记录提纲的实际帮助，再决定继续、改进或重新配置。"],
};
export function selfSourceContent(type: string, row: Row) {
  if (type === "vision") return String(row.payload?.expected || "");
  if (type === "skill") return String(row.payload?.improvement || "");
  if (type === "evidence" || type === "assumption") return String(row.evidence || "");
  return String(type === "experience" ? row.learning || row.description || "" : row.description || "");
}
export default function SelfLoop({ props, type, record, onResourceEvaluate }: { props: ModuleProps; type: string; record: Row; onResourceEvaluate?: (actionId: string) => void }) {
  const { view, post, working } = useStrategy(props);
  const [draft, setDraft] = useState<Row | null>(null), [saving, setSaving] = useState(false), [expanded, setExpanded] = useState(false);
  const title = record.title || record.name || record.ability || record.statement;
  const links = view.sources.filter((row) => row.sourceType === type && row.sourceId === record.id && row.targetType === "action");
  const actions: Row[] = links.map((link) => props.data?.actions?.find((row: Row) => row.id === link.targetId)).filter(Boolean);
  const pending = actions.find((row) => !["已完成", "已取消", "已归档", "归档"].includes(row.status));
  const evidenceLink = view.sources.find((row) => row.sourceType === type && row.sourceId === record.id && row.targetType === "evidence");
  const source = { sourceType: type, sourceId: record.id };
  const review = (actionId: string) => view.selfReviews?.find((row) => row.actionId === actionId);
  const aiBlocked = (actionId: string) => view.selfDailyResults?.some((row) => row.actionId === actionId && row.hasAI && row.status !== "cancelled" && (row.status !== "done" || !row.syncedAt));
  const tagIds = view.records.find((row) => row.kind === "tag" && row.payload.subjectType === type && row.payload.subjectId === record.id)?.payload.sceneIds as string[] || [];
  const sourceScene = record.sceneId || (tagIds.length === 1 ? tagIds[0] : "");
  const start = () => {
    const operation = record._ledger?.availability === "待获取" ? "获取" : "使用";
    setDraft({ kind: "link", sceneId: sourceScene, requestId: clientId(), actionId: "", operation,
      title: `${type === "vision" ? "迈出第一步" : type === "skill" || type === "evidence" ? "练习" : onResourceEvaluate ? operation : "使用／验证"}：${title}`,
      standard: type === "skill" ? String(record.payload?.successCriteria || "") : onResourceEvaluate ? record._ledger?.expectedReturn || "" : "", dueDate: "", goalId: "", projectId: "" });
  };
  const progress = (action: Row) => setDraft({ kind: "progress", ...action, dueDate: action.dueDate?.slice(0, 10) || "" });
  const reflect = (action: Row) => setDraft({ kind: "review", actionId: action.id, result: review(action.id)?.result || "", adjustment: review(action.id)?.adjustment || "", deferred: review(action.id)?.deferred || false });
  const openOutcome = (outcome: { targetId: string; targetType: string }) => {
    const target = outcome.targetType === "evidence" ? props.data?.evidences?.find((row: Row) => row.id === outcome.targetId) : record;
    if (!target) { props.notify("已保存的结果已删除，不会自动重复创建"); return; }
    if (outcome.targetType === "vision" || outcome.targetType === "skill") props.navigate({ section: "self", tab: outcome.targetType === "vision" ? "values" : "skills", recordId: target.id });
    else props.open({ type: outcome.targetType, item: target });
  };
  const apply = (mode: "evidence" | "source", actionId?: string) => {
    const reflection = actionId ? review(actionId) : null;
    const existing = reflection?.applied.find((row) => row.sourceType === type && row.sourceId === record.id && row.mode === mode);
    if (existing) { openOutcome(existing); return; }
    if (!actionId && evidenceLink) { openOutcome({ targetType: "evidence", targetId: evidenceLink.targetId }); return; }
    const content = mode === "evidence" ? reflection?.result || [record.description, record.learning].filter(Boolean).join("\n") : [selfSourceContent(type, record), reflection?.result && `本次结果：${reflection.result}`, reflection?.adjustment && `下次调整：${reflection.adjustment}`].filter(Boolean).join("\n\n");
    setDraft({ kind: "apply", mode, actionId, title, content, expectedUpdatedAt: record.updatedAt });
  };
  const patch = (key: string, value: unknown) => setDraft((current) => current ? { ...current, [key]: value } : current);
  const save = async () => {
    if (!draft || saving || working) return;
    setSaving(true);
    try {
      if (draft.kind === "link") {
        const result = await post("self-link", { ...source, requestId: draft.requestId, ...(draft.actionId ? { actionId: draft.actionId } : {}), ...(onResourceEvaluate ? { operation: draft.operation } : {}), sceneId: draft.sceneId || null, title: draft.title, standard: draft.standard, dueDate: draft.dueDate || null, goalId: draft.goalId || null, projectId: draft.projectId || null });
        if (result) { setDraft(null); setExpanded(true); }
      } else if (draft.kind === "progress") {
        await props.save("action", { title: draft.title, standard: draft.standard, dueDate: draft.dueDate || null, status: draft.status, completedAt: draft.status === "已完成" ? draft.completedAt || new Date().toISOString() : null }, draft.id);
        setDraft(draft.status === "已完成" ? { kind: "review", actionId: draft.id, result: review(draft.id)?.result || "", adjustment: review(draft.id)?.adjustment || "", deferred: false } : null);
        setExpanded(true);
      } else if (draft.kind === "review") {
        if (await post("self-review", { actionId: draft.actionId, result: draft.result, adjustment: draft.adjustment, deferred: draft.deferred })) { setDraft(null); setExpanded(true); }
      } else if (await post("self-apply", { ...source, mode: draft.mode, actionId: draft.actionId, title: draft.title, content: draft.content, expectedUpdatedAt: draft.expectedUpdatedAt })) { setDraft(null); setExpanded(true); }
    } catch (error) { props.notify(error instanceof Error ? error.message : "保存失败，请重试"); }
    finally { setSaving(false); }
  };
  return <div className="mt-3 text-xs" data-self-loop={record.id}>
    <Button onClick={() => pending ? progress(pending) : type === "experience" ? apply("evidence") : start()}>{pending ? "继续任务" : type === "experience" ? evidenceLink ? "查看能力证据" : "沉淀为能力证据" : type === "vision" ? "安排第一步" : ["skill", "evidence"].includes(type) ? "安排练习" : onResourceEvaluate ? "安排使用或维护" : "安排使用／验证"}</Button>
    {(links.length > 0 || type === "experience") && <details className="mt-3" open={expanded} onToggle={(event) => setExpanded(event.currentTarget.open)}><summary className="cursor-pointer text-slate-500">任务与复盘{links.length ? ` · ${links.length}` : ""}</summary><div className="mt-3 space-y-4">
      {links.map((link) => {
        const action = actions.find((row) => row.id === link.targetId), reflection = review(link.targetId);
        if (!action) return <p key={link.id} className="text-slate-400">任务已删除{reflection ? ` · 已保存复盘：${reflection.result}` : ""}</p>;
        return <div key={link.id} className="space-y-2 border-l-2 border-line pl-3"><p className="break-words text-sm">{action.title}</p><p className="text-slate-500">{view.scenes.find((row) => row.id === action.effectiveSceneId)?.name || "其他"} · {action.status}{action.dueDate ? ` · ${action.dueDate.slice(0, 10)}` : ""}</p><div className="flex flex-wrap gap-3"><Link onClick={() => progress(action)}>更新进度</Link>{action.status === "已完成" && !aiBlocked(action.id) && <Link onClick={() => reflect(action)}>{reflection ? "编辑复盘" : "复盘"}</Link>}</div>
          {aiBlocked(action.id) && <Link onClick={() => props.navigate({ section: "daily", recordId: view.selfDailyResults?.find((row) => row.actionId === action.id && row.hasAI && !row.syncedAt)?.id })}>先完成 AI 验收与确认回写</Link>}
          {reflection && <div className="space-y-2 rounded bg-mist p-3"><p className="whitespace-pre-wrap break-words">实际结果：{reflection.result}</p>{reflection.adjustment && <p className="whitespace-pre-wrap break-words text-slate-500">下次调整：{reflection.adjustment}</p>}
            {action.status === "已完成" && !aiBlocked(action.id) && <div className="flex flex-wrap gap-3">{onResourceEvaluate && <Link onClick={() => onResourceEvaluate(action.id)}>{record._ledger?.lastEvaluation?.actionId === action.id && record._ledger?.lastEvaluation?.reviewVersion === reflection.updatedAt ? "查看评估结果" : "评估与确认更新资源"}</Link>}{(onResourceEvaluate ? ["evidence"] as const : ["evidence", "source"] as const).map((mode) => {
              const done = reflection.applied.some((row) => row.sourceType === type && row.sourceId === record.id && row.mode === mode);
              return <Link key={mode} onClick={() => apply(mode, action.id)}>{mode === "evidence" ? done ? "查看已补充证据" : "补充能力证据" : done ? "查看已更新记录" : "更新原记录"}</Link>;
            })}<button type="button" disabled={working || reflection.deferred} className="text-slate-500" onClick={() => void post("self-review", { actionId: action.id, result: reflection.result, adjustment: reflection.adjustment, deferred: true })}>{reflection.deferred ? "已暂不更新" : "暂不更新"}</button></div>}
          </div>}
        </div>;
      })}<Link onClick={start}>新增或关联任务</Link>
    </div></details>}
    {draft && <EditDialog title={draft.kind === "link" ? "安排任务" : draft.kind === "progress" ? "更新任务进度" : draft.kind === "review" ? "简短复盘" : draft.mode === "evidence" ? "确认能力证据" : "确认更新原记录"} working={working || saving} onClose={() => setDraft(null)} onSave={save}>
      {draft.kind === "link" && <><Field label="使用已有任务"><select value={draft.actionId} onChange={(event) => patch("actionId", event.target.value)}><option value="">新建一个任务</option>{(props.data?.actions || []).map((action: Row) => <option key={action.id} value={action.id}>{action.title} · {action.status}</option>)}</select></Field>{draft.actionId && <p className="text-xs text-slate-500">关联同一条任务，不会复制或修改任务内容。</p>}</>}
      {draft.kind === "link" && onResourceEvaluate && !draft.actionId && <Field label="运营目的"><select value={draft.operation} onChange={(event) => { patch("operation", event.target.value); patch("title", `${event.target.value}：${title}`); }}><option>使用</option><option>获取</option><option>维护</option></select></Field>}
      {(draft.kind === "link" && !draft.actionId || draft.kind === "progress") && <><Field label="主场景"><SceneSelect view={view} value={draft.sceneId || ""} onChange={(value) => patch("sceneId", value)} /></Field><Field label="任务名称"><input required value={draft.title} onChange={(event) => patch("title", event.target.value)} /></Field><Field label="完成标准"><textarea rows={2} value={draft.standard} placeholder="做到什么就算完成？" onChange={(event) => patch("standard", event.target.value)} /></Field><Field label="截止日期（可选）"><input type="date" value={draft.dueDate} onChange={(event) => patch("dueDate", event.target.value)} /></Field></>}
      {draft.kind === "progress" && <Field label="任务状态"><select value={draft.status} onChange={(event) => patch("status", event.target.value)}>{Array.from(new Set([draft.status, "待开始", "进行中", "阻塞", "已完成", "已取消"])).map((status) => <option key={status} disabled={status === "已完成" && aiBlocked(draft.id)}>{status}</option>)}</select></Field>}
      {draft.kind === "link" && !draft.actionId && <details><summary className="cursor-pointer text-xs text-slate-500">关联目标或项目（可选）</summary><div className="mt-3 space-y-3"><Field label="关联目标"><select value={draft.goalId} onChange={(event) => { patch("goalId", event.target.value); patch("projectId", ""); }}><option value="">不关联</option>{(props.data?.goals || []).map((row: Row) => <option key={row.id} value={row.id}>{row.title}</option>)}</select></Field><Field label="关联项目"><select value={draft.projectId} onChange={(event) => { const project = props.data?.projects?.find((row: Row) => row.id === event.target.value); patch("projectId", event.target.value); if (project?.goalId) patch("goalId", project.goalId); }}><option value="">不关联</option>{(props.data?.projects || []).filter((row: Row) => !draft.goalId || row.goalId === draft.goalId).map((row: Row) => <option key={row.id} value={row.id}>{row.name}</option>)}</select></Field></div></details>}
      {draft.kind === "review" && <>{view.selfDailyResults?.filter((row) => row.actionId === draft.actionId && row.result).map((row) => <details key={row.id}><summary className="cursor-pointer text-xs text-slate-500">已有协同结果：{row.title}</summary><p className="my-3 whitespace-pre-wrap break-words text-sm">{row.result}</p><Button onClick={() => patch("result", row.result)}>引用此结果</Button></details>)}<Field label="实际结果"><textarea required rows={3} value={draft.result} placeholder="实际做了什么，得到什么结果？" onChange={(event) => patch("result", event.target.value)} /></Field><Field label="下次调整"><textarea rows={2} value={draft.adjustment} placeholder="下一次保留或改变哪一点？可不填。" onChange={(event) => patch("adjustment", event.target.value)} /></Field></>}
      {draft.kind === "apply" && <><Field label={draft.mode === "evidence" ? "能力名称" : "记录名称"}><input required value={draft.title} onChange={(event) => patch("title", event.target.value)} /></Field><Field label={draft.mode === "evidence" ? "具体证据" : "更新内容"}><textarea required rows={6} value={draft.content} onChange={(event) => patch("content", event.target.value)} /></Field><p className="text-xs text-slate-500">确认后保存；原有能力评分不会自动改变。</p></>}
    </EditDialog>}
  </div>;
}
