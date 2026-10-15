ALTER TABLE "DailyAgent" ADD COLUMN "capabilities" TEXT NOT NULL DEFAULT '{}';
CREATE TABLE "DailyAsset" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "profileId" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT NOT NULL DEFAULT '',
  "instructions" TEXT NOT NULL DEFAULT '',
  "adapter" TEXT NOT NULL DEFAULT 'guidance',
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "builtin" BOOLEAN NOT NULL DEFAULT false,
  CONSTRAINT "DailyAsset_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "Profile" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "DailyAsset_profileId_kind_idx" ON "DailyAsset"("profileId", "kind");
