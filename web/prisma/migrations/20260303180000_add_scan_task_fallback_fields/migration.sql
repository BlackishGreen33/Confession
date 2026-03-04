ALTER TABLE "scan_tasks" ADD COLUMN "fallbackUsed" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "scan_tasks" ADD COLUMN "fallbackFrom" TEXT;
ALTER TABLE "scan_tasks" ADD COLUMN "fallbackTo" TEXT;
ALTER TABLE "scan_tasks" ADD COLUMN "fallbackReason" TEXT;
