import { createStore, get, set, del, values } from "idb-keyval";

export type AnnotationType =
  | "highlight"
  | "strikeout"
  | "underline"
  | "note"
  | "ink"
  | "signature"
  | "redaction"
  | "watermark";

export interface SerializedAnnotation {
  id: string;
  type: AnnotationType;
  pageIndex: number;
  x: number; // PDF points (72 DPI)
  y: number;
  width?: number;
  height?: number;
  color?: string;
  opacity?: number;
  text?: string;
  points?: { x: number; y: number }[]; // Freehand ink vector points
  dataUrl?: string; // Base64 PNG/SVG for signatures
  author?: string;
  createdAt: number;
  updatedAt?: number;
}

export interface LocalDocument {
  id: string;
  title: string;
  blob: Blob; // Raw PDF binary stored safely as Blob (avoids iOS structured-clone memory leaks)
  pageCount: number;
  sizeBytes: number;
  updatedAt: number;
  createdAt: number;
  cloudDocId?: string;
  cloudSyncedAt?: number;
  starred?: boolean;
  annotations?: SerializedAnnotation[];
}

export interface SavedSignature {
  id: string;
  dataUrl: string;
  label: string;
  createdAt: number;
}

// Stores for documents and user e-signatures with isolated DB names to avoid idb-keyval onupgradeneeded collision
const docStore = typeof window !== "undefined" ? createStore("vibepdf-docs-db", "documents") : null!;
const sigStore = typeof window !== "undefined" ? createStore("vibepdf-sigs-db", "signatures") : null!;

/**
 * Saves or updates a document in local IndexedDB.
 */
export async function saveLocalDocument(doc: LocalDocument): Promise<void> {
  if (!docStore) return;
  try {
    await set(doc.id, doc, docStore);
  } catch (err) {
    console.warn("[localDb] Failed to save document to IndexedDB:", err);
  }
}

/**
 * Lists all locally cached documents sorted by latest update first.
 */
export async function listLocalDocuments(): Promise<LocalDocument[]> {
  if (!docStore) return [];
  try {
    const allDocs = await values<LocalDocument>(docStore);
    return (allDocs || []).sort((a, b) => b.updatedAt - a.updatedAt);
  } catch (err) {
    console.warn("[localDb] Failed to list documents from IndexedDB:", err);
    return [];
  }
}

/**
 * Retrieves a single document by its local ID.
 */
export async function getLocalDocument(id: string): Promise<LocalDocument | undefined> {
  if (!docStore) return undefined;
  try {
    return await get<LocalDocument>(id, docStore);
  } catch (err) {
    console.warn("[localDb] Failed to get document from IndexedDB:", err);
    return undefined;
  }
}

/**
 * Deletes a document from local IndexedDB storage.
 */
export async function deleteLocalDocument(id: string): Promise<void> {
  if (!docStore) return;
  try {
    await del(id, docStore);
  } catch (err) {
    console.warn("[localDb] Failed to delete document from IndexedDB:", err);
  }
}

/**
 * Toggles the starred bookmark flag on a local document.
 */
export async function toggleStarLocalDocument(id: string): Promise<boolean> {
  if (!docStore) return false;
  try {
    const doc = await get<LocalDocument>(id, docStore);
    if (!doc) return false;
    const updatedStarred = !doc.starred;
    doc.starred = updatedStarred;
    doc.updatedAt = Date.now();
    await set(id, doc, docStore);
    return updatedStarred;
  } catch (err) {
    console.warn("[localDb] Failed to toggle star in IndexedDB:", err);
    return false;
  }
}

/**
 * Saves a reusable drawn or typed e-signature data URL.
 */
export async function saveSignature(dataUrl: string, label: string = "Default Signature"): Promise<SavedSignature> {
  const signature: SavedSignature = {
    id: `sig_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
    dataUrl,
    label,
    createdAt: Date.now(),
  };

  if (!sigStore) {
    return signature;
  }

  try {
    await set(signature.id, signature, sigStore);
  } catch (err) {
    console.warn("[localDb] Failed to persist signature to IndexedDB:", err);
  }
  return signature;
}

/**
 * Retrieves all saved reusable signatures.
 */
export async function listSignatures(): Promise<SavedSignature[]> {
  if (!sigStore) return [];
  try {
    const sigs = await values<SavedSignature>(sigStore);
    return (sigs || []).sort((a, b) => b.createdAt - a.createdAt);
  } catch (err) {
    console.warn("[localDb] Failed to list signatures from IndexedDB:", err);
    return [];
  }
}

/**
 * Deletes a saved signature.
 */
export async function deleteSignature(id: string): Promise<void> {
  if (!sigStore) return;
  try {
    await del(id, sigStore);
  } catch (err) {
    console.warn("[localDb] Failed to delete signature from IndexedDB:", err);
  }
}
