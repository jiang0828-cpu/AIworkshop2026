ALTER TABLE "Project" ADD COLUMN "recordCode" TEXT;
ALTER TABLE "Project" ADD COLUMN "deadline" DATETIME;
ALTER TABLE "Action" ADD COLUMN "recordCode" TEXT;

-- Number allocation is shared by every creation path, including raw SQL and imports.
CREATE TABLE IF NOT EXISTS "RecordNumberSequence" ("prefix" TEXT PRIMARY KEY NOT NULL, "value" INTEGER NOT NULL);
CREATE UNIQUE INDEX IF NOT EXISTS "Project_recordCode_key" ON "Project"("recordCode");
CREATE UNIQUE INDEX IF NOT EXISTS "Action_recordCode_key" ON "Action"("recordCode");

WITH pending AS MATERIALIZED (
  SELECT id, createdAt,
    CASE WHEN typeof(createdAt) IN ('integer','real') THEN strftime('%Y%m%d',createdAt/1000.0,'unixepoch','+8 hours') ELSE strftime('%Y%m%d',createdAt,'+8 hours') END || 'A' AS prefix
  FROM Project WHERE recordCode IS NULL
), numbered AS MATERIALIZED (
  SELECT id,prefix,row_number() OVER (PARTITION BY prefix ORDER BY createdAt,id) +
    (SELECT coalesce(max(cast(substr(p.recordCode,10) AS INTEGER)),0) FROM Project p WHERE substr(p.recordCode,1,9)=pending.prefix) AS number FROM pending
)
UPDATE Project SET recordCode=(SELECT prefix || printf('%02d',number) FROM numbered WHERE numbered.id=Project.id) WHERE recordCode IS NULL;

WITH pending AS MATERIALIZED (
  SELECT id, createdAt,
    CASE WHEN typeof(createdAt) IN ('integer','real') THEN strftime('%Y%m%d',createdAt/1000.0,'unixepoch','+8 hours') ELSE strftime('%Y%m%d',createdAt,'+8 hours') END || 'B' AS prefix
  FROM Action WHERE recordCode IS NULL
), numbered AS MATERIALIZED (
  SELECT id,prefix,row_number() OVER (PARTITION BY prefix ORDER BY createdAt,id) +
    (SELECT coalesce(max(cast(substr(a.recordCode,10) AS INTEGER)),0) FROM Action a WHERE substr(a.recordCode,1,9)=pending.prefix) AS number FROM pending
)
UPDATE Action SET recordCode=(SELECT prefix || printf('%02d',number) FROM numbered WHERE numbered.id=Action.id) WHERE recordCode IS NULL;

INSERT INTO RecordNumberSequence(prefix,value)
SELECT substr(recordCode,1,9),max(cast(substr(recordCode,10) AS INTEGER)) FROM Project WHERE recordCode IS NOT NULL GROUP BY substr(recordCode,1,9)
ON CONFLICT(prefix) DO UPDATE SET value=max(value,excluded.value);
INSERT INTO RecordNumberSequence(prefix,value)
SELECT substr(recordCode,1,9),max(cast(substr(recordCode,10) AS INTEGER)) FROM Action WHERE recordCode IS NOT NULL GROUP BY substr(recordCode,1,9)
ON CONFLICT(prefix) DO UPDATE SET value=max(value,excluded.value);

-- Spaces before CASE are required by Wrangler's compound-statement splitter.
CREATE TRIGGER IF NOT EXISTS "Project_assign_recordCode" AFTER INSERT ON "Project" WHEN NEW.recordCode IS NULL
BEGIN
  INSERT INTO RecordNumberSequence(prefix,value)
  SELECT prefix,(SELECT coalesce(max(cast(substr(recordCode,10) AS INTEGER)),0)+1 FROM Project WHERE substr(recordCode,1,9)=prefix)
  FROM (SELECT CASE WHEN typeof(NEW.createdAt) IN ('integer','real') THEN strftime('%Y%m%d',NEW.createdAt/1000.0,'unixepoch','+8 hours') ELSE strftime('%Y%m%d',NEW.createdAt,'+8 hours') END || 'A' AS prefix)
  WHERE true ON CONFLICT(prefix) DO UPDATE SET value=max(value+1,excluded.value);
  UPDATE Project SET recordCode=(SELECT prefix || printf('%02d',value) FROM RecordNumberSequence WHERE prefix = CASE WHEN typeof(NEW.createdAt) IN ('integer','real') THEN strftime('%Y%m%d',NEW.createdAt/1000.0,'unixepoch','+8 hours') ELSE strftime('%Y%m%d',NEW.createdAt,'+8 hours') END || 'A') WHERE id=NEW.id;
END;

CREATE TRIGGER IF NOT EXISTS "Action_assign_recordCode" AFTER INSERT ON "Action" WHEN NEW.recordCode IS NULL
BEGIN
  INSERT INTO RecordNumberSequence(prefix,value)
  SELECT prefix,(SELECT coalesce(max(cast(substr(recordCode,10) AS INTEGER)),0)+1 FROM Action WHERE substr(recordCode,1,9)=prefix)
  FROM (SELECT CASE WHEN typeof(NEW.createdAt) IN ('integer','real') THEN strftime('%Y%m%d',NEW.createdAt/1000.0,'unixepoch','+8 hours') ELSE strftime('%Y%m%d',NEW.createdAt,'+8 hours') END || 'B' AS prefix)
  WHERE true ON CONFLICT(prefix) DO UPDATE SET value=max(value+1,excluded.value);
  UPDATE Action SET recordCode=(SELECT prefix || printf('%02d',value) FROM RecordNumberSequence WHERE prefix = CASE WHEN typeof(NEW.createdAt) IN ('integer','real') THEN strftime('%Y%m%d',NEW.createdAt/1000.0,'unixepoch','+8 hours') ELSE strftime('%Y%m%d',NEW.createdAt,'+8 hours') END || 'B') WHERE id=NEW.id;
END;

-- Only use dates already recorded by the user; undated projects stay pending.
UPDATE Project SET deadline=(SELECT max(value) FROM (
  SELECT deadline AS value FROM Milestone WHERE projectId=Project.id
  UNION ALL SELECT dueDate AS value FROM Action WHERE projectId=Project.id
)) WHERE deadline IS NULL;
