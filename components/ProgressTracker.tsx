import type { Provider } from "@/lib/types";
import { PROVIDER_LABELS } from "@/lib/providers";

interface ProviderStatus {
  provider: Provider;
  status: "pending" | "loading" | "done" | "failed" | "unavailable";
  errorReason?: string;
}

interface Props {
  providers: ProviderStatus[];
  layout?: "horizontal" | "vertical";
}

export default function ProgressTracker({ providers, layout = "vertical" }: Props) {
  return (
    <div className={layout === "vertical" ? "flex flex-col gap-3" : "flex flex-wrap items-center gap-x-4 gap-y-1.5"}>
      {providers.map(({ provider, status, errorReason }) => (
        <div key={provider} className="flex items-center gap-2">
          {status === "pending" && (
            <span className="w-2.5 h-2.5 rounded-full bg-black/15" />
          )}
          {status === "loading" && (
            <span className="w-2.5 h-2.5 rounded-full bg-[--accent-cyan-bright] animate-pulse-glow glow-dot" style={{ color: 'var(--accent-cyan-bright)' }} />
          )}
          {status === "done" && (
            <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 glow-dot" style={{ color: '#10b981' }} />
          )}
          {status === "failed" && (
            <span className="w-2.5 h-2.5 rounded-full bg-orange-500 glow-dot" style={{ color: '#f97316' }} />
          )}
          {status === "unavailable" && (
            <span className="w-2.5 h-2.5 rounded-full bg-red-400/60" />
          )}
          <span
            className={`text-xs font-medium ${
              status === "done"
                ? "text-emerald-600"
                : status === "failed"
                  ? "text-orange-600"
                  : status === "unavailable"
                    ? "text-red-400"
                    : status === "loading"
                      ? "text-[--text-secondary]"
                      : "text-[--text-tertiary]"
            }`}
          >
            {PROVIDER_LABELS[provider]}
            {status === "failed" && errorReason && (
              <span className="font-normal opacity-75 ml-1">({errorReason})</span>
            )}
            {status === "unavailable" && (
              <span className="text-xs ml-1 opacity-60">(coming soon)</span>
            )}
          </span>
        </div>
      ))}
    </div>
  );
}
