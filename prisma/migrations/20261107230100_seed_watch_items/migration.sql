-- Task 4.2: the model that writes question sets, and the three watch items
-- Josh confirmed (lib/questions/watch-items.ts WATCH_ITEMS; a test checks the
-- two match). Inserts only, each skipped if already there. No question sets:
-- anchor sets are written and locked later, after Josh reads them
-- (scripts/question-sets.ts).

-- The question-writing model's row (lib/answers/registry.ts QUESTIONS_DEFAULT).
INSERT INTO "ModelRegistry" ("id", "role", "provider", "model", "effortLevel", "searchSetting", "locationMode", "confirmedAt", "isGuess", "sourceUrl", "note", "activeFrom", "createdAt", "updatedAt")
SELECT gen_random_uuid()::text, 'questions'::"ModelRole", 'openai'::"AiProvider", 'gpt-6-luna', 'low', 'web_search', 'parameter'::"LocationMode", '2026-11-07T00:00:00.000Z'::timestamp, false, 'https://developers.openai.com/api/docs/pricing',
       'Not an answering AI: writes the watch items'' question sets. The cheapest model on the list that holds a strict JSON schema and searches the web ($0.10 in / $0.50 out per 1M tokens, $0.01 a search). Low reasoning effort for steadier wording. Web search (with the watch item''s location) only for fresh sets.',
       CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
WHERE NOT EXISTS (SELECT 1 FROM "ModelRegistry" WHERE "role" = 'questions' AND "retiredAt" IS NULL);

-- Data centers in Texas
INSERT INTO "WatchItem" ("id", "name", "topic", "geography", "askCity", "askRegion", "askCountry", "askTimezone", "createdAt", "updatedAt")
SELECT gen_random_uuid()::text, 'Data centers in Texas', 'Data centers', 'Texas', 'Austin', 'Texas', 'US', 'America/Chicago', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
WHERE NOT EXISTS (SELECT 1 FROM "WatchItem" WHERE "name" = 'Data centers in Texas');
INSERT INTO "SubTopic" ("id", "watchItemId", "name")
SELECT gen_random_uuid()::text, w."id", 'power generation' FROM "WatchItem" w WHERE w."name" = 'Data centers in Texas'
ON CONFLICT ("watchItemId", "name") DO NOTHING;
INSERT INTO "SubTopic" ("id", "watchItemId", "name")
SELECT gen_random_uuid()::text, w."id", 'water use' FROM "WatchItem" w WHERE w."name" = 'Data centers in Texas'
ON CONFLICT ("watchItemId", "name") DO NOTHING;
INSERT INTO "SubTopic" ("id", "watchItemId", "name")
SELECT gen_random_uuid()::text, w."id", 'noise' FROM "WatchItem" w WHERE w."name" = 'Data centers in Texas'
ON CONFLICT ("watchItemId", "name") DO NOTHING;

-- Oil and gas in New Mexico
INSERT INTO "WatchItem" ("id", "name", "topic", "geography", "askCity", "askRegion", "askCountry", "askTimezone", "createdAt", "updatedAt")
SELECT gen_random_uuid()::text, 'Oil and gas in New Mexico', 'Oil and gas', 'New Mexico', 'Albuquerque', 'New Mexico', 'US', 'America/Denver', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
WHERE NOT EXISTS (SELECT 1 FROM "WatchItem" WHERE "name" = 'Oil and gas in New Mexico');

-- Renewables in Texas
INSERT INTO "WatchItem" ("id", "name", "topic", "geography", "askCity", "askRegion", "askCountry", "askTimezone", "createdAt", "updatedAt")
SELECT gen_random_uuid()::text, 'Renewables in Texas', 'Renewables', 'Texas', 'Austin', 'Texas', 'US', 'America/Chicago', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
WHERE NOT EXISTS (SELECT 1 FROM "WatchItem" WHERE "name" = 'Renewables in Texas');
INSERT INTO "SubTopic" ("id", "watchItemId", "name")
SELECT gen_random_uuid()::text, w."id", 'wind' FROM "WatchItem" w WHERE w."name" = 'Renewables in Texas'
ON CONFLICT ("watchItemId", "name") DO NOTHING;
INSERT INTO "SubTopic" ("id", "watchItemId", "name")
SELECT gen_random_uuid()::text, w."id", 'solar' FROM "WatchItem" w WHERE w."name" = 'Renewables in Texas'
ON CONFLICT ("watchItemId", "name") DO NOTHING;
INSERT INTO "SubTopic" ("id", "watchItemId", "name")
SELECT gen_random_uuid()::text, w."id", 'BESS' FROM "WatchItem" w WHERE w."name" = 'Renewables in Texas'
ON CONFLICT ("watchItemId", "name") DO NOTHING;
