import BetaBannerDismiss from "@/components/BetaBannerDismiss";

/**
 * Rendered on the server so it's in the first paint (no layout shift). A
 * visitor who dismissed it has `data-beta-dismissed` set on <html> by an
 * inline script in the layout before paint, and CSS hides it.
 */
export default function BetaBanner() {
  return (
    <div className="beta-banner w-full bg-(--accent-cyan)/[0.07] border-b border-(--accent-cyan)/15">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-1.5 flex items-center justify-between gap-3">
        <p className="text-sm text-(--text-secondary) py-1 text-pretty">
          <span className="inline-block px-2 py-0.5 rounded-full text-xs font-semibold bg-(--accent-cyan)/10 text-(--accent-cyan) mr-2">
            Beta
          </span>
          This site is in beta. If something seems off, let us know with Report a Bug.
        </p>
        <BetaBannerDismiss />
      </div>
    </div>
  );
}
