/**
 * The one fixed extraction pass over every answer (§2B): entities, citations,
 * themes, and how the industry and topic are framed (tone, framing,
 * arguments for and against, sources). Replaces asking each provider for a
 * JSON block. No client or opponent tracking.
 */
export * from "./schema";
export { parseExtraction, normalizeName, cleanUrl, ExtractionParseError } from "./parse";
export { extractAnswer, buildExtractionInput, EXTRACTION_INSTRUCTIONS } from "./extract";
export type { ExtractionInput, ExtractionOutput, ResponsesClient } from "./extract";
export * from "./map";
export { extractAndStore } from "./store";
export { linkEntities, relinkAllEntities, type LinkResult } from "./link";
export {
  EntityResolver,
  acronymsOf,
  displayName,
  entityGroup,
  entityKeyText,
  looksLikeAcronym,
  mentionKeys,
  type AliasKind,
  type CanonicalState,
  type EntityGroup,
  type EntityKey,
  type MentionInput,
} from "./canonical";
