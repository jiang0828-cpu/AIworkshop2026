import { NextResponse } from "next/server";
import { getCloudSyncConfig, getCloudSyncTarget } from "@/lib/cloud-sync";
import { cloudSyncProgress, enqueueCloudSync } from "@/lib/cloud-sync-client";

export async function GET() {
  const { token, runningOnCloudflare } = getCloudSyncConfig();
  return NextResponse.json({ configured: Boolean(token && getCloudSyncTarget()), runningOnCloudflare, ...cloudSyncProgress() }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST() {
  const { token, runningOnCloudflare } = getCloudSyncConfig();
  const target = getCloudSyncTarget();
  if (runningOnCloudflare) return NextResponse.json({ error: "线上端不执行反向同步" }, { status: 400 });
  if (!token || !target) return NextResponse.json({ error: "尚未配置线上同步。请设置本地 CLOUD_SYNC_URL 和 CLOUD_SYNC_TOKEN。" }, { status: 503 });

  enqueueCloudSync();
  return NextResponse.json({ ok: true, queued: true, ...cloudSyncProgress() }, { status: 202 });
}
