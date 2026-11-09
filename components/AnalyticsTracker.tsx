"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import {
  SOURCE_LINK_AREAS,
  SOURCE_LINK_ATTR,
  linkDomain,
  trackEvent,
  trackPageView,
  type SourceLinkArea,
} from "@/lib/analytics";

const TITLE_WAIT_MS = 1500;

/** Page views on every route, and clicks on cited sources anywhere on the page. */
export default function AnalyticsTracker() {
  const pathname = usePathname();

  const titleAtLastView = useRef<string | null>(null);

  useEffect(() => {
    const href = window.location.href;
    const previousTitle = titleAtLastView.current;
    let sent = false;
    const send = () => {
      if (sent) return;
      sent = true;
      observer.disconnect();
      clearTimeout(timer);
      titleAtLastView.current = document.title;
      trackPageView(href);
    };
    // Next sets the new page's <title> a moment after the route changes, so
    // a page view sent straight away would carry the previous page's title.
    // Wait for the title to change, or give up after a short while (two
    // pages can share a title).
    const observer = new MutationObserver(() => {
      if (document.title !== previousTitle) send();
    });
    const timer = setTimeout(send, TITLE_WAIT_MS);
    if (previousTitle === null || document.title !== previousTitle) send();
    else observer.observe(document.head, { subtree: true, childList: true, characterData: true });
    // Leaving before the title arrived: still count the view.
    return send;
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
