CREATE TABLE "ResearchBatch" (
 "id" TEXT NOT NULL PRIMARY KEY, "profileId" TEXT NOT NULL, "sceneId" TEXT,
 "question" TEXT NOT NULL, "background" TEXT NOT NULL, "queries" TEXT NOT NULL,
 "days" INTEGER NOT NULL DEFAULT 30, "online" BOOLEAN NOT NULL DEFAULT true,
 "previousId" TEXT, "status" TEXT NOT NULL DEFAULT 'queued', "phase" INTEGER NOT NULL DEFAULT 0,
 "version" INTEGER NOT NULL DEFAULT 1, "slot" INTEGER, "leaseToken" TEXT, "leaseUntil" DATETIME,
 "sources" TEXT NOT NULL DEFAULT '[]', "conclusions" TEXT NOT NULL DEFAULT '[]',
 "gaps" TEXT NOT NULL DEFAULT '', "changes" TEXT NOT NULL DEFAULT '', "calls" TEXT NOT NULL DEFAULT '[]',
 "error" TEXT NOT NULL DEFAULT '', "followUpDate" TEXT,
 "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" DATETIME NOT NULL,
 CONSTRAINT "ResearchBatch_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "Profile" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "ResearchBatch_slot_key" ON "ResearchBatch"("slot");
CREATE INDEX "ResearchBatch_profileId_status_createdAt_idx" ON "ResearchBatch"("profileId","status","createdAt");
