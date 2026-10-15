-- Keep the D1 schema aligned with the local SQLite schema after the initial release.
ALTER TABLE "Goal" ADD COLUMN "parentId" TEXT;

CREATE TABLE "SituationAssessment" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "profileId" TEXT NOT NULL,
    "todayStatus" TEXT NOT NULL DEFAULT '',
    "todaySignals" TEXT NOT NULL DEFAULT '',
    "todayJudgement" TEXT NOT NULL DEFAULT '',
    "keyEvents" TEXT NOT NULL DEFAULT '',
    "keyEventAnalysis" TEXT NOT NULL DEFAULT '',
    "trendRadar" TEXT NOT NULL DEFAULT '',
    "trendStage" TEXT NOT NULL DEFAULT '',
    "trendScenarios" TEXT NOT NULL DEFAULT '',
    "enterpriseImpact" TEXT NOT NULL DEFAULT '',
    "enterpriseActions" TEXT NOT NULL DEFAULT '',
    "personalImpact" TEXT NOT NULL DEFAULT '',
    "personalActions" TEXT NOT NULL DEFAULT '',
    "sourceNotes" TEXT NOT NULL DEFAULT '',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "SituationAssessment_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "Profile" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "SituationAssessment_profileId_key" ON "SituationAssessment"("profileId");

CREATE TABLE "SituationItem" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "profileId" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL DEFAULT '',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "SituationItem_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "Profile" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "SituationItem_profileId_category_updatedAt_idx" ON "SituationItem"("profileId", "category", "updatedAt");
