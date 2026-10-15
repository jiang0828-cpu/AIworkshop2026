ALTER TABLE "Project" ADD COLUMN "parentId" TEXT REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Action" ADD COLUMN "parentId" TEXT REFERENCES "Action"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "Project_profileId_parentId_idx" ON "Project"("profileId", "parentId");
CREATE INDEX "Action_profileId_parentId_idx" ON "Action"("profileId", "parentId");
