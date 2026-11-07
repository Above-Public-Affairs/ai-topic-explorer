/** Providers the analysis calls today. */
export type Provider = "claude" | "openai" | "gemini" | "grok";

/**
 * Any provider a saved result can name. Results saved before Nov 2026 also
 * carry Perplexity, which was removed then.
 */
export type StoredProvider = Provider | "perplexity";

export interface Entity {
  name: string;
  url?: string;
  providers?: StoredProvider[];
}

export interface ExtractedEntities {
  people: Entity[];
  organizations: Entity[];
}

export interface Citation {
  title: string;
  url: string;
}

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  purpose: "expansion" | "analysis";
}

export interface AIResponse {
  provider: Provider;
  rawText: string;
  entities: ExtractedEntities;
  citations: Citation[];
  keyThemes: KeyTheme[];
  model: string;
  usage?: TokenUsage[];
  quotedPhrases?: QuotedPhrase[];
}

export interface KeyTheme {
  phrase: string;
  relevance: number;
}

export interface QuotedPhrase {
  phrase: string;
  frequency: number;
}

export interface WordFrequency {
  word: string;
  count: number;
}

export interface WordCloudWord {
  text: string;
  value: number;
}

export interface CombinedCitation {
  title: string;
  url: string;
  domain: string;
  providers: StoredProvider[];
}

export interface CombinedEntities {
  people: Entity[];
  organizations: Entity[];
}

export interface AnalysisResult {
  /**
   * Shape version of a saved result. Missing on results saved before v2
   * (Nov 2026); lib/results/stored-result.ts reads every version.
   */
  schemaVersion?: number;
  topic: string;
  expandedQueries?: string[];
  responses: {
    claude: AIResponse | null;
    openai: AIResponse | null;
    gemini: AIResponse | null;
    grok: AIResponse | null;
  };
  errors: {
    claude?: string;
    openai?: string;
    gemini?: string;
    grok?: string;
  };
  combinedWordFrequencies: WordFrequency[];
  combinedKeyThemes: KeyTheme[];
  combinedEntities: CombinedEntities;
  combinedCitations: CombinedCitation[];
  tokenUsage?: TokenUsage[];
}
