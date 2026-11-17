import type { Metadata, Viewport } from "next";
import "./globals.css";
import { ConvexClientProvider } from "@/components/ConvexClientProvider";

export const metadata: Metadata = {
  title: "VibePDF Studio — Offline-First PDF Viewer & Editor",
  description: "High-precision offline-first PDF viewer, editor, and page surgery studio powered by Web Workers, IndexedDB, and client-side WebAssembly.",
  applicationName: "VibePDF",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "VibePDF",
  },
  formatDetection: {
    telephone: false,
  },
};

export const viewport: Viewport = {
  themeColor: "#09090b",
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
  userScalable: true,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark">
      <head>
        <link rel="icon" href="/icons/icon-192.png" type="image/png" sizes="192x192" />
        <link rel="icon" href="/icons/icon-192.svg" type="image/svg+xml" />
        <link rel="apple-touch-icon" href="/icons/apple-touch-icon.png" sizes="180x180" />
      </head>
      <body className="min-h-screen bg-[#09090b] text-zinc-100 antialiased subpixel-antialiased selection:bg-white/20 selection:text-white">
        <ConvexClientProvider>
          {children}
        </ConvexClientProvider>
      </body>
    </html>
  );
}
