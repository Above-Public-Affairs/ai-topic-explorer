"use client";

import {
  useState,
  useEffect,
  useMemo,
  useCallback,
  useRef,
  useSyncExternalStore,
} from "react";
import { useRouter } from "next/navigation";
import FloatingKeywords from "@/components/FloatingKeywords";
import Footer from "@/components/Footer";
import Dialog from "@/components/Dialog";
import CloseButton from "@/components/CloseButton";
import AnalysisProgressPanel from "@/components/AnalysisProgressPanel";
import { secondsSince, trackEvent, type ErrorType } from "@/lib/analytics";
import { PRIVACY_POLICY_URL } from "@/lib/privacy";
import { MAX_TOPIC_LENGTH } from "@/lib/guards/limits";

const ALL_TOPICS = [
  // Science & Technology
  "Climate change policy",
  "Artificial intelligence ethics",
  "Quantum computing breakthroughs",
  "Gene editing with CRISPR",
  "Nuclear fusion progress",
  "Dark matter research",
  "Antibiotic resistance",
  "Microplastics in food",
  "Brain-computer interfaces",
  "Synthetic biology applications",
  "Gravitational wave discoveries",
  "Lab-grown meat industry",
  "Nanotechnology in medicine",
  "Deep sea exploration",
  "Asteroid mining feasibility",
  "Stem cell therapy advances",
  "Quantum internet development",
  "Bioprinting human organs",
  "Neuromorphic computing",
  "RNA therapeutics beyond vaccines",
  "Photonic chip technology",
  "Carbon capture technologies",
  "Solid-state battery development",
  "Protein folding breakthroughs",
  "Superconductor research",

  // Energy & Environment
  "Renewable energy in Texas",
  "Oil and gas in New Mexico",
  "Ocean plastic pollution",
  "Water scarcity solutions",
  "Electric vehicle adoption",
  "Geothermal energy expansion",
  "Hydrogen fuel cell vehicles",
  "Solar panel recycling",
  "Offshore wind farms",
  "Deforestation in the Amazon",
  "Coral reef restoration",
  "Permafrost thawing effects",
  "Wildfire prevention technology",
  "Urban heat island mitigation",
  "Desalination breakthroughs",
  "Agrivoltaics and dual-use farming",
  "Methane emissions tracking",
  "Rare earth mineral mining",
  "Grid-scale energy storage",
  "Rewilding initiatives in Europe",

  // Space
  "Space exploration missions",
  "Mars colonization challenges",
  "James Webb Telescope discoveries",
  "Space debris cleanup",
  "Lunar base construction",
  "Exoplanet habitability",
  "Commercial space tourism",
  "Space-based solar power",
  "Satellite mega-constellations",
  "Search for extraterrestrial life",

  // Health & Medicine
  "Mental health in teens",
  "Psychedelic-assisted therapy",
  "Gut microbiome and health",
  "Long COVID research",
  "Alzheimer's treatment progress",
  "Global vaccine distribution",
  "Telemedicine adoption",
  "Personalized medicine genomics",
  "Obesity drug breakthroughs",
  "Sleep science discoveries",
  "Maternal mortality disparities",
  "Wearable health technology",
  "Cancer immunotherapy advances",
  "Longevity and aging research",
  "Pandemic preparedness strategy",
  "Mental health in the workplace",
  "Rare disease treatments",
  "Fentanyl crisis solutions",
  "Digital therapeutics",
  "Global malaria eradication",

  // AI & Computing
  "Generative AI in education",
  "Cybersecurity threats in 2026",
  "AI in drug discovery",
  "Deepfake detection methods",
  "AI-generated art copyright",
  "Large language model bias",
  "Autonomous vehicle regulation",
  "AI in criminal justice",
  "Robotics in elder care",
  "Open source AI models",
  "AI chip competition",
  "Machine learning in weather forecasting",
  "AI regulation in the EU",
  "Computer vision in agriculture",
  "AI-powered scientific research",
  "Edge computing applications",
  "Digital twin technology",
  "Prompt engineering techniques",
  "AI in music composition",
  "Embodied AI and robotics",

  // Society & Culture
  "Remote work and productivity",
  "Social media effects on democracy",
  "Digital privacy rights",
  "Universal basic income trials",
  "Misinformation and media literacy",
  "Gig economy worker protections",
  "Homelessness solutions in cities",
  "Online education quality",
  "Digital nomad visa programs",
  "Content moderation challenges",
  "Aging population economics",
  "Affordable housing crisis",
  "Student loan debt impact",
  "Immigration policy reform",
  "Rural broadband expansion",
  "Prison reform and recidivism",
  "Food insecurity in America",
  "Gender pay gap analysis",
  "Childhood literacy programs",
  "Public transit modernization",

  // Economics & Business
  "Blockchain in supply chains",
  "Central bank digital currencies",
  "Semiconductor supply chain",
  "Creator economy growth",
  "ESG investing debate",
  "Inflation and monetary policy",
  "Commercial real estate future",
  "Subscription economy trends",
  "Trade war economic impacts",
  "Venture capital in Africa",
  "Small business AI adoption",
  "Four-day work week experiments",
  "Cryptocurrency regulation globally",
  "Nearshoring manufacturing trends",
  "Sovereign wealth fund strategies",

  // Geopolitics & Global Affairs
  "Arctic territorial disputes",
  "Semiconductor geopolitics",
  "Africa's economic transformation",
  "South China Sea tensions",
  "NATO expansion implications",
  "Global water conflict risks",
  "Nuclear proliferation threats",
  "Latin America political shifts",
  "Middle East diplomatic realignment",
  "Pacific Island climate migration",

  // History & Philosophy
  "Ancient Roman engineering",
  "Philosophy of consciousness",
  "History of cryptography",
  "Indigenous knowledge systems",
  "Evolution of human language",
  "Medieval Islamic golden age",
  "Ethics of human enhancement",
  "History of pandemics",
  "Silk Road trade networks",
  "Stoicism in modern life",

  // Food & Agriculture
  "Vertical farming viability",
  "Regenerative agriculture",
  "Global coffee supply threats",
  "Precision agriculture technology",
  "Food waste reduction strategies",
  "Pollinator decline impacts",
  "Cultured seafood development",
  "Soil health restoration",
  "Urban farming movements",
  "Fermentation technology revival",

  // Arts & Media
  "Streaming industry consolidation",
  "Video game preservation",
  "AI in filmmaking",
  "Podcast industry economics",
  "Museum digital transformation",
  "Independent journalism survival",
  "Virtual reality storytelling",
  "Music industry streaming royalties",
  "Public library evolution",
  "Documentary filmmaking ethics",

  // Sports & Recreation
  "Concussion research in sports",
  "Esports industry growth",
  "Women's sports investment",
  "Sports analytics revolution",
  "Olympic hosting economics",

  // Education
  "Coding bootcamp effectiveness",
  "Montessori education outcomes",
  "Multilingual education benefits",
  "Trade school renaissance",
  "Neuroscience of learning",
];

