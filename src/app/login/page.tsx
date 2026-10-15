"use client";

import { FormEvent, useState } from "react";

export default function LoginPage() {
  const [error, setError] = useState("");
  const [working, setWorking] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setWorking(true);
    setError("");
    const form = new FormData(event.currentTarget);
    try {
      const response = await fetch("/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: form.get("email"), password: form.get("password") }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "登录失败");
      window.location.href = "/";
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "登录失败，请重试");
      setWorking(false);
    }
  }
  return (
    <main className="grid min-h-screen place-items-center px-5 py-10">
      <section className="w-full max-w-md border border-line bg-white p-6 shadow-soft sm:p-8">
        <div className="mb-7"><div className="text-xs font-semibold uppercase tracking-[.16em] text-sage">AI 工作台</div><h1 className="mt-2 text-2xl font-semibold tracking-tight text-ink">登录后继续</h1><p className="mt-2 text-sm leading-6 text-slate-500">请输入已配置的邮箱和密码。凭据只用于验证，不会写入工作台数据库。</p></div>
        <form onSubmit={submit} className="space-y-4">
          <label className="block text-sm text-slate-600">邮箱<input className="mt-1.5" name="email" type="email" autoComplete="username" required /></label>
          <label className="block text-sm text-slate-600">密码<input className="mt-1.5" name="password" type="password" autoComplete="current-password" required /></label>
          {error && <p className="text-sm text-red-600" role="alert">{error}</p>}
          <button type="submit" disabled={working} className="w-full rounded-lg bg-[#496554] px-4 py-2.5 text-sm font-medium text-white transition hover:bg-[#3c5545] disabled:cursor-wait disabled:opacity-60">{working ? "正在登录..." : "登录"}</button>
        </form>
      </section>
    </main>
  );
}
