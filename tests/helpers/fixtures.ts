import { readFileSync } from "node:fs";
import path from "node:path";

const root = path.join(import.meta.dirname, "..", "fixtures");

/** A recorded provider answer from tests/fixtures/answers. */
export function answer(name: string): string {
  return readFileSync(path.join(root, "answers", `${name}.md`), "utf8");
}

/** A JSON fixture from tests/fixtures. */
export function json(relative: string): unknown {
  return JSON.parse(readFileSync(path.join(root, relative), "utf8"));
}
