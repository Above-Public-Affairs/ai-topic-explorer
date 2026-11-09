import type { Metadata } from "next";
import { Inter, Geist_Mono } from "next/font/google";
import Script from "next/script";
import BetaBanner from "@/components/BetaBanner";
import BugReportButton from "@/components/BugReportButton";
import AnalyticsTracker from "@/components/AnalyticsTracker";
import { gaBootstrapScript } from "@/lib/analytics";
import "./globals.css";

// Only a well-formed GA4 ID is written into the page.
const rawGaId = process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID?.trim();
const GA_ID = rawGaId && /^G-[A-Z0-9]+$/.test(rawGaId) ? rawGaId : null;
const GA_DEBUG = process.env.NEXT_PUBLIC_GA_DEBUG === "1";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  display: "swap",
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
  // Used only for the model name and the run timer: not worth a preload.
  preload: false,
});

// Runs before first paint, so a dismissed beta banner never flashes.
const betaBannerScript = `try{if(localStorage.getItem("beta-banner-dismissed")!==null)document.documentElement.setAttribute("data-beta-dismissed","")}catch(e){}`;

const siteUrl = "https://aitopicexplorer.app";
const title = "AI Topic Explorer";
const description =
  "Ask Claude, ChatGPT, Gemini and Grok the same question and read their full answers side by side, with the sources they cite and where they agree and disagree.";

export const metadata: Metadata = {
  title: { default: title, template: `%s – ${title}` },
  description,
  metadataBase: new URL(siteUrl),
  openGraph: {
    title,
    description,
    url: siteUrl,
    siteName: title,
    locale: "en_US",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title,
    description,
  },
  other: {
    "theme-color": "#F8F6F3",
    "color-scheme": "light",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: betaBannerScript }} />
        {/* The gtag queue exists from the start, so events fired before
            gtag.js lazy-loads are kept and sent when it arrives. */}
        {GA_ID && <script dangerouslySetInnerHTML={{ __html: gaBootstrapScript(GA_ID, GA_DEBUG) }} />}
      </head>
      <body
        className={`${inter.variable} ${geistMono.variable} antialiased`}
      >
        {GA_ID && (
          <>
            <Script
              src={`https://www.googletagmanager.com/gtag/js?id=${GA_ID}`}
              strategy="lazyOnload"
            />
            <AnalyticsTracker />
          </>
        )}
        <a href="#content" className="skip-link">
          Skip to content
        </a>
        <BetaBanner />
        {children}
        <BugReportButton />
      </body>
    </html>
  );
}
