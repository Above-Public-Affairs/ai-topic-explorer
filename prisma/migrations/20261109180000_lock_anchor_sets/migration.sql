-- Anchor sets Josh read and approved on 2026-11-09, inserted locked.
-- Written 2026-11-09T16:30:00.000Z by gpt-6-luna (prompt 2026-11-09.1), hand-edited; 1.2 and 1.3 of data centers reworded by Josh (prompt 2026-11-09.1).
-- Additive: skipped where a watch item already has set 1.

-- Data centers in Texas
INSERT INTO "QuestionSet" ("id", "watchItemId", "kind", "number", "startedAt", "lockedAt", "model", "promptVersion", "generation", "createdAt")
SELECT gen_random_uuid()::text, w."id", 'anchor'::"QuestionSetKind", 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, 'gpt-6-luna (prompt 2026-11-09.1), hand-edited; 1.2 and 1.3 of data centers reworded by Josh', '2026-11-09.1', '{"source":"reviewed file","reviewedOn":"2026-11-09","writtenAt":"2026-11-09T16:30:00.000Z"}'::jsonb, CURRENT_TIMESTAMP
FROM "WatchItem" w WHERE w."name" = 'Data centers in Texas'
AND NOT EXISTS (SELECT 1 FROM "QuestionSet" s WHERE s."watchItemId" = w."id" AND s."number" = 1);

