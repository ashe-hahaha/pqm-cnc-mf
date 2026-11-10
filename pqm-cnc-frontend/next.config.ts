import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  async rewrites() {
    const backendOrigin = process.env.PQM_BACKEND_ORIGIN;
    return backendOrigin
      ? [{ source: "/backend/api/:path*", destination: `${backendOrigin}/api/:path*` }]
      : [];
  },
  turbopack: {
    root: path.resolve(__dirname, ".."),
  },
  // pdf.js ships as ESM with a separate worker module.
  transpilePackages: ["pdfjs-dist"],
};

export default nextConfig;
