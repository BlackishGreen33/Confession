-- CreateTable
CREATE TABLE "vulnerabilities" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "filePath" TEXT NOT NULL,
    "line" INTEGER NOT NULL,
    "column" INTEGER NOT NULL,
    "endLine" INTEGER NOT NULL,
    "endColumn" INTEGER NOT NULL,
    "codeSnippet" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "cweId" TEXT,
    "severity" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "riskDescription" TEXT,
    "fixOldCode" TEXT,
    "fixNewCode" TEXT,
    "fixExplanation" TEXT,
    "aiModel" TEXT,
    "aiConfidence" REAL,
    "aiReasoning" TEXT,
    "humanStatus" TEXT NOT NULL DEFAULT 'pending',
    "humanComment" TEXT,
    "humanReviewedAt" DATETIME,
    "owaspCategory" TEXT,
    "status" TEXT NOT NULL DEFAULT 'open',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "scan_tasks" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "progress" REAL NOT NULL DEFAULT 0,
    "totalFiles" INTEGER NOT NULL DEFAULT 0,
    "scannedFiles" INTEGER NOT NULL DEFAULT 0,
    "errorMessage" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE INDEX "vulnerabilities_status_idx" ON "vulnerabilities"("status");

-- CreateIndex
CREATE INDEX "vulnerabilities_severity_idx" ON "vulnerabilities"("severity");

-- CreateIndex
CREATE INDEX "vulnerabilities_filePath_idx" ON "vulnerabilities"("filePath");

-- CreateIndex
CREATE UNIQUE INDEX "vulnerabilities_filePath_line_column_codeHash_type_key" ON "vulnerabilities"("filePath", "line", "column", "codeHash", "type");
