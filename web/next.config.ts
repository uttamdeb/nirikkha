import type { NextConfig } from "next";

const apiProxy =
  process.env.API_PROXY_URL?.replace(/\/$/, "") || "http://127.0.0.1:8100";

const nextConfig: NextConfig = {
  // Dual-process container: Next on $PORT, FastAPI on 8100.
  async rewrites() {
    return [
      { source: "/api/:path*", destination: `${apiProxy}/api/:path*` },
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
