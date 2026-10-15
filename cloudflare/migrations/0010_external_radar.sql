CREATE TABLE "RadarRecord" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "profileId" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "sceneId" TEXT,
  "topicId" TEXT,
  "parentId" TEXT,
  "status" TEXT NOT NULL DEFAULT 'draft',
  "version" INTEGER NOT NULL DEFAULT 1,
  "payload" TEXT NOT NULL DEFAULT '{}',
  "originKey" TEXT,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX "RadarRecord_profileId_originKey_key" ON "RadarRecord"("profileId", "originKey");
CREATE INDEX "RadarRecord_profileId_kind_sceneId_createdAt_idx" ON "RadarRecord"("profileId", "kind", "sceneId", "createdAt");
CREATE INDEX "RadarRecord_profileId_parentId_idx" ON "RadarRecord"("profileId", "parentId");
