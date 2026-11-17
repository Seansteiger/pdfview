import { defaultCache } from "@serwist/next/worker";
import type { PrecacheEntry, SerwistGlobalConfig } from "serwist";
import { CacheFirst, ExpirationPlugin, Serwist } from "serwist";

declare global {
  interface WorkerGlobalScope extends SerwistGlobalConfig {
    __SW_MANIFEST: (PrecacheEntry | string)[] | undefined;
  }
}

declare const self: ServiceWorkerGlobalScope;

// Handle mobile OS "Share -> pdfview" (Web Share Target POST)
self.addEventListener("fetch", (event: FetchEvent) => {
  const url = new URL(event.request.url);
  if (
    event.request.method === "POST" &&
    url.pathname === "/" &&
    url.searchParams.get("share-target") === "true"
  ) {
    event.respondWith(
      (async () => {
        try {
          const formData = await event.request.formData();
          const file = formData.get("file") as File | null;
          if (file && file.size > 0) {
            const cache = await caches.open("vibepdf-share-target");
            const headers = new Headers({
              "Content-Type": file.type || "application/pdf",
              "X-File-Name": encodeURIComponent(file.name || "Shared Document.pdf"),
            });
            await cache.put(
              "/__shared-pdf__",
              new Response(file, { headers })
            );
          }
        } catch (err) {
          console.error("[SW] Failed to process share_target file:", err);
        }
        return Response.redirect("/?shared=1", 303);
      })()
    );
  }
});

const serwist = new Serwist({
  precacheEntries: self.__SW_MANIFEST,
  skipWaiting: true,
  clientsClaim: true,
  navigationPreload: true,
  runtimeCaching: [
    {
      matcher: ({ url }) => url.pathname.endsWith(".wasm"),
      handler: new CacheFirst({
        cacheName: "wasm-cache",
        plugins: [
          new ExpirationPlugin({
            maxEntries: 16,
            maxAgeSeconds: 31536000,
          }),
        ],
      }),
    },
    ...defaultCache,
  ],
});

serwist.addEventListeners();
