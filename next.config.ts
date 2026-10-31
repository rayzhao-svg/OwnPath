import type { NextConfig } from "next";

const nextConfig: NextConfig = { reactStrictMode: true, ...(process.env.OWNPATH_DIST_DIR ? { distDir: process.env.OWNPATH_DIST_DIR } : {}) };
export default nextConfig;
