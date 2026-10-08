import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Cache Components (PPR) is left off for v1. Most pages depend on the Clerk
  // session and the database, so they are dynamic anyway, and keeping the
  // classic rendering model avoids Suspense boundary requirements around
  // `auth()` in every page. Later work packages may turn it on deliberately.
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
