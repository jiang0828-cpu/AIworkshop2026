"use client";
import { useRef, useState } from "react";
import { Download, Loader2 } from "lucide-react";
import { selfSections, type SelfSection } from "@/lib/self-transfer";
import { buildSelfExportRows, selfExportFilename, type SelfBackupData } from "@/lib/self-export";
import type { ModuleProps } from "./Shared";
export default function SelfTransfer({ props, tab }: { props: ModuleProps; tab: string }) {
  const [busy, setBusy] = useState(false), [message, setMessage] = useState("");
  const pending = useRef(false);
  const section = tab as SelfSection;
  if (!selfSections[section]) return null;
  const downloadStructured = async (format: "docx" | "xlsx", all = false) => {
    if (pending.current) return;
    pending.current = true; setBusy(true); setMessage("");
    try {
      const response = await fetch(`/api/profile-backup${all ? "" : `?section=${section}`}`, { cache: "no-store" });
      if (!response.ok) throw new Error("无法读取可导出的内容");
      const data = await response.json() as { data: SelfBackupData };
      const rows = buildSelfExportRows(data.data);
      const blob = format === "xlsx" ? await (await import("@/lib/self-export-excel")).selfExcelBlob(rows) : await (await import("@/lib/self-export-word")).selfWordBlob(rows);
      const link = document.createElement("a"), url = URL.createObjectURL(blob);
      link.href = url; link.download = selfExportFilename(new Date(), format, all ? "完整" : selfSections[section]); document.body.appendChild(link); link.click(); link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 60000);
      setMessage(`${format === "xlsx" ? "Excel" : "Word"} 文件已开始下载`);
    } catch (error) { setMessage(error instanceof Error ? error.message : "导出失败，请重试"); } finally { pending.current = false; setBusy(false); }
  };
  return <details className="mb-4 rounded border border-line p-3"><summary className="cursor-pointer text-xs text-slate-500">导入 / 导出 · {selfSections[section]}</summary><div className="mt-3 space-y-3">
    <div className="flex flex-wrap gap-2">{([ ["docx", false, "本板块 Word"], ["xlsx", false, "本板块 Excel"], ["docx", true, "完整 Word"], ["xlsx", true, "完整 Excel"] ] as const).map(([format, all, label]) => <button key={label} type="button" className="inline-flex min-h-9 items-center gap-2 rounded-md border border-line px-3 py-2 text-sm text-sage disabled:opacity-50" disabled={busy} onClick={() => void downloadStructured(format, all)}><Download size={15} />{label}</button>)}</div>
    <p className="text-xs text-slate-500">已保存内容与历史版本；不包含未保存的 AI 草稿和行动任务。JSON 用于备份恢复，导入替换本板块，其他板块保留。</p><div className="flex flex-wrap gap-3"><a className="text-sm text-sage underline" href={`/api/profile-backup?section=${section}`}>导出本板块 JSON</a><a className="text-sm text-sage underline" href="/api/profile-backup">完整备份认识自己</a><label className="cursor-pointer text-sm text-sage underline">导入本板块 JSON<input type="file" accept=".json,application/json" className="hidden" disabled={busy} onChange={async (event) => {
    const file = event.target.files?.[0]; event.target.value = ""; if (!file || pending.current) return;
    pending.current = true; setBusy(true); setMessage("");
    try {
      const data = JSON.parse(await file.text());
      if (data.section !== section) throw new Error(`请选择“${selfSections[section]}”单独导出的文件；完整备份请使用个人档案的完整导入入口。`);
      if (!window.confirm(`将替换“${selfSections[section]}”的全部场景内容，建议先导出备份。确认继续？`)) return;
      setBusy(true); setMessage("");
      const response = await fetch("/api/profile-backup", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) });
      const result = await response.json(); if (!response.ok) throw new Error(result.error || "导入失败");
      await props.reload(); setMessage("导入成功");
    } catch (error) { setMessage(error instanceof Error ? error.message : "导入失败"); } finally { pending.current = false; setBusy(false); }
  }} /></label></div>{busy && <p role="status" className="inline-flex items-center gap-2 text-sm text-slate-500"><Loader2 size={15} className="animate-spin" />正在处理…</p>}{message && <p role="status" className="text-sm">{message}</p>}</div></details>;
}