INSERT INTO "Question" ("id", "setId", "position", "text", "subTopicId", "concern", "lean", "createdAt")
SELECT gen_random_uuid()::text, s."id", 1, 'data centers straining the ercot grid', (SELECT st."id" FROM "SubTopic" st WHERE st."watchItemId" = w."id" AND st."name" = 'power generation'), 'electricity supply', 'negative'::"QuestionLean", CURRENT_TIMESTAMP
FROM "QuestionSet" s JOIN "WatchItem" w ON w."id" = s."watchItemId"
WHERE w."name" = 'Data centers in Texas' AND s."number" = 1 AND s."kind" = 'anchor'
AND NOT EXISTS (SELECT 1 FROM "Question" x WHERE x."setId" = s."id" AND x."position" = 1);
INSERT INTO "Question" ("id", "setId", "position", "text", "subTopicId", "concern", "lean", "createdAt")
SELECT gen_random_uuid()::text, s."id", 2, 'will all these data centers make my electric bill go up', (SELECT st."id" FROM "SubTopic" st WHERE st."watchItemId" = w."id" AND st."name" = 'power generation'), 'electric bills', 'neutral'::"QuestionLean", CURRENT_TIMESTAMP
FROM "QuestionSet" s JOIN "WatchItem" w ON w."id" = s."watchItemId"
WHERE w."name" = 'Data centers in Texas' AND s."number" = 1 AND s."kind" = 'anchor'
AND NOT EXISTS (SELECT 1 FROM "Question" x WHERE x."setId" = s."id" AND x."position" = 2);
INSERT INTO "Question" ("id", "setId", "position", "text", "subTopicId", "concern", "lean", "createdAt")
SELECT gen_random_uuid()::text, s."id", 3, 'how much water does a data center actually use', (SELECT st."id" FROM "SubTopic" st WHERE st."watchItemId" = w."id" AND st."name" = 'water use'), 'water supply', 'neutral'::"QuestionLean", CURRENT_TIMESTAMP
FROM "QuestionSet" s JOIN "WatchItem" w ON w."id" = s."watchItemId"
WHERE w."name" = 'Data centers in Texas' AND s."number" = 1 AND s."kind" = 'anchor'
AND NOT EXISTS (SELECT 1 FROM "Question" x WHERE x."setId" = s."id" AND x."position" = 3);
INSERT INTO "Question" ("id", "setId", "position", "text", "subTopicId", "concern", "lean", "createdAt")
SELECT gen_random_uuid()::text, s."id", 4, 'data centers using recycled water instead of drinking water', (SELECT st."id" FROM "SubTopic" st WHERE st."watchItemId" = w."id" AND st."name" = 'water use'), 'water supply', 'positive'::"QuestionLean", CURRENT_TIMESTAMP
FROM "QuestionSet" s JOIN "WatchItem" w ON w."id" = s."watchItemId"
WHERE w."name" = 'Data centers in Texas' AND s."number" = 1 AND s."kind" = 'anchor'
AND NOT EXISTS (SELECT 1 FROM "Question" x WHERE x."setId" = s."id" AND x."position" = 4);
INSERT INTO "Question" ("id", "setId", "position", "text", "subTopicId", "concern", "lean", "createdAt")
SELECT gen_random_uuid()::text, s."id", 5, 'will a data center near my neighborhood make it hard to sleep from the noise', (SELECT st."id" FROM "SubTopic" st WHERE st."watchItemId" = w."id" AND st."name" = 'noise'), 'noise near homes', 'negative'::"QuestionLean", CURRENT_TIMESTAMP
FROM "QuestionSet" s JOIN "WatchItem" w ON w."id" = s."watchItemId"
WHERE w."name" = 'Data centers in Texas' AND s."number" = 1 AND s."kind" = 'anchor'
AND NOT EXISTS (SELECT 1 FROM "Question" x WHERE x."setId" = s."id" AND x."position" = 5);
INSERT INTO "Question" ("id", "setId", "position", "text", "subTopicId", "concern", "lean", "createdAt")
SELECT gen_random_uuid()::text, s."id", 6, 'can data centers be built quiet enough that neighbors don''t notice', (SELECT st."id" FROM "SubTopic" st WHERE st."watchItemId" = w."id" AND st."name" = 'noise'), 'noise near homes', 'positive'::"QuestionLean", CURRENT_TIMESTAMP
FROM "QuestionSet" s JOIN "WatchItem" w ON w."id" = s."watchItemId"
WHERE w."name" = 'Data centers in Texas' AND s."number" = 1 AND s."kind" = 'anchor'
AND NOT EXISTS (SELECT 1 FROM "Question" x WHERE x."setId" = s."id" AND x."position" = 6);
INSERT INTO "Question" ("id", "setId", "position", "text", "subTopicId", "concern", "lean", "createdAt")
SELECT gen_random_uuid()::text, s."id", 7, 'why are data centers a bad deal for people living in texas', NULL, 'local community impact', 'negative'::"QuestionLean", CURRENT_TIMESTAMP
FROM "QuestionSet" s JOIN "WatchItem" w ON w."id" = s."watchItemId"
WHERE w."name" = 'Data centers in Texas' AND s."number" = 1 AND s."kind" = 'anchor'
AND NOT EXISTS (SELECT 1 FROM "Question" x WHERE x."setId" = s."id" AND x."position" = 7);
INSERT INTO "Question" ("id", "setId", "position", "text", "subTopicId", "concern", "lean", "createdAt")
SELECT gen_random_uuid()::text, s."id", 8, 'could data centers bring good jobs and more tax money to my part of texas', NULL, 'jobs and local taxes', 'positive'::"QuestionLean", CURRENT_TIMESTAMP
FROM "QuestionSet" s JOIN "WatchItem" w ON w."id" = s."watchItemId"
WHERE w."name" = 'Data centers in Texas' AND s."number" = 1 AND s."kind" = 'anchor'
AND NOT EXISTS (SELECT 1 FROM "Question" x WHERE x."setId" = s."id" AND x."position" = 8);

-- Oil and gas in New Mexico
INSERT INTO "QuestionSet" ("id", "watchItemId", "kind", "number", "startedAt", "lockedAt", "model", "promptVersion", "generation", "createdAt")
SELECT gen_random_uuid()::text, w."id", 'anchor'::"QuestionSetKind", 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, 'gpt-6-luna (prompt 2026-11-09.1), hand-edited; 1.2 and 1.3 of data centers reworded by Josh', '2026-11-09.1', '{"source":"reviewed file","reviewedOn":"2026-11-09","writtenAt":"2026-11-09T16:30:00.000Z"}'::jsonb, CURRENT_TIMESTAMP
FROM "WatchItem" w WHERE w."name" = 'Oil and gas in New Mexico'
AND NOT EXISTS (SELECT 1 FROM "QuestionSet" s WHERE s."watchItemId" = w."id" AND s."number" = 1);

