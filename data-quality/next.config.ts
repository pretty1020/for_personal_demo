import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import type { NextConfig } from "next";

if ((process.env.VERCEL === "1" || process.env.PORTAL_STATIC === "1") && !existsSync("public/portal-index.html")) {
  const prepared = spawnSync("node", ["scripts/prepare-portal.mjs"], { stdio: "inherit" });
  if ((prepared.status ?? 1) !== 0) {
    throw new Error("Portal build failed.");
  }
}

const isDev = process.env.NODE_ENV !== "production";

const servePortal = process.env.VERCEL === "1" || process.env.PORTAL_STATIC === "1";

/** Portal screens. /dashboard stays the Data Quality app. */
const PORTAL_PATHS = [
  "/workspace",
  "/workspace/:path*",
  "/setup",
  "/executive",
  "/users",
  "/formulas",
  "/capacity-plan",
  "/capacity-plan/:path*",
  "/forecasting",
  "/roster",
  "/roster/:path*",
  "/scheduling",
  "/scheduling/:path*",
  "/planning",
  "/planning/:path*",
  "/financial",
  "/financial/:path*",
  "/process-audit",
  "/governance",
  "/certified-data",
  "/anomaly-detection",
  "/planner/:path*",
  "/ideal-financial/:path*",
  "/advanced-staffing-capacity-plan",
  "/summary",
  "/dbe/:path*",
  "/choose",
];

const nextConfig: NextConfig = {
  experimental: {
    serverActions: {
      bodySizeLimit: "10mb",
    },
  },
  // Safety net: older Capacity embeds may request /chunks/* instead of /capacity/chunks/*.
  async rewrites() {
    const chunks = { source: "/chunks/:path*", destination: "/capacity/chunks/:path*" };
    if (!servePortal) return [chunks];
    return {
      beforeFiles: [
        { source: "/", destination: "/portal-index.html" },
        chunks,
      ],
      fallback: PORTAL_PATHS.map((source) => ({ source, destination: "/portal-index.html" })),
    };
  },
  webpack: (config) => {
    config.resolve ??= {};
    config.resolve.extensionAlias = {
      ".js": [".ts", ".tsx", ".js"],
      ".mjs": [".mts", ".mjs"],
      ".cjs": [".cts", ".cjs"],
    };
    return config;
  },
  async headers() {
    // Dev: nothing may be cached, so removed webpack chunks cannot linger.
    if (isDev) {
      return [
        {
          source: "/:path*",
          headers: [{ key: "Cache-Control", value: "no-store, must-revalidate" }],
        },
      ];
    }

    // Production: embed.js/embed.css keep a stable URL while their content changes
    // every build, and each build wipes the old hashed chunks (vite emptyOutDir).
    // A cached entry point would therefore request chunks the server no longer has,
    // so the entry point must revalidate while the hashed chunks stay immutable.
    return [
      {
        source: "/capacity/embed.:ext(js|css)",
        headers: [{ key: "Cache-Control", value: "no-cache, must-revalidate" }],
      },
      {
        source: "/capacity/chunks/:path*",
        headers: [{ key: "Cache-Control", value: "public, max-age=31536000, immutable" }],
      },
    ];
  },
};

export default nextConfig;
