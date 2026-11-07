-- CreateEnum
CREATE TYPE "AiProvider" AS ENUM ('claude', 'openai', 'gemini', 'grok');

-- CreateEnum
CREATE TYPE "LocationMode" AS ENUM ('parameter', 'by_prompt', 'none');

-- CreateEnum
CREATE TYPE "CostSource" AS ENUM ('provider', 'computed');

-- CreateEnum
CREATE TYPE "QuestionSetKind" AS ENUM ('anchor', 'promoted', 'fresh');

-- CreateEnum
CREATE TYPE "RunKind" AS ENUM ('weekly', 'event', 'model_switch', 'manual', 'public');

-- CreateEnum
CREATE TYPE "RunStatus" AS ENUM ('running', 'complete', 'partial', 'failed');

-- CreateEnum
CREATE TYPE "ArgumentSide" AS ENUM ('for', 'against');

-- CreateEnum
CREATE TYPE "EventCategory" AS ENUM ('new_model', 'model_policy', 'crawler_change', 'election', 'legislative_session', 'major_news');

-- CreateEnum
CREATE TYPE "EventStatus" AS ENUM ('pending', 'approved', 'ignored');

-- CreateTable
CREATE TABLE "ModelRegistry" (
    "id" TEXT NOT NULL,
    "provider" "AiProvider" NOT NULL,
    "model" TEXT NOT NULL,
    "effortLevel" TEXT,
    "searchSetting" TEXT,
    "locationMode" "LocationMode" NOT NULL,
    "confirmedAt" TIMESTAMP(3) NOT NULL,
    "isGuess" BOOLEAN NOT NULL DEFAULT false,
    "sourceUrl" TEXT,
    "note" TEXT,
    "activeFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "retiredAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ModelRegistry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WatchItem" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "topic" TEXT NOT NULL,
    "geography" TEXT,
    "subSector" TEXT,
    "askCity" TEXT NOT NULL,
    "askRegion" TEXT NOT NULL,
    "askCountry" TEXT NOT NULL DEFAULT 'US',
    "askTimezone" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "retiredAt" TIMESTAMP(3),

    CONSTRAINT "WatchItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SubTopic" (
    "id" TEXT NOT NULL,
    "watchItemId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "retiredAt" TIMESTAMP(3),

    CONSTRAINT "SubTopic_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QuestionSet" (
    "id" TEXT NOT NULL,
    "watchItemId" TEXT NOT NULL,
    "kind" "QuestionSetKind" NOT NULL,
    "number" INTEGER NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lockedAt" TIMESTAMP(3),
    "runId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "QuestionSet_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Question" (
    "id" TEXT NOT NULL,
    "setId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "text" TEXT NOT NULL,
    "subTopicId" TEXT,
    "promotedFromId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "retiredAt" TIMESTAMP(3),

    CONSTRAINT "Question_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Run" (
    "id" TEXT NOT NULL,
    "kind" "RunKind" NOT NULL,
    "status" "RunStatus" NOT NULL DEFAULT 'running',
    "watchItemId" TEXT,
    "topic" TEXT NOT NULL,
    "askCity" TEXT,
    "askRegion" TEXT,
    "askCountry" TEXT,
    "askTimezone" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "costUsd" DOUBLE PRECISION,
    "stats" JSONB,
    "note" TEXT,

    CONSTRAINT "Run_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Answer" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "questionId" TEXT,
    "question" TEXT NOT NULL,
    "repeat" INTEGER NOT NULL DEFAULT 1,
    "provider" "AiProvider" NOT NULL,
    "modelRegistryId" TEXT,
    "requestedModel" TEXT NOT NULL,
    "model" TEXT,
    "answer" TEXT,
    "finishReason" TEXT,
    "latencyMs" INTEGER,
    "searchQueries" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "locationCity" TEXT,
    "locationRegion" TEXT,
    "locationCountry" TEXT,
    "locationTimezone" TEXT,
    "locationMode" "LocationMode" NOT NULL,
    "inputTokens" INTEGER NOT NULL DEFAULT 0,
    "cachedInputTokens" INTEGER NOT NULL DEFAULT 0,
    "outputTokens" INTEGER NOT NULL DEFAULT 0,
    "reasoningTokens" INTEGER NOT NULL DEFAULT 0,
    "searchCalls" INTEGER NOT NULL DEFAULT 0,
    "costUsd" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "costSource" "CostSource",
    "costTokensUsd" DOUBLE PRECISION,
    "costSearchUsd" DOUBLE PRECISION,
    "priceIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "costNote" TEXT,
    "errorKind" TEXT,
    "errorStatus" INTEGER,
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Answer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Citation" (
    "id" TEXT NOT NULL,
    "answerId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "domain" TEXT NOT NULL,
    "title" TEXT,
    "cited" BOOLEAN,
    "origin" TEXT NOT NULL DEFAULT 'provider',
    "position" INTEGER NOT NULL,

    CONSTRAINT "Citation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Extraction" (
    "id" TEXT NOT NULL,
    "answerId" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "promptVersion" TEXT NOT NULL,
    "tone" TEXT,
    "framing" TEXT,
    "inputTokens" INTEGER NOT NULL DEFAULT 0,
    "outputTokens" INTEGER NOT NULL DEFAULT 0,
    "costUsd" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "priceIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "raw" JSONB,
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Extraction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Entity" (
    "id" TEXT NOT NULL,
    "extractionId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "normalized" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "mentions" INTEGER NOT NULL DEFAULT 1,
    "url" TEXT,

    CONSTRAINT "Entity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Theme" (
    "id" TEXT NOT NULL,
    "extractionId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "normalized" TEXT NOT NULL,
    "subTopicId" TEXT,
    "sentiment" TEXT,
    "weight" DOUBLE PRECISION,

    CONSTRAINT "Theme_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Argument" (
    "id" TEXT NOT NULL,
    "extractionId" TEXT NOT NULL,
    "side" "ArgumentSide" NOT NULL,
    "text" TEXT NOT NULL,
    "sourceUrl" TEXT,

    CONSTRAINT "Argument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Event" (
    "id" TEXT NOT NULL,
    "category" "EventCategory" NOT NULL,
    "status" "EventStatus" NOT NULL DEFAULT 'pending',
    "title" TEXT NOT NULL,
    "summary" TEXT,
    "sourceUrl" TEXT,
    "sourceName" TEXT,
    "scheduled" BOOLEAN NOT NULL DEFAULT false,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "detectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "triggerAt" TIMESTAMP(3),
    "geography" TEXT,
    "watchItemId" TEXT,
    "modelRegistryId" TEXT,
    "runId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Event_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ModelRegistry_provider_retiredAt_idx" ON "ModelRegistry"("provider", "retiredAt");

-- CreateIndex
CREATE UNIQUE INDEX "SubTopic_watchItemId_name_key" ON "SubTopic"("watchItemId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "QuestionSet_runId_key" ON "QuestionSet"("runId");

-- CreateIndex
CREATE UNIQUE INDEX "QuestionSet_watchItemId_number_key" ON "QuestionSet"("watchItemId", "number");

-- CreateIndex
CREATE UNIQUE INDEX "Question_setId_position_key" ON "Question"("setId", "position");

-- CreateIndex
CREATE INDEX "Run_watchItemId_startedAt_idx" ON "Run"("watchItemId", "startedAt");

-- CreateIndex
CREATE INDEX "Run_kind_startedAt_idx" ON "Run"("kind", "startedAt");

-- CreateIndex
CREATE INDEX "Answer_runId_idx" ON "Answer"("runId");

-- CreateIndex
CREATE INDEX "Answer_questionId_createdAt_idx" ON "Answer"("questionId", "createdAt");

-- CreateIndex
CREATE INDEX "Answer_provider_createdAt_idx" ON "Answer"("provider", "createdAt");

-- CreateIndex
CREATE INDEX "Citation_answerId_idx" ON "Citation"("answerId");

-- CreateIndex
CREATE INDEX "Citation_domain_idx" ON "Citation"("domain");

-- CreateIndex
CREATE UNIQUE INDEX "Extraction_answerId_key" ON "Extraction"("answerId");

-- CreateIndex
CREATE INDEX "Entity_extractionId_idx" ON "Entity"("extractionId");

-- CreateIndex
CREATE INDEX "Entity_normalized_idx" ON "Entity"("normalized");

-- CreateIndex
CREATE INDEX "Theme_extractionId_idx" ON "Theme"("extractionId");

-- CreateIndex
CREATE INDEX "Theme_normalized_idx" ON "Theme"("normalized");

-- CreateIndex
CREATE INDEX "Argument_extractionId_idx" ON "Argument"("extractionId");

-- CreateIndex
CREATE INDEX "Event_status_triggerAt_idx" ON "Event"("status", "triggerAt");

-- CreateIndex
CREATE INDEX "Event_category_occurredAt_idx" ON "Event"("category", "occurredAt");

-- AddForeignKey
ALTER TABLE "SubTopic" ADD CONSTRAINT "SubTopic_watchItemId_fkey" FOREIGN KEY ("watchItemId") REFERENCES "WatchItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuestionSet" ADD CONSTRAINT "QuestionSet_watchItemId_fkey" FOREIGN KEY ("watchItemId") REFERENCES "WatchItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuestionSet" ADD CONSTRAINT "QuestionSet_runId_fkey" FOREIGN KEY ("runId") REFERENCES "Run"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Question" ADD CONSTRAINT "Question_setId_fkey" FOREIGN KEY ("setId") REFERENCES "QuestionSet"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Question" ADD CONSTRAINT "Question_subTopicId_fkey" FOREIGN KEY ("subTopicId") REFERENCES "SubTopic"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Question" ADD CONSTRAINT "Question_promotedFromId_fkey" FOREIGN KEY ("promotedFromId") REFERENCES "Question"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Run" ADD CONSTRAINT "Run_watchItemId_fkey" FOREIGN KEY ("watchItemId") REFERENCES "WatchItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Answer" ADD CONSTRAINT "Answer_runId_fkey" FOREIGN KEY ("runId") REFERENCES "Run"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Answer" ADD CONSTRAINT "Answer_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "Question"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Answer" ADD CONSTRAINT "Answer_modelRegistryId_fkey" FOREIGN KEY ("modelRegistryId") REFERENCES "ModelRegistry"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Citation" ADD CONSTRAINT "Citation_answerId_fkey" FOREIGN KEY ("answerId") REFERENCES "Answer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Extraction" ADD CONSTRAINT "Extraction_answerId_fkey" FOREIGN KEY ("answerId") REFERENCES "Answer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Entity" ADD CONSTRAINT "Entity_extractionId_fkey" FOREIGN KEY ("extractionId") REFERENCES "Extraction"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Theme" ADD CONSTRAINT "Theme_extractionId_fkey" FOREIGN KEY ("extractionId") REFERENCES "Extraction"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Theme" ADD CONSTRAINT "Theme_subTopicId_fkey" FOREIGN KEY ("subTopicId") REFERENCES "SubTopic"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Argument" ADD CONSTRAINT "Argument_extractionId_fkey" FOREIGN KEY ("extractionId") REFERENCES "Extraction"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Event" ADD CONSTRAINT "Event_watchItemId_fkey" FOREIGN KEY ("watchItemId") REFERENCES "WatchItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Event" ADD CONSTRAINT "Event_modelRegistryId_fkey" FOREIGN KEY ("modelRegistryId") REFERENCES "ModelRegistry"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Event" ADD CONSTRAINT "Event_runId_fkey" FOREIGN KEY ("runId") REFERENCES "Run"("id") ON DELETE SET NULL ON UPDATE CASCADE;

