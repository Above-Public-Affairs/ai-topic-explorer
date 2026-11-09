/**
 * Anchor sets reach production only after Josh reads them. The draft anchor
 * sets are exported to a reviewed file (scripts/anchor-sets/*.json); once he
 * approves it, anchorMigrationSql() turns it into an additive migration that
 * inserts each set already locked, word for word. Nothing else writes anchor
 * sets to production.
 */
import { normalizeConcern, type Lean, type Style } from "./rules";

export interface ReviewedQuestion {
  label: string;
  text: string;
  subTopic: string | null;
  concern: string;
  lean: Lean;
  /** For the reader and the mix check; not stored. */
  style?: Style;
}

export interface ReviewedFile {
  /** When the drafts were written. */
  writtenAt: string;
  model: string | null;
  promptVersion: string | null;
  items: { watchItem: string; questions: ReviewedQuestion[] }[];
}

const q = (v: string | null) => (v === null ? "NULL" : `'${v.replace(/'/g, "''")}'`);

/**
 * SQL that inserts each reviewed anchor set locked, as set 1 of its watch
 * item. Skips an item whose set 1 already exists, and each question already
 * there, so re-running changes nothing.
 */
export function anchorMigrationSql(file: ReviewedFile, reviewedOn: string): string {
  const out = [
    `-- Anchor sets Josh read and approved on ${reviewedOn}, inserted locked.`,
    `-- Written ${file.writtenAt} by ${file.model ?? "hand"} (prompt ${file.promptVersion ?? "n/a"}).`,
    `-- Additive: skipped where a watch item already has set 1.`,
    "",
  ];
  const generation = JSON.stringify({ source: "reviewed file", reviewedOn, writtenAt: file.writtenAt });
  for (const item of file.items) {
    const w = q(item.watchItem);
    out.push(
      `-- ${item.watchItem}`,
      `INSERT INTO "QuestionSet" ("id", "watchItemId", "kind", "number", "startedAt", "lockedAt", "model", "promptVersion", "generation", "createdAt")`,
      `SELECT gen_random_uuid()::text, w."id", 'anchor'::"QuestionSetKind", 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, ${q(file.model)}, ${q(file.promptVersion)}, ${q(generation)}::jsonb, CURRENT_TIMESTAMP`,
      `FROM "WatchItem" w WHERE w."name" = ${w}`,
      `AND NOT EXISTS (SELECT 1 FROM "QuestionSet" s WHERE s."watchItemId" = w."id" AND s."number" = 1);`,
      ""
    );
    item.questions.forEach((question, i) => {
      const subTopic = question.subTopic
        ? `(SELECT st."id" FROM "SubTopic" st WHERE st."watchItemId" = w."id" AND st."name" = ${q(question.subTopic)})`
        : "NULL";
      out.push(
        `INSERT INTO "Question" ("id", "setId", "position", "text", "subTopicId", "concern", "lean", "createdAt")`,
        `SELECT gen_random_uuid()::text, s."id", ${i + 1}, ${q(question.text)}, ${subTopic}, ${q(normalizeConcern(question.concern))}, '${question.lean}'::"QuestionLean", CURRENT_TIMESTAMP`,
        `FROM "QuestionSet" s JOIN "WatchItem" w ON w."id" = s."watchItemId"`,
        `WHERE w."name" = ${w} AND s."number" = 1 AND s."kind" = 'anchor'`,
        `AND NOT EXISTS (SELECT 1 FROM "Question" x WHERE x."setId" = s."id" AND x."position" = ${i + 1});`
      );
    });
    out.push("");
  }
  return out.join("\n");
}
