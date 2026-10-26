import { NextRequest, NextResponse } from "next/server";
import { getAuthConfig } from "@/lib/auth-config";
import { isAuthConfigured, isAuthorized } from "@/lib/request-auth";
import { isSessionValid } from "@/lib/session-auth";
import { verifyConfiguredPassword } from "@/lib/auth-config";
import { getCloudSyncConfig, isCloudSyncAuthorized } from "@/lib/cloud-sync";

function challenge(message = "需要验证后才能访问 AI 工作台") {
  return new NextResponse(message, { status: 401, headers: { "WWW-Authenticate": 'Basic realm="AI 工作台", charset="UTF-8"', "Cache-Control": "no-store" } });
}

export async function middleware(request: NextRequest) {
  if (request.nextUrl.pathname === "/login" || request.nextUrl.pathname === "/api/auth/login") return NextResponse.next();
  if (["/api/sync/import", "/api/sync/transfer"].includes(request.nextUrl.pathname)) {
    const { token, runningOnCloudflare } = getCloudSyncConfig();
    if (runningOnCloudflare && isCloudSyncAuthorized(request.headers.get("x-workbench-sync-token"), token)) return NextResponse.next();
  }
  const config = await getAuthConfig();
  const credentials = { email: config.email, password: config.password || config.passwordHash };
  if (!isAuthConfigured(credentials) || !config.sessionSecret) {
    if (config.runningOnCloudflare) return new NextResponse("线上访问验证尚未配置，请先设置 Worker Secret。", { status: 503, headers: { "Cache-Control": "no-store" } });
    return NextResponse.next();
  }
  if (await isSessionValid(request.cookies.get("ai_workbench_session")?.value, { email: config.email!, sessionSecret: config.sessionSecret }) || isAuthorized(request.headers.get("authorization"), credentials)) return NextResponse.next();
  const basic = request.headers.get("authorization");
  if (basic?.startsWith("Basic ")) {
    const provided = basic.slice(6);
    try {
      const decoded = atob(provided);
      const separator = decoded.indexOf(":");
      if (separator > 0 && decoded.slice(0, separator) === config.email && await verifyConfiguredPassword(decoded.slice(separator + 1), config)) return NextResponse.next();
    } catch { /* Fall through to the normal challenge. */ }
  }
  return request.nextUrl.pathname.startsWith("/api/") ? challenge() : NextResponse.redirect(new URL("/login", request.url));
}

export const config = { matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"] };
