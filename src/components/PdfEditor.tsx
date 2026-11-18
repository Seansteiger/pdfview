"use client";

import React, { useState, useEffect, useMemo, useRef, useCallback } from "react";
import dynamic from "next/dynamic";
import {
  ArrowLeft,
  Share2,
  Download,
  RotateCw,
  RotateCcw,
  Trash2,
  Layers,
  FileCheck2,
  PenTool,
  SlidersHorizontal,
  Cloud,
  CloudCheck,
  Check,
  X,
  ChevronLeft,
  ChevronRight,
  Info,
  Undo2,
  Redo2,
  FileText,
  Eye,
  PanelLeft,
  ClipboardList,
} from "lucide-react";
import type { Viewer } from "@embedpdf/viewer/core";
import type { FormField } from "@embedpdf/plugin-form";
import {
  pdfWorker,
  blobToArrayBuffer,
  arrayBufferToBlob,
} from "@/lib/pdfWorkerClient";
import type { PdfInspectionInfo } from "@/lib/pdfWorker";
import {
  saveLocalDocument,
  getLocalDocument,
  LocalDocument,
  SerializedAnnotation,
  saveSignature,
} from "@/lib/localDb";
import {
  isConvexConfigured,
  createSafeConvexClient,
  uploadDocumentToCloud,
} from "@/lib/convexCloud";
import { renderPdfThumbnails } from "@/lib/pdfThumbnails";
import { useAutoSave } from "@/hooks/useAutoSave";
import { ShimmerButton, BorderBeam, InsporaBadge } from "./ui/inspora-primitives";

// Dynamically load modals with { ssr: false } to ensure client-only execution
const PageOrganizerModal = dynamic(
  () => import("./PageOrganizerModal").then((mod) => mod.PageOrganizerModal),
  { ssr: false }
);

const SignatureModal = dynamic(
  () => import("./SignatureModal").then((mod) => mod.SignatureModal),
  { ssr: false }
);

const FormFillerPanel = dynamic(
  () => import("./FormFillerPanel").then((mod) => mod.FormFillerPanel),
  { ssr: false }
);

// Dynamically load the high-DPI PDFium WebAssembly viewer on the client only
const PDFViewer = dynamic(
  () => import("@embedpdf/viewer-react").then((mod) => mod.PDFViewer),
  {
    ssr: false,
    loading: () => (
      <div className="flex flex-col items-center justify-center w-full h-full bg-[#09090b] text-zinc-400 space-y-3">
        <div className="w-8 h-8 rounded-full border-2 border-white/40 border-t-transparent animate-spin" />
        <span className="text-xs font-mono">Mounting WebAssembly PDFium Engine...</span>
      </div>
    ),
  }
);

export interface PdfEditorProps {
  initialDocId?: string | null;
  initialBlob: Blob;
  initialTitle?: string;
  onBackToHub: () => void;
  onDocumentCreatedOrUpdated?: (doc: LocalDocument) => void;
}

