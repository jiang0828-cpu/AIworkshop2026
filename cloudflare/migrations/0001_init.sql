-- CreateTable
CREATE TABLE "Profile" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL DEFAULT '',
    "ageRange" TEXT NOT NULL DEFAULT '',
    "birthYear" TEXT NOT NULL DEFAULT '',
    "genderIdentity" TEXT NOT NULL DEFAULT '',
    "city" TEXT NOT NULL DEFAULT '',
    "education" TEXT NOT NULL DEFAULT '',
    "major" TEXT NOT NULL DEFAULT '',
    "industry" TEXT NOT NULL DEFAULT '',
    "organization" TEXT NOT NULL DEFAULT '',
    "employmentStatus" TEXT NOT NULL DEFAULT '',
    "jobTitle" TEXT NOT NULL DEFAULT '',
    "stage" TEXT NOT NULL DEFAULT '',
    "roles" TEXT NOT NULL DEFAULT '',
    "responsibilities" TEXT NOT NULL DEFAULT '',
    "professionalFocus" TEXT NOT NULL DEFAULT '',
    "stageTransition" TEXT NOT NULL DEFAULT '',
    "currentPriorities" TEXT NOT NULL DEFAULT '',
    "stageNeeds" TEXT NOT NULL DEFAULT '',
    "currentChallenges" TEXT NOT NULL DEFAULT '',
    "directionOneToThreeYears" TEXT NOT NULL DEFAULT '',
    "successDefinition" TEXT NOT NULL DEFAULT '',
    "familyResponsibilities" TEXT NOT NULL DEFAULT '',
    "healthEnergy" TEXT NOT NULL DEFAULT '',
    "incomeRange" TEXT NOT NULL DEFAULT '',
    "financialPressure" TEXT NOT NULL DEFAULT '',
    "behaviorPatterns" TEXT NOT NULL DEFAULT '',
    "riskPreference" TEXT NOT NULL DEFAULT '',
    "sensitiveAiFields" TEXT NOT NULL DEFAULT '[]',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "Experience" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "profileId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "learning" TEXT NOT NULL DEFAULT '',
    "happenedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Experience_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "Profile" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Evidence" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "profileId" TEXT NOT NULL,
    "ability" TEXT NOT NULL,
    "evidence" TEXT NOT NULL,
    "confidence" INTEGER NOT NULL DEFAULT 3,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Evidence_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "Profile" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ValueRule" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "profileId" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "priority" INTEGER NOT NULL DEFAULT 3,
    "rule" TEXT NOT NULL DEFAULT '',
    "conflict" TEXT NOT NULL DEFAULT '',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ValueRule_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "Profile" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Resource" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "profileId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "category" TEXT NOT NULL DEFAULT '其他',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Resource_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "Profile" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Constraint" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "profileId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "severity" TEXT NOT NULL DEFAULT '中',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Constraint_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "Profile" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Assumption" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "profileId" TEXT NOT NULL,
    "statement" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT '待验证',
    "evidence" TEXT NOT NULL DEFAULT '',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Assumption_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "Profile" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Goal" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "profileId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "horizon" TEXT NOT NULL DEFAULT '90天',
    "status" TEXT NOT NULL DEFAULT '进行中',
    "metric" TEXT NOT NULL DEFAULT '',
    "deadline" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Goal_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "Profile" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Project" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "profileId" TEXT NOT NULL,
    "goalId" TEXT,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT '进行中',
    "metric" TEXT NOT NULL DEFAULT '',
    "budget" TEXT NOT NULL DEFAULT '',
    "boundary" TEXT NOT NULL DEFAULT '',
    "stopCondition" TEXT NOT NULL DEFAULT '',
    "risk" TEXT NOT NULL DEFAULT '',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Project_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "Profile" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Project_goalId_fkey" FOREIGN KEY ("goalId") REFERENCES "Goal" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Milestone" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "deadline" DATETIME,
    "status" TEXT NOT NULL DEFAULT '未开始',
    "metric" TEXT NOT NULL DEFAULT '',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Milestone_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Action" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "profileId" TEXT NOT NULL,
    "goalId" TEXT,
    "projectId" TEXT,
    "title" TEXT NOT NULL,
    "purpose" TEXT NOT NULL DEFAULT '',
    "dueDate" DATETIME,
    "estimatedHours" REAL NOT NULL DEFAULT 1,
    "standard" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT '待开始',
    "completedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Action_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "Profile" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Action_goalId_fkey" FOREIGN KEY ("goalId") REFERENCES "Goal" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Action_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Review" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "profileId" TEXT NOT NULL,
    "periodStart" DATETIME NOT NULL,
    "periodEnd" DATETIME NOT NULL,
    "wins" TEXT NOT NULL DEFAULT '',
    "goalIssue" TEXT NOT NULL DEFAULT '',
    "strategyIssue" TEXT NOT NULL DEFAULT '',
    "executionIssue" TEXT NOT NULL DEFAULT '',
    "externalIssue" TEXT NOT NULL DEFAULT '',
    "adjustment" TEXT NOT NULL DEFAULT '',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Review_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "Profile" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Decision" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "profileId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "context" TEXT NOT NULL DEFAULT '',
    "criteria" TEXT NOT NULL DEFAULT '',
    "facts" TEXT NOT NULL DEFAULT '',
    "assumptions" TEXT NOT NULL DEFAULT '',
    "gaps" TEXT NOT NULL DEFAULT '',
    "selectedOption" TEXT NOT NULL DEFAULT '',
    "rationale" TEXT NOT NULL DEFAULT '',
    "risk" TEXT NOT NULL DEFAULT '',
    "reversible" BOOLEAN NOT NULL DEFAULT true,
    "reviewDate" DATETIME,
    "resultReview" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT '待决定',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Decision_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "Profile" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "DecisionOption" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "decisionId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "benefit" TEXT NOT NULL DEFAULT '',
    "cost" TEXT NOT NULL DEFAULT '',
    "risk" TEXT NOT NULL DEFAULT '',
    "score" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "DecisionOption_decisionId_fkey" FOREIGN KEY ("decisionId") REFERENCES "Decision" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AIInstruction" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "profileId" TEXT NOT NULL,
    "language" TEXT NOT NULL DEFAULT '中文',
    "answerLength" TEXT NOT NULL DEFAULT '适中',
    "structure" TEXT NOT NULL DEFAULT '先结论，后依据',
    "aiRole" TEXT NOT NULL DEFAULT '提问者、分析者和记录助手',
    "delegate" TEXT NOT NULL DEFAULT '',
    "mustConfirm" TEXT NOT NULL DEFAULT '重要目标、决策和对外行动',
    "privacyOptions" TEXT NOT NULL DEFAULT '姓名和联系方式脱敏',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "AIInstruction_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "Profile" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AISuggestion" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "profileId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT '规则模板',
    "status" TEXT NOT NULL DEFAULT '待确认',
    "sentScope" TEXT NOT NULL DEFAULT '',
    "targetType" TEXT NOT NULL DEFAULT '',
    "targetId" TEXT NOT NULL DEFAULT '',
    "payload" TEXT NOT NULL DEFAULT '',
    "sourceTaskId" TEXT,
    "sourceFeedbackId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "AISuggestion_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "Profile" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "AISuggestion_sourceTaskId_fkey" FOREIGN KEY ("sourceTaskId") REFERENCES "AITask" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "AISuggestion_sourceFeedbackId_fkey" FOREIGN KEY ("sourceFeedbackId") REFERENCES "AITaskFeedback" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "IdentityCard" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "profileId" TEXT NOT NULL,
    "currentVersion" INTEGER NOT NULL DEFAULT 0,
    "lengthMode" TEXT NOT NULL DEFAULT '标准',
    "structuredData" TEXT NOT NULL DEFAULT '{}',
    "markdown" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT '草稿',
    "source" TEXT NOT NULL DEFAULT '确定性模板',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "IdentityCard_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "Profile" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "IdentityCardVersion" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "profileId" TEXT NOT NULL,
    "cardId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "lengthMode" TEXT NOT NULL,
    "structuredData" TEXT NOT NULL,
    "markdown" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT '确定性模板',
    "status" TEXT NOT NULL DEFAULT '草稿',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "IdentityCardVersion_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "Profile" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "IdentityCardVersion_cardId_fkey" FOREIGN KEY ("cardId") REFERENCES "IdentityCard" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ContextPackage" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "profileId" TEXT NOT NULL,
    "packageNumber" INTEGER NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "domain" TEXT NOT NULL,
    "customDomain" TEXT NOT NULL DEFAULT '',
    "goalId" TEXT,
    "projectId" TEXT,
    "aiRole" TEXT NOT NULL,
    "scope" TEXT NOT NULL DEFAULT '标准',
    "options" TEXT NOT NULL DEFAULT '{}',
    "privacyOptions" TEXT NOT NULL DEFAULT '',
    "snapshot" TEXT NOT NULL DEFAULT '{}',
    "markdown" TEXT NOT NULL DEFAULT '',
    "plainText" TEXT NOT NULL DEFAULT '',
    "charCount" INTEGER NOT NULL DEFAULT 0,
    "tokenEstimate" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ContextPackage_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "Profile" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ContextPackage_goalId_fkey" FOREIGN KEY ("goalId") REFERENCES "Goal" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "ContextPackage_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ContextPackageItem" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "contextPackageId" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "sourceType" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL DEFAULT '',
    "sourceLabel" TEXT NOT NULL DEFAULT '',
    "sourceDocumentKey" TEXT NOT NULL DEFAULT '',
    "sourceVersion" TEXT NOT NULL DEFAULT '',
    "priority" INTEGER NOT NULL DEFAULT 0,
    "included" BOOLEAN NOT NULL DEFAULT true,
    "excluded" BOOLEAN NOT NULL DEFAULT false,
    "redacted" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ContextPackageItem_contextPackageId_fkey" FOREIGN KEY ("contextPackageId") REFERENCES "ContextPackage" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ContextSourceReference" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "contextPackageId" TEXT NOT NULL,
    "contextPackageItemId" TEXT,
    "sourceType" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL DEFAULT '',
    "sourceLabel" TEXT NOT NULL,
    "sourceDocumentKey" TEXT NOT NULL DEFAULT '',
    "sourceVersion" TEXT NOT NULL DEFAULT '',
    "snapshot" TEXT NOT NULL DEFAULT '',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ContextSourceReference_contextPackageId_fkey" FOREIGN KEY ("contextPackageId") REFERENCES "ContextPackage" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AITask" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "profileId" TEXT NOT NULL,
    "contextPackageId" TEXT,
    "goalId" TEXT,
    "projectId" TEXT,
    "title" TEXT NOT NULL,
    "taskType" TEXT NOT NULL,
    "problem" TEXT NOT NULL DEFAULT '',
    "whyNow" TEXT NOT NULL DEFAULT '',
    "aiRole" TEXT NOT NULL,
    "permission" TEXT NOT NULL DEFAULT 'L1',
    "permissionOverrideReason" TEXT NOT NULL DEFAULT '',
    "instructions" TEXT NOT NULL DEFAULT '',
    "deliverables" TEXT NOT NULL DEFAULT '',
    "outputFormat" TEXT NOT NULL DEFAULT '',
    "deadline" DATETIME,
    "acceptanceCriteria" TEXT NOT NULL DEFAULT '',
    "allowedOperations" TEXT NOT NULL DEFAULT '',
    "mustConfirmOperations" TEXT NOT NULL DEFAULT '',
    "forbiddenOperations" TEXT NOT NULL DEFAULT '',
    "riskLevel" TEXT NOT NULL DEFAULT '低',
    "requireUnderstandingCheck" BOOLEAN NOT NULL DEFAULT false,
    "status" TEXT NOT NULL DEFAULT '草稿',
    "promptSnapshot" TEXT NOT NULL DEFAULT '',
    "contextSnapshot" TEXT NOT NULL DEFAULT '',
    "privacyPreview" TEXT NOT NULL DEFAULT '',
    "auditLog" TEXT NOT NULL DEFAULT '[]',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "AITask_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "Profile" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "AITask_contextPackageId_fkey" FOREIGN KEY ("contextPackageId") REFERENCES "ContextPackage" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "AITask_goalId_fkey" FOREIGN KEY ("goalId") REFERENCES "Goal" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "AITask_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AITaskFeedback" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "taskId" TEXT NOT NULL,
    "understandingScore" INTEGER,
    "constraintScore" INTEGER,
    "executableScore" INTEGER,
    "correctContent" TEXT NOT NULL DEFAULT '',
    "incorrectContent" TEXT NOT NULL DEFAULT '',
    "missingInformation" TEXT NOT NULL DEFAULT '',
    "violatedConstraints" TEXT NOT NULL DEFAULT '',
    "adopted" BOOLEAN NOT NULL DEFAULT false,
    "actualAction" TEXT NOT NULL DEFAULT '',
    "actualResult" TEXT NOT NULL DEFAULT '',
    "correctionRequest" TEXT NOT NULL DEFAULT '',
    "preferenceUpdate" TEXT NOT NULL DEFAULT '',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "AITaskFeedback_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "AITask" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "CorrectionRecord" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "profileId" TEXT NOT NULL,
    "feedbackId" TEXT,
    "category" TEXT NOT NULL,
    "target" TEXT NOT NULL DEFAULT '',
    "content" TEXT NOT NULL,
    "priority" INTEGER NOT NULL DEFAULT 1,
    "status" TEXT NOT NULL DEFAULT '已确认',
    "source" TEXT NOT NULL DEFAULT '用户确认',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "CorrectionRecord_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "Profile" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "CorrectionRecord_feedbackId_fkey" FOREIGN KEY ("feedbackId") REFERENCES "AITaskFeedback" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "DocumentVersion" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "profileId" TEXT NOT NULL,
    "documentKey" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT '结构化数据',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "DocumentVersion_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "Profile" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "AIInstruction_profileId_key" ON "AIInstruction"("profileId");

