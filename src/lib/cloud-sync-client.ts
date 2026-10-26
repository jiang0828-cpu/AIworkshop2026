import { GET as exportBackup, POST as normalizeBackup } from "./workspace-backup-service";
import { getCloudSyncConfig, getCloudSyncTarget } from "./cloud-sync";
import { syncDigest, syncParts, validateSyncRow } from "./cloud-sync-transfer";
import type { SyncRow } from "./database-writes";

type Progress = { status: "idle" | "preparing" | "uploading" | "committing" | "synced" | "error"; uploaded: number; total: number; syncedAt: string | null; error: string | null };
type State = { progress: Progress; active: Promise<void> | null; again: boolean; fingerprint: string | null };
class RemoteSyncError extends Error { constructor(message: string, readonly status: number) { super(message); } }
const globalState = globalThis as typeof globalThis & { workbenchSync?: State };
const state = globalState.workbenchSync ??= { progress: { status: "idle", uploaded: 0, total: 0, syncedAt: null, error: null }, active: null, again: false, fingerprint: null };
export const cloudSyncProgress = () => ({ ...state.progress });

async function transferSnapshot() {
  const { token } = getCloudSyncConfig();
  const target = getCloudSyncTarget();
  if (!target || !token) throw new Error("尚未配置线上同步");
  const request = async (payload: object): Promise<{ status: string; rowCount?: number }> => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 120000);
    try {
      const endpoint = (process.env.CLOUD_SYNC_TRANSFER_URL || target).trim().replace(/\/$/, "");
      const response = await fetch(`${endpoint}/api/sync/transfer`, { method: "POST", headers: { "Content-Type": "application/json", "X-Workbench-Sync-Token": token }, body: JSON.stringify(payload), signal: controller.signal, cache: "no-store" });
      const result = await response.json().catch(() => null);
      if (!response.ok) throw new RemoteSyncError(typeof result?.error === "string" ? result.error : `线上同步请求失败（HTTP ${response.status}，${(payload as { phase: string }).phase}）`, response.status);
      return result;
    } finally { clearTimeout(timeout); }
  };
  const call = async (payload: object) => {
    const phase = (payload as { phase: string }).phase;
    for (let attempt = 0; ; attempt++) {
      try { return await request(payload); }
      catch (error) {
        if (phase === "commit" || phase === "status" || attempt >= 5 || error instanceof RemoteSyncError && error.status < 500 && error.status !== 429) throw error;
        await new Promise(resolve => setTimeout(resolve, Math.min(2000 * 2 ** attempt, 16000)));
      }
    }
  };
  state.progress = { ...state.progress, status: "preparing", uploaded: 0, total: 0, error: null };
  const backup = await exportBackup();
  if (!backup.ok) throw new Error("无法生成本地完整备份");
  const payload = await backup.text();
  const source = JSON.parse(payload);
  const fingerprint = await syncDigest(JSON.stringify(source.data));
  if (state.fingerprint === `${target}:${fingerprint}`) { state.progress.status = "synced"; return; }
  let rows: SyncRow[] = [];
  const normalized = await normalizeBackup(new Request("http://localhost/api/backup", { method: "POST", headers: { "Content-Type": "application/json" }, body: payload }), captured => { rows = captured; });
  if (!normalized.ok) { const result = await normalized.json(); throw new Error(result.error || "本地数据校验失败"); }
  const encoded = [];
  const large = new Map<number, Awaited<ReturnType<typeof syncParts>>>();
  for (const [position, row] of rows.entries()) {
    validateSyncRow(row);
    const data = JSON.stringify(row.data);
    if (new TextEncoder().encode(data).length > 128000) large.set(position, await syncParts(row.table, data));
    encoded.push({ ...row, position, digest: large.get(position)?.digest || await syncDigest(`${row.table}\n${data}`) });
  }
  const id = crypto.randomUUID();
  const digest = await syncDigest(encoded.map(row => row.digest).join("\n"));
  await call({ phase: "begin", id, rowCount: rows.length, digest });
  state.progress = { ...state.progress, status: "uploading", total: rows.length };
  const batches: typeof encoded[] = [];
  let batch: typeof encoded = [], bytes = 0;
  for (const row of encoded) {
    const size = new TextEncoder().encode(JSON.stringify(row)).length;
    if (size > 1_900_000) throw new Error("单条档案超过数据库大小限制，未修改线上数据，请导出备份后检查");
    if (large.has(row.position)) {
      if (batch.length) { batches.push(batch); batch = []; bytes = 0; }
      batches.push([row]); continue;
    }
    if (batch.length && (bytes + size > 180000 || batch.length >= 20)) { batches.push(batch); batch = []; bytes = 0; }
    batch.push(row); bytes += size + 1;
  }
  if (batch.length) batches.push(batch);
  let cursor = 0;
  const uploads = await Promise.allSettled(Array.from({ length: 2 }, async () => {
    while (cursor < batches.length) {
      const chunk = batches[cursor++];
      const fragmented = large.get(chunk[0].position);
      if (fragmented) {
        const header = { id, position: chunk[0].position, table: chunk[0].table, rowDigest: fragmented.digest, partCount: fragmented.parts.length };
        for (let offset = 0; offset < fragmented.parts.length; offset += 2) await call({ ...header, phase: "parts", parts: fragmented.parts.slice(offset, offset + 2) });
        await call({ ...header, phase: "assemble" });
      } else await call({ phase: "chunk", id, rows: chunk });
      state.progress.uploaded += chunk.length;
    }
  }));
  const failed = uploads.find(result => result.status === "rejected");
  if (failed?.status === "rejected") throw failed.reason;
  state.progress.status = "committing";
  let receipt;
  try { receipt = await call({ phase: "commit", id }); }
  catch (error) {
    // Query the receipt instead of blindly repeating an uncertain commit.
    receipt = await call({ phase: "status", id }).catch(() => null);
    if (receipt?.status !== "applied") throw error;
  }
  if (receipt?.status !== "applied" || receipt.rowCount !== rows.length) throw new Error("未取得线上提交确认，请重试");
  state.fingerprint = `${target}:${fingerprint}`;
  state.progress = { status: "synced", uploaded: rows.length, total: rows.length, syncedAt: new Date().toISOString(), error: null };
}

export function enqueueCloudSync() {
  if (state.active) { state.again = true; return; }
  state.progress = { ...state.progress, status: "preparing", error: null };
  state.active = (async () => {
    do { state.again = false; await transferSnapshot(); } while (state.again);
  })().catch(error => {
    state.progress = { ...state.progress, status: "error", error: error instanceof Error ? error.message.slice(0, 240) : "同步失败，本地数据已保留" };
  }).finally(() => { state.active = null; });
}
