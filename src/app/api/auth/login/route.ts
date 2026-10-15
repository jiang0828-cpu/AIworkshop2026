import { NextResponse } from "next/server";
import { z } from "zod";
import { getAuthConfig } from "@/lib/auth-config";
import { createSessionToken, sessionCookie } from "@/lib/session-auth";
import { isAuthConfigured } from "@/lib/request-auth";

const loginSchema = z.object({ email: z.string().trim().min(1).max(320), password: z.string().min(1).max(500) });

export async function POST(request: Request) {
  try {
    const { email, password, runningOnCloudflare } = getAuthConfig();
    if (!isAuthConfigured({ email, password })) return NextResponse.json({ error: runningOnCloudflare ? "线上登录尚未配置，请先设置 Worker Secret。" : "登录服务尚未配置。" }, { status: 503 });
    const input = loginSchema.parse(await request.json());
    if (input.email !== email || input.password !== password) return NextResponse.json({ error: "邮箱或密码不正确" }, { status: 401 });
    const response = NextResponse.json({ ok: true });
    response.headers.set("Set-Cookie", sessionCookie(await createSessionToken(email, password)));
    return response;
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "登录失败，请重试" }, { status: 400 });
  }
}
