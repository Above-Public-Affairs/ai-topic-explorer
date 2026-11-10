-- Task 4.7 event watcher. Additive only.

-- Why an event was ignored, deferred or failed.
ALTER TABLE "Event" ADD COLUMN "note" TEXT;

-- Idempotency ledger for cron watchers (a cron runs on every deploy).
CREATE TABLE "WatcherJob" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 1,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "costUsd" DOUBLE PRECISION,
    "stats" JSONB,
    "note" TEXT,

    CONSTRAINT "WatcherJob_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "WatcherJob_key_key" ON "WatcherJob"("key");
CREATE INDEX "WatcherJob_kind_startedAt_idx" ON "WatcherJob"("kind", "startedAt");
