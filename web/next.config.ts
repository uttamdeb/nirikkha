import type { NextConfig } from "next";

const apiProxy =
  process.env.API_PROXY_URL?.replace(/\/$/, "") || "http://127.0.0.1:8100";

const nextConfig: NextConfig = {
  // Keep resolution inside web/ (repo sits under a parent folder that also has lockfiles).
  turbopack: {
    root: process.cwd(),
  },
  // Marking a script takes 20-60s through a vision model, and the default proxy
  // timeout is far shorter — the request was being cut off mid-pipeline and
  // surfacing as "socket hang up". Match the Cloud Run request timeout instead.
  experimental: {
    proxyTimeout: 900_000,
  },
  // Dual-process container: Next on $PORT, FastAPI on 8100.
  async rewrites() {
    return [
      { source: "/api/:path*", destination: `${apiProxy}/api/:path*` },
      // Not under /api, but the deployed service is checked by it.
      { source: "/health", destination: `${apiProxy}/health` },
      { source: "/mcp", destination: `${apiProxy}/mcp` },
      { source: "/mcp/:path*", destination: `${apiProxy}/mcp/:path*` },
      {
        source: "/.well-known/:path*",
        destination: `${apiProxy}/.well-known/:path*`,
      },
    ];
  },
};

export default nextConfig;
