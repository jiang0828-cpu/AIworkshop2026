"use client";
import { useState } from "react";
import { recurrenceLabel, taskRecurrences, taskMinutes } from "@/lib/task-schedule";

export function TaskRecurrenceInput({ value = "none" }: { value?: string }) {
  const [recurrence, setRecurrence] = useState(value);
  const periodic = recurrence !== "none";
  return <div className="space-y-3">
    <input type="hidden" name="recurrence" value={recurrence} />
    <div role="group" aria-label="任务周期类型" className="flex flex-wrap gap-4">
      {[false, true].map(enabled => <label key={String(enabled)} className="inline-flex cursor-pointer items-center gap-2 whitespace-nowrap text-sm">
        <input className="!h-4 !w-4 shrink-0 !p-0 accent-sage" type="radio" name="_periodic" value={String(enabled)} checked={periodic === enabled} onChange={() => setRecurrence(enabled ? "daily" : "none")} />{enabled ? "周期性" : "非周期性"}
      </label>)}
    </div>
    {periodic && <div role="group" aria-label="重复频率" className="flex flex-wrap gap-4">
      {taskRecurrences.filter(item => item !== "none").map(item => <label key={item} className="inline-flex cursor-pointer items-center gap-2 whitespace-nowrap text-sm">
        <input className="!h-4 !w-4 shrink-0 !p-0 accent-sage" type="radio" name="_frequency" value={item} checked={recurrence === item} onChange={() => setRecurrence(item)} />{recurrenceLabel(item)}
      </label>)}
    </div>}
    {periodic && <p className="text-xs text-slate-500">从创建日起重复，每周沿用创建日的星期，每月沿用创建日的日期（不足时取月末），至交付日期结束。</p>}
  </div>;
}

export default function TaskSchedule({ recurrence, estimatedHours }: { recurrence?: string | null; estimatedHours?: number | null }) {
  return <span className="inline-flex max-w-full flex-wrap items-center gap-2 text-xs text-slate-500">
    <span className="rounded border border-line px-1.5 py-0.5 text-sage">{recurrenceLabel(recurrence)}</span>
    {estimatedHours != null && <span>预计 {taskMinutes(estimatedHours)} 分钟</span>}
  </span>;
}
