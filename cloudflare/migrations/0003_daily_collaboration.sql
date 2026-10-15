-- CreateTable
CREATE TABLE "DailyPlan" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "profileId" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "input" TEXT NOT NULL DEFAULT '',
    "source" TEXT NOT NULL DEFAULT '规则编排',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "DailyPlan_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "Profile" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "DailyTask" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "planId" TEXT NOT NULL,
    "actionId" TEXT,
    "title" TEXT NOT NULL,
    "lane" TEXT NOT NULL,
    "priority" INTEGER NOT NULL DEFAULT 2,
    "dueAt" DATETIME,
    "notes" TEXT NOT NULL DEFAULT '',
    "result" TEXT NOT NULL DEFAULT '',
    "completedAt" DATETIME,
    "syncedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "DailyTask_planId_fkey" FOREIGN KEY ("planId") REFERENCES "DailyPlan" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "DailyTask_actionId_fkey" FOREIGN KEY ("actionId") REFERENCES "Action" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "DailyStep" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "taskId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "assignee" TEXT NOT NULL,
    "agentId" TEXT,
    "estimatedMinutes" INTEGER NOT NULL DEFAULT 15,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "notes" TEXT NOT NULL DEFAULT '',
    "result" TEXT NOT NULL DEFAULT '',
    "blockedReason" TEXT NOT NULL DEFAULT '',
    "attempt" INTEGER NOT NULL DEFAULT 0,
    "currentRunId" TEXT,
    "completedAt" DATETIME,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "DailyStep_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "DailyTask" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "DailyStep_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "DailyAgent" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "DailyCheckpoint" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "taskId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "dueAt" DATETIME NOT NULL,
    "done" BOOLEAN NOT NULL DEFAULT false,
    CONSTRAINT "DailyCheckpoint_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "DailyTask" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "DailyAgent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "profileId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "model" TEXT NOT NULL DEFAULT '',
    "prompt" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "timeoutSeconds" INTEGER NOT NULL DEFAULT 120,
    CONSTRAINT "DailyAgent_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "Profile" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "DailyRun" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "stepId" TEXT NOT NULL,
    "attempt" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "slot" INTEGER,
    "leaseToken" TEXT,
    "leaseExpiresAt" DATETIME,
    "leaseUntilSeconds" INTEGER,
    "input" TEXT NOT NULL,
    "config" TEXT NOT NULL,
    "output" TEXT NOT NULL DEFAULT '',
    "error" TEXT NOT NULL DEFAULT '',
    "durationMs" INTEGER NOT NULL DEFAULT 0,
    "promptTokens" INTEGER,
    "completionTokens" INTEGER,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" DATETIME,
    "finishedAt" DATETIME,
    CONSTRAINT "DailyRun_stepId_fkey" FOREIGN KEY ("stepId") REFERENCES "DailyStep" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "DailyTimer" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "stepId" TEXT NOT NULL,
    "startedAt" DATETIME NOT NULL,
    "endedAt" DATETIME,
    CONSTRAINT "DailyTimer_stepId_fkey" FOREIGN KEY ("stepId") REFERENCES "DailyStep" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "DailyReport" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "planId" TEXT NOT NULL,
    "metrics" TEXT NOT NULL,
    "markdown" TEXT NOT NULL,
    "reflection" TEXT NOT NULL DEFAULT '',
    "generatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "DailyReport_planId_fkey" FOREIGN KEY ("planId") REFERENCES "DailyPlan" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "DailyControl" (
    "profileId" TEXT NOT NULL PRIMARY KEY,
    "heartbeat" DATETIME,
    "maintenance" BOOLEAN NOT NULL DEFAULT false,
    "maintenanceUntil" DATETIME,
    "maintenanceToken" TEXT,
    CONSTRAINT "DailyControl_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "Profile" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "DailyPlan_profileId_date_key" ON "DailyPlan"("profileId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "DailyTask_planId_actionId_key" ON "DailyTask"("planId", "actionId");

-- CreateIndex
CREATE UNIQUE INDEX "DailyStep_taskId_position_key" ON "DailyStep"("taskId", "position");

-- CreateIndex
CREATE UNIQUE INDEX "DailyRun_slot_key" ON "DailyRun"("slot");

-- CreateIndex
CREATE INDEX "DailyRun_status_createdAt_idx" ON "DailyRun"("status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "DailyRun_stepId_attempt_key" ON "DailyRun"("stepId", "attempt");

-- CreateIndex
CREATE UNIQUE INDEX "DailyReport_planId_key" ON "DailyReport"("planId");

