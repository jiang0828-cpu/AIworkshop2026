"use client";
import { useEffect, useRef, useState } from "react";
import { Download, FileText, Loader2, X } from "lucide-react";
import { buildExecutionDocument, executionExportFilename, executionMarkdown, executionSummary, exportScopeLabels, type ExecutionExportRecord, type ExportScope } from "@/lib/execution-export";
import type { TreeFilters } from "@/lib/execution-tree";
import { Button, Field, type ModuleProps } from "./Shared";
import type { SceneRow } from "@/lib/scenes";

export default function ExecutionExport({ props, scenes, filters, selected }: { props: ModuleProps; scenes: SceneRow[]; filters: TreeFilters; selected: string[] }) {
  const [open, setOpen] = useState(false), [scope, setScope] = useState<ExportScope>("filtered"), [format, setFormat] = useState<"md" | "docx">("md");
  const [working, setWorking] = useState(false), [error, setError] = useState("");
  const busy = useRef(false), dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    dialog.current?.showModal();
    return () => previous?.focus();
  }, [open]);
  const build = () => buildExecutionDocument({
    goals: (props.data?.goals || []) as ExecutionExportRecord[], projects: (props.data?.projects || []) as ExecutionExportRecord[],
    actions: (props.data?.actions || []) as ExecutionExportRecord[], scenes, filters, scope, selected,
  });
  const preview = open ? build() : null;
  const empty = !preview || !preview.sections.length;
  const download = async () => {
    if (busy.current || empty) return;
    busy.current = true; setWorking(true); setError("");
    try {
      const document = build();
      const blob = format === "md" ? new Blob([executionMarkdown(document)], { type: "text/markdown;charset=utf-8" })
        : await (await import("@/lib/execution-export-word")).executionWordBlob(document);
      const link = window.document.createElement("a"), url = URL.createObjectURL(blob);
      try {
        link.href = url; link.download = executionExportFilename(new Date(document.exportedAt), format);
        window.document.body.appendChild(link); link.click();
      } finally { link.remove(); window.setTimeout(() => URL.revokeObjectURL(url), 60000); }
      props.notify(`${format === "md" ? "Markdown" : "Word"} 文件已开始下载`);
      setOpen(false);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "导出失败，请重试"); }
    finally { busy.current = false; setWorking(false); }
  };
  return <>
    <Button onClick={() => { setScope("filtered"); setError(""); setOpen(true); }}><Download size={15} />导出</Button>
    {open && <dialog ref={dialog} aria-labelledby="execution-export-title" onCancel={event => { if (working) event.preventDefault(); else setOpen(false); }}
      className="m-auto max-h-[90dvh] w-[calc(100%-2rem)] max-w-md overflow-y-auto rounded-lg border border-line bg-white p-0 text-ink shadow-soft backdrop:bg-black/25">
      <div className="flex items-center justify-between border-b border-line p-5"><h2 id="execution-export-title" className="font-semibold">导出目标项目任务</h2><button type="button" title="关闭" aria-label="关闭导出" disabled={working} onClick={() => setOpen(false)}><X size={18} /></button></div>
      <form onSubmit={event => { event.preventDefault(); void download(); }}>
        <div className="space-y-4 p-5">
          <Field label="导出范围"><select aria-label="导出范围" disabled={working} value={scope} onChange={event => { setScope(event.target.value as ExportScope); setError(""); }}>
            {(Object.entries(exportScopeLabels) as Array<[ExportScope, string]>).map(([value, label]) => <option key={value} value={value} disabled={value === "selected" && !selected.length}>{label}{value === "selected" && selected.length ? `（${selected.length} 项）` : ""}</option>)}
          </select></Field>
          <fieldset><legend className="mb-2 text-xs text-slate-500">文件格式</legend><div className="flex flex-wrap gap-3">{([ ["md", "Markdown (.md)"], ["docx", "Word (.docx)"] ] as const).map(([value, label]) => <label key={value} className={`inline-flex min-h-10 cursor-pointer items-center gap-2 rounded-md border px-3 py-2 text-sm ${format === value ? "border-sage bg-mist" : "border-line"}`}><input type="radio" className="!w-auto" name="exportFormat" value={value} checked={format === value} disabled={working} onChange={() => setFormat(value)} /><FileText size={15} />{label}</label>)}</div></fieldset>
          <div role="status" aria-live="polite" className="break-words text-sm leading-6 text-slate-600">{empty ? "没有可导出的目标、项目或任务" : preview && executionSummary(preview)}</div>
          {preview && scope === "filtered" && <p className="break-words text-xs leading-5 text-slate-500">{preview.filters.join("；")}</p>}
          {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
        </div>
        <div className="flex flex-wrap justify-end gap-2 border-t border-line p-5"><Button disabled={working} onClick={() => setOpen(false)}>取消</Button><Button type="submit" primary disabled={working || empty}>{working ? <Loader2 size={15} className="animate-spin" /> : <Download size={15} />}{working ? "正在生成…" : "导出文件"}</Button></div>
      </form>
    </dialog>}
  </>;
}
