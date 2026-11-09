"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import {
  SOURCE_LINK_AREAS,
  SOURCE_LINK_ATTR,
  linkDomain,
  trackEvent,
  trackPageView,
  type SourceLinkArea,
} from "@/lib/analytics";

/** Page views on every route, and clicks on cited sources anywhere on the page. */
export default function AnalyticsTracker() {
  const pathname = usePathname();

  useEffect(() => {
    trackPageView();
  }, [pathname]);

  useEffect(() => {
    // One listener for every source link, however it was rendered (answer
    // prose, source lists). Middle clicks open a tab too, so count those.
    const onClick = (e: MouseEvent) => {
      if (e.type === "auxclick" && e.button !== 1) return;
      const link = (e.target as Element | null)?.closest?.(`a[${SOURCE_LINK_ATTR}]`);
      if (!(link instanceof HTMLAnchorElement)) return;
      const area = link.getAttribute(SOURCE_LINK_ATTR) as SourceLinkArea;
      const domain = linkDomain(link.href);
      if (!domain || !SOURCE_LINK_AREAS.includes(area)) return;
      trackEvent("source_link_opened", { source_domain: domain, link_area: area });
    };
    document.addEventListener("click", onClick, true);
    document.addEventListener("auxclick", onClick, true);
    return () => {
      document.removeEventListener("click", onClick, true);
      document.removeEventListener("auxclick", onClick, true);
    };
  }, []);

  return null;
}
