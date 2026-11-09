-- Task 4.2 rework: record which way each question leans toward the industry
-- or topic, so sets can be balanced and analysis can account for it.
-- Additive: a new enum and a nullable column. Questions written before this
-- keep a null lean.

-- CreateEnum
CREATE TYPE "QuestionLean" AS ENUM ('neutral', 'negative', 'positive');

-- AlterTable
ALTER TABLE "Question" ADD COLUMN     "lean" "QuestionLean";
