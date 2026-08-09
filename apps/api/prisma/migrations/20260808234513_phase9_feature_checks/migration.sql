-- CreateTable
CREATE TABLE "Feature" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "applicationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Feature_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "Application" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "FeatureCheck" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "featureId" TEXT NOT NULL,
    "applicationId" TEXT NOT NULL,
    "environmentId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "criteria" TEXT NOT NULL,
    "verdicts" TEXT NOT NULL DEFAULT '[]',
    "cases" TEXT NOT NULL DEFAULT '[]',
    "error" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" DATETIME,
    CONSTRAINT "FeatureCheck_featureId_fkey" FOREIGN KEY ("featureId") REFERENCES "Feature" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "FeatureCheck_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "Application" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_TestSpec" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "applicationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "source" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "currentVersionId" TEXT,
    "featureId" TEXT,
    "priority" TEXT,
    "criteriaKeys" TEXT,
    CONSTRAINT "TestSpec_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "Application" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "TestSpec_featureId_fkey" FOREIGN KEY ("featureId") REFERENCES "Feature" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_TestSpec" ("applicationId", "createdAt", "currentVersionId", "description", "id", "name", "source", "updatedAt") SELECT "applicationId", "createdAt", "currentVersionId", "description", "id", "name", "source", "updatedAt" FROM "TestSpec";
DROP TABLE "TestSpec";
ALTER TABLE "new_TestSpec" RENAME TO "TestSpec";
CREATE INDEX "TestSpec_applicationId_idx" ON "TestSpec"("applicationId");
CREATE INDEX "TestSpec_featureId_idx" ON "TestSpec"("featureId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "Feature_applicationId_idx" ON "Feature"("applicationId");

-- CreateIndex
CREATE UNIQUE INDEX "Feature_applicationId_name_key" ON "Feature"("applicationId", "name");

-- CreateIndex
CREATE INDEX "FeatureCheck_featureId_idx" ON "FeatureCheck"("featureId");

-- CreateIndex
CREATE INDEX "FeatureCheck_applicationId_idx" ON "FeatureCheck"("applicationId");
