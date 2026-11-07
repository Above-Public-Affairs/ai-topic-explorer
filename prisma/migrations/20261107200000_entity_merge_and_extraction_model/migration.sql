-- Task 2.7: merge entity names across answers, and the extraction model in
-- the model list. Additive only: two new tables, nullable columns, and a
-- `role` column that defaults every existing ModelRegistry row to 'answer'.
-- Existing entities are merged afterwards by `npm run entities:merge`
-- (lib/pipeline/backfill.ts remergeEntities), not here.

-- CreateEnum
CREATE TYPE "ModelRole" AS ENUM ('answer', 'extraction');

-- AlterTable
ALTER TABLE "Entity" ADD COLUMN     "canonicalEntityId" TEXT,
ADD COLUMN     "canonicalName" TEXT;

-- AlterTable
ALTER TABLE "Extraction" ADD COLUMN     "modelRegistryId" TEXT;

-- AlterTable
ALTER TABLE "ModelRegistry" ADD COLUMN     "role" "ModelRole" NOT NULL DEFAULT 'answer';

-- CreateTable
CREATE TABLE "CanonicalEntity" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "group" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CanonicalEntity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EntityAlias" (
    "id" TEXT NOT NULL,
    "canonicalEntityId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EntityAlias_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CanonicalEntity_group_idx" ON "CanonicalEntity"("group");

-- CreateIndex
CREATE INDEX "EntityAlias_key_idx" ON "EntityAlias"("key");

-- CreateIndex
CREATE UNIQUE INDEX "EntityAlias_canonicalEntityId_key_kind_key" ON "EntityAlias"("canonicalEntityId", "key", "kind");

-- CreateIndex
CREATE INDEX "Entity_canonicalEntityId_idx" ON "Entity"("canonicalEntityId");

-- CreateIndex
CREATE INDEX "ModelRegistry_role_provider_retiredAt_idx" ON "ModelRegistry"("role", "provider", "retiredAt");

-- AddForeignKey
ALTER TABLE "Extraction" ADD CONSTRAINT "Extraction_modelRegistryId_fkey" FOREIGN KEY ("modelRegistryId") REFERENCES "ModelRegistry"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Entity" ADD CONSTRAINT "Entity_canonicalEntityId_fkey" FOREIGN KEY ("canonicalEntityId") REFERENCES "CanonicalEntity"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EntityAlias" ADD CONSTRAINT "EntityAlias_canonicalEntityId_fkey" FOREIGN KEY ("canonicalEntityId") REFERENCES "CanonicalEntity"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- The extraction model's row (lib/answers/registry.ts EXTRACTION_DEFAULT;
-- a test checks the two match). Left alone if one is already current.
INSERT INTO "ModelRegistry" ("id", "role", "provider", "model", "effortLevel", "searchSetting", "locationMode", "confirmedAt", "isGuess", "sourceUrl", "note", "activeFrom", "createdAt", "updatedAt")
SELECT gen_random_uuid()::text, 'extraction'::"ModelRole", 'openai'::"AiProvider", 'gpt-6-luna', 'none', NULL, 'none'::"LocationMode", '2026-11-07T00:00:00.000Z'::timestamp, false, 'https://developers.openai.com/api/docs/pricing',
       'Not an answering AI: the one extraction pass over every answer (strict JSON schema, no web search, no location). Chosen in task 2.3 as the cheapest model that holds the schema: $0.10 in / $0.50 out per 1M tokens, about $0.0007 per answer. Reasoning effort none.',
       CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
WHERE NOT EXISTS (SELECT 1 FROM "ModelRegistry" WHERE "role" = 'extraction' AND "retiredAt" IS NULL);
