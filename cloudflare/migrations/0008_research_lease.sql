-- D1 dates may be returned/bound as ISO text. Lease comparisons use integers.
ALTER TABLE "ResearchBatch" ADD COLUMN "leaseUntilSeconds" INTEGER;
UPDATE "ResearchBatch" SET "status"='failed', "error"='调度器升级中断，已保存资料；请确认用量后手动重试', "slot"=NULL, "leaseToken"=NULL, "leaseUntil"=NULL WHERE "slot" IS NOT NULL;
