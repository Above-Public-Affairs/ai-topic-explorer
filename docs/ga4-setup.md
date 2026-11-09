# Google Analytics 4 setup

The public site sends to GA4 property **G-6WT4RP9NQD** (set as `NEXT_PUBLIC_GA_MEASUREMENT_ID` on Railway; it's a build-time variable, so changing it needs a rebuild). The code is in `lib/analytics.ts` (event catalog, page views, the inline gtag queue) and `components/AnalyticsTracker.tsx` (route-change page views, source-link clicks).

## What the site sends

| Event | When | Params |
|---|---|---|
| `page_view` | Landing page (sent by GA's config), then every client-side route change (sent by the site) | `page_location`, `page_referrer`, `page_title` |
| `topic_searched` | Analyze pressed | `topic` (as typed; GA keeps the first 100 characters), `topic_length` |
| `example_topic_clicked` | An example topic pill | `topic` |
| `analysis_started` | Analysis begins | `topic_length` |
| `analysis_completed` | Results are ready | `duration_sec`, `ais_answered`, `ais_asked` |
| `analysis_abandoned` | Tab closed or left mid-analysis | `duration_sec`, `stage`, `ais_answered` |
| `error_shown` | An error message shown to the visitor | `error_type`, `error_area` (`analysis` or `bug_report`) |
| `results_viewed` | A results page opens | `layout` (`new` or `old`), `ais_answered`, `from_share` |
| `share` | Share button copies the link | `method`, `content_type`, `item_id`, `placement` |
| `shared_link_opened` | Someone opens a link copied with Share (`?ref=share`) | `item_id` |
| `source_link_opened` | A cited source is opened | `source_domain` (domain only), `link_area` |
| `modal_opened` | How it works, changelog, bug report | `modal` |
| `theme_clicked` / `word_clicked` | A theme or word cloud word (opens it in context) | `theme` / `word` |
| `answer_tab_selected` / `answer_expanded` | Answer tabs | `provider` |
| `new_topic_clicked` | New Topic on a results page | `placement` |
| `bug_report_sent` | A bug report was delivered | none |

No user IDs, emails or full source URLs are sent. GA4 doesn't log IP addresses; Google signals and ad personalization are switched off in the tag.

**Checking it:** add `?ga_debug=1` to any URL and that tab's hits show in **Admin → DebugView** (debug hits stay out of reports).

## Admin checklist (one time, in GA)

1. **Enhanced measurement** (Admin → Data streams → the web stream → Enhanced measurement → gear):
   - Under **Page views → Show advanced settings**, untick "Page changes based on browser history events" and leave "Page loads" ticked (the Page views switch itself can't be turned off). The site sends its own page views on navigation; leaving this on counts every in-app page twice.
   - Turn **off** "Outbound clicks". It sends the full URL of every link clicked; `source_link_opened` replaces it with the domain only.
   - Leave scrolls, file downloads and form interactions as they are.
2. **Key events** (Admin → Events, after each event has fired once, or Admin → Key events → New key event and type the name):
   - `analysis_completed`
   - `share`
   - Optional: `shared_link_opened`, `bug_report_sent`
3. **Custom dimensions** (Admin → Custom definitions → Create custom dimension, scope **Event**, with the event parameter named exactly as below; the dimension name can match):
   `topic`, `error_type`, `error_area`, `layout`, `from_share`, `source_domain`, `link_area`, `modal`, `theme`, `word`, `provider`, `placement`, `stage`, `method`
4. **Custom metrics** (same page, Custom metrics tab, scope Event): `duration_sec` (unit: seconds), `ais_answered`, `ais_asked`, `topic_length` (standard).
5. **Data retention** (Admin → Data collection and modification → Data retention): event data **14 months**. Turn on "Reset user data on new activity" if you like.
6. **Optional: internal traffic.** Admin → Data streams → web stream → Configure tag settings → Define internal traffic: add the office IP, then Admin → Data filters → Internal Traffic → set to Active.
7. **Optional: Search Console.** Admin → Product links → Search Console links → Link, and pick the aitopicexplorer.app property.
