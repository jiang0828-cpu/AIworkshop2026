"use client";
import { useState } from "react";
import { selfSections, type SelfSection } from "@/lib/self-transfer";
import type { ModuleProps } from "./Shared";
export default function SelfTransfer({ props, tab }: { props: ModuleProps; tab: string }) {
  const [busy, setBusy] = useState(false), [message, setMessage] = useState("");
  const section = tab as SelfSection;
  if (!selfSections[section]) return null;
  return <details className="mb-4 rounded border border-line p-3"><summary className="cursor-pointer text-xs text-slate-500">导入 / 导出 · {selfSections[section]}</summary><div className="mt-3 space-y-3"><p className="text-xs text-slate-500">导出本板块全部场景的已保存内容及历史。导入替换本板块，其他板块保留；不包含未保存的 AI 草稿和行动任务。</p><div className="flex flex-wrap gap-3"><a className="text-sm text-sage underline" href={`/api/profile-backup?section=${section}`}>导出本板块 JSON</a><a className="text-sm text-sage underline" href="/api/profile-backup">完整备份认识自己</a><label className="cursor-pointer text-sm text-sage underline">{busy ? "正在导入…" : "导入本板块 JSON"}<input type="file" accept=".json,application/json" className="hidden" disabled={busy} onChange={async (event) => {
    const file = event.target.files?.[0]; event.target.value = ""; if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      if (data.section !== section) throw new Error(`请选择“${selfSections[section]}”单独导出的文件；完整备份请使用个人档案的完整导入入口。`);
      if (!window.confirm(`将替换“${selfSections[section]}”的全部场景内容，建议先导出备份。确认继续？`)) return;
      setBusy(true); setMessage("");
      const response = await fetch("/api/profile-backup", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) });
      const result = await response.json(); if (!response.ok) throw new Error(result.error || "导入失败");
      await props.reload(); setMessage("导入成功");
    } catch (error) { setMessage(error instanceof Error ? error.message : "导入失败"); } finally { setBusy(false); }
  }} /></label></div>{message && <p role="status" className="text-sm">{message}</p>}</div></details>;
}
