import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  ...(process.env.OWNPATH_DIST_DIR ? { distDir: process.env.OWNPATH_DIST_DIR } : {}),
  outputFileTracingIncludes: {
    "/api/resume": [
      "./node_modules/pdfjs-dist/legacy/build/pdf.mjs",
      "./node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs",
      "./node_modules/pdfjs-dist/package.json",
    ],
  },
};
export default nextConfig;
