import { NextResponse } from "next/server";
import { getCloudSyncConfig, getCloudSyncTarget } from "@/lib/cloud-sync";

export async function GET() {
  const { token, runningOnCloudflare } = getCloudSyncConfig();
  return NextResponse.json({ configured: Boolean(token && getCloudSyncTarget()), runningOnCloudflare });
}

export async function POST(request: Request) {
  const { token, runningOnCloudflare } = getCloudSyncConfig();
  const target = getCloudSyncTarget();
  if (runningOnCloudflare) return NextResponse.json({ error: "线上端不执行反向同步" }, { status: 400 });
  if (!token || !target) return NextResponse.json({ error: "尚未配置线上同步。请设置本地 CLOUD_SYNC_URL 和 CLOUD_SYNC_TOKEN。" }, { status: 503 });

  try {
    const backup = await fetch(new URL("/api/backup", request.url), { cache: "no-store" });
    if (!backup.ok) return NextResponse.json({ error: "无法生成本地备份，线上同步未执行。" }, { status: 500 });
    const payload = await backup.text();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 30_000);
    const response = await fetch(`${target}/api/sync/import`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Workbench-Sync-Token": token },
      body: payload,
      cache: "no-store",
      signal: controller.signal,
    });
    clearTimeout(timer);
    const result = await response.json().catch(() => ({}));
    if (!response.ok) return NextResponse.json({ error: typeof result.error === "string" ? result.error : "线上同步失败" }, { status: 502 });
    return NextResponse.json({ ok: true, syncedAt: new Date().toISOString(), imported: result.imported || null });
  } catch (error) {
    const detail = error instanceof Error ? error.message.slice(0, 240) : "未知网络错误";
    return NextResponse.json({ error: "无法连接线上工作台，已保留本地数据，请稍后重试。", detail }, { status: 502 });
  }
}
