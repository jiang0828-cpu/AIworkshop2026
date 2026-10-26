import { NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { getCloudSyncConfig, isCloudSyncAuthorized } from "@/lib/cloud-sync";
import { processSyncTransfer, SyncConflict } from "@/lib/cloud-sync-protocol";

export async function POST(request: Request) {
  const { token, runningOnCloudflare } = getCloudSyncConfig();
  if (!runningOnCloudflare || !isCloudSyncAuthorized(request.headers.get("x-workbench-sync-token"), token)) return NextResponse.json({ error: "同步请求未获授权" }, { status: 401 });
  try {
    if (Number(request.headers.get("content-length")) > 2_000_000) return NextResponse.json({ error: "同步分片过大" }, { status: 413 });
    const body = await request.text();
    if (new TextEncoder().encode(body).length > 2_000_000) return NextResponse.json({ error: "同步分片过大" }, { status: 413 });
    const result = await processSyncTransfer(getCloudflareContext().env.WORKBENCH_DB, JSON.parse(body), async callback => {
      const [{ getDb }, { withDailyLock }] = await Promise.all([import("@/lib/db"), import("@/lib/daily/service")]);
      return withDailyLock(await getDb(), callback, true);
    });
    return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("Cloud sync transfer failed", error instanceof Error ? error.name : "unknown");
    return NextResponse.json({ error: error instanceof Error ? error.message.slice(0, 180) : "分批同步失败" }, { status: error instanceof SyncConflict ? 409 : 400 });
  }
}
