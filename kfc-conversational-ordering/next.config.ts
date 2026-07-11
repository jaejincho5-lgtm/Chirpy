import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // StrictMode double-invokes effects in dev, which tears down and restarts the
  // /voice three.js render loop mid-flight (the loop dies, the canvas freezes).
  // Production never double-invokes, so this only affects dev behavior.
  reactStrictMode: false,
  // Add project-specific config here if channel webhooks or image domains need it later.
};

export default nextConfig;
