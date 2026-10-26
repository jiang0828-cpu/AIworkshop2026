import { NextResponse } from "next/server";
import { z } from "zod";
import { getAuthConfig, verifyConfiguredPassword } from "@/lib/auth-config";
import { updateStoredAdmin } from "@/lib/admin-auth";
import { clearSessionCookie } from "@/lib/session-auth";

const changeSchema = z.object({
  currentPassword: z.string().min(1).max(500),
  email: z.string().trim().email().max(320),
  newPassword: z.string().min(12).max(500),
});

export async function POST(request: Request) {
  try {
    const config = await getAuthConfig();
    const input = changeSchema.parse(await request.json());
    if (!config.email || !(await verifyConfiguredPassword(input.currentPassword, config))) return NextResponse.json({ error: "当前密码不正确" }, { status: 401 });
    if (!config.runningOnCloudflare) return NextResponse.json({ error: "管理员密码修改仅支持线上 Worker" }, { status: 503 });
    await updateStoredAdmin(input.email, input.newPassword);
    const response = NextResponse.json({ ok: true });
    response.headers.set("Set-Cookie", clearSessionCookie());
    return response;
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "修改失败，请重试" }, { status: 400 });
  }
}
