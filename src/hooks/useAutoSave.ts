import { useEffect, useRef, useState, useCallback } from "react";
import { saveLocalDocument, LocalDocument, SerializedAnnotation } from "@/lib/localDb";

export type SaveStatus = "idle" | "saving" | "saved" | "error";

interface UseAutoSaveOptions {
  docId: string | null;
  title: string;
  getBlob: () => Promise<Blob | null> | Blob | null;
  pageCount: number;
  sizeBytes: number;
  annotations?: SerializedAnnotation[];
  cloudDocId?: string;
  isStarred?: boolean;
  debounceMs?: number;
  periodicIntervalMs?: number;
}

export function useAutoSave({
  docId,
  title,
  getBlob,
  pageCount,
  sizeBytes,
  annotations,
  cloudDocId,
  isStarred,
  debounceMs = 2000,
  periodicIntervalMs = 30000,
}: UseAutoSaveOptions) {
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle");
  const [lastSavedAt, setLastSavedAt] = useState<number | null>(null);

  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const prevAnnotationsCountRef = useRef<number>(annotations?.length ?? 0);

  const performSave = useCallback(async (): Promise<boolean> => {
    if (!docId) return false;

    try {
      setSaveStatus("saving");
      const currentBlob = await getBlob();
      if (!currentBlob) {
        setSaveStatus("idle");
        return false;
      }

      const now = Date.now();
      const docRecord: LocalDocument = {
        id: docId,
        title,
        blob: currentBlob,
        pageCount,
        sizeBytes: currentBlob.size || sizeBytes,
        updatedAt: now,
        createdAt: now,
        cloudDocId,
        starred: isStarred,
        annotations,
      };

      await saveLocalDocument(docRecord);
      setLastSavedAt(now);
      setSaveStatus("saved");

      // Reset to idle after 3 seconds of showing saved
      setTimeout(() => {
        setSaveStatus((prev) => (prev === "saved" ? "idle" : prev));
      }, 3000);

      return true;
    } catch (err) {
      console.error("[useAutoSave] Error saving document:", err);
      setSaveStatus("error");
      return false;
    }
  }, [docId, title, getBlob, pageCount, sizeBytes, cloudDocId, isStarred, annotations]);

  // Trigger debounced save when annotations change
  useEffect(() => {
    if (!docId) return;

    const currentCount = annotations?.length ?? 0;
    if (currentCount !== prevAnnotationsCountRef.current) {
      prevAnnotationsCountRef.current = currentCount;

      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }

      debounceTimerRef.current = setTimeout(() => {
        performSave();
      }, debounceMs);
    }

    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
    };
  }, [annotations, docId, debounceMs, performSave]);

  // Periodic interval backup
  useEffect(() => {
    if (!docId || periodicIntervalMs <= 0) return;

    const interval = setInterval(() => {
      performSave();
    }, periodicIntervalMs);

    return () => clearInterval(interval);
  }, [docId, periodicIntervalMs, performSave]);

  return {
    saveStatus,
    lastSavedAt,
    manualSave: performSave,
  };
}
