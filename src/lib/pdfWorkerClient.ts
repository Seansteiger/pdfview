import type {
  PdfInspectionInfo,
  PdfWorkerAction,
  PdfWorkerRequest,
  PdfWorkerResponse,
} from "./pdfWorker";
import type { SerializedAnnotation } from "./localDb";

class PdfWorkerClient {
  private worker: Worker | null = null;
  private pendingRequests = new Map<
    string,
    {
      resolve: (data: any) => void;
      reject: (err: Error) => void;
    }
  >();

  private getWorker(): Worker {
    if (typeof window === "undefined") {
      throw new Error("PdfWorkerClient can only be used in a browser environment");
    }

    if (!this.worker) {
      this.worker = new Worker(new URL("./pdfWorker.ts", import.meta.url), {
        type: "module",
      });

      this.worker.onmessage = (event: MessageEvent<PdfWorkerResponse>) => {
        const { id, success, error, buffer, info } = event.data;
        const pending = this.pendingRequests.get(id);
        if (!pending) return;

        this.pendingRequests.delete(id);

        if (!success) {
          pending.reject(new Error(error || "Worker operation failed"));
        } else if (info) {
          pending.resolve(info);
        } else if (buffer) {
          pending.resolve(buffer);
        } else {
          pending.resolve(undefined);
        }
      };

      this.worker.onerror = (err) => {
        console.error("[PdfWorkerClient] Worker error:", err);
      };
    }

    return this.worker;
  }

  private dispatch<T>(
    action: PdfWorkerAction,
    payload: Omit<PdfWorkerRequest, "id" | "action">,
    transferables: Transferable[] = []
  ): Promise<T> {
    const worker = this.getWorker();
    const id = `req_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;

    return new Promise<T>((resolve, reject) => {
      this.pendingRequests.set(id, { resolve, reject });

      const request: PdfWorkerRequest = {
        id,
        action,
        ...payload,
      };

      worker.postMessage(request, transferables);
    });
  }

  /**
   * Inspects PDF metadata, total pages, and per-page dimensions.
   */
  async inspectPdf(buffer: ArrayBuffer): Promise<PdfInspectionInfo> {
    // Clone buffer slice so caller's original isn't detached if caller needs it
    const copy = buffer.slice(0);
    return await this.dispatch<PdfInspectionInfo>("INSPECT_PDF", { buffer: copy }, [copy]);
  }

  /**
   * Reorders pages by the given index array (0-based).
   */
  async reorderPages(buffer: ArrayBuffer, newOrder: number[]): Promise<ArrayBuffer> {
    const copy = buffer.slice(0);
    return await this.dispatch<ArrayBuffer>(
      "REORDER_PAGES",
      { buffer: copy, newOrder },
      [copy]
    );
  }

  /**
   * Rotates specified pages by 90, 180, 270, or -90 degrees.
   */
  async rotatePages(
    buffer: ArrayBuffer,
    pageIndices: number[],
    degrees: 90 | 180 | 270 | -90
  ): Promise<ArrayBuffer> {
    const copy = buffer.slice(0);
    return await this.dispatch<ArrayBuffer>(
      "ROTATE_PAGES",
      { buffer: copy, pageIndices, degrees },
      [copy]
    );
  }

  /**
   * Deletes specified pages from the PDF document.
   */
  async deletePages(buffer: ArrayBuffer, pageIndices: number[]): Promise<ArrayBuffer> {
    const copy = buffer.slice(0);
    return await this.dispatch<ArrayBuffer>(
      "DELETE_PAGES",
      { buffer: copy, pageIndices },
      [copy]
    );
  }

  /**
   * Extracts specified pages or range string into a standalone PDF.
   */
  async extractPages(
    buffer: ArrayBuffer,
    options: { pageIndices?: number[]; rangeString?: string }
  ): Promise<ArrayBuffer> {
    const copy = buffer.slice(0);
    return await this.dispatch<ArrayBuffer>(
      "EXTRACT_PAGES",
      { buffer: copy, ...options },
      [copy]
    );
  }

  /**
   * Merges multiple PDF ArrayBuffers into a single combined document.
   */
  async mergePdfs(buffers: ArrayBuffer[]): Promise<ArrayBuffer> {
    const copies = buffers.map((b) => b.slice(0));
    return await this.dispatch<ArrayBuffer>(
      "MERGE_PDFS",
      { buffers: copies },
      copies
    );
  }

  /**
   * Stamps/burns annotations (highlights, text, redactions, signatures) and flattens AcroForms.
   */
  async stampAndFlatten(
    buffer: ArrayBuffer,
    annotations: SerializedAnnotation[],
    flattenForms: boolean = true
  ): Promise<ArrayBuffer> {
    const copy = buffer.slice(0);
    return await this.dispatch<ArrayBuffer>(
      "STAMP_AND_FLATTEN",
      { buffer: copy, annotations, flattenForms },
      [copy]
    );
  }

  /**
   * Terminates the background worker instance.
   */
  terminate() {
    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
      this.pendingRequests.clear();
    }
  }
}

// Export singleton instance
export const pdfWorker = new PdfWorkerClient();

// Helper conversion utilities
export async function blobToArrayBuffer(blob: Blob): Promise<ArrayBuffer> {
  return await blob.arrayBuffer();
}

export function arrayBufferToBlob(buffer: ArrayBuffer, type = "application/pdf"): Blob {
  return new Blob([buffer], { type });
}
