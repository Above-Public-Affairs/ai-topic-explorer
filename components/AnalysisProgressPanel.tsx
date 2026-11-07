import ProgressTracker from "@/components/ProgressTracker";
import type { Provider } from "@/lib/types";

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
  complete: "Analysis complete! Redirecting",
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

  return (
    <div className="glass-tier-2 rounded-2xl p-5 mt-4 animate-fade-in-up">
      {/* Stage message + timer */}
      <div className="flex items-center justify-between mb-1">
        <p className="text-sm font-medium text-[--text-secondary]">
          {message}
          {stage !== "complete" && stage !== "error" && (
            <span className="animate-ellipsis">
              <span>.</span><span>.</span><span>.</span>
            </span>
          )}
        </p>
        <span className="text-xs font-mono text-[--text-tertiary] tabular-nums ml-4">
          {elapsedSeconds}s
        </span>
      </div>

      {/* Provider status */}
      {hasProviders && (
        <div className="mt-3 pt-3 border-t border-black/5">
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
