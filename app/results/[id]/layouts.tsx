"use client";

import dynamic from "next/dynamic";

// Each results layout is its own chunk, loaded only by the pages that use it:
// an old saved result doesn't download the new layout or its Markdown
// renderer. (next/dynamic has to be called from a client module to split.)
export const ResultsContent = dynamic(() => import("./ResultsContent"));
export const RunResultsContent = dynamic(() => import("./RunResultsContent"));
