"use client";
import { useState } from "react";
import { goalHorizons } from "@/lib/goal-hierarchy";
import { EditDialog, Field, type ModuleProps, type Row } from "./Shared";

export default function GoalProjectPlanner({ props, goal, onClose }: { props: ModuleProps; goal: Row; onClose: () => void }) {
  const [opened, setOpened] = useState(true), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const [allow, setAllow] = useState(false), [hours, setHours] = useState(""), [instruction, setInstruction] = useState("");
  const [preview, setPreview] = useState<Row | null>(null), [draft, setDraft] = useState<Row | null>(null);
  const input = { goalId: goal.id, allowSensitive: allow, weeklyHours: hours ? Number(hours) : null, instruction };
  const request = async (action: string, data: Row) => {
    const response = await fetch("/api/strategy", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, data }) });
    const result = await response.json(); if (!response.ok) throw new Error(result.error || "操作失败"); return result;
  };
  const generate = async () => {
    if (busy) return; setBusy(true); setError("");
    try {
      if (!preview) setPreview(await request("goal-project-preview", input));
      else {
        const result = await request("goal-project-generate", { input, fingerprint: preview.fingerprint });
        setDraft(result); setOpened(false); setPreview(null);
      }
    } catch (error) { setError(error instanceof Error ? error.message : "生成失败"); } finally { setBusy(false); }
  };
  const updateGoal = (index: number, values: Row) => setDraft(current => current && ({ ...current, warning: "", goals: current.goals.map((row: Row, i: number) => i === index ? { ...row, ...values } : row) }));
  const updateProject = (goalIndex: number, projectIndex: number, values: Row) => updateGoal(goalIndex, { projects: draft!.goals[goalIndex].projects.map((row: Row, index: number) => index === projectIndex ? { ...row, ...values } : row) });
  const countGoals = draft?.goals.filter((row: Row) => row.selected).length || 0;
  const countProjects = draft?.goals.filter((row: Row) => row.selected).reduce((sum: number, row: Row) => sum + row.projects.filter((project: Row) => project.selected).length, 0) || 0;
  return <>
    {opened && <EditDialog title="生成子目标与项目" working={busy} saveLabel={preview ? busy ? "DeepSeek 规划中…" : "确认发送并生成" : "预览资料"} onClose={onClose} onSave={generate}>
      <p className="break-words text-sm">{goal.title} · {goal.horizon}</p>
      <Field label="每周可投入时间（小时，可留空）"><input type="number" min="0.5" max="168" step="0.5" value={hours} onChange={event => { setHours(event.target.value); setPreview(null); }} /></Field>
      <Field label="补充要求"><textarea rows={3} value={instruction} onChange={event => { setInstruction(event.target.value); setPreview(null); }} /></Field>
      <label className="flex items-start gap-2 text-xs"><input type="checkbox" className="!w-auto" checked={allow} onChange={event => { setAllow(event.target.checked); setPreview(null); }} />本次允许发送所选资料中的敏感内容</label>
      {preview && <><details open className="border-t border-line pt-3"><summary className="text-sm">发送资料 · {preview.records.length} 条</summary><pre className="mt-3 max-h-64 overflow-auto whitespace-pre-wrap break-words text-xs leading-5">{JSON.stringify(preview.records, null, 2)}</pre></details>{preview.blocked && <p className="text-xs text-amber-800">核心资料未授权，请授权或调整补充要求后重新预览。</p>}{preview.omitted > 0 && <p className="text-xs text-slate-500">另有 {preview.omitted} 条参考资料未进入本次发送内容。</p>}</>}
      {error && <p role="alert" className="break-words text-sm text-red-700">{error}</p>}
    </EditDialog>}
    {draft && <EditDialog title="确认子目标与项目" working={busy} saveLabel="确认保存" onClose={onClose} onSave={async () => {
      if (busy) return; setBusy(true); setError("");
      try {
        const selected = draft.goals.filter((row: Row) => row.selected).map((row: Row) => ({ ...row, projects: row.projects.filter((project: Row) => project.selected) }));
        const result = await request("goal-project-save", { requestId: draft.requestId, input: draft.input, fingerprint: draft.fingerprint, draft: { summary: draft.summary, gaps: draft.gaps, goals: selected } });
        await props.reload(); props.notify(`已保存 ${result.goals} 个子目标、${result.projects} 个项目，均为待开始`); onClose();
      } catch (error) { setError(error instanceof Error ? error.message : "保存失败"); } finally { setBusy(false); }
    }}>
      <p className="text-xs text-slate-500">{draft.source} · 已选 {countGoals} 个子目标、{countProjects} 个项目</p><Field label="规划依据"><textarea rows={3} value={draft.summary} onChange={event => setDraft({ ...draft, summary: event.target.value })} /></Field>
      {draft.warning && <p role="alert" className="break-words text-sm text-amber-800">待调整：{draft.warning}</p>}
      <Field label="待核实条件"><textarea rows={3} value={draft.gaps.join("\n")} onChange={event => setDraft({ ...draft, gaps: event.target.value.split("\n").map(row => row.trim()).filter(Boolean) })} /></Field>
      {draft.goals.map((row: Row, index: number) => <section key={index} className="min-w-0 border-t border-line pt-4">
        <label className="flex items-start gap-2 text-sm font-semibold"><input type="checkbox" className="mt-1 !w-auto" checked={row.selected} onChange={event => updateGoal(index, { selected: event.target.checked })} /><span className="min-w-0 break-words">{row.title} · {row.horizon}</span></label>
        <details className="mt-3" open={index === 0 || undefined}><summary className="cursor-pointer text-xs text-sage">子目标与项目详情 · {row.projects.length} 个项目</summary><div className="mt-3 space-y-3">
          {[["title", "子目标名称"], ["description", "预期结果与依据"], ["metric", "衡量标准"]].map(([key, label]) => <Field key={key} label={label}><textarea required={row.selected} rows={2} value={row[key]} onChange={event => updateGoal(index, { [key]: event.target.value })} /></Field>)}
          <Field label="时间跨度"><select value={row.horizon} onChange={event => updateGoal(index, { horizon: event.target.value })}>{goalHorizons.map(value => <option key={value}>{value}</option>)}</select></Field>
          <Field label="目标截止日期"><input type="date" value={row.deadline || ""} onChange={event => updateGoal(index, { deadline: event.target.value || null })} /></Field>
          {row.projects.map((project: Row, projectIndex: number) => <div key={projectIndex} className="min-w-0 border-t border-line pt-4">
            <label className="flex items-start gap-2 text-sm"><input type="checkbox" className="mt-1 !w-auto" checked={project.selected} disabled={!row.selected} onChange={event => updateProject(index, projectIndex, { selected: event.target.checked })} /><span className="min-w-0 break-words">项目：{project.name}</span></label>
            <p className="mt-2 whitespace-pre-wrap break-words text-xs text-slate-600">交付物：{project.deliverable}</p><p className="mt-1 whitespace-pre-wrap break-words text-xs text-slate-600">第一步：{project.firstStep}</p>
            <details className="mt-3"><summary className="cursor-pointer text-xs text-sage">编辑项目与里程碑</summary><div className="mt-3 space-y-3">
              {[["name", "项目名称"], ["deliverable", "交付物"], ["metric", "验收标准"], ["firstStep", "第一步行动"], ["budget", "投入"], ["boundary", "边界"], ["risk", "风险"], ["stopCondition", "停止条件"]].map(([key, label]) => <Field key={key} label={label}><textarea required={row.selected && project.selected} rows={2} value={project[key]} onChange={event => updateProject(index, projectIndex, { [key]: event.target.value })} /></Field>)}
              <Field label="预计总投入（小时，未知留空）"><input type="number" min="0.5" step="0.5" value={project.estimatedHours ?? ""} onChange={event => updateProject(index, projectIndex, { estimatedHours: event.target.value ? Number(event.target.value) : null })} /></Field>
              {[["capabilities", "能力需求"], ["resources", "资源需求"]].map(([key, label]) => <Field key={key} label={label}><textarea rows={2} value={project[key].join("\n")} onChange={event => updateProject(index, projectIndex, { [key]: event.target.value.split("\n").map(row => row.trim()).filter(Boolean) })} /></Field>)}
              {project.milestones.map((milestone: Row, milestoneIndex: number) => <fieldset key={milestoneIndex} className="space-y-3 border-t border-line pt-3"><legend className="text-xs">里程碑 {milestoneIndex + 1}</legend>{[["title", "阶段交付"], ["metric", "验收标准"], ["deadline", "日期"]].map(([key, label]) => <Field key={key} label={label}><input type={key === "deadline" ? "date" : "text"} required={key !== "deadline" && row.selected && project.selected} value={milestone[key] || ""} onChange={event => updateProject(index, projectIndex, { milestones: project.milestones.map((item: Row, i: number) => i === milestoneIndex ? { ...item, [key]: key === "deadline" ? event.target.value || null : event.target.value } : item) })} /></Field>)}</fieldset>)}
            </div></details>
          </div>)}
        </div></details>
      </section>)}
      {error && <p role="alert" className="break-words text-sm text-red-700">{error}</p>}
    </EditDialog>}
  </>;
}