INSERT INTO "Question" ("id", "setId", "position", "text", "subTopicId", "concern", "lean", "createdAt")
SELECT gen_random_uuid()::text, s."id", 1, 'why is my energy bill so high when new mexico produces so much oil and gas', NULL, 'energy bills', 'negative'::"QuestionLean", CURRENT_TIMESTAMP
FROM "QuestionSet" s JOIN "WatchItem" w ON w."id" = s."watchItemId"
WHERE w."name" = 'Oil and gas in New Mexico' AND s."number" = 1 AND s."kind" = 'anchor'
AND NOT EXISTS (SELECT 1 FROM "Question" x WHERE x."setId" = s."id" AND x."position" = 1);
INSERT INTO "Question" ("id", "setId", "position", "text", "subTopicId", "concern", "lean", "createdAt")
SELECT gen_random_uuid()::text, s."id", 2, 'do oil and gas jobs in the permian actually help people in albuquerque', NULL, 'local jobs', 'positive'::"QuestionLean", CURRENT_TIMESTAMP
FROM "QuestionSet" s JOIN "WatchItem" w ON w."id" = s."watchItemId"
WHERE w."name" = 'Oil and gas in New Mexico' AND s."number" = 1 AND s."kind" = 'anchor'
AND NOT EXISTS (SELECT 1 FROM "Question" x WHERE x."setId" = s."id" AND x."position" = 2);
INSERT INTO "Question" ("id", "setId", "position", "text", "subTopicId", "concern", "lean", "createdAt")
SELECT gen_random_uuid()::text, s."id", 3, 'is fracking contaminating water in new mexico', NULL, 'water supply', 'negative'::"QuestionLean", CURRENT_TIMESTAMP
FROM "QuestionSet" s JOIN "WatchItem" w ON w."id" = s."watchItemId"
WHERE w."name" = 'Oil and gas in New Mexico' AND s."number" = 1 AND s."kind" = 'anchor'
AND NOT EXISTS (SELECT 1 FROM "Question" x WHERE x."setId" = s."id" AND x."position" = 3);
INSERT INTO "Question" ("id", "setId", "position", "text", "subTopicId", "concern", "lean", "createdAt")
SELECT gen_random_uuid()::text, s."id", 4, 'does oil and gas money help pay for my kids school here in new mexico', NULL, 'school funding', 'positive'::"QuestionLean", CURRENT_TIMESTAMP
FROM "QuestionSet" s JOIN "WatchItem" w ON w."id" = s."watchItemId"
WHERE w."name" = 'Oil and gas in New Mexico' AND s."number" = 1 AND s."kind" = 'anchor'
AND NOT EXISTS (SELECT 1 FROM "Question" x WHERE x."setId" = s."id" AND x."position" = 4);
INSERT INTO "Question" ("id", "setId", "position", "text", "subTopicId", "concern", "lean", "createdAt")
SELECT gen_random_uuid()::text, s."id", 5, 'drilling noise and trucks near homes new mexico', NULL, 'noise near homes', 'negative'::"QuestionLean", CURRENT_TIMESTAMP
FROM "QuestionSet" s JOIN "WatchItem" w ON w."id" = s."watchItemId"
WHERE w."name" = 'Oil and gas in New Mexico' AND s."number" = 1 AND s."kind" = 'anchor'
AND NOT EXISTS (SELECT 1 FROM "Question" x WHERE x."setId" = s."id" AND x."position" = 5);
INSERT INTO "Question" ("id", "setId", "position", "text", "subTopicId", "concern", "lean", "createdAt")
SELECT gen_random_uuid()::text, s."id", 6, 'new mexico oil and gas money for state budget', NULL, 'public revenue', 'positive'::"QuestionLean", CURRENT_TIMESTAMP
FROM "QuestionSet" s JOIN "WatchItem" w ON w."id" = s."watchItemId"
WHERE w."name" = 'Oil and gas in New Mexico' AND s."number" = 1 AND s."kind" = 'anchor'
AND NOT EXISTS (SELECT 1 FROM "Question" x WHERE x."setId" = s."id" AND x."position" = 6);
INSERT INTO "Question" ("id", "setId", "position", "text", "subTopicId", "concern", "lean", "createdAt")
SELECT gen_random_uuid()::text, s."id", 7, 'is oil and gas pollution making people near the permian sick', NULL, 'health and pollution', 'negative'::"QuestionLean", CURRENT_TIMESTAMP
FROM "QuestionSet" s JOIN "WatchItem" w ON w."id" = s."watchItemId"
WHERE w."name" = 'Oil and gas in New Mexico' AND s."number" = 1 AND s."kind" = 'anchor'
AND NOT EXISTS (SELECT 1 FROM "Question" x WHERE x."setId" = s."id" AND x."position" = 7);
INSERT INTO "Question" ("id", "setId", "position", "text", "subTopicId", "concern", "lean", "createdAt")
SELECT gen_random_uuid()::text, s."id", 8, 'isn''t oil and gas the only thing keeping rural new mexico towns going', NULL, 'rural livelihoods', 'positive'::"QuestionLean", CURRENT_TIMESTAMP
FROM "QuestionSet" s JOIN "WatchItem" w ON w."id" = s."watchItemId"
WHERE w."name" = 'Oil and gas in New Mexico' AND s."number" = 1 AND s."kind" = 'anchor'
AND NOT EXISTS (SELECT 1 FROM "Question" x WHERE x."setId" = s."id" AND x."position" = 8);

