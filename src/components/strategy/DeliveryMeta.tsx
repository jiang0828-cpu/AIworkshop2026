"use client";
import { CalendarDays } from "lucide-react";
import type { Navigation } from "./Shared";

export default function DeliveryMeta({ code, date, navigate }: { code?: string | null; date?: string | null; navigate?: (target: Navigation) => void }) {
  const day = date?.slice(0, 10);
  return <div className="mt-1 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500">
    {code && <span className="break-all font-mono">{code}</span>}
    <span className="inline-flex items-center gap-1"><CalendarDays size={12} />{day ? `交付 ${day}` : "交付日期待填写"}</span>
    {day && navigate && <span className="inline-flex gap-2">{[["weekly", "周"], ["monthly", "月"], ["yearly", "年"]].map(([tab, label]) => <button key={tab} type="button" className="text-sage hover:underline" title={`查看当${label}计划`} aria-label={`查看当${label}计划`} onClick={() => navigate({ section: "actions", tab })}>{label}</button>)}</span>}
  </div>;
}
