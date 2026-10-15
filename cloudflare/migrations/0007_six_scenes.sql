ALTER TABLE "Action" ADD COLUMN "sceneId" TEXT;
ALTER TABLE "DailyTask" ADD COLUMN "sceneId" TEXT;
-- Stable slots: work=0, finance=1, family=2, health=3, other=4, hobbies=5.
UPDATE "WorkbenchScene" SET "name"='工作' WHERE "slot"=0 AND "name"='职业'
  AND NOT EXISTS (SELECT 1 FROM "WorkbenchScene" s WHERE s."profileId"="WorkbenchScene"."profileId" AND s."slot"=5);
UPDATE "WorkbenchScene" SET "position"=CASE "slot" WHEN 3 THEN 0 WHEN 1 THEN 1 WHEN 0 THEN 2 WHEN 2 THEN 3 WHEN 4 THEN 5 ELSE "position" END
  WHERE NOT EXISTS (SELECT 1 FROM "WorkbenchScene" s WHERE s."profileId"="WorkbenchScene"."profileId" AND s."slot"=5);
INSERT OR IGNORE INTO "WorkbenchScene" ("id","profileId","slot","name","position","updatedAt")
  SELECT "id" || '-scene-4', "id", 4, '其他', 5, strftime('%s','now') * 1000 FROM "Profile";
INSERT OR IGNORE INTO "WorkbenchScene" ("id","profileId","slot","name","position","updatedAt")
  SELECT "id" || '-scene-5', "id", 5, '爱好', 4, strftime('%s','now') * 1000 FROM "Profile";
