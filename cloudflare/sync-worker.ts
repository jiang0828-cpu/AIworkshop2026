import type { D1Database } from "@cloudflare/workers-types";
import { processSyncTransfer, SyncConflict } from "../src/lib/cloud-sync-protocol";
import { withCloudSyncLock } from "../src/lib/cloud-sync-lock";
import { isCloudSyncAuthorized } from "../src/lib/cloud-sync-auth";

type Env = { WORKBENCH_DB: D1Database; CLOUD_SYNC_TOKEN: string };
export default {
  async fetch(request: Request, env: Env) {
    if (new URL(request.url).pathname !== "/api/sync/transfer" || request.method !== "POST") return new Response("Not found", { status: 404 });
    if (!isCloudSyncAuthorized(request.headers.get("x-workbench-sync-token"), env.CLOUD_SYNC_TOKEN || "")) return Response.json({ error: "同步请求未获授权" }, { status: 401 });
    try {
      if (Number(request.headers.get("content-length")) > 250000) return Response.json({ error: "同步分片过大" }, { status: 413 });
      const body = await request.text();
      if (new TextEncoder().encode(body).length > 250000) return Response.json({ error: "同步分片过大" }, { status: 413 });
      const result = await processSyncTransfer(env.WORKBENCH_DB, JSON.parse(body), callback => withCloudSyncLock(env.WORKBENCH_DB, callback));
      return Response.json(result, { headers: { "Cache-Control": "no-store" } });
    } catch (error) {
      return Response.json({ error: error instanceof Error ? error.message.slice(0, 180) : "同步失败" }, { status: error instanceof SyncConflict ? 409 : 400 });
    }
  },
};
