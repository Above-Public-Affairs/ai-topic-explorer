-- Task 4.2: question sets. Additive only: a new model-list role for the model
-- that writes questions, nullable columns on QuestionSet and Question, and a
-- guard so a question's wording never changes once written.
-- The 'questions' role is used by the next migration, not this one: Postgres
-- won't use a new enum value in the transaction that adds it.

-- AlterEnum
ALTER TYPE "ModelRole" ADD VALUE 'questions';

-- AlterTable
ALTER TABLE "Question" ADD COLUMN     "concern" TEXT,
ADD COLUMN     "retiredReason" TEXT,
ADD COLUMN     "why" TEXT;

-- AlterTable
ALTER TABLE "QuestionSet" ADD COLUMN     "costUsd" DOUBLE PRECISION,
ADD COLUMN     "generation" JSONB,
ADD COLUMN     "model" TEXT,
ADD COLUMN     "modelRegistryId" TEXT,
ADD COLUMN     "promptVersion" TEXT;

-- CreateIndex
CREATE INDEX "Question_concern_idx" ON "Question"("concern");

-- AddForeignKey
ALTER TABLE "QuestionSet" ADD CONSTRAINT "QuestionSet_modelRegistryId_fkey" FOREIGN KEY ("modelRegistryId") REFERENCES "ModelRegistry"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Retire, never edit (PROJECT-PLAN §4B): a question's wording, set and
-- position never change, and a locked set's questions are never deleted.
-- Unlocked drafts can still be deleted and written again.
CREATE OR REPLACE FUNCTION "question_locked_guard"() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW."text" IS DISTINCT FROM OLD."text"
       OR NEW."setId" IS DISTINCT FROM OLD."setId"
       OR NEW."position" IS DISTINCT FROM OLD."position" THEN
      RAISE EXCEPTION 'Question % is never edited: retire it and add a new one', OLD."id";
    END IF;
    RETURN NEW;
  END IF;
  IF EXISTS (SELECT 1 FROM "QuestionSet" WHERE "id" = OLD."setId" AND "lockedAt" IS NOT NULL) THEN
    RAISE EXCEPTION 'Question % is in a locked set: retire it instead of deleting it', OLD."id";
  END IF;
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "question_locked_guard"
BEFORE UPDATE OR DELETE ON "Question"
FOR EACH ROW EXECUTE FUNCTION "question_locked_guard"();
