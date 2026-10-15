-- Append a stable scene without changing existing names, IDs or ordering.
INSERT OR IGNORE INTO "WorkbenchScene" ("id","profileId","slot","name","position","updatedAt")
SELECT p."id" || '-scene-6', p."id", 6, '系统',
  COALESCE((SELECT MAX(s."position") + 1 FROM "WorkbenchScene" s WHERE s."profileId"=p."id"), 0),
  strftime('%s','now') * 1000
FROM "Profile" p;