function pickRandom<T>(arr: T[], count: number): T[] {
  const shuffled = [...arr].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, count);
}

type ProviderStatus = "pending" | "loading" | "done" | "failed";
type Stage = "querying" | "merging" | "complete" | "error";

/** The ?topic= query param, read from the browser URL. */
function readTopicParam(): string | null {
  return (
    new URLSearchParams(window.location.search)
      .get("topic")
      ?.slice(0, MAX_TOPIC_LENGTH) ?? null
  );
}

/** The URL is read once per render; nothing needs to re-render on change. */
function subscribeToNothing(): () => void {
  return () => {};
}

/**
 * A value that `next()` replaces every `intervalMs` while anything is
 * subscribed, for useSyncExternalStore.
 */
function createRotatingStore(next: () => string, intervalMs: number) {
  let value = "";
  const listeners = new Set<() => void>();
  let timer: ReturnType<typeof setInterval> | null = null;
  const rotate = () => {
    value = next();
    listeners.forEach((listener) => listener());
  };
  return {
    getSnapshot: () => value,
    subscribe(listener: () => void) {
      listeners.add(listener);
      if (!timer) {
        timer = setInterval(rotate, intervalMs);
        rotate();
      }
      return () => {
        listeners.delete(listener);
        if (listeners.size === 0 && timer) {
          clearInterval(timer);
          timer = null;
        }
      };
    },
  };
}

