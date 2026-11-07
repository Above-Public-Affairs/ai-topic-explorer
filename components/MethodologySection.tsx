const platforms = [
  {
    name: "Claude",
    provider: "Anthropic",
    description: "Known for nuanced analysis and careful reasoning.",
    color: "bg-orange-100 text-orange-700",
  },
  {
    name: "ChatGPT",
    provider: "OpenAI",
    description: "Broad knowledge base with strong general coverage.",
    color: "bg-green-100 text-green-700",
  },
  {
    name: "Gemini",
    provider: "Google",
    description: "Deep integration with Google's knowledge graph.",
    color: "bg-blue-100 text-blue-700",
  },
  {
    name: "Grok",
    provider: "xAI",
    description: "Trained on X/Twitter data for a social media perspective.",
    color: "bg-red-100 text-red-700",
  },
];

const steps = [
  {
    number: "1",
    title: "Enter a topic",
    description: "Type any subject you want to explore.",
  },
  {
    number: "2",
    title: "AI models analyze it",
    description:
      "We query multiple AI models simultaneously and combine their responses.",
  },
  {
    number: "3",
    title: "See what AI knows",
    description:
      "Get a word cloud of key terms, named entities with links, and AI-suggested sources.",
  },
];

export default function MethodologySection() {
  return (
    <section className="w-full max-w-4xl mx-auto mt-20 px-4">
      {/* How It Works */}
      <h2 className="text-2xl font-bold text-slate-800 text-center mb-8">
        How It Works
      </h2>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-16">
        {steps.map((step) => (
          <div
            key={step.number}
            className="bg-white rounded-lg border border-slate-200 p-6 text-center"
          >
            <div className="w-10 h-10 rounded-full bg-blue-600 text-white font-bold text-lg flex items-center justify-center mx-auto mb-4">
              {step.number}
            </div>
            <h3 className="font-semibold text-slate-800 mb-2">{step.title}</h3>
            <p className="text-sm text-slate-600">{step.description}</p>
          </div>
        ))}
      </div>

      {/* What You Get */}
      <h2 className="text-2xl font-bold text-slate-800 text-center mb-8">
        What You Get
      </h2>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-16">
        <div className="bg-white rounded-lg border border-slate-200 p-6 text-center">
          <div className="text-3xl mb-3">{"☁️"}</div>
          <h3 className="font-semibold text-slate-800 mb-2">Word Cloud</h3>
          <p className="text-sm text-slate-600">
            See the most frequently mentioned terms across all AI responses at a
            glance.
          </p>
        </div>
        <div className="bg-white rounded-lg border border-slate-200 p-6 text-center">
          <div className="text-3xl mb-3">{"🏷️"}</div>
          <h3 className="font-semibold text-slate-800 mb-2">Named Entities</h3>
          <p className="text-sm text-slate-600">
            People, organizations, locations, and concepts identified by AI —
            each linked for easy research.
          </p>
        </div>
        <div className="bg-white rounded-lg border border-slate-200 p-6 text-center">
          <div className="text-3xl mb-3">{"📄"}</div>
          <h3 className="font-semibold text-slate-800 mb-2">Citations</h3>
          <p className="text-sm text-slate-600">
            Sources and references suggested by the AI models, with links to
            learn more.
          </p>
        </div>
      </div>

      {/* Platforms */}
      <h2 className="text-2xl font-bold text-slate-800 text-center mb-8">
        Powered By
      </h2>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6 mb-12">
        {platforms.map((platform) => (
          <div
            key={platform.name}
            className="bg-white rounded-lg border border-slate-200 p-6 text-center"
          >
            <span
              className={`inline-block px-3 py-1 rounded-full text-sm font-medium mb-3 ${platform.color}`}
            >
              {platform.name}
            </span>
            <p className="text-xs text-slate-500 mb-2">{platform.provider}</p>
            <p className="text-sm text-slate-600">{platform.description}</p>
          </div>
        ))}
      </div>

      {/* Disclaimer */}
      <p className="text-xs text-slate-400 text-center max-w-2xl mx-auto">
        AI responses may contain inaccuracies. Citations and links are
        AI-suggested and may not be valid. This tool shows what AI models report
        — it does not verify facts.
      </p>
    </section>
  );
}
