import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  async rewrites() {
    const backendOrigin = process.env.PQM_BACKEND_ORIGIN;
    const go2rtcOrigin = process.env.PQM_GO2RTC_ORIGIN;
    return [
      ...(backendOrigin ? [{ source: "/backend/api/:path*", destination: `${backendOrigin}/api/:path*` }] : []),
      // Live CCTV video: only the fixed stream. A request carrying its own `src` is not forwarded, because go2rtc
      // would accept an arbitrary source URL there.
      ...(go2rtcOrigin
        ? [{ source: "/cctv/ws", missing: [{ type: "query" as const, key: "src" }], destination: `${go2rtcOrigin}/api/ws?src=v61` }]
        : []),
    ];
  },
  turbopack: {
    root: path.resolve(__dirname, ".."),
  },
  // pdf.js ships as ESM with a separate worker module.
  transpilePackages: ["pdfjs-dist"],
};

export default nextConfig;
