ALTER TABLE "scan_tasks" ADD COLUMN "engineMode" TEXT NOT NULL DEFAULT 'baseline';
ALTER TABLE "scan_tasks" ADD COLUMN "errorCode" TEXT;

CREATE INDEX "scan_tasks_engineMode_updatedAt_idx" ON "scan_tasks"("engineMode", "updatedAt" DESC);
