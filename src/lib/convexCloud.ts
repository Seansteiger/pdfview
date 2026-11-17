import { ConvexReactClient } from "convex/react";
import { api } from "../../convex/_generated/api";

const STORAGE_KEY_CONVEX_URL = "vibepdf_convex_url";

/**
 * Retrieves the active Convex deployment URL from environment variables or browser localStorage.
 */
export function getActiveConvexUrl(): string | null {
  if (typeof window !== "undefined") {
    const customUrl = localStorage.getItem(STORAGE_KEY_CONVEX_URL);
    if (customUrl && customUrl.trim().length > 0) {
      return customUrl.trim();
    }
  }
  const envUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
  if (envUrl && envUrl.trim().length > 0) {
    return envUrl.trim();
  }
  return null;
}

/**
 * Saves or clears a user-configured Convex deployment URL in localStorage.
 */
export function setActiveConvexUrl(url: string | null): void {
  if (typeof window === "undefined") return;
  if (!url || url.trim().length === 0) {
    localStorage.removeItem(STORAGE_KEY_CONVEX_URL);
  } else {
    localStorage.setItem(STORAGE_KEY_CONVEX_URL, url.trim());
  }
  window.dispatchEvent(new Event("vibepdf-convex-url-changed"));
}

/**
 * Checks whether Convex cloud sync is configured and reachable.
 */
export function isConvexConfigured(): boolean {
  return !!getActiveConvexUrl();
}

/**
 * Creates a Convex client safely. Returns null if no URL is configured.
 */
export function createSafeConvexClient(): ConvexReactClient | null {
  const url = getActiveConvexUrl();
  if (!url) return null;
  try {
    return new ConvexReactClient(url);
  } catch (err) {
    console.warn("[VibePDF Cloud] Failed to initialize Convex client:", err);
    return null;
  }
}

export interface CloudUploadResult {
  cloudDocId: string;
  storageId: string;
}

/**
 * Uploads a local PDF binary to Convex Storage and creates/updates the document record.
 */
export async function uploadDocumentToCloud(
  client: ConvexReactClient,
  blob: Blob,
  meta: {
    title: string;
    pageCount: number;
    sizeBytes: number;
    annotationsCount?: number;
    isStarred?: boolean;
    existingCloudDocId?: string;
  }
): Promise<CloudUploadResult> {
  // 1. Request short-lived direct POST upload URL from Convex
  const postUrl = await client.mutation(api.documents.generateUploadUrl, {});

  // 2. Upload raw PDF blob to Convex storage
  const uploadResponse = await fetch(postUrl, {
    method: "POST",
    headers: { "Content-Type": "application/pdf" },
    body: blob,
  });

  if (!uploadResponse.ok) {
    throw new Error(`Cloud storage upload failed: HTTP ${uploadResponse.status} ${uploadResponse.statusText}`);
  }

  const { storageId } = (await uploadResponse.json()) as { storageId: string };

  // 3. Save document record in Convex
  const cloudDocId = await client.mutation(api.documents.saveDocument, {
    id: meta.existingCloudDocId as any,
    title: meta.title,
    storageId: storageId as any,
    pageCount: meta.pageCount,
    sizeBytes: meta.sizeBytes,
    annotationsCount: meta.annotationsCount,
    isStarred: meta.isStarred,
  });

  return { cloudDocId, storageId };
}
