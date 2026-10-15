import { NextResponse } from "next/server";
import { POST as restoreBackup } from "@/app/api/backup/route";
import { getCloudSyncConfig, isCloudSyncAuthorized } from "@/lib/cloud-sync";

export async function POST(request: Request) {
  const { token, runningOnCloudflare } = getCloudSyncConfig();
  if (!runningOnCloudflare || !isCloudSyncAuthorized(request.headers.get("x-workbench-sync-token"), token)) {
    return NextResponse.json({ error: "同步请求未获授权" }, { status: 401, headers: { "Cache-Control": "no-store" } });
  }
  const payload = await request.text();
  return restoreBackup(new Request(request.url, { method: "POST", headers: { "Content-Type": "application/json" }, body: payload }));
}
