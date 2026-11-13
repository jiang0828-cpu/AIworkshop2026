import type { D1Database } from "@cloudflare/workers-types";
import { COOKIE_NAME, isSessionValid } from "./session-auth";
import type { WorkbenchPart } from "./workbench-read";

export type WorkbenchEdgeEnv = { WORKBENCH_DB: D1Database; APP_AUTH_EMAIL?: string; APP_AUTH_PASSWORD?: string; AI_API_KEY?: string };

// Only accelerate ordinary GETs. Login submissions, Basic auth, RSC requests
// and all writes retain the original Next middleware and API handlers.
export async function workbenchEdge(request: Request, env: WorkbenchEdgeEnv, shell: string, loginShell?: string): Promise<Response | null> {
  const url = new URL(request.url);
  if (request.method !== "GET" || request.headers.has("rsc")) return null;
  if (url.pathname === "/login" && loginShell) return new Response(loginShell, { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } });
  if (!["/", "/api/data"].includes(url.pathname) || request.headers.has("authorization")) return null;
  const cookie = request.headers.get("cookie")?.split(";").map(part => part.trim()).find(part => part.startsWith(`${COOKIE_NAME}=`))?.slice(COOKIE_NAME.length + 1);
  const admin = await env.WORKBENCH_DB.prepare("SELECT email, password_hash AS secret FROM admin_accounts WHERE id = ?1 LIMIT 1").bind("super-admin").first<{ email: string; secret: string }>();
  const email = admin?.email || env.APP_AUTH_EMAIL, secret = admin?.secret || env.APP_AUTH_PASSWORD;
  if (!email || !secret) return null;
  if (!await isSessionValid(cookie, { email, sessionSecret: secret })) {
    return url.pathname === "/" ? new Response(null, { status: 307, headers: { Location: new URL("/login", request.url).href, "Cache-Control": "no-store" } }) : new Response("需要验证后才能访问 AI 工作台", { status: 401, headers: { "WWW-Authenticate": 'Basic realm="AI Workbench", charset="UTF-8"', "Cache-Control": "no-store" } });
  }
  const headers = { "Cache-Control": "private, no-store", "Vary": "Cookie", "X-Workbench-Read": "d1-direct" };
  if (url.pathname === "/") return new Response(shell, { headers: { ...headers, "Content-Type": "text/html; charset=utf-8" } });
  const { readWorkbenchData } = await import("./workbench-read");
  const requestedPart = url.searchParams.get("part");
  const part = ["main", "archive", "strategy"].includes(requestedPart || "") ? requestedPart as WorkbenchPart : undefined;
  const data = await readWorkbenchData(env.WORKBENCH_DB, Boolean(env.AI_API_KEY), undefined, part);
  return data ? Response.json(data, { headers: { ...headers, ...(part ? { "X-Workbench-Part": part } : {}) } }) : null;
}
