-- CreateTable
CREATE TABLE "RateLimitCounter" (
    "bucket" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "windowStart" TIMESTAMP(3) NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "RateLimitCounter_pkey" PRIMARY KEY ("bucket","key","windowStart")
);

-- CreateTable
CREATE TABLE "DailySpend" (
    "day" DATE NOT NULL,
    "costUsd" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "analyses" INTEGER NOT NULL DEFAULT 0,
    "capAlerted" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DailySpend_pkey" PRIMARY KEY ("day")
);

-- CreateIndex
CREATE INDEX "RateLimitCounter_windowStart_idx" ON "RateLimitCounter"("windowStart");
