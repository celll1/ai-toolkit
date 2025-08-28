-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Dataset" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'local',
    "external_path" TEXT,
    "caption_format" TEXT NOT NULL DEFAULT 'txt',
    "json_attribute" TEXT NOT NULL DEFAULT 'tags',
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL
);
INSERT INTO "new_Dataset" ("created_at", "external_path", "id", "name", "type", "updated_at") SELECT "created_at", "external_path", "id", "name", "type", "updated_at" FROM "Dataset";
DROP TABLE "Dataset";
ALTER TABLE "new_Dataset" RENAME TO "Dataset";
CREATE UNIQUE INDEX "Dataset_name_key" ON "Dataset"("name");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
