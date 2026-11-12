import Link from "next/link";
import Footer from "@/components/Footer";

/**
 * Shown for a saved result too damaged to display (no topic, or no provider
 * answers survive reading). Offers to rerun the topic instead of erroring.
 */
export default function UnreadableResult({ topic }: { topic: string }) {
  const rerunHref = topic ? `/?topic=${encodeURIComponent(topic)}` : "/";
  return (
    <div className="min-h-screen flex flex-col">
      <main className="flex-1 flex items-center justify-center px-4 py-16">
        <div className="max-w-md w-full text-center">
          <p className="text-xs font-semibold text-(--text-tertiary) uppercase tracking-wider mb-3">
            Saved result
          </p>
          <h1 className="text-2xl font-bold text-(--text-primary) text-balance mb-3">
            {topic ? `“${topic}” can’t be shown` : "This result can’t be shown"}
          </h1>
          <p className="text-sm text-(--text-secondary) text-pretty mb-8">
            It was saved by an older version of the site, or saved incomplete. Run
            the topic again to get a fresh comparison.
          </p>
          <Link
            href={rerunHref}
            className="btn-primary inline-flex items-center justify-center min-h-11 px-6 rounded-xl text-sm active:scale-[0.96]"
          >
            {topic ? "Run it again" : "Start a new topic"}
          </Link>
        </div>
      </main>
      <Footer />
    </div>
  );
}
