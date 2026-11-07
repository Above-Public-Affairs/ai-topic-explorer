import type { Metadata } from "next";
import { Inter, Geist_Mono } from "next/font/google";
import Script from "next/script";
import BetaBanner from "@/components/BetaBanner";
import BugReportButton from "@/components/BugReportButton";
import "./globals.css";

const GA_ID = process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID;

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
            <Script id="ga4-init" strategy="lazyOnload">
              {`window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}gtag('js',new Date());gtag('config','${GA_ID}');`}
            </Script>
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
