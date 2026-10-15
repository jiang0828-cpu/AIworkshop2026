CREATE TABLE IF NOT EXISTS "ExecutionPlan" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "profileId" TEXT NOT NULL,
  "revision" INTEGER NOT NULL DEFAULT 1,
  "status" TEXT NOT NULL DEFAULT 'draft',
  "snapshot" TEXT NOT NULL,
  "fingerprint" TEXT NOT NULL,
  "payload" TEXT NOT NULL,
  "leaseToken" TEXT,
  "leaseUntil" DATETIME,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL
);
CREATE INDEX IF NOT EXISTS "ExecutionPlan_profileId_status_idx" ON "ExecutionPlan"("profileId", "status");
