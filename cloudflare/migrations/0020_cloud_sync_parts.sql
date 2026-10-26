CREATE TABLE IF NOT EXISTS "CloudSyncPart" (
  "sessionId" TEXT NOT NULL REFERENCES "CloudSyncSession"("id") ON DELETE CASCADE,
  "position" INTEGER NOT NULL,
  "partIndex" INTEGER NOT NULL,
  "tableName" TEXT NOT NULL,
  "rowDigest" TEXT NOT NULL,
  "partCount" INTEGER NOT NULL,
  "content" TEXT NOT NULL,
  "digest" TEXT NOT NULL,
  PRIMARY KEY ("sessionId", "position", "partIndex")
);
