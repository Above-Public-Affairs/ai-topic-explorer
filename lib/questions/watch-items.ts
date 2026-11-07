/**
 * The watch items Josh confirmed (PROJECT-PLAN §4A). Seeded into WatchItem
 * and SubTopic by migration 20261107230100 (a test checks the two match).
 * Later items are added the same way: a new additive migration.
 *
 * We track industries and topics, not clients: nothing here names one.
 */
export interface WatchItemSeed {
  name: string;
  topic: string;
  geography: string | null;
  askCity: string;
  askRegion: string;
  askCountry: string;
  askTimezone: string;
  /** Sub-topics live inside their parent item; the anchor set covers each. */
  subTopics: string[];
}

export const WATCH_ITEMS: WatchItemSeed[] = [
  {
    name: "Data centers in Texas",
    topic: "Data centers",
    geography: "Texas",
    askCity: "Austin",
    askRegion: "Texas",
    askCountry: "US",
    askTimezone: "America/Chicago",
    subTopics: ["power generation", "water use", "noise"],
  },
  {
    name: "Oil and gas in New Mexico",
    topic: "Oil and gas",
    geography: "New Mexico",
    askCity: "Albuquerque",
    askRegion: "New Mexico",
    askCountry: "US",
    askTimezone: "America/Denver",
    subTopics: [],
  },
  {
    name: "Renewables in Texas",
    topic: "Renewables",
    geography: "Texas",
    askCity: "Austin",
    askRegion: "Texas",
    askCountry: "US",
    askTimezone: "America/Chicago",
    subTopics: ["wind", "solar", "BESS"],
  },
];
