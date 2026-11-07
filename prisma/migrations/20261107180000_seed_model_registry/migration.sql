-- Task 2.4: seed the model list with each provider's free-tier default,
-- confirmed Nov 7, 2026 (lib/answers/registry.ts FREE_TIER_DEFAULTS; a test
-- checks the two match). Data only, no schema change. A provider that
-- already has a current row is left alone, so re-running changes nothing.

INSERT INTO "ModelRegistry" ("id", "provider", "model", "effortLevel", "searchSetting", "locationMode", "confirmedAt", "isGuess", "sourceUrl", "note", "activeFrom", "createdAt", "updatedAt")
SELECT gen_random_uuid()::text, 'claude'::"AiProvider", 'claude-sonnet-5-5', 'medium', 'web_search_20250305', 'parameter'::"LocationMode", '2026-11-07T00:00:00.000Z'::timestamp, false, 'https://claude.com/pricing',
       'Pricing page: Free includes Sonnet and Haiku, not Opus or Fable. Sonnet is the claude.ai default; Sonnet 5.5 is the current Sonnet. Medium effort is the apps'' default (anthropic.com/claude-sonnet-5-5). Thinking stays off (between_tools), as decided in task 2.1. Basic web_search_20250305, because the newer tool cites nothing.',
       CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
WHERE NOT EXISTS (SELECT 1 FROM "ModelRegistry" WHERE "provider" = 'claude' AND "retiredAt" IS NULL);

INSERT INTO "ModelRegistry" ("id", "provider", "model", "effortLevel", "searchSetting", "locationMode", "confirmedAt", "isGuess", "sourceUrl", "note", "activeFrom", "createdAt", "updatedAt")
SELECT gen_random_uuid()::text, 'openai'::"AiProvider", 'gpt-6-luna', 'none', 'web_search', 'parameter'::"LocationMode", '2026-11-07T00:00:00.000Z'::timestamp, false, 'https://help.openai.com/en/articles/6825453-chatgpt-release-notes',
       'Release notes, Oct 7, 2026: ''Free and Go use GPT-6 Luna'' in the Chat tab, from Oct 8. The Free tier FAQ (help.openai.com/en/articles/9275245) still says GPT-5.6 Luna and is out of date. Free answers at Instant unless the user picks Think, so reasoning effort is none.',
       CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
WHERE NOT EXISTS (SELECT 1 FROM "ModelRegistry" WHERE "provider" = 'openai' AND "retiredAt" IS NULL);

INSERT INTO "ModelRegistry" ("id", "provider", "model", "effortLevel", "searchSetting", "locationMode", "confirmedAt", "isGuess", "sourceUrl", "note", "activeFrom", "createdAt", "updatedAt")
SELECT gen_random_uuid()::text, 'gemini'::"AiProvider", 'gemini-3.5-flash-lite', 'low', 'google_search', 'by_prompt'::"LocationMode", '2026-11-07T00:00:00.000Z'::timestamp, false, 'https://support.google.com/gemini/answer/18648722',
       'About Gemini models: without a Google AI plan, chats use ''Auto or Flash-Lite''; with Auto on, most prompts use Flash-Lite (some go to Flash or Pro), so Flash-Lite is the default. Since Oct 9, 2026; before then free users got Flash. The page names no version: gemini-3.5-flash-lite is the newest Flash-Lite in the API (gemini-flash-lite-latest resolves to it). Thinking level defaults to Low. Google Search grounding takes no location.',
       CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
WHERE NOT EXISTS (SELECT 1 FROM "ModelRegistry" WHERE "provider" = 'gemini' AND "retiredAt" IS NULL);

INSERT INTO "ModelRegistry" ("id", "provider", "model", "effortLevel", "searchSetting", "locationMode", "confirmedAt", "isGuess", "sourceUrl", "note", "activeFrom", "createdAt", "updatedAt")
SELECT gen_random_uuid()::text, 'grok'::"AiProvider", 'grok-4.3', 'low', 'web_search', 'by_prompt'::"LocationMode", '2026-11-07T00:00:00.000Z'::timestamp, true, 'https://docs.x.ai/developers/models',
       'Guess: xAI doesn''t say which model grok.com''s free ''Fast'' mode runs. grok-4.3 is its non-flagship model; the flagship grok-4.7 runs paid Expert mode. Low is grok-4.3''s default reasoning effort. Web search only, no X Search (task 3.2). xAI''s search tools take no location, so it goes in the prompt.',
       CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
WHERE NOT EXISTS (SELECT 1 FROM "ModelRegistry" WHERE "provider" = 'grok' AND "retiredAt" IS NULL);
