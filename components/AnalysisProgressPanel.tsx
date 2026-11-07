import ProgressTracker from "@/components/ProgressTracker";
import type { Provider } from "@/lib/types";
import { PROVIDER_LABELS } from "@/lib/providers";

type Stage = "querying" | "merging" | "complete" | "error";
type ProviderStatus = "pending" | "loading" | "done" | "failed";

interface Props {
  stage: Stage;
  providers: Record<string, ProviderStatus>;
  providerErrors?: Record<string, string>;
  elapsedSeconds: number;
  errorMessage?: string;
}

const STAGE_MESSAGES: Record<Stage, string> = {
  querying: "Asking each AI",
  merging: "Reading the answers",
  complete: "Done. Opening the results",
  error: "Something went wrong",
};

export default function AnalysisProgressPanel({
  stage,
  providers,
  providerErrors,
  elapsedSeconds,
  errorMessage,
}: Props) {
  const providerEntries = Object.entries(providers) as [string, ProviderStatus][];
  const hasProviders = providerEntries.length > 0;

  const message = stage === "error" && errorMessage
    ? errorMessage
    : STAGE_MESSAGES[stage];

  // Screen readers hear each step once, as it's added: the stage, then each
  // AI as it finishes. The seconds counter is left out.
  const announcements: string[] = [STAGE_MESSAGES.querying];
  for (const [provider, status] of providerEntries) {
    const label = PROVIDER_LABELS[provider as Provider] ?? provider;
    if (status === "done") announcements.push(`${label} answered`);
    if (status === "failed") {
      const reason = providerErrors?.[provider];
      announcements.push(`${label} failed${reason ? `: ${reason}` : ""}`);
    }
  }
  if (stage !== "querying") announcements.push(message);

  return (
    <div className="glass-tier-2 rounded-2xl p-5 mt-4 animate-fade-in-up">
      <div role="log" aria-live="polite" className="sr-only">
        {announcements.map((line) => (
          <p key={line}>{line}</p>
        ))}
      </div>

      {/* Stage message + timer */}
      <div className="flex items-center justify-between mb-1" aria-hidden="true">
        <p className="text-sm font-medium text-(--text-primary)">
          {message}
          {stage !== "complete" && stage !== "error" && (
            <span className="animate-ellipsis">
              <span>.</span><span>.</span><span>.</span>
            </span>
          )}
        </p>
        <span className="text-xs font-mono text-(--text-tertiary) tabular-nums ml-4">
          {elapsedSeconds}s
        </span>
      </div>
      {stage !== "complete" && stage !== "error" && (
        <p className="text-xs text-(--text-tertiary)" aria-hidden="true">
          Usually about a minute.
        </p>
      )}

      {/* Provider status */}
      {hasProviders && (
        <div className="mt-3 pt-3 border-t border-black/5" aria-hidden="true">
          <ProgressTracker
            layout="horizontal"
            providers={providerEntries.map(([provider, status]) => ({
              provider: provider as Provider,
              status,
              errorReason: providerErrors?.[provider],
            }))}
          />
        </div>
      )}
    </div>
  );
}
