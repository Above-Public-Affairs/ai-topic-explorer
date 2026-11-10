-- Task 4.8: merge themes worded different ways. Additive only: two new
-- tables and one nullable column on "Theme". Existing themes are linked
-- afterwards by `npm run themes -- --link` (lib/themes), not here.

-- AlterTable
ALTER TABLE "Theme" ADD COLUMN     "canonicalThemeId" TEXT;

-- CreateTable
CREATE TABLE "CanonicalTheme" (
    "id" TEXT NOT NULL,
    "watchItemId" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "subTopicId" TEXT,
    "status" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CanonicalTheme_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ThemeAlias" (
    "id" TEXT NOT NULL,
    "watchItemId" TEXT NOT NULL,
    "canonicalThemeId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ThemeAlias_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CanonicalTheme_watchItemId_slug_key" ON "CanonicalTheme"("watchItemId", "slug");

-- CreateIndex
CREATE INDEX "ThemeAlias_canonicalThemeId_idx" ON "ThemeAlias"("canonicalThemeId");

-- CreateIndex
CREATE UNIQUE INDEX "ThemeAlias_watchItemId_key_key" ON "ThemeAlias"("watchItemId", "key");

-- CreateIndex
CREATE INDEX "Theme_canonicalThemeId_idx" ON "Theme"("canonicalThemeId");

-- AddForeignKey
ALTER TABLE "Theme" ADD CONSTRAINT "Theme_canonicalThemeId_fkey" FOREIGN KEY ("canonicalThemeId") REFERENCES "CanonicalTheme"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CanonicalTheme" ADD CONSTRAINT "CanonicalTheme_watchItemId_fkey" FOREIGN KEY ("watchItemId") REFERENCES "WatchItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CanonicalTheme" ADD CONSTRAINT "CanonicalTheme_subTopicId_fkey" FOREIGN KEY ("subTopicId") REFERENCES "SubTopic"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ThemeAlias" ADD CONSTRAINT "ThemeAlias_canonicalThemeId_fkey" FOREIGN KEY ("canonicalThemeId") REFERENCES "CanonicalTheme"("id") ON DELETE CASCADE ON UPDATE CASCADE;