-- CreateIndex
CREATE UNIQUE INDEX "IdentityCard_profileId_key" ON "IdentityCard"("profileId");

-- CreateIndex
CREATE INDEX "IdentityCardVersion_profileId_createdAt_idx" ON "IdentityCardVersion"("profileId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "IdentityCardVersion_cardId_version_key" ON "IdentityCardVersion"("cardId", "version");

-- CreateIndex
CREATE INDEX "ContextPackage_profileId_createdAt_idx" ON "ContextPackage"("profileId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ContextPackage_profileId_packageNumber_key" ON "ContextPackage"("profileId", "packageNumber");

-- CreateIndex
CREATE INDEX "ContextPackageItem_contextPackageId_priority_idx" ON "ContextPackageItem"("contextPackageId", "priority");

-- CreateIndex
CREATE INDEX "ContextSourceReference_contextPackageId_idx" ON "ContextSourceReference"("contextPackageId");

-- CreateIndex
CREATE INDEX "AITask_profileId_status_updatedAt_idx" ON "AITask"("profileId", "status", "updatedAt");

-- CreateIndex
CREATE INDEX "AITaskFeedback_taskId_createdAt_idx" ON "AITaskFeedback"("taskId", "createdAt");

-- CreateIndex
CREATE INDEX "CorrectionRecord_profileId_status_updatedAt_idx" ON "CorrectionRecord"("profileId", "status", "updatedAt");

-- CreateIndex
CREATE INDEX "DocumentVersion_profileId_documentKey_createdAt_idx" ON "DocumentVersion"("profileId", "documentKey", "createdAt");