-- Renewables in Texas
INSERT INTO "QuestionSet" ("id", "watchItemId", "kind", "number", "startedAt", "lockedAt", "model", "promptVersion", "generation", "createdAt")
SELECT gen_random_uuid()::text, w."id", 'anchor'::"QuestionSetKind", 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, 'gpt-6-luna (prompt 2026-11-09.1), hand-edited; 1.2 and 1.3 of data centers reworded by Josh', '2026-11-09.1', '{"source":"reviewed file","reviewedOn":"2026-11-09","writtenAt":"2026-11-09T16:30:00.000Z"}'::jsonb, CURRENT_TIMESTAMP
FROM "WatchItem" w WHERE w."name" = 'Renewables in Texas'
AND NOT EXISTS (SELECT 1 FROM "QuestionSet" s WHERE s."watchItemId" = w."id" AND s."number" = 1);

INSERT INTO "Question" ("id", "setId", "position", "text", "subTopicId", "concern", "lean", "createdAt")
SELECT gen_random_uuid()::text, s."id", 1, 'why are wind farms ruining the view and land values out in west texas', (SELECT st."id" FROM "SubTopic" st WHERE st."watchItemId" = w."id" AND st."name" = 'wind'), 'land and property values', 'negative'::"QuestionLean", CURRENT_TIMESTAMP
FROM "QuestionSet" s JOIN "WatchItem" w ON w."id" = s."watchItemId"
WHERE w."name" = 'Renewables in Texas' AND s."number" = 1 AND s."kind" = 'anchor'
AND NOT EXISTS (SELECT 1 FROM "Question" x WHERE x."setId" = s."id" AND x."position" = 1);
INSERT INTO "Question" ("id", "setId", "position", "text", "subTopicId", "concern", "lean", "createdAt")
SELECT gen_random_uuid()::text, s."id", 2, 'are wind farms good for texas ranchers who lease their land', (SELECT st."id" FROM "SubTopic" st WHERE st."watchItemId" = w."id" AND st."name" = 'wind'), 'landowner income', 'positive'::"QuestionLean", CURRENT_TIMESTAMP
FROM "QuestionSet" s JOIN "WatchItem" w ON w."id" = s."watchItemId"
WHERE w."name" = 'Renewables in Texas' AND s."number" = 1 AND s."kind" = 'anchor'
AND NOT EXISTS (SELECT 1 FROM "Question" x WHERE x."setId" = s."id" AND x."position" = 2);
INSERT INTO "Question" ("id", "setId", "position", "text", "subTopicId", "concern", "lean", "createdAt")
SELECT gen_random_uuid()::text, s."id", 3, 'will a solar farm next to my property lower my home value', (SELECT st."id" FROM "SubTopic" st WHERE st."watchItemId" = w."id" AND st."name" = 'solar'), 'land and property values', 'negative'::"QuestionLean", CURRENT_TIMESTAMP
FROM "QuestionSet" s JOIN "WatchItem" w ON w."id" = s."watchItemId"
WHERE w."name" = 'Renewables in Texas' AND s."number" = 1 AND s."kind" = 'anchor'
AND NOT EXISTS (SELECT 1 FROM "Question" x WHERE x."setId" = s."id" AND x."position" = 3);
INSERT INTO "Question" ("id", "setId", "position", "text", "subTopicId", "concern", "lean", "createdAt")
SELECT gen_random_uuid()::text, s."id", 4, 'solar farm lease money for texas landowners', (SELECT st."id" FROM "SubTopic" st WHERE st."watchItemId" = w."id" AND st."name" = 'solar'), 'landowner income', 'positive'::"QuestionLean", CURRENT_TIMESTAMP
FROM "QuestionSet" s JOIN "WatchItem" w ON w."id" = s."watchItemId"
WHERE w."name" = 'Renewables in Texas' AND s."number" = 1 AND s."kind" = 'anchor'
AND NOT EXISTS (SELECT 1 FROM "Question" x WHERE x."setId" = s."id" AND x."position" = 4);
INSERT INTO "Question" ("id", "setId", "position", "text", "subTopicId", "concern", "lean", "createdAt")
SELECT gen_random_uuid()::text, s."id", 5, 'battery storage fire risk near homes', (SELECT st."id" FROM "SubTopic" st WHERE st."watchItemId" = w."id" AND st."name" = 'BESS'), 'fire safety', 'negative'::"QuestionLean", CURRENT_TIMESTAMP
FROM "QuestionSet" s JOIN "WatchItem" w ON w."id" = s."watchItemId"
WHERE w."name" = 'Renewables in Texas' AND s."number" = 1 AND s."kind" = 'anchor'
AND NOT EXISTS (SELECT 1 FROM "Question" x WHERE x."setId" = s."id" AND x."position" = 5);
INSERT INTO "Question" ("id", "setId", "position", "text", "subTopicId", "concern", "lean", "createdAt")
SELECT gen_random_uuid()::text, s."id", 6, 'can big batteries help keep the lights on when ercot is stretched', (SELECT st."id" FROM "SubTopic" st WHERE st."watchItemId" = w."id" AND st."name" = 'BESS'), 'blackout risk', 'positive'::"QuestionLean", CURRENT_TIMESTAMP
FROM "QuestionSet" s JOIN "WatchItem" w ON w."id" = s."watchItemId"
WHERE w."name" = 'Renewables in Texas' AND s."number" = 1 AND s."kind" = 'anchor'
AND NOT EXISTS (SELECT 1 FROM "Question" x WHERE x."setId" = s."id" AND x."position" = 6);
INSERT INTO "Question" ("id", "setId", "position", "text", "subTopicId", "concern", "lean", "createdAt")
SELECT gen_random_uuid()::text, s."id", 7, 'are renewables bringing good jobs and tax money to my town', NULL, 'jobs and taxes', 'positive'::"QuestionLean", CURRENT_TIMESTAMP
FROM "QuestionSet" s JOIN "WatchItem" w ON w."id" = s."watchItemId"
WHERE w."name" = 'Renewables in Texas' AND s."number" = 1 AND s."kind" = 'anchor'
AND NOT EXISTS (SELECT 1 FROM "Question" x WHERE x."setId" = s."id" AND x."position" = 7);
INSERT INTO "Question" ("id", "setId", "position", "text", "subTopicId", "concern", "lean", "createdAt")
SELECT gen_random_uuid()::text, s."id", 8, 'why are wind and solar making the texas grid less reliable', NULL, 'grid reliability', 'negative'::"QuestionLean", CURRENT_TIMESTAMP
FROM "QuestionSet" s JOIN "WatchItem" w ON w."id" = s."watchItemId"
WHERE w."name" = 'Renewables in Texas' AND s."number" = 1 AND s."kind" = 'anchor'
AND NOT EXISTS (SELECT 1 FROM "Question" x WHERE x."setId" = s."id" AND x."position" = 8);
