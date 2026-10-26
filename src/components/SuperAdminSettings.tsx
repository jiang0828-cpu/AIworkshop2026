"use client";

import { useState } from "react";
import { KeyRound, ShieldCheck } from "lucide-react";

export default function SuperAdminSettings() {
  const [working, setWorking] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setWorking(true);
    setMessage("");
    setError("");
    const form = new FormData(event.currentTarget);
    try {
      const response = await fetch("/api/auth/change-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          currentPassword: form.get("currentPassword"),
          email: form.get("email"),
          newPassword: form.get("newPassword"),
        }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || "修改失败");
      setMessage("超级管理员凭据已更新，请使用新密码重新登录。");
      window.setTimeout(() => { window.location.href = "/login"; }, 900);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "修改失败，请重试");
    } finally {
      setWorking(false);
    }
  }

  return (
    <section className="rounded-xl border border-line bg-white p-5 shadow-soft sm:p-6">
      <div className="flex items-start gap-3">
        <div className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-[#edf7ef] text-sage"><ShieldCheck size={18} /></div>
        <div><h2 className="font-semibold text-ink">超级管理员安全设置</h2><p className="mt-1 text-xs leading-5 text-slate-500">修改 AI 工作台登录邮箱或密码。凭据只保存在 Worker 的安全存储和管理员表中。</p></div>
      </div>
      <form onSubmit={submit} className="mt-5 space-y-4">
        <label className="block text-sm text-slate-600">当前密码<input className="mt-1.5" name="currentPassword" type="password" autoComplete="current-password" required /></label>
        <label className="block text-sm text-slate-600">管理员邮箱<input className="mt-1.5" name="email" type="email" autoComplete="username" required /></label>
        <label className="block text-sm text-slate-600">新密码<input className="mt-1.5" name="newPassword" type="password" autoComplete="new-password" minLength={12} required /><span className="mt-1 block text-xs text-slate-400">至少 12 个字符。</span></label>
        {error && <p className="text-sm text-red-600" role="alert">{error}</p>}
        {message && <p className="text-sm text-sage" role="status">{message}</p>}
        <button type="submit" disabled={working} className="inline-flex items-center gap-2 rounded-lg bg-[#496554] px-4 py-2.5 text-sm font-medium text-white transition hover:bg-[#3c5545] disabled:cursor-wait disabled:opacity-60"><KeyRound size={15} />{working ? "正在更新..." : "更新管理员凭据"}</button>
      </form>
    </section>
  );
}
