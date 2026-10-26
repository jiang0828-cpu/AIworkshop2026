import { NextResponse } from "next/server";
import { z } from "zod";
import { ensureStoredAdmin } from "@/lib/admin-auth";
import { getAuthConfig, verifyConfiguredPassword } from "@/lib/auth-config";
import { createSessionToken, sessionCookie } from "@/lib/session-auth";
import { isAuthConfigured } from "@/lib/request-auth";

const loginSchema = z.object({ email: z.string().trim().min(1).max(320), password: z.string().min(1).max(500) });

export async function POST(request: Request) {
  try {
    let config = await getAuthConfig();
    if (!isAuthConfigured({ email: config.email, password: config.password || config.passwordHash })) return NextResponse.json({ error: config.runningOnCloudflare ? "线上登录尚未配置，请先设置 Worker Secret。" : "登录服务尚未配置。" }, { status: 503 });
    const input = loginSchema.parse(await request.json());
    if (input.email !== config.email || !(await verifyConfiguredPassword(input.password, config))) return NextResponse.json({ error: "邮箱或密码不正确" }, { status: 401 });
    if (!config.passwordHash && config.runningOnCloudflare) {
      const stored = await ensureStoredAdmin(config.email!, input.password);
      if (stored) config = { ...config, email: stored.email, passwordHash: stored.passwordHash, sessionSecret: stored.passwordHash };
    }
    const response = NextResponse.json({ ok: true });
    response.headers.set("Set-Cookie", sessionCookie(await createSessionToken(config.email!, config.sessionSecret!)));
    return response;
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "登录失败，请重试" }, { status: 400 });
  }
}
