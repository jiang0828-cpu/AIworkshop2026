"use client";

import { useEffect, useRef, useState } from "react";
import { Download, Loader2, Upload } from "lucide-react";
import { backupDownloadSchema, readWorkspaceBackup, workspaceBackupFilename, type BackupDownload } from "@/lib/workspace-backup";

const historyKey = "workbench-last-backup-download-v1";
const buttonStyle = "inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border border-line px-3 py-2 text-sm font-medium text-slate-700 hover:bg-mist disabled:cursor-not-allowed disabled:opacity-60";

export function useWorkspaceBackup(notify: (message: string) => void) {
  const [busy, setBusy] = useState<"export" | "restore" | null>(null);
  const lock = useRef(false);
  const [lastDownload, setLastDownload] = useState<BackupDownload | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    try {
      const result = backupDownloadSchema.safeParse(JSON.parse(localStorage.getItem(historyKey) || "null"));
      if (result.success) setLastDownload(result.data);
    } catch { /* Downloads still work when browser storage is unavailable. */ }
  }, []);

  async function exportBackup() {
    if (lock.current) return;
    lock.current = true; setBusy("export"); setError("");
    try {
      const response = await fetch("/api/backup", { cache: "no-store" });
      if (!response.ok) throw new Error(response.status === 401 ? "登录已失效，请重新登录后导出。" : "导出失败，请稍后重试。");
      const blob = await response.blob();
      let value: unknown;
      try { value = JSON.parse(await blob.text()); } catch { throw new Error("备份内容无效，未下载文件，请重试。"); }
      const backup = readWorkspaceBackup(value);
      if (!backup.exportedAt) throw new Error("备份缺少导出时间，请重试。");
      const filename = workspaceBackupFilename(new Date(backup.exportedAt));
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      try {
        link.href = url; link.download = filename;
        document.body.appendChild(link); link.click();
      } finally {
        link.remove();
        window.setTimeout(() => URL.revokeObjectURL(url), 60000);
      }
      const receipt = { exportedAt: backup.exportedAt, filename, bytes: blob.size };
      setLastDownload(receipt);
      try { localStorage.setItem(historyKey, JSON.stringify(receipt)); } catch { /* Do not fail a successful download. */ }
      notify("完整备份已开始下载，请保留下载文件。");
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "导出失败，请重试。";
      setError(message); notify(message);
    } finally { lock.current = false; setBusy(null); }
  }

  async function restoreBackup(file: File, reload: () => Promise<void>) {
    if (lock.current) return;
    lock.current = true; setBusy("restore"); setError("");
    try {
      let value: unknown;
      try { value = JSON.parse(await file.text()); } catch { throw new Error("无法读取 JSON 备份文件。"); }
      readWorkspaceBackup(value);
      if (!window.confirm("恢复会覆盖当前整个工作台的数据，包括档案、愿景、目标、项目、任务、复盘和 AI 记录。建议先导出当前完整备份。确定恢复吗？")) return;
      const response = await fetch("/api/backup", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(value),
      });
      if (!response.ok) {
        const result = await response.json().catch(() => null);
        throw new Error(result?.error || "恢复失败，请检查备份文件或登录状态。");
      }
      try { await reload(); notify("整个工作台数据已恢复。"); }
      catch { notify("数据已恢复，请刷新页面查看。"); }
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "恢复失败，请重试。";
      setError(message); notify(message);
    } finally { lock.current = false; setBusy(null); }
  }
  return { busy, lastDownload, error, exportBackup, restoreBackup };
}

type BackupController = ReturnType<typeof useWorkspaceBackup>;

export function BackupExportButton({ backup, compact = false }: { backup: BackupController; compact?: boolean }) {
  const label = backup.busy === "export" ? "正在导出完整备份" : "导出完整备份";
  return <button type="button" onClick={backup.exportBackup} disabled={Boolean(backup.busy)} title={label} aria-label={label}
    className={compact ? "inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-line text-slate-600 hover:bg-mist disabled:opacity-50" : buttonStyle}>
    {backup.busy === "export" ? <Loader2 size={16} className="animate-spin" /> : <Download size={16} />}
    {!compact && (backup.busy === "export" ? "正在导出…" : "导出完整备份")}
  </button>;
}

export default function WorkspaceBackup({ backup, reload }: { backup: BackupController; reload: () => Promise<void> }) {
  const input = useRef<HTMLInputElement>(null);
  const receipt = backup.lastDownload;
  return <section id="workspace-backup" aria-labelledby="workspace-backup-title" className="mb-5 border border-line bg-white p-5 shadow-soft md:p-6">
    <h2 id="workspace-backup-title" className="text-base font-semibold text-ink">完整工作台备份</h2>
    <p className="mt-2 text-sm leading-6 text-slate-500">档案、愿景、能力与资源、研判、目标、项目、任务、复盘、AI 记录和历史版本统一导出为 JSON。</p>
    <div className="mt-4 flex flex-wrap gap-2">
      <BackupExportButton backup={backup} />
      <button type="button" className={buttonStyle} disabled={Boolean(backup.busy)} onClick={() => input.current?.click()}>
        {backup.busy === "restore" ? <Loader2 size={16} className="animate-spin" /> : <Upload size={16} />}
        {backup.busy === "restore" ? "正在恢复…" : "从备份恢复"}
      </button>
      <input ref={input} type="file" accept=".json,application/json" aria-label="选择完整工作台备份" className="hidden" disabled={Boolean(backup.busy)} onChange={async event => {
        const element = event.currentTarget, file = element.files?.[0];
        if (file) await backup.restoreBackup(file, reload);
        element.value = "";
      }} />
    </div>
    <div className="mt-4 break-words text-xs leading-6 text-slate-500" role="status" aria-live="polite">
      {receipt ? <>
        <p>本浏览器最近导出：{new Date(receipt.exportedAt).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai", hour12: false })}（北京时间）</p>
        <p>{receipt.filename} · {receipt.bytes < 1024 * 1024 ? `${(receipt.bytes / 1024).toFixed(1)} KB` : `${(receipt.bytes / 1024 / 1024).toFixed(1)} MB`}</p>
      </> : <p>本浏览器暂无导出记录。</p>}
    </div>
    {backup.error && <p role="alert" className="mt-2 text-sm text-red-600">{backup.error}</p>}
    <details className="mt-3 text-xs leading-6 text-slate-500">
      <summary className="cursor-pointer">备份与恢复说明</summary>
      <p className="mt-2">建议每周及重要修改前导出，保留不同日期的文件。导出记录表示已发起下载，请确认文件保存在下载目录。</p>
      <p>文件包含个人资料，请妥善保管。不包含服务端 API 密钥、环境变量、程序代码及外部链接所指向的文件。恢复会覆盖现有业务数据；运行中的任务需先结束，恢复的执行队列需手动重新启动。</p>
    </details>
  </section>;
}
