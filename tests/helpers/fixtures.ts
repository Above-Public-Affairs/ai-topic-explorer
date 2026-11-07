import { readFileSync } from "node:fs";
import path from "node:path";

const root = path.join(import.meta.dirname, "..", "fixtures");

/** A JSON fixture from tests/fixtures. */
export function json(relative: string): unknown {
  return JSON.parse(readFileSync(path.join(root, relative), "utf8"));
}
