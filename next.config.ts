import type { NextConfig } from "next";
import { PRIVACY_POLICY_URL } from "./lib/privacy";

const nextConfig: NextConfig = {
  experimental: {
    // The one stylesheet (~10 KB) goes in the HTML instead of blocking first
    // paint on a separate request (task 6.6, speed review 6).
    inlineCss: true,
  },
  // A typed or guessed /privacy goes to Above's policy, which covers this site (task 6.9).
  async redirects() {
    return [
      { source: "/privacy", destination: PRIVACY_POLICY_URL, permanent: false },
      { source: "/privacy-policy", destination: PRIVACY_POLICY_URL, permanent: false },
    ];
  },
};

export default nextConfig;
