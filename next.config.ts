import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    // The one stylesheet (~10 KB) goes in the HTML instead of blocking first
    // paint on a separate request (task 6.6, speed review 6).
    inlineCss: true,
  },
};

export default nextConfig;
