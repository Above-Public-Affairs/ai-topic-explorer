import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";

/**
 * An AI's answer as it wrote it: Markdown rendered as prose. Raw HTML in the
 * answer is not rendered (react-markdown escapes it), and links open in a new
 * tab.
 */
const components: Components = {
  h1: ({ children }) => <h3 className="text-lg font-semibold text-[--text-primary] mt-6 mb-2 first:mt-0 text-balance">{children}</h3>,
  h2: ({ children }) => <h3 className="text-lg font-semibold text-[--text-primary] mt-6 mb-2 first:mt-0 text-balance">{children}</h3>,
  h3: ({ children }) => <h4 className="text-base font-semibold text-[--text-primary] mt-5 mb-2 first:mt-0 text-balance">{children}</h4>,
  h4: ({ children }) => <h5 className="text-[15px] font-semibold text-[--text-primary] mt-4 mb-1.5 first:mt-0">{children}</h5>,
  h5: ({ children }) => <h5 className="text-[15px] font-semibold text-[--text-primary] mt-4 mb-1.5 first:mt-0">{children}</h5>,
  h6: ({ children }) => <h5 className="text-[15px] font-semibold text-[--text-primary] mt-4 mb-1.5 first:mt-0">{children}</h5>,
  p: ({ children }) => <p className="mb-4 last:mb-0 text-pretty">{children}</p>,
  ul: ({ children }) => <ul className="mb-4 last:mb-0 pl-5 list-disc space-y-1.5 marker:text-black/25">{children}</ul>,
  ol: ({ children }) => <ol className="mb-4 last:mb-0 pl-5 list-decimal space-y-1.5 marker:text-[--text-tertiary]">{children}</ol>,
  li: ({ children }) => <li className="pl-1">{children}</li>,
  strong: ({ children }) => <strong className="font-semibold text-[--text-primary]">{children}</strong>,
  a: ({ href, children }) => (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="text-[--accent-cyan] underline decoration-[--accent-cyan]/30 underline-offset-2 hover:decoration-[--accent-cyan] transition-colors break-words"
    >
      {children}
    </a>
  ),
  blockquote: ({ children }) => (
    <blockquote className="mb-4 border-l-2 border-black/10 pl-4 text-[--text-secondary] italic">{children}</blockquote>
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
  th: ({ children }) => <th className="px-3 py-2 text-left font-semibold text-[--text-primary] border-b border-black/8">{children}</th>,
  td: ({ children }) => <td className="px-3 py-2 align-top border-b border-black/5 tabular-nums">{children}</td>,
  img: () => null,
};

export default function AnswerProse({ text }: { text: string }) {
  return (
    <div className="text-[15px] leading-7 text-[--text-secondary] break-words">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {text}
      </ReactMarkdown>
    </div>
  );
}
