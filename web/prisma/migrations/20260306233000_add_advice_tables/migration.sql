-- CreateTable
CREATE TABLE "advice_snapshots" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "summary" TEXT NOT NULL,
    "confidence" REAL NOT NULL,
    "triggerScore" REAL NOT NULL,
    "triggerReason" TEXT NOT NULL,
    "sourceEvent" TEXT NOT NULL,
    "metricsFingerprint" TEXT NOT NULL,
    "actionItems" TEXT NOT NULL,
    "rawResponse" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "advice_decisions" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sourceEvent" TEXT NOT NULL,
    "sourceTaskId" TEXT,
    "sourceVulnerabilityId" TEXT,
    "triggerScore" REAL NOT NULL,
    "triggerReason" TEXT NOT NULL,
    "metricsFingerprint" TEXT NOT NULL,
    "shouldCallAi" BOOLEAN NOT NULL DEFAULT false,
    "calledAi" BOOLEAN NOT NULL DEFAULT false,
    "blockedReason" TEXT,
    "llmError" TEXT,
    "metricSnapshot" TEXT NOT NULL,
    "adviceSnapshotId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "advice_decisions_adviceSnapshotId_fkey" FOREIGN KEY ("adviceSnapshotId") REFERENCES "advice_snapshots" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "advice_snapshots_createdAt_idx" ON "advice_snapshots"("createdAt" DESC);

-- CreateIndex
CREATE INDEX "advice_decisions_createdAt_idx" ON "advice_decisions"("createdAt" DESC);

-- CreateIndex
CREATE INDEX "advice_decisions_calledAi_createdAt_idx" ON "advice_decisions"("calledAi", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "advice_decisions_sourceEvent_createdAt_idx" ON "advice_decisions"("sourceEvent", "createdAt" DESC);
