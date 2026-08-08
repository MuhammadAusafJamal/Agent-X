/*
  Warnings:

  - Added the required column `fingerprint` to the `BugReport` table without a default value. This is not possible if the table is not empty.

*/
-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_BugReport" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "executionId" TEXT NOT NULL,
    "executionStepId" TEXT,
    "title" TEXT NOT NULL,
    "severity" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "reproSteps" TEXT NOT NULL,
    "expected" TEXT NOT NULL,
    "actual" TEXT NOT NULL,
    "evidenceRefs" TEXT NOT NULL DEFAULT '[]',
    "status" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "occurrences" INTEGER NOT NULL DEFAULT 1,
    "lastSeenAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "BugReport_executionId_fkey" FOREIGN KEY ("executionId") REFERENCES "Execution" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "BugReport_executionStepId_fkey" FOREIGN KEY ("executionStepId") REFERENCES "ExecutionStep" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_BugReport" ("actual", "createdAt", "evidenceRefs", "executionId", "executionStepId", "expected", "id", "reproSteps", "severity", "status", "summary", "title", "updatedAt") SELECT "actual", "createdAt", "evidenceRefs", "executionId", "executionStepId", "expected", "id", "reproSteps", "severity", "status", "summary", "title", "updatedAt" FROM "BugReport";
DROP TABLE "BugReport";
ALTER TABLE "new_BugReport" RENAME TO "BugReport";
CREATE INDEX "BugReport_executionId_idx" ON "BugReport"("executionId");
CREATE INDEX "BugReport_status_idx" ON "BugReport"("status");
CREATE INDEX "BugReport_fingerprint_idx" ON "BugReport"("fingerprint");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
