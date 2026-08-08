-- CreateTable
CREATE TABLE "Project" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "Application" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "baseUrl" TEXT NOT NULL,
    "description" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Application_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Environment" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "applicationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "baseUrl" TEXT NOT NULL,
    "credentialRefs" TEXT NOT NULL DEFAULT '{"extra":{}}',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Environment_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "Application" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Recording" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "applicationId" TEXT NOT NULL,
    "environmentId" TEXT,
    "startUrl" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "startedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "stoppedAt" DATETIME,
    "error" TEXT,
    CONSTRAINT "Recording_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "Application" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Recording_environmentId_fkey" FOREIGN KEY ("environmentId") REFERENCES "Environment" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "RecordedEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "recordingId" TEXT NOT NULL,
    "index" INTEGER NOT NULL,
    "type" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "timestamp" DATETIME NOT NULL,
    "value" TEXT,
    "targetRole" TEXT,
    "targetName" TEXT,
    "targetText" TEXT,
    "targetTestId" TEXT,
    "landmark" TEXT,
    "bbox" TEXT,
    "selectorCandidates" TEXT NOT NULL DEFAULT '[]',
    "a11yRef" TEXT,
    "screenshotRef" TEXT,
    CONSTRAINT "RecordedEvent_recordingId_fkey" FOREIGN KEY ("recordingId") REFERENCES "Recording" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "TestSpec" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "applicationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "source" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "currentVersionId" TEXT,
    CONSTRAINT "TestSpec_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "Application" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "TestVersion" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "specId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "source" TEXT NOT NULL,
    "note" TEXT,
    "recordingId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "TestVersion_specId_fkey" FOREIGN KEY ("specId") REFERENCES "TestSpec" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "TestVersion_recordingId_fkey" FOREIGN KEY ("recordingId") REFERENCES "Recording" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "TestStep" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "versionId" TEXT NOT NULL,
    "index" INTEGER NOT NULL,
    "intent" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "targetDescription" TEXT,
    "targetHints" TEXT NOT NULL DEFAULT '{"selectorCandidates":[]}',
    "data" TEXT,
    "expectation" TEXT NOT NULL,
    "optional" BOOLEAN NOT NULL DEFAULT false,
    CONSTRAINT "TestStep_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "TestVersion" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Execution" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "specId" TEXT NOT NULL,
    "versionId" TEXT NOT NULL,
    "environmentId" TEXT NOT NULL,
    "mode" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "startedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" DATETIME,
    "cancelRequested" BOOLEAN NOT NULL DEFAULT false,
    "summary" TEXT,
    "error" TEXT,
    CONSTRAINT "Execution_specId_fkey" FOREIGN KEY ("specId") REFERENCES "TestSpec" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Execution_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "TestVersion" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Execution_environmentId_fkey" FOREIGN KEY ("environmentId") REFERENCES "Environment" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ExecutionStep" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "executionId" TEXT NOT NULL,
    "stepId" TEXT,
    "index" INTEGER NOT NULL,
    "intent" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "resolutionStrategy" TEXT,
    "resolvedSelector" TEXT,
    "candidateCount" INTEGER,
    "confidence" REAL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "startedAt" DATETIME,
    "finishedAt" DATETIME,
    "durationMs" INTEGER,
    "verifierRationale" TEXT,
    "error" TEXT,
    CONSTRAINT "ExecutionStep_executionId_fkey" FOREIGN KEY ("executionId") REFERENCES "Execution" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ExecutionStep_stepId_fkey" FOREIGN KEY ("stepId") REFERENCES "TestStep" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Observation" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "executionStepId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "payload" TEXT NOT NULL,
    "artifactId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Observation_executionStepId_fkey" FOREIGN KEY ("executionStepId") REFERENCES "ExecutionStep" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Observation_artifactId_fkey" FOREIGN KEY ("artifactId") REFERENCES "Artifact" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Artifact" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "executionId" TEXT,
    "recordingId" TEXT,
    "executionStepId" TEXT,
    "kind" TEXT NOT NULL,
    "relPath" TEXT NOT NULL,
    "bytes" INTEGER,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Artifact_executionId_fkey" FOREIGN KEY ("executionId") REFERENCES "Execution" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Artifact_recordingId_fkey" FOREIGN KEY ("recordingId") REFERENCES "Recording" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Artifact_executionStepId_fkey" FOREIGN KEY ("executionStepId") REFERENCES "ExecutionStep" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "KnowledgeItem" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "applicationId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "confidence" REAL NOT NULL DEFAULT 0.5,
    "hitCount" INTEGER NOT NULL DEFAULT 0,
    "missCount" INTEGER NOT NULL DEFAULT 0,
    "lastSeenAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "KnowledgeItem_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "Application" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "HealingRecord" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "executionStepId" TEXT NOT NULL,
    "specVersionId" TEXT NOT NULL,
    "diagnosis" TEXT NOT NULL,
    "originalTarget" TEXT NOT NULL,
    "proposedTarget" TEXT NOT NULL,
    "rationale" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "reverifyStatus" TEXT,
    "appliedToVersionId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewedAt" DATETIME,
    CONSTRAINT "HealingRecord_executionStepId_fkey" FOREIGN KEY ("executionStepId") REFERENCES "ExecutionStep" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "HealingRecord_specVersionId_fkey" FOREIGN KEY ("specVersionId") REFERENCES "TestVersion" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "HealingRecord_appliedToVersionId_fkey" FOREIGN KEY ("appliedToVersionId") REFERENCES "TestVersion" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "BugReport" (
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
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "BugReport_executionId_fkey" FOREIGN KEY ("executionId") REFERENCES "Execution" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "BugReport_executionStepId_fkey" FOREIGN KEY ("executionStepId") REFERENCES "ExecutionStep" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "LlmCall" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "executionId" TEXT,
    "recordingId" TEXT,
    "promptId" TEXT NOT NULL,
    "promptVersion" INTEGER NOT NULL,
    "model" TEXT NOT NULL,
    "inputTokens" INTEGER NOT NULL,
    "outputTokens" INTEGER NOT NULL,
    "latencyMs" INTEGER NOT NULL,
    "costUsd" REAL,
    "ok" BOOLEAN NOT NULL,
    "error" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "LlmCall_executionId_fkey" FOREIGN KEY ("executionId") REFERENCES "Execution" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "LlmCall_recordingId_fkey" FOREIGN KEY ("recordingId") REFERENCES "Recording" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Report" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "executionId" TEXT NOT NULL,
    "markdown" TEXT NOT NULL,
    "json" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Report_executionId_fkey" FOREIGN KEY ("executionId") REFERENCES "Execution" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "Application_projectId_idx" ON "Application"("projectId");

-- CreateIndex
CREATE INDEX "Environment_applicationId_idx" ON "Environment"("applicationId");

-- CreateIndex
CREATE INDEX "Recording_applicationId_idx" ON "Recording"("applicationId");

-- CreateIndex
CREATE INDEX "RecordedEvent_recordingId_idx" ON "RecordedEvent"("recordingId");

-- CreateIndex
CREATE UNIQUE INDEX "RecordedEvent_recordingId_index_key" ON "RecordedEvent"("recordingId", "index");

-- CreateIndex
CREATE INDEX "TestSpec_applicationId_idx" ON "TestSpec"("applicationId");

-- CreateIndex
CREATE INDEX "TestVersion_specId_idx" ON "TestVersion"("specId");

-- CreateIndex
CREATE UNIQUE INDEX "TestVersion_specId_version_key" ON "TestVersion"("specId", "version");

-- CreateIndex
CREATE INDEX "TestStep_versionId_idx" ON "TestStep"("versionId");

-- CreateIndex
CREATE UNIQUE INDEX "TestStep_versionId_index_key" ON "TestStep"("versionId", "index");

-- CreateIndex
CREATE INDEX "Execution_specId_idx" ON "Execution"("specId");

-- CreateIndex
CREATE INDEX "Execution_versionId_idx" ON "Execution"("versionId");

-- CreateIndex
CREATE INDEX "Execution_environmentId_idx" ON "Execution"("environmentId");

-- CreateIndex
CREATE INDEX "Execution_status_idx" ON "Execution"("status");

-- CreateIndex
CREATE INDEX "ExecutionStep_executionId_idx" ON "ExecutionStep"("executionId");

-- CreateIndex
CREATE INDEX "ExecutionStep_stepId_idx" ON "ExecutionStep"("stepId");

-- CreateIndex
CREATE UNIQUE INDEX "ExecutionStep_executionId_index_key" ON "ExecutionStep"("executionId", "index");

-- CreateIndex
CREATE INDEX "Observation_executionStepId_idx" ON "Observation"("executionStepId");

-- CreateIndex
CREATE INDEX "Artifact_executionId_idx" ON "Artifact"("executionId");

-- CreateIndex
CREATE INDEX "Artifact_recordingId_idx" ON "Artifact"("recordingId");

-- CreateIndex
CREATE INDEX "Artifact_executionStepId_idx" ON "Artifact"("executionStepId");

-- CreateIndex
CREATE INDEX "KnowledgeItem_applicationId_idx" ON "KnowledgeItem"("applicationId");

-- CreateIndex
CREATE UNIQUE INDEX "KnowledgeItem_applicationId_kind_key_key" ON "KnowledgeItem"("applicationId", "kind", "key");

-- CreateIndex
CREATE INDEX "HealingRecord_executionStepId_idx" ON "HealingRecord"("executionStepId");

-- CreateIndex
CREATE INDEX "HealingRecord_specVersionId_idx" ON "HealingRecord"("specVersionId");

-- CreateIndex
CREATE INDEX "HealingRecord_status_idx" ON "HealingRecord"("status");

-- CreateIndex
CREATE INDEX "BugReport_executionId_idx" ON "BugReport"("executionId");

-- CreateIndex
CREATE INDEX "BugReport_status_idx" ON "BugReport"("status");

-- CreateIndex
CREATE INDEX "LlmCall_executionId_idx" ON "LlmCall"("executionId");

-- CreateIndex
CREATE INDEX "LlmCall_recordingId_idx" ON "LlmCall"("recordingId");

-- CreateIndex
CREATE UNIQUE INDEX "Report_executionId_key" ON "Report"("executionId");
