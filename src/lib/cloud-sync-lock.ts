import type { D1Database } from "@cloudflare/workers-types";
import { PROFILE_ID } from "./profile-id";
import { SyncConflict } from "./cloud-sync-protocol";

// Same maintenance lease and idle checks as withDailyLock, without loading Prisma in the transport Worker.
export async function withCloudSyncLock<T>(db: D1Database, callback: () => Promise<T>) {
  await db.prepare('INSERT INTO "DailyControl" (profileId) SELECT id FROM Profile WHERE id=? ON CONFLICT(profileId) DO NOTHING').bind(PROFILE_ID).run();
  const token = crypto.randomUUID();
  const lease = new Date(Date.now() + 600000).toISOString().replace("Z", "+00:00");
  const acquired = await db.prepare('UPDATE "DailyControl" SET maintenance=1,maintenanceToken=?,maintenanceUntil=? WHERE profileId=? AND (maintenance=0 OR (CASE WHEN typeof(maintenanceUntil) IN (\'integer\',\'real\') THEN maintenanceUntil ELSE (julianday(maintenanceUntil)-2440587.5)*86400000 END)<?)')
    .bind(token, lease, PROFILE_ID, Date.now()).run();
  if (!acquired.meta.changes) throw new SyncConflict("任务数据正在更新，请稍后重试");
  try {
    const active = await db.batch([
      db.prepare('SELECT id FROM "ExecutionPlan" WHERE profileId=? AND (CASE WHEN typeof(leaseUntil) IN (\'integer\',\'real\') THEN leaseUntil ELSE (julianday(leaseUntil)-2440587.5)*86400000 END)>? LIMIT 1').bind(PROFILE_ID, Date.now()),
      db.prepare('SELECT id FROM "ResearchBatch" WHERE profileId=? AND slot IS NOT NULL LIMIT 1').bind(PROFILE_ID),
      db.prepare('SELECT r.id FROM "DailyRun" r JOIN "DailyStep" s ON s.id=r.stepId JOIN "DailyTask" t ON t.id=s.taskId JOIN "DailyPlan" p ON p.id=t.planId WHERE p.profileId=? AND r.slot IS NOT NULL LIMIT 1').bind(PROFILE_ID),
      db.prepare('SELECT s.id FROM "DailyStep" s JOIN "DailyTask" t ON t.id=s.taskId JOIN "DailyPlan" p ON p.id=t.planId WHERE p.profileId=? AND s.status IN (\'running\',\'preparing\') LIMIT 1').bind(PROFILE_ID),
    ]);
    if (active.some(result => result.results.length)) throw new SyncConflict("存在运行中任务，请暂停人工任务并等待 AI 执行结束后再同步");
    return await callback();
  } finally {
    await db.prepare('UPDATE "DailyControl" SET maintenance=0,maintenanceToken=NULL,maintenanceUntil=NULL WHERE profileId=? AND maintenanceToken=?').bind(PROFILE_ID, token).run();
  }
}