export function PdfEditor({
  initialDocId,
  initialBlob,
  initialTitle = "Untitled Document.pdf",
  onBackToHub,
  onDocumentCreatedOrUpdated,
}: PdfEditorProps) {
  // Document Core State
  const [docId, setDocId] = useState<string>(
    initialDocId || `doc_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`
  );
  const [title, setTitle] = useState<string>(initialTitle);
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [currentBlob, setCurrentBlob] = useState<Blob>(initialBlob);
  const [docInfo, setDocInfo] = useState<PdfInspectionInfo | null>(null);
  const [thumbnails, setThumbnails] = useState<string[]>([]);

  // Toast State for sleek feedback
  const [toast, setToast] = useState<{ message: string; type: "success" | "error" | "info" } | null>(null);

  const showToast = (message: string, type: "success" | "error" | "info" = "info") => {
    setToast({ message, type });
    setTimeout(() => {
      setToast((cur) => (cur?.message === message ? null : cur));
    }, 3500);
  };

  // Confirmation States
  const [confirmDeletePage, setConfirmDeletePage] = useState(false);
  const [confirmFlatten, setConfirmFlatten] = useState(false);

  // Undo / Redo History Stack
  const [history, setHistory] = useState<Blob[]>([initialBlob]);
  const [historyIndex, setHistoryIndex] = useState(0);

  // Active Tool & Navigation
  const [activeTool, setActiveTool] = useState<
    "view" | "highlight" | "ink" | "redact" | "stamp"
  >("view");
  const [currentPageIndex, setCurrentPageIndex] = useState(0);

  // UI Panels (all closed by default for distraction-free reading)
  const [leftRailOpen, setLeftRailOpen] = useState(false);
  const [rightInspectorOpen, setRightInspectorOpen] = useState(false);
  const [isFormPanelOpen, setIsFormPanelOpen] = useState(false);

  // Live PDFium Viewer & Form State
  const viewerRef = useRef<Viewer | null>(null);
  const [viewerInstance, setViewerInstance] = useState<Viewer | null>(null);
  const [formFields, setFormFields] = useState<readonly FormField[]>([]);
  const [modalBlob, setModalBlob] = useState<Blob | null>(null);
  const createdAtRef = useRef<number>(Date.now());
  const formAutoSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const manualSaveRef = useRef<(() => Promise<boolean>) | null>(null);
  const viewerCleanupsRef = useRef<Array<() => void>>([]);

  useEffect(() => {
    if (!initialDocId) return;
    getLocalDocument(initialDocId).then((existing) => {
      if (existing?.createdAt) {
        createdAtRef.current = existing.createdAt;
      }
    });
  }, [initialDocId]);

  useEffect(() => {
    return () => {
      if (formAutoSaveTimerRef.current) {
        clearTimeout(formAutoSaveTimerRef.current);
      }
      viewerCleanupsRef.current.forEach((fn) => {
        try {
          fn();
        } catch {}
      });
      viewerCleanupsRef.current = [];
    };
  }, []);

  const scheduleLiveBackgroundSave = useCallback(() => {
    if (formAutoSaveTimerRef.current) {
      clearTimeout(formAutoSaveTimerRef.current);
    }
    formAutoSaveTimerRef.current = setTimeout(() => {
      formAutoSaveTimerRef.current = null;
      manualSaveRef.current?.();
    }, 2000);
  }, []);

  const syncFormFieldsFromViewer = useCallback((v?: Viewer | null) => {
    const target = v || viewerRef.current;
    if (!target) return;
    try {
      const form = target.tryGet("form");
      if (form) {
        setFormFields(form.list());
      } else {
        setFormFields([]);
      }
    } catch {
      setFormFields([]);
    }
  }, []);

  const handleViewerReady = useCallback(
    (viewer: Viewer) => {
      viewerCleanupsRef.current.forEach((fn) => {
        try {
          fn();
        } catch {}
      });
      viewerCleanupsRef.current = [];

      viewerRef.current = viewer;
      setViewerInstance(viewer);

      // Calibrate form field appearance to blend transparently with document paper texture
      try {
        const form = viewer.tryGet("form");
        form?.updateSettings?.({
          focus: { color: "rgba(24, 24, 27, 0.45)" },
          fields: {
            border: "rgba(24, 24, 27, 0.16)",
            background: "rgba(24, 24, 27, 0.025)",
            color: "#18181b",
          },
        });
      } catch {}

      const refresh = () => syncFormFieldsFromViewer(viewer);
      refresh();

      try {
        const unsubOpened = viewer.documents.onOpened(() => {
          refresh();
          const stage = viewer.tryGet("stage");
          if (stage) {
            const idx = stage.getCurrentPageIndex();
            if (typeof idx === "number" && idx >= 0) {
              setCurrentPageIndex(idx);
            }
          }
        });
        viewerCleanupsRef.current.push(unsubOpened);
      } catch {}

      try {
        const unsubForm = viewer.watch(
          () => viewer.tryGet("form")?.getSnapshot() ?? null,
          (_snapshot, previous) => {
            refresh();
            if (previous !== undefined && previous !== null) {
              scheduleLiveBackgroundSave();
            }
          },
          { immediate: true }
        );
        viewerCleanupsRef.current.push(unsubForm);
      } catch {}

      try {
        const unsubStage = viewer.watch(
          () => viewer.tryGet("stage")?.getCurrentPageIndex() ?? null,
          (pageIdx) => {
            if (typeof pageIdx === "number" && pageIdx >= 0) {
              setCurrentPageIndex(pageIdx);
            }
          },
          { immediate: true }
        );
        viewerCleanupsRef.current.push(unsubStage);
      } catch {}

      try {
        const unsubUnsaved = viewer.documents.onUnsavedChangesChanged((ev) => {
          if (ev?.hasUnsavedChanges) {
            scheduleLiveBackgroundSave();
          }
        });
        viewerCleanupsRef.current.push(unsubUnsaved);
      } catch {}
    },
    [syncFormFieldsFromViewer, scheduleLiveBackgroundSave]
  );

  // Memoized viewer layout: close all internal tabs & side panels on initial open
  const viewerLayout = useCallback((layout: any) => {
    return layout.tabs("never").panels({ open: false });
  }, []);

  const viewerFeatures = useMemo(() => ({ "forms.building": true }), []);

  // Modals
  const [isOrganizerOpen, setIsOrganizerOpen] = useState(false);
  const [isSignatureOpen, setIsSignatureOpen] = useState(false);

  // Cloud & Connectivity
  const [isOnline, setIsOnline] = useState(true);
  const [cloudDocId, setCloudDocId] = useState<string | undefined>(undefined);
  const [isCloudSyncing, setIsCloudSyncing] = useState(false);
  const [cloudSyncSuccess, setCloudSyncSuccess] = useState(false);

  // Watermark / Stamp form in inspector
  const [watermarkText, setWatermarkText] = useState("CONFIDENTIAL");
  const [redactionLabel, setRedactionLabel] = useState("[REDACTED]");

  // Online / Offline listener
  useEffect(() => {
    setIsOnline(navigator.onLine);
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);

  // Inspect PDF metadata & page count via Web Worker
  const refreshPdfInfo = useCallback(async (blobToInspect: Blob) => {
    try {
      const buffer = await blobToArrayBuffer(blobToInspect);
      const info = await pdfWorker.inspectPdf(buffer);
      setDocInfo(info);
    } catch (err) {
      console.error("[PdfEditor] Failed to inspect PDF:", err);
    }
  }, []);

  useEffect(() => {
    refreshPdfInfo(currentBlob);
  }, [currentBlob, refreshPdfInfo]);

  // Lazy-render visual thumbnails ONLY when the left Pages rail is toggled open
  useEffect(() => {
    let isMounted = true;
    if (!leftRailOpen || !currentBlob) return;
    (async () => {
      try {
        const thumbs = await renderPdfThumbnails(currentBlob, 0.25);
        if (isMounted) setThumbnails(thumbs);
      } catch (err) {
        console.warn("[PdfEditor] Could not render left rail thumbnails:", err);
      }
    })();
    return () => {
      isMounted = false;
    };
  }, [leftRailOpen, currentBlob]);

  // Pull live modified bytes (including filled AcroForms & in-viewer annotations) from PDFium
  const getEffectivePdfBlob = useCallback(async (): Promise<Blob> => {
    if (viewerRef.current) {
      try {
        const bytes = await viewerRef.current.documents.download();
        if (bytes && bytes.byteLength > 0) {
          return new Blob([new Uint8Array(bytes)], { type: "application/pdf" });
        }
      } catch {
        // Fallback to currentBlob if active doc isn't ready
      }
    }
    return currentBlob;
  }, [currentBlob]);

  // Persist live viewer bytes (filled AcroForms + annotations) to IndexedDB
  const syncLiveViewerToLocalDb = useCallback(
    async (updateStateBlob = false): Promise<Blob> => {
      const liveBlob = await getEffectivePdfBlob();
      const now = Date.now();
      const docRecord: LocalDocument = {
        id: docId,
        title,
        blob: liveBlob,
        pageCount: docInfo?.pageCount || 1,
        sizeBytes: liveBlob.size,
        updatedAt: now,
        createdAt: createdAtRef.current,
        cloudDocId,
      };
      await saveLocalDocument(docRecord);
      if (onDocumentCreatedOrUpdated) {
        onDocumentCreatedOrUpdated(docRecord);
      }
      if (updateStateBlob) {
        setCurrentBlob(liveBlob);
      }
      return liveBlob;
    },
    [
      getEffectivePdfBlob,
      docId,
      title,
      docInfo?.pageCount,
      cloudDocId,
      onDocumentCreatedOrUpdated,
    ]
  );

  // Auto-Save Hook integration (always pulls live bytes from PDFium)
  const { saveStatus, lastSavedAt, manualSave } = useAutoSave({
    docId,
    title,
    getBlob: getEffectivePdfBlob,
    pageCount: docInfo?.pageCount || 1,
    sizeBytes: currentBlob.size,
    cloudDocId,
    debounceMs: 2500,
    periodicIntervalMs: 30000,
  });
  manualSaveRef.current = manualSave;

  // Handle PDF update from surgery, signatures, or stamps
  const handlePdfUpdated = async (newBlob: Blob, description?: string) => {
    // Add to Undo History
    const updatedHistory = history.slice(0, historyIndex + 1);
    updatedHistory.push(newBlob);
    setHistory(updatedHistory);
    setHistoryIndex(updatedHistory.length - 1);

    setCurrentBlob(newBlob);

    // Save immediately to local IndexedDB
    const now = Date.now();
    const docRecord: LocalDocument = {
      id: docId,
      title,
      blob: newBlob,
      pageCount: docInfo?.pageCount || 1,
      sizeBytes: newBlob.size,
      updatedAt: now,
      createdAt: createdAtRef.current,
      cloudDocId,
    };
    await saveLocalDocument(docRecord);
    if (onDocumentCreatedOrUpdated) {
      onDocumentCreatedOrUpdated(docRecord);
    }

    if (description) {
      showToast(description, "success");
    }
  };

  // Safe Workspace Exit: flush live form values & annotations to IndexedDB first
  const handleBackToWorkspace = async () => {
    if (formAutoSaveTimerRef.current) {
      clearTimeout(formAutoSaveTimerRef.current);
      formAutoSaveTimerRef.current = null;
    }
    try {
      await syncLiveViewerToLocalDb(false);
    } catch (err) {
      console.warn("[PdfEditor] Sync before exit failed:", err);
    } finally {
      onBackToHub();
    }
  };

  const handleGoToPage = (pageIdx: number) => {
    setCurrentPageIndex(pageIdx);
    try {
      viewerRef.current?.tryGet("stage")?.goToPage(pageIdx);
    } catch {}
  };

  const handleOpenOrganizer = async () => {
    const liveBlob = await syncLiveViewerToLocalDb(false);
    setModalBlob(liveBlob);
    setIsOrganizerOpen(true);
  };

  const handleOpenSignature = async () => {
    const liveBlob = await syncLiveViewerToLocalDb(false);
    setModalBlob(liveBlob);
    setIsSignatureOpen(true);
  };

  // Undo / Redo Actions
  const handleUndo = () => {
    if (historyIndex > 0) {
      const prevIndex = historyIndex - 1;
      setHistoryIndex(prevIndex);
      setCurrentBlob(history[prevIndex]);
      showToast("Undone last change", "info");
    }
  };

  const handleRedo = () => {
    if (historyIndex < history.length - 1) {
      const nextIndex = historyIndex + 1;
      setHistoryIndex(nextIndex);
      setCurrentBlob(history[nextIndex]);
      showToast("Redone change", "info");
    }
  };

  // Rotate Current Page 90° (preserves live filled form values)
  const handleQuickRotateCurrentPage = async (
    degrees: 90 | -90,
    targetPageIdx = currentPageIndex
  ) => {
    try {
      const liveBlob = await getEffectivePdfBlob();
      const buffer = await blobToArrayBuffer(liveBlob);
      const outBuffer = await pdfWorker.rotatePages(buffer, [targetPageIdx], degrees);
      const newBlob = arrayBufferToBlob(outBuffer);
      await handlePdfUpdated(newBlob, `Rotated Page ${targetPageIdx + 1} by ${degrees}°`);
    } catch (err: any) {
      showToast(`Rotate failed: ${err.message}`, "error");
    }
  };

  // Delete Current Page Execution (preserves live filled form values on remaining pages)
  const executeDeleteCurrentPage = async () => {
    setConfirmDeletePage(false);
    if (!docInfo || docInfo.pageCount <= 1) {
      showToast("Cannot delete the only page in the document.", "error");
      return;
    }

    try {
      const liveBlob = await getEffectivePdfBlob();
      const buffer = await blobToArrayBuffer(liveBlob);
      const outBuffer = await pdfWorker.deletePages(buffer, [currentPageIndex]);
      const newBlob = arrayBufferToBlob(outBuffer);
      if (currentPageIndex >= docInfo.pageCount - 1) {
        setCurrentPageIndex(Math.max(0, currentPageIndex - 1));
      }
      await handlePdfUpdated(newBlob, `Deleted Page ${currentPageIndex + 1}`);
    } catch (err: any) {
      showToast(`Delete failed: ${err.message}`, "error");
    }
  };

  // Burn Watermark via Worker (preserves live filled form values)
  const handleApplyWatermark = async () => {
    if (!watermarkText.trim()) return;
    try {
      const liveBlob = await getEffectivePdfBlob();
      const buffer = await blobToArrayBuffer(liveBlob);
      const ann = {
        id: `wm_${Date.now()}`,
        type: "watermark" as const,
        pageIndex: currentPageIndex,
        x: 140,
        y: 350,
        text: watermarkText.trim(),
        color: "#18181b",
        createdAt: Date.now(),
      };
      const outBuffer = await pdfWorker.stampAndFlatten(buffer, [ann], false);
      const newBlob = arrayBufferToBlob(outBuffer);
      await handlePdfUpdated(newBlob, `Applied Watermark to Page ${currentPageIndex + 1}`);
    } catch (err: any) {
      showToast(`Watermark failed: ${err.message}`, "error");
    }
  };

  // Burn Redaction Box via Worker (preserves live filled form values)
  const handleApplyRedactionBox = async () => {
    try {
      const liveBlob = await getEffectivePdfBlob();
      const buffer = await blobToArrayBuffer(liveBlob);
      const ann = {
        id: `redact_${Date.now()}`,
        type: "redaction" as const,
        pageIndex: currentPageIndex,
        x: 100,
        y: 600,
        width: 320,
        height: 28,
        text: redactionLabel.trim(),
        createdAt: Date.now(),
      };
      const outBuffer = await pdfWorker.stampAndFlatten(buffer, [ann], false);
      const newBlob = arrayBufferToBlob(outBuffer);
      await handlePdfUpdated(newBlob, `Applied Redaction to Page ${currentPageIndex + 1}`);
    } catch (err: any) {
      showToast(`Redaction failed: ${err.message}`, "error");
    }
  };

  // Flatten interactive AcroForm fields Execution
  const executeFlattenDocument = async () => {
    setConfirmFlatten(false);
    try {
      const liveBlob = await getEffectivePdfBlob();
      const buffer = await blobToArrayBuffer(liveBlob);
      const outBuffer = await pdfWorker.stampAndFlatten(buffer, [], true);
      const newBlob = arrayBufferToBlob(outBuffer);
      await handlePdfUpdated(newBlob, "AcroForms & annotations permanently flattened!");
    } catch (err: any) {
      showToast(`Flatten failed: ${err.message}`, "error");
    }
  };

  // Export / Download PDF (captures filled form fields & annotations)
  const handleExportDownload = async () => {
    const liveBlob = await getEffectivePdfBlob();
    const url = URL.createObjectURL(liveBlob);
    const a = document.createElement("a");
    a.href = url;
    a.download = title.endsWith(".pdf") ? title : `${title}.pdf`;
    a.click();
    URL.revokeObjectURL(url);
    showToast(`Exported "${title}"`, "success");
  };

  // Native Web Share
  const handleShare = async () => {
    const liveBlob = await getEffectivePdfBlob();
    if (navigator.share) {
      try {
        const file = new File([liveBlob], title, { type: "application/pdf" });
        await navigator.share({
          title,
          text: `pdfview document: ${title}`,
          files: [file],
        });
      } catch (err) {
        console.warn("Share cancelled or failed:", err);
      }
    } else {
      handleExportDownload();
    }
  };

  // Convex Cloud Push
  const handleSyncToConvexCloud = async () => {
    if (!isConvexConfigured()) {
      showToast("Convex Cloud not configured yet. Configure your URL on the Home page.", "info");
      return;
    }

    const client = createSafeConvexClient();
    if (!client) {
      showToast("Could not initialize Convex client.", "error");
      return;
    }

    setIsCloudSyncing(true);
    setCloudSyncSuccess(false);

    try {
      const liveBlob = await getEffectivePdfBlob();
      const result = await uploadDocumentToCloud(client, liveBlob, {
        title,
        pageCount: docInfo?.pageCount || 1,
        sizeBytes: liveBlob.size,
        existingCloudDocId: cloudDocId,
      });

      setCloudDocId(result.cloudDocId);
      setCloudSyncSuccess(true);
      showToast("Document synchronized to private Convex Cloud!", "success");
      setTimeout(() => setCloudSyncSuccess(false), 4000);
    } catch (err: any) {
      console.error("[PdfEditor] Cloud sync error:", err);
      showToast(`Cloud sync failed: ${err.message}`, "error");
    } finally {
      setIsCloudSyncing(false);
    }
  };

  return (
    <div className="flex flex-col h-screen w-screen overflow-hidden bg-[#09090b] text-zinc-100 select-none">
      {/* ========================================================= */}
      {/* 0. INSPORA TOAST BANNER (TOP-CENTER)                      */}
      {/* ========================================================= */}
      {toast && (
        <div
          className={`fixed top-14 left-1/2 -translate-x-1/2 z-50 flex items-center gap-2.5 px-4 py-2 rounded-full border shadow-2xl text-xs font-medium backdrop-blur-xl animate-in fade-in slide-in-from-top-2 duration-150 ${
            toast.type === "success"
              ? "bg-[#111113]/95 border-emerald-500/30 text-emerald-300"
              : toast.type === "error"
              ? "bg-[#111113]/95 border-red-500/30 text-red-300"
              : "bg-[#111113]/95 border-white/20 text-zinc-200"
          }`}
        >
          {toast.type === "success" && <Check className="w-3.5 h-3.5 text-emerald-400 shrink-0" />}
          {toast.type === "error" && <X className="w-3.5 h-3.5 text-red-400 shrink-0" />}
          {toast.type === "info" && <Info className="w-3.5 h-3.5 text-zinc-400 shrink-0" />}
          <span>{toast.message}</span>
          <button
            type="button"
            onClick={() => setToast(null)}
            className="ml-1 text-zinc-400 hover:text-white p-0.5 cursor-pointer"
          >
            <X className="w-3 h-3" />
          </button>
        </div>
      )}

      {/* Confirmation Banners */}
      {confirmDeletePage && (
        <div className="fixed top-14 left-1/2 -translate-x-1/2 z-50 flex items-center gap-3 px-5 py-2.5 rounded-[18px] bg-[#111113] border border-red-500/40 text-xs text-red-200 shadow-2xl backdrop-blur-xl animate-in fade-in slide-in-from-top-2 duration-150">
          <Trash2 className="w-4 h-4 text-red-400 shrink-0" />
          <span>Delete Page {currentPageIndex + 1}? This cannot be undone.</span>
          <div className="flex items-center gap-1.5 ml-2">
            <button
              type="button"
              onClick={() => setConfirmDeletePage(false)}
              className="px-2.5 py-1 rounded-md border border-white/10 bg-white/[0.04] text-zinc-300 hover:text-white cursor-pointer transition-[transform,background-color] duration-150 active:scale-[0.98]"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={executeDeleteCurrentPage}
              className="px-2.5 py-1 rounded-md bg-red-600 hover:bg-red-500 text-white font-semibold cursor-pointer transition-[transform,background-color] duration-150 active:scale-[0.98]"
            >
              Delete
            </button>
          </div>
        </div>
      )}

      {confirmFlatten && (
        <div className="fixed top-14 left-1/2 -translate-x-1/2 z-50 flex items-center gap-3 px-5 py-2.5 rounded-[18px] bg-[#111113] border border-amber-500/40 text-xs text-amber-200 shadow-2xl backdrop-blur-xl animate-in fade-in slide-in-from-top-2 duration-150">
          <FileCheck2 className="w-4 h-4 text-amber-400 shrink-0" />
          <span>Permanently commit form fields & annotations into PDF vectors?</span>
          <div className="flex items-center gap-1.5 ml-2">
            <button
              type="button"
              onClick={() => setConfirmFlatten(false)}
              className="px-2.5 py-1 rounded-md border border-white/10 bg-white/[0.04] text-zinc-300 hover:text-white cursor-pointer transition-[transform,background-color] duration-150 active:scale-[0.98]"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={executeFlattenDocument}
              className="px-2.5 py-1 rounded-md bg-amber-600 hover:bg-amber-500 text-white font-semibold cursor-pointer transition-[transform,background-color] duration-150 active:scale-[0.98]"
            >
              Flatten
            </button>
          </div>
        </div>
      )}

      {/* ========================================================= */}
      {/* 1. TOP DOCKED TOOL RIBBON (DESKTOP & TABLET >= 768px)     */}
      {/* ========================================================= */}
      <header className="hidden md:flex items-center justify-between px-4 py-2 border-b border-white/[0.08] bg-[#0c0d12] z-30 shrink-0">
        {/* Left: Back, Pages Toggle & Title */}
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={handleBackToWorkspace}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-white/10 bg-white/[0.04] text-xs font-medium text-zinc-300 hover:text-white hover:bg-white/10 transition-[transform,background-color] duration-150 cursor-pointer active:scale-[0.98]"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            <span>Workspace</span>
          </button>

          <button
            type="button"
            onClick={() => setLeftRailOpen((prev) => !prev)}
            className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl border text-xs font-medium transition-[transform,background-color] duration-150 cursor-pointer active:scale-[0.98] ${
              leftRailOpen
                ? "border-white/20 bg-white/[0.12] text-white"
                : "border-white/10 bg-white/[0.04] text-zinc-400 hover:text-white hover:bg-white/10"
            }`}
            title="Toggle Pages Rail"
          >
            <PanelLeft className="w-3.5 h-3.5" />
            <span>Pages</span>
          </button>

          <div className="h-4 w-[1px] bg-white/10" />

          {/* Document Title Editable */}
          {isEditingTitle ? (
            <input
              type="text"
              value={title}
              autoFocus
              onBlur={() => setIsEditingTitle(false)}
              onKeyDown={(e) => e.key === "Enter" && setIsEditingTitle(false)}
              onChange={(e) => setTitle(e.target.value)}
              className="px-2 py-0.5 rounded border border-white/30 bg-black/60 text-xs font-semibold text-white focus:outline-none max-w-[220px]"
            />
          ) : (
            <button
              type="button"
              onClick={() => setIsEditingTitle(true)}
              className="flex items-center gap-1.5 text-xs font-semibold text-zinc-200 hover:text-white transition-colors cursor-pointer max-w-[240px] truncate"
              title="Click to rename"
            >
              <FileText className="w-3.5 h-3.5 text-zinc-400 shrink-0" />
              <span className="truncate">{title}</span>
            </button>
          )}

          {/* Telemetry Pills */}
          <InsporaBadge variant="outline">
            {docInfo ? `${docInfo.pageCount} ${docInfo.pageCount === 1 ? "page" : "pages"}` : "Loading..."}
          </InsporaBadge>

          {/* Auto-Save Status */}
          <div className="flex items-center gap-1 text-[11px] text-zinc-400">
            {saveStatus === "saving" && (
              <span className="inline-flex items-center gap-1 text-amber-400">
                <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
                Saving...
              </span>
            )}
            {saveStatus === "saved" && (
              <span className="inline-flex items-center gap-1 text-emerald-400">
                <Check className="w-3 h-3" />
                IndexedDB
              </span>
            )}
            {saveStatus === "idle" && (
              <span className="text-zinc-500">
                {lastSavedAt ? "Saved" : "Offline"}
              </span>
            )}
          </div>
        </div>

        {/* Center: Quick Tool Switcher Pills (Calibrated Neutrals) */}
        <div className="flex items-center gap-1 p-1 rounded-full bg-[#111113] border border-white/[0.08] shadow-[inset_0_1px_0_0_rgba(255,255,255,0.05)]">
          <button
            type="button"
            onClick={() => setActiveTool("view")}
            className={`flex items-center gap-1 px-3 py-1 rounded-full text-xs font-medium transition-[transform,background-color] duration-150 cursor-pointer active:scale-[0.98] ${
              activeTool === "view"
                ? "bg-white/[0.12] text-white shadow-[inset_0_1px_0_0_rgba(255,255,255,0.15)]"
                : "text-zinc-400 hover:text-zinc-200"
            }`}
          >
            <Eye className="w-3.5 h-3.5" />
            <span>Select</span>
          </button>

          <button
            type="button"
            onClick={() => {
              setIsFormPanelOpen((prev) => !prev);
              if (!isFormPanelOpen) setRightInspectorOpen(false);
            }}
            className={`flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium transition-[transform,background-color] duration-150 cursor-pointer active:scale-[0.98] ${
              isFormPanelOpen
                ? "bg-white/[0.14] text-white shadow-[inset_0_1px_0_0_rgba(255,255,255,0.15)]"
                : "text-zinc-400 hover:text-zinc-200 hover:bg-white/[0.03]"
            }`}
            title="Guided Form Filler, Auto-Detect & Autofill"
          >
            <ClipboardList className="w-3.5 h-3.5 text-zinc-300" />
            <span>Fill Form</span>
            {formFields.length > 0 && (
              <span className="px-1.5 py-0.2 rounded-full text-[10px] font-mono tabular-nums bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                {formFields.length}
              </span>
            )}
          </button>

          <button
            type="button"
            onClick={handleOpenSignature}
            className="flex items-center gap-1 px-3 py-1 rounded-full text-xs font-medium text-zinc-400 hover:text-zinc-200 hover:bg-white/[0.03] transition-[transform,background-color] duration-150 cursor-pointer active:scale-[0.98]"
          >
            <PenTool className="w-3.5 h-3.5 text-zinc-300" />
            <span>E-Sign</span>
          </button>

          <button
            type="button"
            onClick={handleOpenOrganizer}
            className="flex items-center gap-1 px-3 py-1 rounded-full text-xs font-medium text-zinc-400 hover:text-zinc-200 hover:bg-white/[0.03] transition-[transform,background-color] duration-150 cursor-pointer active:scale-[0.98]"
          >
            <Layers className="w-3.5 h-3.5 text-zinc-300" />
            <span>Page Surgery</span>
          </button>

          <button
            type="button"
            onClick={() => setConfirmFlatten(true)}
            className="flex items-center gap-1 px-3 py-1 rounded-full text-xs font-medium text-zinc-400 hover:text-zinc-200 hover:bg-white/[0.03] transition-[transform,background-color] duration-150 cursor-pointer active:scale-[0.98]"
            title="Permanently flatten AcroForms and annotations"
          >
            <FileCheck2 className="w-3.5 h-3.5 text-amber-400" />
            <span>Flatten</span>
          </button>
        </div>

        {/* Right: History, Cloud Sync & Export */}
        <div className="flex items-center gap-2">
          {/* Undo / Redo */}
          <div className="flex items-center rounded-lg border border-white/10 bg-white/[0.03]">
            <button
              type="button"
              disabled={historyIndex <= 0}
              onClick={handleUndo}
              className="p-1.5 text-zinc-400 hover:text-white disabled:opacity-30 disabled:pointer-events-none transition-colors cursor-pointer"
              title="Undo"
            >
              <Undo2 className="w-3.5 h-3.5" />
            </button>
            <div className="w-[1px] h-3.5 bg-white/10" />
            <button
              type="button"
              disabled={historyIndex >= history.length - 1}
              onClick={handleRedo}
              className="p-1.5 text-zinc-400 hover:text-white disabled:opacity-30 disabled:pointer-events-none transition-colors cursor-pointer"
              title="Redo"
            >
              <Redo2 className="w-3.5 h-3.5" />
            </button>
          </div>

          {/* Convex Cloud Push */}
          <button
            type="button"
            disabled={isCloudSyncing}
            onClick={handleSyncToConvexCloud}
            className={`flex items-center gap-1 px-3 py-1.5 rounded-xl border text-xs font-medium transition-[transform,background-color] duration-150 cursor-pointer active:scale-[0.98] ${
              cloudSyncSuccess
                ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300"
                : "border-white/10 bg-white/[0.04] text-zinc-300 hover:text-white hover:bg-white/10"
            }`}
            title="Sync document to private Convex cloud"
          >
            {isCloudSyncing ? (
              <div className="w-3.5 h-3.5 rounded-full border border-white/40 border-t-transparent animate-spin" />
            ) : cloudSyncSuccess ? (
              <CloudCheck className="w-3.5 h-3.5 text-emerald-400" />
            ) : (
              <Cloud className="w-3.5 h-3.5 text-zinc-400" />
            )}
            <span className="hidden lg:inline">
              {cloudSyncSuccess ? "Synced" : "Cloud Sync"}
            </span>
          </button>

          {/* Share */}
          <button
            type="button"
            onClick={handleShare}
            className="p-1.5 rounded-xl border border-white/10 bg-white/[0.04] text-zinc-300 hover:text-white hover:bg-white/10 transition-all cursor-pointer"
            title="Share Document"
          >
            <Share2 className="w-3.5 h-3.5" />
          </button>

          {/* Inspector Panel Toggle */}
          <button
            type="button"
            onClick={() => {
              const next = !rightInspectorOpen;
              setRightInspectorOpen(next);
              if (next) setIsFormPanelOpen(false);
            }}
            className={`p-1.5 rounded-xl border text-xs transition-all cursor-pointer ${
              rightInspectorOpen
                ? "border-white/20 bg-white/[0.1] text-white"
                : "border-white/10 bg-white/[0.04] text-zinc-400 hover:text-white"
            }`}
            title="Toggle Document Inspector"
          >
            <SlidersHorizontal className="w-3.5 h-3.5" />
          </button>

          {/* Primary Export CTA: Crisp Alabaster White */}
          <button
            type="button"
            onClick={handleExportDownload}
            className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl bg-[#fafafa] hover:bg-white text-zinc-950 text-xs font-semibold transition-[transform,background-color] duration-150 cursor-pointer shadow-sm active:scale-[0.98]"
          >
            <Download className="w-3.5 h-3.5 mr-0.5" />
            Export
          </button>
        </div>
      </header>

      {/* ========================================================= */}
      {/* 2. MOBILE TOP HEADER (< 768px)                            */}
      {/* ========================================================= */}
      <header className="flex md:hidden items-center justify-between px-3 py-2 border-b border-white/[0.08] bg-[#0c0d12] z-30 shrink-0">
        <button
          type="button"
          onClick={handleBackToWorkspace}
          className="p-1.5 rounded-lg text-zinc-400 hover:text-white transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
        </button>

        <div className="flex flex-col items-center max-w-[180px]">
          <span className="text-xs font-bold text-zinc-200 truncate">{title}</span>
          <span className="text-[10px] text-zinc-500 font-mono tabular-nums">
            {docInfo?.pageCount || 1} pages · IndexedDB
          </span>
        </div>

        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={handleOpenOrganizer}
            className="p-1.5 rounded-lg border border-white/10 text-zinc-300"
            title="Pages"
          >
            <Layers className="w-4 h-4 text-zinc-300" />
          </button>
          <button
            type="button"
            onClick={handleExportDownload}
            className="p-1.5 rounded-lg bg-[#fafafa] text-zinc-950 font-medium"
            title="Export"
          >
            <Download className="w-4 h-4" />
          </button>
        </div>
      </header>

      {/* ========================================================= */}
      {/* 3. MAIN WORKSPACE VIEWPORT                                */}
      {/* ========================================================= */}
      <div className="relative flex flex-1 overflow-hidden">
        {/* ------------------------------------------------------- */}
        {/* Left Rail: Quick Page Surgery & Thumbnails (Closed by default) */}
        {/* ------------------------------------------------------- */}
        {leftRailOpen && (
          <aside className="hidden md:flex flex-col w-64 border-r border-white/[0.08] bg-[#09090b] z-20 shrink-0 animate-in slide-in-from-left duration-150">
            {/* Rail Header */}
            <div className="flex items-center justify-between px-3 py-2 border-b border-white/[0.08] bg-[#0c0d12]">
              <span className="text-xs font-semibold text-zinc-300">Pages</span>
              <button
                type="button"
                onClick={() => setLeftRailOpen(false)}
                className="p-1 rounded text-zinc-400 hover:text-white hover:bg-white/10 transition-colors ml-auto cursor-pointer"
                title="Close Pages Rail"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-3 space-y-3">
              {/* Full Organizer Trigger Button */}
              <button
                type="button"
                onClick={handleOpenOrganizer}
                className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-xl border border-dashed border-white/20 bg-white/[0.02] text-xs font-medium text-zinc-300 hover:border-white/40 hover:bg-white/[0.04] hover:text-white transition-all cursor-pointer"
              >
                <Layers className="w-3.5 h-3.5 text-zinc-300" />
                <span>Launch Page Grid</span>
              </button>

              {/* Page Thumbnails List with Visual Page Preview */}
              <div className="space-y-2">
                {Array.from({ length: docInfo?.pageCount || 1 }).map((_, idx) => {
                  const isCurrent = idx === currentPageIndex;
                  return (
                    <div
                      key={idx}
                      onClick={() => handleGoToPage(idx)}
                      className={`group relative flex items-center justify-between p-2 rounded-xl border transition-all cursor-pointer ${
                        isCurrent
                          ? "border-white/30 bg-white/[0.08] shadow-[inset_0_1px_0_0_rgba(255,255,255,0.12)] ring-1 ring-white/20"
                          : "border-white/[0.06] bg-[#0c0d12] hover:border-white/15 hover:bg-[#12131a]"
                      }`}
                    >
                      <div className="flex items-center gap-2.5">
                        <div className="relative w-8 h-10 rounded-md bg-white text-zinc-900 overflow-hidden flex items-center justify-center text-[10px] font-bold shadow-sm shrink-0">
                          {thumbnails[idx] ? (
                            /* eslint-disable-next-line @next/next/no-img-element */
                            <img
                              src={thumbnails[idx]}
                              alt={`Page ${idx + 1}`}
                              className="w-full h-full object-cover pointer-events-none"
                            />
                          ) : (
                            <span className="tabular-nums">{idx + 1}</span>
                          )}
                        </div>
                        <div>
                          <div className="text-xs font-medium text-zinc-200">
                            Page <span className="tabular-nums">{idx + 1}</span>
                          </div>
                          <div className="text-[10px] text-zinc-500 font-mono tabular-nums">
                            {docInfo?.pageDimensions[idx]
                              ? `${Math.round(docInfo.pageDimensions[idx].width)} × ${Math.round(docInfo.pageDimensions[idx].height)}`
                              : "Standard A4"}
                          </div>
                        </div>
                      </div>

                      {/* Quick Surgery on Hover */}
                      <div className="opacity-0 group-hover:opacity-100 flex items-center gap-1 transition-opacity">
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setCurrentPageIndex(idx);
                            handleQuickRotateCurrentPage(90, idx);
                          }}
                          className="p-1 rounded text-zinc-400 hover:text-white hover:bg-white/10 cursor-pointer"
                          title="Rotate 90° CW"
                        >
                          <RotateCw className="w-3 h-3" />
                        </button>
                        <button
                          type="button"
                          disabled={docInfo?.pageCount === 1}
                          onClick={(e) => {
                            e.stopPropagation();
                            setCurrentPageIndex(idx);
                            setConfirmDeletePage(true);
                          }}
                          className="p-1 rounded text-zinc-400 hover:text-red-400 hover:bg-white/10 disabled:opacity-20 cursor-pointer"
                          title="Delete Page"
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </aside>
        )}

        {/* ------------------------------------------------------- */}
        {/* Center: High-DPI PDFium WebAssembly Viewport            */}
        {/* Responsive fix: pb-20 on mobile so bottom pill bar never */}
        {/* obscures PDF page content or controls!                  */}
        {/* ------------------------------------------------------- */}
        <main className="relative flex-1 h-full w-full bg-[#121318] overflow-hidden flex flex-col pb-20 md:pb-0">
          {currentBlob ? (
            <div className="w-full h-full relative">
              <PDFViewer
                src={currentBlob}
                theme="dark"
                layout={viewerLayout}
                features={viewerFeatures}
                onReady={handleViewerReady}
                warnBeforeLeaving={false}
                style={{
                  width: "100%",
                  height: "100%",
                  display: "block",
                }}
              />
            </div>
          ) : (
            <div className="flex items-center justify-center h-full text-zinc-500 text-xs">
              No document loaded
            </div>
          )}
        </main>

        {/* ------------------------------------------------------- */}
        {/* Right Rail: Document Inspector & Overlays (Collapsible) */}
        {/* ------------------------------------------------------- */}
        {rightInspectorOpen && (
          <aside className="w-80 border-l border-white/[0.08] bg-[#0c0d12] flex flex-col z-20 shrink-0 animate-in slide-in-from-right duration-150">
            {/* Inspector Header */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-white/[0.08]">
              <div className="flex items-center gap-2">
                <Info className="w-4 h-4 text-zinc-400" />
                <span className="text-xs font-bold text-zinc-200">Document Inspector</span>
              </div>
              <button
                type="button"
                onClick={() => setRightInspectorOpen(false)}
                className="p-1 rounded text-zinc-400 hover:text-white hover:bg-white/10 transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-5 text-xs">
              {/* Document Telemetry */}
              <div className="space-y-2">
                <h4 className="text-[11px] font-semibold text-zinc-400 uppercase tracking-wider font-mono">
                  Metadata & Storage
                </h4>
                <div className="rounded-[16px] border border-white/[0.08] bg-[#111113] p-3 space-y-2 text-zinc-300">
                  <div className="flex justify-between">
                    <span className="text-zinc-500">File Size:</span>
                    <span className="font-mono tabular-nums">{Math.round(currentBlob.size / 1024)} KB</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-zinc-500">Page Count:</span>
                    <span className="font-mono tabular-nums">{docInfo?.pageCount || 1}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-zinc-500">Local Draft:</span>
                    <span>IndexedDB (Encrypted)</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-zinc-500">Cloud Status:</span>
                    <span className={cloudDocId ? "text-emerald-400" : "text-zinc-500"}>
                      {cloudDocId ? "Convex Synced" : "Local Only"}
                    </span>
                  </div>
                </div>
              </div>

              {/* Watermark Tool */}
              <div className="space-y-2">
                <h4 className="text-[11px] font-semibold text-zinc-400 uppercase tracking-wider font-mono">
                  Stamp Watermark
                </h4>
                <div className="rounded-[16px] border border-white/[0.08] bg-[#111113] p-3 space-y-2.5">
                  <input
                    type="text"
                    value={watermarkText}
                    onChange={(e) => setWatermarkText(e.target.value)}
                    placeholder="Watermark text"
                    className="w-full px-2.5 py-1.5 rounded-lg border border-white/10 bg-black/40 text-xs text-white focus:outline-none focus:border-white/30"
                  />
                  <button
                    type="button"
                    onClick={handleApplyWatermark}
                    className="w-full py-1.5 rounded-lg border border-white/15 bg-white/[0.06] text-xs font-medium text-zinc-200 hover:bg-white/[0.1] transition-all cursor-pointer active:scale-[0.98]"
                  >
                    Stamp on Page <span className="tabular-nums">{currentPageIndex + 1}</span>
                  </button>
                </div>
              </div>

              {/* Redaction Tool */}
              <div className="space-y-2">
                <h4 className="text-[11px] font-semibold text-zinc-400 uppercase tracking-wider font-mono">
                  Permanent Redaction Box
                </h4>
                <div className="rounded-[16px] border border-white/[0.08] bg-[#111113] p-3 space-y-2.5">
                  <input
                    type="text"
                    value={redactionLabel}
                    onChange={(e) => setRedactionLabel(e.target.value)}
                    placeholder="Overlay label"
                    className="w-full px-2.5 py-1.5 rounded-lg border border-white/10 bg-black/40 text-xs text-white focus:outline-none focus:border-red-500/50"
                  />
                  <button
                    type="button"
                    onClick={handleApplyRedactionBox}
                    className="w-full py-1.5 rounded-lg border border-red-500/30 bg-red-500/15 text-xs font-medium text-red-300 hover:bg-red-500/25 transition-all cursor-pointer active:scale-[0.98]"
                  >
                    Burn Redaction Box
                  </button>
                </div>
              </div>
            </div>
          </aside>
        )}

        {/* ------------------------------------------------------- */}
        {/* Right Rail: Smart Form Studio Drawer (Closed by default) */}
        {/* ------------------------------------------------------- */}
        <FormFillerPanel
          isOpen={isFormPanelOpen}
          onClose={() => setIsFormPanelOpen(false)}
          viewer={viewerInstance}
          pdfBlob={currentBlob}
          documentTitle={title}
          totalPages={docInfo?.pageCount || 1}
          currentPageIndex={currentPageIndex}
          fields={formFields}
          onFieldsChanged={() => syncFormFieldsFromViewer()}
          onFlattenRequest={() => setConfirmFlatten(true)}
          onOpenSignature={handleOpenSignature}
          onNotify={showToast}
        />
      </div>

      {/* ========================================================= */}
      {/* 4. MOBILE FLOATING ERGONOMIC BOTTOM PILL TOOLBAR (< 768px)*/}
      {/* ========================================================= */}
      <div className="flex md:hidden fixed bottom-4 inset-x-0 justify-center z-40 px-4 pointer-events-none">
        <div className="pointer-events-auto flex items-center gap-1 px-3 py-2 rounded-full bg-zinc-900/95 backdrop-blur-xl border border-white/15 shadow-2xl">
          <button
            type="button"
            onClick={() => setActiveTool("view")}
            className={`p-2 rounded-full transition-all cursor-pointer ${
              activeTool === "view" ? "bg-white/20 text-white" : "text-zinc-400"
            }`}
            title="Select"
          >
            <Eye className="w-4 h-4" />
          </button>

          <button
            type="button"
            onClick={() => {
              setIsFormPanelOpen((prev) => !prev);
              if (!isFormPanelOpen) setRightInspectorOpen(false);
            }}
            className={`relative p-2 rounded-full transition-all cursor-pointer ${
              isFormPanelOpen ? "bg-white/20 text-white" : "text-zinc-400 hover:text-white"
            }`}
            title="Fill Form"
          >
            <ClipboardList className="w-4 h-4" />
            {formFields.length > 0 && (
              <span className="absolute -top-0.5 -right-0.5 w-4 h-4 rounded-full bg-emerald-500 text-[9px] font-bold text-zinc-950 flex items-center justify-center tabular-nums">
                {formFields.length}
              </span>
            )}
          </button>

          <button
            type="button"
            onClick={handleOpenSignature}
            className="p-2 rounded-full text-zinc-400 hover:text-white cursor-pointer"
            title="E-Sign"
          >
            <PenTool className="w-4 h-4 text-zinc-300" />
          </button>

          <button
            type="button"
            onClick={handleOpenOrganizer}
            className="p-2 rounded-full text-zinc-400 hover:text-white cursor-pointer"
            title="Pages"
          >
            <Layers className="w-4 h-4 text-zinc-300" />
          </button>

          <button
            type="button"
            onClick={() => setConfirmFlatten(true)}
            className="p-2 rounded-full text-zinc-400 hover:text-white cursor-pointer"
            title="Flatten"
          >
            <FileCheck2 className="w-4 h-4 text-amber-400" />
          </button>

          <div className="w-[1px] h-5 bg-white/15 mx-1" />

          <button
            type="button"
            onClick={handleExportDownload}
            className="p-2 rounded-full bg-[#fafafa] text-zinc-950 font-semibold cursor-pointer shadow-sm active:scale-[0.98]"
            title="Download"
          >
            <Download className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* ========================================================= */}
      {/* 5. MODALS                                                 */}
      {/* ========================================================= */}
      <PageOrganizerModal
        isOpen={isOrganizerOpen}
        onClose={() => {
          setIsOrganizerOpen(false);
          setModalBlob(null);
        }}
        pdfBlob={modalBlob || currentBlob}
        onPdfUpdated={handlePdfUpdated}
      />

      <SignatureModal
        isOpen={isSignatureOpen}
        onClose={() => {
          setIsSignatureOpen(false);
          setModalBlob(null);
        }}
        pdfBlob={modalBlob || currentBlob}
        currentPageIndex={currentPageIndex}
        totalPages={docInfo?.pageCount || 1}
        onPdfUpdated={handlePdfUpdated}
      />
    </div>
  );
}
