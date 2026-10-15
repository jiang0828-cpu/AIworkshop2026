-- AlterTable
ALTER TABLE "Decision" ADD COLUMN "goalId" TEXT;
ALTER TABLE "Decision" ADD COLUMN "sceneId" TEXT;
ALTER TABLE "Decision" ADD COLUMN "signalId" TEXT;
ALTER TABLE "Decision" ADD COLUMN "visionId" TEXT;

-- AlterTable
ALTER TABLE "Goal" ADD COLUMN "sceneId" TEXT;
ALTER TABLE "Goal" ADD COLUMN "visionId" TEXT;

-- AlterTable
ALTER TABLE "Project" ADD COLUMN "sceneId" TEXT;
ALTER TABLE "Project" ADD COLUMN "visionId" TEXT;

-- CreateTable
CREATE TABLE "WorkbenchScene" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "profileId" TEXT NOT NULL,
    "slot" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "WorkbenchScene_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "Profile" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "StrategyRecord" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "profileId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "sceneId" TEXT,
    "title" TEXT NOT NULL,
    "payload" TEXT NOT NULL,
    "archived" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "StrategyRecord_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "Profile" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "StrategyVersion" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "profileId" TEXT NOT NULL,
    "recordId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "snapshot" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "StrategyVersion_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "Profile" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "GoalRelation" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "profileId" TEXT NOT NULL,
    "fromId" TEXT NOT NULL,
    "toId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "evidence" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "GoalRelation_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "Profile" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "RecordSource" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "profileId" TEXT NOT NULL,
    "targetType" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "sourceType" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "sourceTitle" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "RecordSource_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "Profile" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "WorkbenchPin" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "profileId" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "taskKey" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    CONSTRAINT "WorkbenchPin_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "Profile" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "GoalBatch" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "profileId" TEXT NOT NULL,
    "payload" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "GoalBatch_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "Profile" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "WorkbenchScene_profileId_slot_key" ON "WorkbenchScene"("profileId", "slot");

-- CreateIndex
CREATE INDEX "StrategyRecord_profileId_kind_sceneId_idx" ON "StrategyRecord"("profileId", "kind", "sceneId");

-- CreateIndex
CREATE INDEX "StrategyVersion_profileId_recordId_createdAt_idx" ON "StrategyVersion"("profileId", "recordId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "GoalRelation_profileId_fromId_toId_kind_key" ON "GoalRelation"("profileId", "fromId", "toId", "kind");

-- CreateIndex
CREATE INDEX "RecordSource_profileId_targetId_idx" ON "RecordSource"("profileId", "targetId");

-- CreateIndex
CREATE UNIQUE INDEX "WorkbenchPin_profileId_date_taskKey_key" ON "WorkbenchPin"("profileId", "date", "taskKey");
