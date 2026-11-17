import withSerwistInit from "@serwist/next";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const withSerwist = withSerwistInit({
  swSrc: "src/app/sw.ts",
  swDest: "public/sw.js",
  disable: process.env.NODE_ENV === "development",
  reloadOnOnline: true,
  // Ensure the 7.89 MB PDFium WASM binary is precached for instant subsequent opens & offline use
  maximumFileSizeToCacheInBytes: 12 * 1024 * 1024,
});

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  outputFileTracingRoot: __dirname,
  serverExternalPackages: ["pdfjs-dist"],
  async headers() {
    return [
      {
        source: "/pdf.worker.min.mjs",
        headers: [
          {
            key: "Cache-Control",
            value: "public, max-age=31536000, immutable",
          },
        ],
      },
      {
        source: "/:path*.wasm",
        headers: [
          {
            key: "Cache-Control",
            value: "public, max-age=31536000, immutable",
          },
        ],
      },
    ];
  },
  webpack: (config, { isServer }) => {
    config.experiments = {
      ...config.experiments,
      asyncWebAssembly: true,
      layers: true,
    };
    if (isServer) {
      config.resolve.alias = {
        ...config.resolve.alias,
        "pdfjs-dist": false,
      };
    }
    return config;
  },
};

export default withSerwist(nextConfig);
