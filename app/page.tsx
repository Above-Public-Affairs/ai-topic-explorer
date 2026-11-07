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
import AnalysisProgressPanel from "@/components/AnalysisProgressPanel";
import { trackEvent } from "@/lib/analytics";
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
type Stage = "expanding" | "querying" | "merging" | "complete" | "error";

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
  const exampleTopics = useMemo(() => pickRandom(ALL_TOPICS, 5), []);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

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
    setError("");

    const trimmedTopic = topic.trim();
    if (!trimmedTopic) {
      setError("Please enter a topic to explore.");
      return;
    }

    setIsLoading(true);
    setProgress({
      active: true,
      stage: "expanding",
      providers: {},
      providerErrors: {},
      elapsedSeconds: 0,
    });
    trackEvent({ action: "topic_searched", params: { topic: trimmedTopic } });

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
          trackEvent({ action: "analysis_error", params: { error_type: "rate_limit" } });
          setError("You've reached the analysis limit. Please try again in a few minutes.");
        } else if (response.status === 503) {
          trackEvent({ action: "analysis_error", params: { error_type: "unavailable" } });
          setError("Analysis is temporarily unavailable. Please try again later.");
        } else {
          const data = await response.json();
          trackEvent({ action: "analysis_error", params: { error_type: "api_error" } });
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
            case "expanding":
              setProgress((prev) =>
                prev ? { ...prev, stage: "expanding" } : prev
              );
              break;

            case "querying": {
              const providerMap: Record<string, ProviderStatus> = {};
              for (const p of event.providers) providerMap[p] = "loading";
              setProgress((prev) =>
                prev ? { ...prev, stage: "querying", providers: providerMap } : prev
              );
              break;
            }

            case "provider_done":
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
              setProgress((prev) =>
                prev ? { ...prev, stage: "merging" } : prev
              );
              break;

            case "complete":
              clearTimeout(streamTimeout);
              setProgress((prev) =>
                prev ? { ...prev, stage: "complete", active: false } : prev
              );
              trackEvent({ action: "analysis_completed", params: { topic: trimmedTopic } });
              router.push(`/results/${event.id}`);
              return;

            case "error":
              clearTimeout(streamTimeout);
              setProgress((prev) =>
                prev
                  ? { ...prev, stage: "error", active: false, errorMessage: event.message }
                  : prev
              );
              trackEvent({ action: "analysis_error", params: { error_type: "stream_error" } });
              setError(event.message || "Analysis failed. Please try again.");
              setIsLoading(false);
              return;
          }
        }
      }

      // Stream ended without complete/error event
      clearTimeout(streamTimeout);
      setError("Analysis ended unexpectedly. Please try again.");
      setIsLoading(false);
      setProgress(null);
    } catch (err) {
      clearTimeout(streamTimeout);
      if (err instanceof DOMException && err.name === "AbortError") {
        trackEvent({ action: "analysis_error", params: { error_type: "timeout" } });
        setError("Analysis took too long. Please try again.");
      } else {
        trackEvent({ action: "analysis_error", params: { error_type: "network" } });
        setError("Something went wrong. Please try again.");
      }
      setIsLoading(false);
      setProgress(null);
    }
  };

  return (
    <div className="min-h-screen flex flex-col">
      <main className="flex-1 flex flex-col">
        {/* Split hero section */}
        <div className="flex-1 flex items-center relative">

          {/* RIGHT — Floating Keywords Visual (full right half of viewport) */}
          <div className="hidden md:block absolute top-0 right-0 w-1/2 h-full overflow-hidden">
            <FloatingKeywords />
          </div>

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
              <p className="text-lg text-[--text-secondary] mb-10 max-w-lg leading-relaxed">
                Enter any topic and see what AI knows about it. We query
                multiple models and combine their responses into key themes,
                entities, and citations.
              </p>

              {/* Input Form */}
              <form onSubmit={handleSubmit} className="mb-8">
                <div className="flex flex-col sm:flex-row gap-3">
                  <input
                    type="text"
                    value={topic}
                    onChange={(e) => setTopic(e.target.value)}
                    maxLength={MAX_TOPIC_LENGTH}
                    placeholder={placeholder ? `e.g. "${placeholder}"` : 'e.g. "oil and gas in New Mexico"'}
                    className="flex-1 px-5 py-3.5 text-base rounded-2xl bg-white/80 border border-black/12 shadow-sm text-[--text-primary] placeholder-[--text-tertiary] focus:outline-none focus:border-[--accent-cyan]/50 focus:ring-2 focus:ring-[--accent-cyan]/15 focus:bg-white/90 backdrop-blur-xl transition-all duration-300"
                    disabled={isLoading}
                  />
                  <button
                    type="submit"
                    disabled={isLoading}
                    className="btn-primary px-8 py-3.5 text-base rounded-2xl whitespace-nowrap"
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
                {error && (
                  <p className="mt-4 text-red-500 font-medium text-sm">{error}</p>
                )}
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
                <div className="text-sm text-[--text-secondary]">
                  <p className="mb-3">Try an example:</p>
                  <div className="flex flex-wrap gap-2">
                    {exampleTopics.map((example) => (
                      <button
                        key={example}
                        onClick={() => {
                          setTopic(example);
                          trackEvent({ action: "example_topic_clicked", params: { topic: example } });
                        }}
                        className="pill-interactive px-4 py-2 rounded-full text-sm"
                        disabled={isLoading}
                      >
                        {example}
                      </button>
                    ))}
                  </div>
                  <button
                    onClick={() => {
                      setShowMethodology(true);
                      trackEvent({ action: "methodology_opened" });
                    }}
                    className="mt-4 text-[--accent-cyan] hover:text-[--accent-violet] transition-colors underline underline-offset-2"
                  >
                    How does this work?
                  </button>
                </div>
              )}
            </div>

          </div>
        </div>
      </main>

      <Footer />

      {/* Methodology Modal */}
      {showMethodology && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          onClick={() => setShowMethodology(false)}
        >
          <div className="absolute inset-0 bg-black/30 backdrop-blur-sm" />
          <div
            className="relative glass-tier-3 max-w-lg w-full max-h-[80vh] overflow-y-auto p-6 sm:p-8 rounded-2xl shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              onClick={() => setShowMethodology(false)}
              className="absolute top-4 right-4 text-[--text-tertiary] hover:text-[--text-primary] transition-colors text-xl leading-none"
            >
              &times;
            </button>

            <h2 className="text-xl font-bold text-[--text-primary] mb-4">
              How It Works
            </h2>

            <div className="space-y-4 text-sm text-[--text-secondary] leading-relaxed">
              <div>
                <h3 className="font-semibold text-[--text-primary] mb-1">1. Query Expansion</h3>
                <p>
                  Your topic is expanded into 3–4 distinct subtopic queries using AI, covering
                  different angles like history, current state, and key players. This ensures
                  comprehensive coverage rather than a single narrow perspective.
                </p>
              </div>

              <div>
                <h3 className="font-semibold text-[--text-primary] mb-1">2. Multi-Model Analysis</h3>
                <p>
                  Each subtopic is sent to multiple AI models (Claude, ChatGPT, Gemini, Grok) in parallel.
                  Each model independently generates a detailed response about the topic.
                </p>
              </div>


              <div>
                <h3 className="font-semibold text-[--text-primary] mb-1">3. Key Theme Extraction</h3>
                <p>
                  AI identifies the most important themes from its analysis as short, meaningful
                  phrases. These are displayed as clickable pills — tap any theme to see the
                  exact sentences where it appears in context.
                </p>
              </div>

              <div>
                <h3 className="font-semibold text-[--text-primary] mb-1">4. Entity Extraction</h3>
                <p>
                  People and organizations mentioned across all responses are extracted and
                  deduplicated. When available, reference URLs are included.
                </p>
              </div>

              <div>
                <h3 className="font-semibold text-[--text-primary] mb-1">5. Citation Merging</h3>
                <p>
                  Recommended sources from each model are merged and ranked by how many
                  models independently cited them — giving higher weight to sources with
                  cross-model agreement.
                </p>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
