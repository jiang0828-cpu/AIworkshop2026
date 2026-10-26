CREATE TABLE IF NOT EXISTS "CloudSyncSession" (
  "id" TEXT PRIMARY KEY NOT NULL,
  "profileId" TEXT NOT NULL,
  "rowCount" INTEGER NOT NULL,
  "digest" TEXT NOT NULL,
  "baseline" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'uploading',
  "createdAt" INTEGER NOT NULL,
  "expiresAt" INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS "CloudSyncRow" (
  "sessionId" TEXT NOT NULL REFERENCES "CloudSyncSession"("id") ON DELETE CASCADE,
  "position" INTEGER NOT NULL,
  "tableName" TEXT NOT NULL,
  "rowId" TEXT NOT NULL,
  "data" TEXT NOT NULL,
  "digest" TEXT NOT NULL,
  PRIMARY KEY ("sessionId", "position"),
  UNIQUE ("sessionId", "tableName", "rowId")
);
CREATE INDEX IF NOT EXISTS "CloudSyncRow_table" ON "CloudSyncRow"("sessionId", "tableName");
