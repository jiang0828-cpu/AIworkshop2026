CREATE TABLE "SelfActionReview" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "profileId" TEXT NOT NULL,
  "actionId" TEXT NOT NULL,
  "result" TEXT NOT NULL,
  "adjustment" TEXT NOT NULL DEFAULT '',
  "deferred" BOOLEAN NOT NULL DEFAULT false,
  "applied" TEXT NOT NULL DEFAULT '[]',
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "SelfActionReview_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "Profile" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "SelfActionReview_profileId_actionId_key" ON "SelfActionReview"("profileId", "actionId");
