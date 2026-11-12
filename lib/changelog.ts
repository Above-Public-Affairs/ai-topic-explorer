/**
 * The in-site changelog shown from the footer. Kept out of the page's
 * JavaScript: the footer loads this module only when the changelog is opened
 * (task 6.6, speed review 9). Add an entry for every user-facing change.
 */
export interface ChangelogDay {
  date: string;
  changes: string[];
}

export const CHANGELOG: ChangelogDay[] = [
  {
    date: "Nov 11",
    changes: [
      "Key Themes no longer shows near-duplicates side by side: \"Technical hurdles\" and \"Technical challenges\" are now one theme, sized by how many AIs raised it",
      "Collapsing a long answer or an argument list keeps you where you were, instead of leaving you far down the page",
      "Shared results links now show a preview image with the topic, in Messages, Slack, X and elsewhere",
      "On phones, Share opens your phone's share sheet. On a computer it still copies the link",
      "Each source is listed once, even when the AIs linked it in slightly different ways, and sources from one website are grouped together. Tracking codes are now removed from every link",
      "Larger tap targets on phones, a slimmer header when your phone is sideways, and the changelog is now in every page's footer",
      "Closing a pop-up puts you back on the button that opened it, and the bug report box no longer zooms the page on iPhone",
      "Added a privacy policy, linked from the footer, the topic box and the bug report form. It says what happens to the topics you type, what our usage stats record, and what a bug report sends",
      "Usage stats moved to a new, fully set-up Google Analytics property. Sources opened from the Arguments section are now counted too, by website only",
      "Long theme names now wrap instead of being cut off, and on phones the topic at the top shows on up to two lines",
      "Screen readers now say when a link opens in a new tab",
      "Pages start drawing a little sooner, and the changelog loads only when you open it",
      "Steadier limits on how many analyses run at once, so the site stays within its daily budget",
    ],
  },
  {
    date: "Nov 9",
    changes: [
      "Usage stats now cover every page, including ones you reach without a reload, so we can see which features help people most. Sources you open are counted by website, not by full address",
    ],
  },
  {
    date: "Nov 7",
    changes: [
      "Each AI is now asked your topic the way a person would ask it, with its own web search on, and its full answer is shown as written",
      "See the sources each AI actually cited, beside its answer",
      "New Arguments section: the case for and against that the answers make, and which AIs made it",
      "Named entities now include places and laws, not just people and organizations, and one name written different ways (\"HARC\" and its full name) is listed once",
      "Each answer shows its overall tone and how it frames the topic",
      "Each AI runs the model its free version uses by default, updated as that changes. Gemini now uses Gemini Flash-Lite",
      "Topics are no longer split into subtopics first, so results come back sooner",
      "Older saved results still open as they were, with a note that they come from an earlier version and a link to run the topic again",
      "Grok's numbered citations now point to the matching source in its list, and every AI's sources are listed in the order its answer cites them",
      "Sources are tidier: the same page linked with tracking codes is listed once, and unreadable titles are replaced with readable ones",
      "Answers are set for easier reading: larger text, shorter lines, and no \"I'll search for…\" line at the top of Claude's answer",
      "Easier to read and use with a keyboard or screen reader: stronger text contrast, visible focus, a skip link, pop-ups that hold and return focus and close with Escape, progress and errors that are announced, and AI status shown with icons as well as color",
      "The floating words on the home page can be paused, stop while an analysis runs, and stay still if you've asked your device to reduce motion",
      "Results pages are named after their topic in your browser tab, and load faster",
      "The Report a Bug button is a small icon on phones, so it no longer covers the text",
    ],
  },
  {
    date: "Nov 6",
    changes: [
      "Compare four AI models: Claude, ChatGPT, Gemini and Grok. Perplexity has been removed",
      "Each model now runs the version free users get by default: GPT-6 Luna for ChatGPT, Grok 4.3, and Gemini 3.6 Flash",
      "Topic expansion now uses Claude Haiku 5.5",
      "Topics can be up to 300 characters",
      "Bug reports now tell you if they couldn't be sent",
      "Your analysis is saved even if you close the tab before it finishes",
      "Long analyses finish before your browser gives up on them, and slow topic expansion is cancelled instead of left running",
      "Older or damaged saved results open with whatever survives, or a page offering to run the topic again, instead of an error",
      "Clearer reasons when a provider's safety filter blocks an answer, returns nothing, or runs out of prepaid credit",
    ],
  },
  {
    date: "Oct 28",
    changes: [
      "Gemini retries when Google is busy and falls back to a lighter model, so it drops out of comparisons less often",
      "Claude's analysis now uses Claude Sonnet 5.5, and Gemini's uses Gemini 3.5 Flash",
      "Fewer cut-off responses, so named entities, citations and themes come through more reliably",
      "Keep stray formatting out of the word cloud when a response is cut off",
      "Clearer reasons when an AI provider is unavailable, such as a blocked API key or an exhausted quota",
    ],
  },
  {
    date: "Aug 20",
    changes: [
      "Fix a bug where one malformed field in an AI's response threw away that provider's entire analysis",
      "Cancel timed-out provider requests properly and retry rate-limited ones, so fewer providers drop out of a comparison",
    ],
  },
  {
    date: "Aug 6",
    changes: [
      "Keep partial Claude results when a response is cut short instead of dropping the whole query",
      "Give each provider query more time to finish so healthy requests aren't cancelled mid-answer",
    ],
  },
  {
    date: "Jul 22",
    changes: [
      "Stream Claude responses and cancel timed-out requests to cut down on provider timeouts",
    ],
  },
  {
    date: "Mar 12",
    changes: [
      "Fix Claude timeouts by increasing provider timeout to 90s and reducing max response length",
      "Add timeout to query expansion to prevent indefinite hangs",
    ],
  },
  {
    date: "Mar 10",
    changes: [
      "Add beta announcement banner at the top of every page",
      "Add floating 'Report a Bug' button with submission form",
    ],
  },
  {
    date: "Feb 15",
    changes: [
      "Show specific error reasons when an AI provider fails (timeout, rate limit, API error, etc.)",
      "Fix text overflow issues on small screens for entities, citations, and word context",
      "Add error reporting for daily error reports",
    ],
  },
  {
    date: "Feb 14",
    changes: [
      "Upgrade Gemini from deprecated 2.0 Flash to 2.5 Flash to fix failures",
      "Update metadata, OG image, and Apple icon to reflect all 5 AI platforms",
      "Disable Gemini safety filters so sensitive topics aren't blocked",
      "Increase provider timeout to 60s so Claude has enough time to respond",
      "Change Grok pill to red to match X/Twitter branding",
      "Add stability improvements: DB save retry, client-side timeout, abort on disconnect, data validation",
      "Fix analysis timeout by switching Gemini to faster model and adding per-provider timeouts",
      "Hide changelog link on results page to reduce sidebar clutter",
      "Replace Web Perspective with lightweight Perplexity section showing related questions",
      "Show top 10 citations with same-domain companions, compact single-line layout",
      "Cap named entities at 15 per category, sorted by number of mentions",
      "Show provider pills next to each named entity showing which AI mentioned it",
      "Rename X section to 'X Perspective' with Grok pill, clarify phrases are AI-generated",
      "Cut X Perspective phrases from 15 to 8 with longer talking points",
      "Add explainer subtitles to Citations and Related Questions sections",
      "Add Grok (xAI) as 5th AI provider with separate X / Social Perspective section",
      "Add changelog modal to footer",
      "Add GA4 analytics, event tracking, and increase max AI response length",
      "Add OpenAI, Gemini, and Perplexity providers for multi-AI comparison",
    ],
  },
  {
    date: "Feb 13",
    changes: [
      "Fix mobile overflow on Key Themes, Citations, and main content area",
      "Add OG/Twitter metadata, expand floating keywords, and improve UI polish",
    ],
  },
];