interface ProgressState {
  active: boolean;
  stage: Stage;
  providers: Record<string, ProviderStatus>;
  providerErrors: Record<string, string>;
  elapsedSeconds: number;
  errorMessage?: string;
}

export default function Home() {
  const [topic, setTopic] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");
  const [showMethodology, setShowMethodology] = useState(false);
  const [progress, setProgress] = useState<ProgressState | null>(null);
  const router = useRouter();
  const closeMethodology = useCallback(() => setShowMethodology(false), []);
  // Random examples can't be rendered on the server: its pick and the
  // browser's would differ (a hydration error). The server renders the first
  // five, hidden so they hold the row's height, and the browser swaps in a
  // random five that fade in.
  const isClient = useSyncExternalStore(subscribeToNothing, () => true, () => false);
  const exampleTopics = useMemo(
    () => (isClient ? pickRandom(ALL_TOPICS, 5) : ALL_TOPICS.slice(0, 5)),
    [isClient]
  );
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const topicInputRef = useRef<HTMLInputElement>(null);
  // While a run goes, the locked box shows the start of the topic, not the
  // end where the caret was ("…beekeeping rules" with "Rooftop" cut off).
  useEffect(() => {
    const input = topicInputRef.current;
    if (!isLoading || !input) return;
    input.setSelectionRange(0, 0);
    input.scrollLeft = 0;
  }, [isLoading]);
  // The analysis in flight, for analytics: when it started, how far it got,
  // and how many AIs have answered. Null when none is running.
  const runRef = useRef<{ startedAt: number; stage: string; answered: number; asked: number } | null>(null);

  // Leaving (closing the tab, navigating away) while an analysis runs.
  useEffect(() => {
    const reportAbandoned = () => {
      const run = runRef.current;
      if (!run) return;
      runRef.current = null;
      trackEvent("analysis_abandoned", {
        duration_sec: secondsSince(run.startedAt),
        stage: run.stage,
        ais_answered: run.answered,
      });
    };
    window.addEventListener("pagehide", reportAbandoned);
    return () => {
      window.removeEventListener("pagehide", reportAbandoned);
      reportAbandoned();
    };
  }, []);

  const getPlaceholderTopic = useCallback(() => {
    const remaining = ALL_TOPICS.filter((t) => !exampleTopics.includes(t));
    return remaining[Math.floor(Math.random() * remaining.length)];
  }, [exampleTopics]);

  // A fresh example topic every 5s. It's random, so it's read only on the
  // client: the server snapshot is "" and the input shows its fixed fallback.
  const [placeholderStore] = useState(() =>
    createRotatingStore(getPlaceholderTopic, 5000)
  );
  const placeholder = useSyncExternalStore(
    placeholderStore.subscribe,
    placeholderStore.getSnapshot,
    () => ""
  );

  // Pre-fill topic from ?topic= query param (e.g. from "Explore Further" links).
  // The URL is read only on the client, and copied into `topic` during render
  // (React's "adjust state on change" pattern) so it survives the URL cleanup
  // below.
  const prefilledTopic = useSyncExternalStore(
    subscribeToNothing,
    readTopicParam,
    () => null
  );
  const [appliedPrefill, setAppliedPrefill] = useState<string | null>(null);
  if (prefilledTopic && prefilledTopic !== appliedPrefill) {
    setAppliedPrefill(prefilledTopic);
    setTopic(prefilledTopic);
  }
  useEffect(() => {
    // Clean the URL without triggering navigation
    if (prefilledTopic) window.history.replaceState({}, "", "/");
  }, [prefilledTopic]);

  // Elapsed timer
  useEffect(() => {
    if (progress?.active) {
      timerRef.current = setInterval(() => {
        setProgress((prev) =>
          prev ? { ...prev, elapsedSeconds: prev.elapsedSeconds + 1 } : prev
        );
      }, 1000);
    } else if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [progress?.active]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isLoading) return;
    setError("");

    const trimmedTopic = topic.trim();
    if (!trimmedTopic) {
      setError("Please enter a topic to explore.");
      return;
    }

    setIsLoading(true);
    setProgress({
      active: true,
      stage: "querying",
      providers: {},
      providerErrors: {},
      elapsedSeconds: 0,
    });
    trackEvent("topic_searched", { topic: trimmedTopic, topic_length: trimmedTopic.length });
    trackEvent("analysis_started", { topic_length: trimmedTopic.length });
    runRef.current = { startedAt: performance.now(), stage: "starting", answered: 0, asked: 0 };
    const fail = (errorType: ErrorType) => {
      runRef.current = null;
      trackEvent("error_shown", { error_type: errorType, error_area: "analysis" });
    };

    const abortController = new AbortController();
    const streamTimeout = setTimeout(() => {
      abortController.abort();
    }, 3 * 60 * 1000); // 3 minute client-side timeout

    try {
      const response = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ topic: trimmedTopic }),
        signal: abortController.signal,
      });

      // Handle non-streaming error responses (rate limit, 503, validation)
      if (!response.ok) {
        if (response.status === 429) {
          fail("rate_limit");
          setError("You've reached the analysis limit. Please try again in a few minutes.");
        } else if (response.status === 503) {
          fail("unavailable");
          setError("Analysis is temporarily unavailable. Please try again later.");
        } else {
          const data = await response.json();
          fail("api_error");
          setError(data.error || "Analysis failed. Please try again.");
        }
        setIsLoading(false);
        setProgress(null);
        return;
      }

      // Read SSE stream
      const reader = response.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const chunks = buffer.split("\n\n");
        buffer = chunks.pop() || "";

        for (const chunk of chunks) {
          const line = chunk.trim();
          if (!line.startsWith("data: ")) continue;

          const event = JSON.parse(line.slice(6));

          switch (event.stage) {
            case "querying": {
              const providerMap: Record<string, ProviderStatus> = {};
              for (const p of event.providers) providerMap[p] = "loading";
              if (runRef.current) {
                runRef.current.stage = "querying";
                runRef.current.asked = event.providers.length;
              }
              setProgress((prev) =>
                prev ? { ...prev, stage: "querying", providers: providerMap } : prev
              );
              break;
            }

            case "provider_done":
              if (runRef.current) runRef.current.answered += 1;
              setProgress((prev) => {
                if (!prev) return prev;
                return {
                  ...prev,
                  providers: { ...prev.providers, [event.provider]: "done" },
                };
              });
              break;

            case "provider_failed":
              setProgress((prev) => {
                if (!prev) return prev;
                return {
                  ...prev,
                  providers: { ...prev.providers, [event.provider]: "failed" },
                  providerErrors: {
                    ...prev.providerErrors,
                    ...(event.reason ? { [event.provider]: event.reason } : {}),
                  },
                };
              });
              break;

            case "merging":
              if (runRef.current) runRef.current.stage = "merging";
              setProgress((prev) =>
                prev ? { ...prev, stage: "merging" } : prev
              );
              break;

            case "complete":
              clearTimeout(streamTimeout);
              setProgress((prev) =>
                prev ? { ...prev, stage: "complete", active: false } : prev
              );
              if (runRef.current) {
                const run = runRef.current;
                runRef.current = null;
                trackEvent("analysis_completed", {
                  duration_sec: secondsSince(run.startedAt),
                  ais_answered: run.answered,
                  ais_asked: run.asked,
                });
              }
              router.push(`/results/${event.id}`);
              return;

            case "error":
              clearTimeout(streamTimeout);
              setProgress((prev) =>
                prev
                  ? { ...prev, stage: "error", active: false, errorMessage: event.message }
                  : prev
              );
              fail("stream_error");
              setError(event.message || "Analysis failed. Please try again.");
              setIsLoading(false);
              return;
          }
        }
      }

      // Stream ended without complete/error event
      clearTimeout(streamTimeout);
      fail("ended_early");
      setError("Analysis ended unexpectedly. Please try again.");
      setIsLoading(false);
      setProgress(null);
    } catch (err) {
      clearTimeout(streamTimeout);
      if (err instanceof DOMException && err.name === "AbortError") {
        fail("timeout");
        setError("Analysis took too long. Please try again.");
      } else {
        fail("network");
        setError("Something went wrong. Please try again.");
      }
      setIsLoading(false);
      setProgress(null);
    }
  };

  return (
    <div className="min-h-screen flex flex-col">
      <main id="content" tabIndex={-1} className="flex-1 flex flex-col outline-none">
        {/* Split hero section */}
        <div className="flex-1 flex items-center relative">


          <div className="relative z-10 w-full max-w-7xl mx-auto px-6 md:px-10 md:min-h-[calc(100vh-80px)] md:flex md:items-center pointer-events-none">
            {/* LEFT — Search */}
            <div className="w-full md:w-1/2 py-16 md:py-0 pointer-events-auto min-w-0">
              <h1
                className="text-4xl md:text-5xl lg:text-6xl font-bold mb-4"
                style={{
                  background: "linear-gradient(to right, var(--text-primary), var(--accent-cyan), var(--accent-violet))",
                  WebkitBackgroundClip: "text",
                  WebkitTextFillColor: "transparent",
                  backgroundClip: "text",
                }}
              >
                AI Topic Explorer
              </h1>
              <p className="text-lg text-(--text-secondary) mb-10 max-w-lg leading-relaxed text-pretty">
                Ask Claude, ChatGPT, Gemini and Grok the same question and read
                their full answers side by side, with the sources they cite and
                where they agree and disagree.
              </p>

              {/* Input Form */}
              <form onSubmit={handleSubmit} className="mb-8" noValidate>
                <label htmlFor="topic" className="sr-only">
                  Topic to explore
                </label>
                <div className="flex flex-col sm:flex-row gap-3">
                  <input
                    ref={topicInputRef}
                    id="topic"
                    type="text"
                    enterKeyHint="go"
                    aria-invalid={error ? true : undefined}
                    aria-describedby={error ? "topic-error" : undefined}
                    value={topic}
                    onChange={(e) => setTopic(e.target.value)}
                    maxLength={MAX_TOPIC_LENGTH}
                    placeholder={placeholder ? `e.g. "${placeholder}"` : 'e.g. "oil and gas in New Mexico"'}
                    className="flex-1 min-w-0 px-5 py-3.5 text-base rounded-2xl bg-white/80 border border-black/12 shadow-sm text-(--text-primary) placeholder-(--text-tertiary) outline-none focus-visible:border-(--accent-cyan) focus-visible:ring-2 focus-visible:ring-(--accent-cyan) focus-visible:ring-offset-2 focus-visible:ring-offset-(--bg-base) focus:bg-white/90 backdrop-blur-xl transition-[background-color,border-color,box-shadow] duration-200 read-only:text-(--text-secondary)"
                    // Read-only rather than disabled while a run is going, so
                    // keyboard focus stays here instead of dropping to the page.
                    readOnly={isLoading}
                  />
                  <button
                    type="submit"
                    aria-disabled={isLoading || undefined}
                    className={`btn-primary px-8 py-3.5 text-base rounded-2xl whitespace-nowrap active:scale-[0.96] ${isLoading ? "cursor-progress" : ""}`}
                  >
                    {isLoading ? (
                      <span className="flex items-center justify-center gap-2">
                        <span className="w-4 h-4 border-2 border-white/80 border-t-transparent rounded-full animate-spin" />
                        Analyzing…
                      </span>
                    ) : (
                      "Explore"
                    )}
                  </button>
                </div>
                <p id="topic-error" role="alert" className="mt-4 text-red-700 font-medium text-sm empty:hidden">
                  {error}
                </p>
                <p className="mt-3 text-xs text-(--text-tertiary) text-pretty">
                  Your topic goes to each AI and is saved on a results page anyone with the link can open.{" "}
                  <a
                    href={PRIVACY_POLICY_URL}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-(--accent-cyan) hover:text-(--accent-violet) transition-colors underline underline-offset-2"
                  >
                    Privacy policy
                    <span className="sr-only"> (opens in a new tab)</span>
                  </a>
                </p>
              </form>

              {/* Analysis Progress Panel */}
              {progress && (
                <AnalysisProgressPanel
                  stage={progress.stage}
                  providers={progress.providers}
                  providerErrors={progress.providerErrors}
                  elapsedSeconds={progress.elapsedSeconds}
                  errorMessage={progress.errorMessage}
                />
              )}

              {/* Example Topics */}
              {!progress && (
                <div className="text-sm text-(--text-secondary)">
                  <p className="mb-3">Try an example:</p>
                  <div className="flex flex-wrap gap-2">
                    {exampleTopics.map((example, i) => (
                      <button
                        key={example}
                        // Stagger the fade-in; "both" keeps each pill hidden
                        // until its delay ends.
                        style={isClient ? { animationDelay: `${i * 60}ms`, animationFillMode: "both" } : undefined}
                        onClick={() => {
                          setTopic(example);
                          trackEvent("example_topic_clicked", { topic: example });
                        }}
                        type="button"
                        className={`hit-area [--hit-y:-4px] [--hit-x:-4px] pill-interactive px-4 py-2 rounded-full text-sm active:scale-[0.96] ${isClient ? "animate-fade-in" : "invisible"}`}
                        disabled={isLoading}
                      >
                        {example}
                      </button>
                    ))}
                  </div>
                  <button
                    onClick={() => {
                      setShowMethodology(true);
                      trackEvent("modal_opened", { modal: "how_it_works" });
                    }}
                    type="button"
                    className="hit-area [--hit-y:-4px] [--hit-x:-4px] mt-3 py-2 text-(--accent-cyan) hover:text-(--accent-violet) transition-colors underline underline-offset-2"
                  >
                    How does this work?
                  </button>
                </div>
              )}
            </div>

          </div>

          {/* RIGHT — Floating Keywords Visual (full right half of viewport).
              After the form in the DOM so its pause button comes after it in tab order. */}
          <div className="hidden md:block absolute top-0 right-0 w-1/2 h-full overflow-hidden">
            <FloatingKeywords paused={!!progress} />
          </div>
        </div>
      </main>

      <Footer />

      {/* Methodology Modal */}
      {showMethodology && (
        <Dialog labelledBy="how-it-works-title" onClose={closeMethodology} className="max-w-lg">
          <div className="p-6 sm:p-8 overflow-y-auto max-h-[80vh]">
            <div className="flex items-start justify-between gap-4 mb-4">
              <h2 id="how-it-works-title" className="text-xl font-bold text-(--text-primary)">
                How It Works
              </h2>
              <CloseButton onClick={closeMethodology} className="-mt-2" />
            </div>

            <div className="space-y-4 text-sm text-(--text-secondary) leading-relaxed">
              <div>
                <h3 className="font-semibold text-(--text-primary) mb-1">1. Asked like a person would ask</h3>
                <p>
                  Your topic goes to Claude, ChatGPT, Gemini and Grok in parallel, word for word,
                  with each AI&rsquo;s own web search turned on. Each runs the model its free
                  version uses by default, so you see what an ordinary user sees.
                </p>
              </div>

              <div>
                <h3 className="font-semibold text-(--text-primary) mb-1">2. Answers as written</h3>
                <p>
                  Each answer is shown in full, at whatever length the AI chose, with the sources
                  it cited. Nothing is rewritten.
                </p>
              </div>

              <div>
                <h3 className="font-semibold text-(--text-primary) mb-1">3. One reading of every answer</h3>
                <p>
                  A separate AI then reads each answer the same way and pulls out its themes, the
                  arguments it makes for and against, the people, organizations, places and laws it
                  names, and its overall tone. Select any theme to see the sentences where it appears.
                </p>
              </div>

              <div>
                <h3 className="font-semibold text-(--text-primary) mb-1">4. Compared across AIs</h3>
                <p>
                  Themes, arguments, names and sources are combined across the AIs and ranked by
                  how many of them raised each one, so cross-model agreement stands out.
                </p>
              </div>
            </div>
          </div>
        </Dialog>
      )}
    </div>
  );
}
