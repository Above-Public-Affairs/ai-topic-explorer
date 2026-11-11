import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import type { AnswerSourceView } from "@/lib/results/run-view";
import { urlKey } from "@/lib/results/sources";
import NewTabNote from "@/components/NewTabNote";

/**
 * An AI's answer as it wrote it: Markdown rendered as prose. Raw HTML in the
 * answer is not rendered (react-markdown escapes it), and links open in a new
 * tab.
 */
const baseComponents: Components = {
  h1: ({ children }) => <h3 className="text-xl font-semibold text-(--text-primary) mt-8 mb-2.5 scroll-mt-28 first:mt-0 text-balance">{children}</h3>,
  h2: ({ children }) => <h3 className="text-xl font-semibold text-(--text-primary) mt-8 mb-2.5 scroll-mt-28 first:mt-0 text-balance">{children}</h3>,
  h3: ({ children }) => <h4 className="text-lg font-semibold text-(--text-primary) mt-6 mb-2 first:mt-0 text-balance">{children}</h4>,
  h4: ({ children }) => <h5 className="text-base sm:text-[17px] font-semibold text-(--text-primary) mt-4 mb-1.5 first:mt-0">{children}</h5>,
  h5: ({ children }) => <h5 className="text-base sm:text-[17px] font-semibold text-(--text-primary) mt-4 mb-1.5 first:mt-0">{children}</h5>,
  h6: ({ children }) => <h5 className="text-base sm:text-[17px] font-semibold text-(--text-primary) mt-4 mb-1.5 first:mt-0">{children}</h5>,
  p: ({ children }) => <p className="mb-[1.1em] last:mb-0 text-pretty">{children}</p>,
  ul: ({ children }) => <ul className="mb-[1.1em] last:mb-0 pl-5 list-disc space-y-1.5 marker:text-black/25">{children}</ul>,
  ol: ({ children }) => <ol className="mb-[1.1em] last:mb-0 pl-5 list-decimal space-y-1.5 marker:text-(--text-tertiary)">{children}</ol>,
  li: ({ children }) => <li className="pl-1">{children}</li>,
  strong: ({ children }) => <strong className="font-semibold text-(--text-primary)">{children}</strong>,
  blockquote: ({ children }) => (
    <blockquote className="mb-4 border-l-2 border-black/10 pl-4 text-(--text-secondary) italic">{children}</blockquote>
  ),
  hr: () => <hr className="my-6 border-black/8" />,
  code: ({ children }) => <code className="rounded bg-black/5 px-1 py-0.5 text-[0.9em] font-mono">{children}</code>,
  pre: ({ children }) => <pre className="mb-4 overflow-x-auto rounded-xl bg-black/5 p-3 text-sm">{children}</pre>,
  table: ({ children }) => (
    <div className="mb-4 overflow-x-auto rounded-xl border border-black/8">
      <table className="w-full text-sm border-collapse">{children}</table>
    </div>
  ),
  thead: ({ children }) => <thead className="bg-black/[0.03]">{children}</thead>,
  th: ({ children }) => <th className="px-3 py-2 text-left font-semibold text-(--text-primary) border-b border-black/8">{children}</th>,
  td: ({ children }) => <td className="px-3 py-2 align-top border-b border-black/5 tabular-nums">{children}</td>,
  img: () => null,
};

/** Plain text of a rendered node, for spotting "[1]"-style citation markers. */
function textOf(node: React.ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textOf).join("");
  return "";
}

const CITATION_MARKER = /^\[?(\d{1,3})\]?$/;

/**
 * `sources` is the list shown under the answer. Inline citation markers
 * ("[2]" linking to a URL) show that URL's number in the list, whatever
 * number the AI wrote, so a marker always points at the matching row.
 */
export default function AnswerProse({ text, sources = [] }: { text: string; sources?: AnswerSourceView[] }) {
  const position = new Map(sources.map((s, i) => [urlKey(s.url), i + 1]));
  const components: Components = {
    ...baseComponents,
    a: ({ href, children }) => {
      const marker = CITATION_MARKER.exec(textOf(children).trim());
      if (marker && href) {
        const n = position.get(urlKey(href));
        const source = n ? sources[n - 1] : null;
        return (
          <a
            href={href}
            data-source-link="answer_inline"
            target="_blank"
            rel="noopener noreferrer"
            aria-label={source ? `Source ${n}: ${source.title} (opens in a new tab)` : "Source (opens in a new tab)"}
            title={source?.title}
            className="relative mx-px inline-flex h-[1.15rem] min-w-[1.15rem] items-center justify-center rounded-full bg-(--accent-cyan)/10 px-1 align-[0.3em] text-[11px] font-semibold leading-none tabular-nums text-(--accent-cyan) no-underline transition-colors hover:bg-(--accent-cyan) hover:text-white after:absolute after:-inset-1 after:content-['']"
          >
            {n ?? "↗"}
          </a>
        );
      }
      return (
        <a
          href={href}
          data-source-link="answer_inline"
          target="_blank"
          rel="noopener noreferrer"
          className="text-(--accent-cyan) underline decoration-(--accent-cyan)/30 underline-offset-2 hover:decoration-(--accent-cyan) transition-colors break-words"
        >
          {children}
          <NewTabNote />
        </a>
      );
    },
  };
  return (
    <div className="max-w-[68ch] text-base sm:text-[17px] leading-[1.7] text-(--text-secondary) break-words">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {text}
      </ReactMarkdown>
    </div>
  );
}
