-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_RecordedEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "recordingId" TEXT NOT NULL,
    "index" INTEGER NOT NULL,
    "type" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "timestamp" DATETIME NOT NULL,
    "value" TEXT,
    "isSecret" BOOLEAN NOT NULL DEFAULT false,
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
INSERT INTO "new_RecordedEvent" ("a11yRef", "bbox", "id", "index", "landmark", "recordingId", "screenshotRef", "selectorCandidates", "targetName", "targetRole", "targetTestId", "targetText", "timestamp", "type", "url", "value") SELECT "a11yRef", "bbox", "id", "index", "landmark", "recordingId", "screenshotRef", "selectorCandidates", "targetName", "targetRole", "targetTestId", "targetText", "timestamp", "type", "url", "value" FROM "RecordedEvent";
DROP TABLE "RecordedEvent";
ALTER TABLE "new_RecordedEvent" RENAME TO "RecordedEvent";
CREATE INDEX "RecordedEvent_recordingId_idx" ON "RecordedEvent"("recordingId");
CREATE UNIQUE INDEX "RecordedEvent_recordingId_index_key" ON "RecordedEvent"("recordingId", "index");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
