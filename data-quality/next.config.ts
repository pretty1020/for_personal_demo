import type { NextConfig } from "next";

const isDev = process.env.NODE_ENV !== "production";

const nextConfig: NextConfig = {
  experimental: {
    serverActions: {
      bodySizeLimit: "10mb",
    },
  },
  // Safety net: older Capacity embeds may request /chunks/* instead of /capacity/chunks/*.
  async rewrites() {
    return [
      {
        source: "/chunks/:path*",
        destination: "/capacity/chunks/:path*",
      },
    ];
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
