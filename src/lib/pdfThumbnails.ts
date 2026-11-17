// Client-side high-speed PDF page thumbnail renderer using pdfjs-dist

let pdfjsLibInstance: any = null;
const weakBlobCache = new WeakMap<Blob, string[]>();

/**
 * Initializes and returns the PDF.js library on the client.
 */
export async function getPdfjsLib() {
  if (pdfjsLibInstance) return pdfjsLibInstance;

  if (typeof window !== "undefined") {
    try {
      const pdfjs = await import("pdfjs-dist");
      if (pdfjs.GlobalWorkerOptions) {
        pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";
      }
      pdfjsLibInstance = pdfjs;
      return pdfjs;
    } catch (err) {
      console.error("[pdfThumbnails] Failed to load pdfjs-dist:", err);
      return null;
    }
  }
  return null;
}

/**
 * Renders thumbnail JPEG data URLs for every page in the given PDF Blob.
 * Uses WeakMap caching for instantaneous retrieval on repeated calls with the same Blob.
 */
export async function renderPdfThumbnails(
  blob: Blob,
  maxScale = 0.35,
  quality = 0.75
): Promise<string[]> {
  if (typeof window === "undefined" || !blob) return [];

  // Check in-memory WeakMap cache first
  if (weakBlobCache.has(blob)) {
    return weakBlobCache.get(blob)!;
  }

  const pdfjs = await getPdfjsLib();
  if (!pdfjs) return [];

  try {
    const arrayBuffer = await blob.arrayBuffer();
    // Copy bytes to avoid Web Worker array detachment bugs
    const clone = new Uint8Array(arrayBuffer.slice(0));
    const loadingTask = pdfjs.getDocument({
      data: clone,
      cMapUrl: "https://unpkg.com/pdfjs-dist@4.10.38/cmaps/",
      cMapPacked: true,
    });
    const pdf = await loadingTask.promise;
    const totalPages = pdf.numPages;
    const thumbnails: string[] = [];

    for (let i = 1; i <= totalPages; i++) {
      try {
        const page = await pdf.getPage(i);
        const viewport = page.getViewport({ scale: maxScale });
        const canvas = document.createElement("canvas");
        const context = canvas.getContext("2d");
        canvas.width = Math.max(1, Math.floor(viewport.width));
        canvas.height = Math.max(1, Math.floor(viewport.height));

        if (context) {
          // Fill background white
          context.fillStyle = "#ffffff";
          context.fillRect(0, 0, canvas.width, canvas.height);

          await page.render({
            canvasContext: context,
            viewport,
          }).promise;

          thumbnails.push(canvas.toDataURL("image/jpeg", quality));
        } else {
          thumbnails.push("");
        }
      } catch (pageErr) {
        console.warn(`[pdfThumbnails] Error rendering thumbnail for page ${i}:`, pageErr);
        thumbnails.push("");
      }
    }

    weakBlobCache.set(blob, thumbnails);
    return thumbnails;
  } catch (err) {
    console.error("[pdfThumbnails] Error in renderPdfThumbnails:", err);
    return [];
  }
}
