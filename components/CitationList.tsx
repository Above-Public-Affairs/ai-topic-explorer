import type { CombinedCitation } from "@/lib/types";
import { PROVIDER_COLORS, PROVIDER_LABELS } from "@/lib/providers";
import NewTabNote from "@/components/NewTabNote";

interface Props {
  citations: CombinedCitation[];
  /** Note under the list. Older results' sources were written by the AIs themselves, so they carry a warning. */
  disclaimer?: string;
}

/**
 * Group citations by domain ("www." ignored). A group sits where its first
 * citation was, so the most-shared sources still lead.
 */
function groupByDomain(
  citations: CombinedCitation[]
): { domain: string; items: CombinedCitation[] }[] {
  const groups = new Map<string, { domain: string; items: CombinedCitation[] }>();
  for (const citation of citations) {
    const domain = citation.domain.toLowerCase().replace(/^www\./, "");
    const group = groups.get(domain) ?? { domain, items: [] };
    group.items.push(citation);
    groups.set(domain, group);
  }
  return [...groups.values()];
}

export default function CitationList({
  citations,
  disclaimer = "Sources suggested by AI models — links may not be accurate.",
}: Props) {
  if (citations.length === 0) {
    return (
      <div className="glass-tier-2 rounded-2xl p-8 text-center">
        <p className="text-(--text-tertiary)">No citations suggested.</p>
      </div>
    );
  }

  const groups = groupByDomain(citations);

  return (
    <div className="glass-tier-2 rounded-2xl p-6">
      <div className="space-y-5">
        {groups.map((group) => (
          <div key={group.domain}>
            {group.items.length > 1 && (
              <p className="text-[11px] font-medium text-(--text-tertiary) uppercase tracking-wide mb-2">
                {group.domain}
              </p>
            )}
            <ul className={`space-y-5 ${group.items.length > 1 ? "border-l-2 border-black/5 pl-4" : ""}`}>
              {group.items.map((citation, idx) => (
                <li key={idx} className="flex flex-wrap items-baseline gap-x-2 gap-y-1 min-w-0">
                  <a
                    href={citation.url}
                    data-source-link="citation_list"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="hit-area [--hit-y:-10px] [--hit-x:0px] text-(--text-primary) underline decoration-black/15 hover:text-(--accent-cyan) hover:decoration-(--accent-cyan)/40 text-sm font-medium leading-snug transition-colors break-words min-w-0"
                  >
                    {citation.title}
                    <NewTabNote />
                  </a>
                  <div className="flex gap-1 shrink-0">
                    {citation.providers.map((provider) => (
                      <span
                        key={provider}
                        className={`inline-block px-1.5 py-0.5 rounded text-[11px] font-medium ${PROVIDER_COLORS[provider]}`}
                      >
                        {PROVIDER_LABELS[provider]}
                      </span>
                    ))}
                  </div>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>

      {/* Disclaimer */}
      <p className="mt-6 text-xs text-(--text-tertiary) border-t border-black/5 pt-4">
        {disclaimer}
      </p>

      {/* AEO Checker callout */}
      <div className="mt-4 bg-(--accent-cyan-muted) border border-[color:var(--accent-cyan)]/15 rounded-2xl p-4 text-center">
        <p className="text-sm text-(--text-secondary)">
          Want your website cited by AI?{" "}
          <a
            href="https://aeochecker.app"
            target="_blank"
            rel="noopener noreferrer"
            className="font-semibold text-(--accent-cyan) underline hover:text-(--text-primary) transition-colors"
          >
            Check out AEO Checker
            <NewTabNote />
          </a>
        </p>
      </div>
    </div>
  );
}
