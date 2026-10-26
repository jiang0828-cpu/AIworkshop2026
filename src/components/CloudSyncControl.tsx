"use client";

import { useCallback, useEffect, useState } from "react";
import { CheckCircle2, CloudOff, Loader2, RefreshCw } from "lucide-react";

type Status = { configured: boolean; runningOnCloudflare: boolean; status: string; uploaded: number; total: number; syncedAt: string | null; error: string | null };
export default function CloudSyncControl({ compact = false }: { compact?: boolean }) {
  const [state, setState] = useState<Status | null>(null);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const read = useCallback(async () => {
    try {
      const response = await fetch("/api/sync", { cache: "no-store" });
      if (!response.ok) throw new Error("无法读取同步状态");
      setState(await response.json()); setError("");
    } catch { setError("无法读取同步状态，请重试"); }
  }, []);
  useEffect(() => {
    void read();
    const timer = window.setInterval(() => void read(), 5000);
    window.addEventListener("focus", read);
    return () => { clearInterval(timer); window.removeEventListener("focus", read); };
  }, [read]);
  if (state?.runningOnCloudflare) return compact ? null : <section className="mb-5 border border-line bg-white p-5"><h2 className="font-semibold">线上数据</h2><p className="mt-2 text-sm text-slate-500">当前使用云端数据库。请在本地工作台发起本地到线上的同步。</p></section>;
  const busy = submitting || Boolean(state && ["preparing", "uploading", "committing"].includes(state.status));
  const label = error || (state?.status === "error" ? "同步失败" : state?.status === "synced" ? "线上已同步" : state?.status === "uploading" ? `上传中 ${state.uploaded}/${state.total}` : state?.status === "committing" ? "线上提交中" : busy ? "准备同步中" : !state ? "读取同步状态" : state.configured ? "待同步" : "未配置同步");
  const sync = async () => {
    if (!state?.configured || busy) return;
    setSubmitting(true);
    try {
      const response = await fetch("/api/sync", { method: "POST" });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "同步启动失败");
      setState(previous => previous ? { ...previous, ...result } : previous); setError("");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "同步启动失败"); }
    finally { setSubmitting(false); }
  };
  const icon = busy ? <Loader2 size={16} className="animate-spin" /> : state?.status === "synced" ? <CheckCircle2 size={16} /> : state?.status === "error" || error ? <CloudOff size={16} /> : <RefreshCw size={16} />;
  const button = <button type="button" title={`${label}；本地数据同步至线上`} aria-label={`${label}，同步至线上`} disabled={busy || !state?.configured} onClick={sync} className={`inline-flex min-h-9 items-center justify-center gap-2 rounded-lg border border-line px-2 text-xs disabled:opacity-60 ${error || state?.status === "error" ? "text-red-700" : "text-slate-600"}`}>{icon}<span className={compact ? "hidden sm:inline" : ""}>{compact ? label : busy ? label : "同步至线上"}</span></button>;
  if (compact) return button;
  return <section className="mb-5 border border-line bg-white p-5" aria-label="线上同步">
    <div className="flex flex-wrap items-center justify-between gap-3"><h2 className="text-base font-semibold">线上同步</h2>{button}</div>
    <p role="status" className="mt-3 break-words text-sm text-slate-600">{label}{state?.syncedAt ? ` · 最近确认：${new Date(state.syncedAt).toLocaleString("zh-CN")}` : ""}</p>
    {(state?.error || error) && <p role="alert" className="mt-2 break-words text-sm text-red-700">{error || state?.error}。本地数据已保留。</p>}
    {state?.configured && <p className="mt-2 text-xs text-slate-500">以本地完整快照更新线上。请避免同步期间同时编辑线上资料；同步不是备份。</p>}
  </section>;
}
