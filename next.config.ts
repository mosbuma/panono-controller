import withSerwistInit from "@serwist/next";
import type { NextConfig } from "next";
import { execSync } from "node:child_process";
import packageJson from "./package.json";

function gitRevision(): string {
  try {
    return execSync("git rev-parse HEAD", { encoding: "utf8" }).trim();
  } catch {
    return String(Date.now());
  }
}

const revision = gitRevision();

const withSerwist = withSerwistInit({
  swSrc: "app/sw.ts",
  swDest: "public/sw.js",
  // Keep SW enabled in dev so HTTPS testing via cloudflared works.
  disable: process.env.DISABLE_SW === "1",
  cacheOnNavigation: true,
  reloadOnOnline: true,
  additionalPrecacheEntries: [{ url: "/~offline", revision }],
});

const tunnelDevHosts = (process.env.NEXT_DEV_TUNNEL_HOST ?? "")
  .split(",")
  .map((host) => host.trim())
  .filter(Boolean);

const nextConfig: NextConfig = {
  output: "standalone",
  reactStrictMode: true,
  env: {
    NEXT_PUBLIC_APP_VERSION: packageJson.version,
  },
  ...(tunnelDevHosts.length > 0 ? { allowedDevOrigins: tunnelDevHosts } : {}),
};

export default withSerwist(nextConfig);
