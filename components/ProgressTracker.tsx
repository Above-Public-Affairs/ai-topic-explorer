import type { Provider } from "@/lib/types";
import { PROVIDER_LABELS } from "@/lib/providers";

type Status = "pending" | "loading" | "done" | "failed" | "unavailable";

interface ProviderStatus {
  provider: Provider;
  status: Status;
  errorReason?: string;
}

interface Props {
  providers: ProviderStatus[];
  layout?: "horizontal" | "vertical";
}

/** Read aloud after the name, so status never relies on color alone. */
const STATUS_TEXT: Record<Status, string> = {
  pending: "waiting",
  loading: "working",
  done: "answered",
  failed: "failed",
  unavailable: "unavailable",
};

function StatusIcon({ status }: { status: Status }) {
  // Each state has its own shape as well as its own color.
  switch (status) {
    case "pending":
      return <span className="size-2.5 rounded-full border-2 border-black/20" aria-hidden="true" />;
    case "loading":
      return (
        <span
          className="size-2.5 rounded-full bg-(--accent-cyan-bright) animate-pulse-glow glow-dot"
          style={{ color: "var(--accent-cyan-bright)" }}
          aria-hidden="true"
        />
      );
    case "done":
      return (
        <svg className="size-3.5 text-emerald-600" viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <circle cx="8" cy="8" r="8" fill="currentColor" />
          <path d="M4.75 8.25l2.1 2.1 4.4-4.6" stroke="white" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      );
    case "failed":
    case "unavailable":
      return (
        <svg className="size-3.5 text-orange-600" viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <circle cx="8" cy="8" r="8" fill="currentColor" />
          <path d="M8 4.25v4.5" stroke="white" strokeWidth="1.8" strokeLinecap="round" />
          <circle cx="8" cy="11.4" r="1" fill="white" />
        </svg>
      );
  }
}

export default function ProgressTracker({ providers, layout = "vertical" }: Props) {
  return (
    <ul className={layout === "vertical" ? "flex flex-col gap-3" : "flex flex-wrap items-center gap-x-4 gap-y-1.5"}>
      {providers.map(({ provider, status, errorReason }) => (
        <li key={provider} className="flex items-center gap-2 min-w-0">
          <span className="inline-flex size-3.5 shrink-0 items-center justify-center">
            <StatusIcon status={status} />
          </span>
          <span
            className={`text-xs font-medium ${
              status === "done"
                ? "text-emerald-700"
                : status === "failed" || status === "unavailable"
                  ? "text-orange-700"
                  : status === "loading"
                    ? "text-(--text-primary)"
                    : "text-(--text-tertiary)"
            }`}
          >
            {PROVIDER_LABELS[provider]}
            <span className="sr-only">: {STATUS_TEXT[status]}</span>
            {status === "failed" && errorReason && (
              <span className="font-normal ml-1">({errorReason})</span>
            )}
            {status === "unavailable" && (
              <span className="font-normal ml-1">(unavailable)</span>
            )}
          </span>
        </li>
      ))}
    </ul>
  );
}
