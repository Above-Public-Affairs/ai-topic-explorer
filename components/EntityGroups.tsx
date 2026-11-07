import { PROVIDER_COLORS, PROVIDER_LABELS } from "@/lib/providers";
import type { EntityView } from "@/lib/results/run-view";

/** Named entities from the new pipeline, grouped by type (people, organizations, places, laws). */
export default function EntityGroups({ groups }: { groups: { label: string; items: EntityView[] }[] }) {
  if (groups.length === 0) {
    return (
      <div className="glass-tier-2 rounded-2xl p-8 text-center">
        <p className="text-(--text-tertiary)">No named entities identified.</p>
      </div>
    );
  }
  return (
    <div className="glass-tier-2 rounded-2xl p-5 sm:p-6">
      <div className="grid grid-cols-1 gap-x-8 gap-y-6 md:grid-cols-2">
        {groups.map((group) => (
          <div key={group.label} className="min-w-0">
            <h3 className="mb-3 font-semibold text-(--accent-cyan)">{group.label}</h3>
            <ul className="space-y-1.5">
              {group.items.map((entity) => (
                <li key={entity.name} className="flex flex-wrap items-baseline gap-x-2 gap-y-1 text-sm text-(--text-secondary)">
                  <span className="min-w-0 break-words">
                    {entity.url ? (
                      <a
                        href={entity.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="underline decoration-black/15 underline-offset-2 hover:text-(--accent-cyan) hover:decoration-(--accent-cyan)/40 transition-colors"
                      >
                        {entity.name}
                      </a>
                    ) : (
                      entity.name
                    )}
                  </span>
                  <span className="flex shrink-0 gap-1">
                    {entity.providers.map((p) => (
                      <span key={p} className={`inline-block rounded px-1.5 py-0.5 text-[11px] font-medium ${PROVIDER_COLORS[p]}`}>
                        {PROVIDER_LABELS[p]}
                      </span>
                    ))}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </div>
  );
}
