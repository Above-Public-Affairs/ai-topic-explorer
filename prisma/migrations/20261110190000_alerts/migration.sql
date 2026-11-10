-- Task 5.2 notable-change alerts. Additive only: a new enum and a new table.
-- CreateEnum
CREATE TYPE "AlertStatus" AS ENUM ('pending', 'sending', 'sent', 'suppressed', 'failed');

-- CreateTable
CREATE TABLE "Alert" (
    "id" TEXT NOT NULL,
    "number" SERIAL NOT NULL,
    "watchItemId" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "beforeRunId" TEXT,
    "eventId" TEXT,
    "trigger" "RunKind" NOT NULL,
    "dedupeKey" TEXT NOT NULL,
    "metric" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "providers" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "before" DOUBLE PRECISION NOT NULL,
    "after" DOUBLE PRECISION NOT NULL,
    "countBefore" INTEGER NOT NULL,
    "countAfter" INTEGER NOT NULL,
    "threshold" DOUBLE PRECISION NOT NULL,
    "modelChange" BOOLEAN NOT NULL DEFAULT false,
    "rank" INTEGER NOT NULL,
    "facts" JSONB NOT NULL,
    "subject" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "writer" TEXT NOT NULL,
    "costUsd" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "status" "AlertStatus" NOT NULL DEFAULT 'pending',
    "note" TEXT,
    "sentAt" TIMESTAMP(3),
    "messageId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Alert_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Alert_number_key" ON "Alert"("number");

-- CreateIndex
CREATE UNIQUE INDEX "Alert_dedupeKey_key" ON "Alert"("dedupeKey");

-- CreateIndex
CREATE INDEX "Alert_runId_idx" ON "Alert"("runId");

-- CreateIndex
CREATE INDEX "Alert_watchItemId_createdAt_idx" ON "Alert"("watchItemId", "createdAt");

-- CreateIndex
CREATE INDEX "Alert_status_createdAt_idx" ON "Alert"("status", "createdAt");

-- AddForeignKey
ALTER TABLE "Alert" ADD CONSTRAINT "Alert_watchItemId_fkey" FOREIGN KEY ("watchItemId") REFERENCES "WatchItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Alert" ADD CONSTRAINT "Alert_runId_fkey" FOREIGN KEY ("runId") REFERENCES "Run"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Alert" ADD CONSTRAINT "Alert_beforeRunId_fkey" FOREIGN KEY ("beforeRunId") REFERENCES "Run"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Alert" ADD CONSTRAINT "Alert_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE SET NULL ON UPDATE CASCADE;

