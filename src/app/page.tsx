"use client";

import React, { useState, useEffect, useRef, useCallback } from "react";
import dynamic from "next/dynamic";
import {
  FileText,
  Upload,
  Layers,
  Scissors,
  PenTool,
  Download,
  Trash2,
  Star,
  Cloud,
  CloudCheck,
  HardDrive,
  Clock,
  ArrowRight,
  ArrowUpRight,
  Settings,
  X,
  Check,
  ShieldCheck,
  FolderOpen,
  FileCheck2,
  Sliders,
} from "lucide-react";
import {
  listLocalDocuments,
  deleteLocalDocument,
  toggleStarLocalDocument,
  LocalDocument,
  saveLocalDocument,
} from "@/lib/localDb";
import {
  isConvexConfigured,
  getActiveConvexUrl,
  setActiveConvexUrl,
  createSafeConvexClient,
  uploadDocumentToCloud,
} from "@/lib/convexCloud";
import { pdfWorker, blobToArrayBuffer, arrayBufferToBlob } from "@/lib/pdfWorkerClient";
import { createSampleWelcomePdf } from "@/lib/samplePdf";
import {
  ShimmerButton,
  CardSpotlight,
  BorderBeam,
  SlidingPillTabs,
  InsporaBadge,
  TabItem,
} from "@/components/ui/inspora-primitives";
import { PwaInstallControl } from "@/components/PwaInstallControl";

// Client-only dynamic loading of editor to exclude pdfjs-dist from Node.js SSR
const PdfEditor = dynamic(
  () => import("@/components/PdfEditor").then((m) => m.PdfEditor),
  {
    ssr: false,
    loading: () => (
      <div className="flex flex-col items-center justify-center w-screen h-screen bg-[#09090b] text-zinc-400 space-y-3">
        <div className="w-8 h-8 rounded-full border-2 border-white/40 border-t-transparent animate-spin" />
        <span className="text-xs font-mono">Loading VibePDF Studio Editor...</span>
      </div>
    ),
  }
);

export default function HomePage() {
  // Document Viewing State
  const [activeDoc, setActiveDoc] = useState<{
    id: string;
    blob: Blob;
    title: string;
  } | null>(null);

  // Documents List
  const [documents, setDocuments] = useState<LocalDocument[]>([]);
  const [activeFilter, setActiveFilter] = useState<string>("all");
  const [loading, setLoading] = useState(true);
  const [isDemoLoading, setIsDemoLoading] = useState(false);
  const [isSmartyLoading, setIsSmartyLoading] = useState(false);

  // Toast State for sleek Inspora feedback
  const [toast, setToast] = useState<{ message: string; type: "success" | "error" | "info" } | null>(null);

  const showToast = (message: string, type: "success" | "error" | "info" = "info") => {
    setToast({ message, type });
    setTimeout(() => {
      setToast((cur) => (cur?.message === message ? null : cur));
    }, 3500);
  };

  // Delete Confirmation Dialog State
  const [docToDelete, setDocToDelete] = useState<LocalDocument | null>(null);

  // Drag and Drop Zone State
  const [isDraggingOver, setIsDraggingOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const mergeInputRef = useRef<HTMLInputElement>(null);

  // Convex Settings Modal
  const [isConvexModalOpen, setIsConvexModalOpen] = useState(false);
  const [convexUrlInput, setConvexUrlInput] = useState("");
  const [convexConfigured, setConvexConfigured] = useState(false);

  // Refresh Documents from IndexedDB
  const refreshDocuments = useCallback(async () => {
    try {
      const docs = await listLocalDocuments();
      setDocuments(docs);
    } catch (err) {
      console.error("[HomePage] Failed to load local documents:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  // Load "The Smarty Bunny, Theatre proposal.pdf" sample from public folder
  const handleLoadSmartyBunnySample = useCallback(
    async (autoOpen: boolean = true): Promise<LocalDocument | null> => {
      try {
        setIsSmartyLoading(true);
        const res = await fetch("/samples/The-Smarty-Bunny-Theatre-proposal.pdf");
        if (!res.ok) {
          throw new Error(`Failed to fetch sample PDF: HTTP ${res.status}`);
        }
        const buffer = await res.arrayBuffer();
        const info = await pdfWorker.inspectPdf(buffer);
        const blob = new Blob([buffer], { type: "application/pdf" });
        const docId = `sample_smarty_bunny_${Date.now()}`;
        const title = "The Smarty Bunny, Theatre proposal.pdf";

        const sampleDoc: LocalDocument = {
          id: docId,
          title,
          blob,
          pageCount: info.pageCount || 1,
          sizeBytes: buffer.byteLength,
          updatedAt: Date.now(),
          createdAt: Date.now(),
          starred: true,
        };

        await saveLocalDocument(sampleDoc);
        const docs = await listLocalDocuments();
        setDocuments(docs);

        if (autoOpen) {
          setActiveDoc({ id: docId, blob, title });
        }
        return sampleDoc;
      } catch (err: any) {
        console.error("[HomePage] Failed to load Smarty Bunny sample:", err);
        if (autoOpen) {
          showToast(`Failed to load sample: ${err.message}`, "error");
        }
        return null;
      } finally {
        setIsSmartyLoading(false);
      }
    },
    []
  );

  // Open "The Smarty Bunny, Theatre proposal.pdf" - reuse if already cached or fetch fresh
  const handleOpenSmartyBunny = useCallback(async () => {
    try {
      setIsSmartyLoading(true);
      const docs = await listLocalDocuments();
      const existing = docs.find((d) => d.title.includes("The Smarty Bunny"));
      if (existing) {
        setActiveDoc({ id: existing.id, blob: existing.blob, title: existing.title });
        return;
      }
      await handleLoadSmartyBunnySample(true);
    } finally {
      setIsSmartyLoading(false);
    }
  }, [handleLoadSmartyBunnySample]);

  useEffect(() => {
    const initDocs = async () => {
      try {
        const docs = await listLocalDocuments();
        setDocuments(docs);

        // Check query parameters (e.g., ?loadSample=smarty-bunny)
        if (typeof window !== "undefined") {
          const params = new URLSearchParams(window.location.search);
          if (
            params.get("loadSample") === "smarty-bunny" ||
            params.get("sample") === "smarty-bunny" ||
            params.get("loadSample") === "true" ||
            params.get("smarty") === "true"
          ) {
            const found = docs.find((d) => d.title.includes("The Smarty Bunny"));
            if (found) {
              setActiveDoc({ id: found.id, blob: found.blob, title: found.title });
            } else {
              await handleLoadSmartyBunnySample(true);
            }
          }

          // Handle mobile Share Target PDF (?shared=1 from sw.ts)
          if (params.get("shared") === "1" && "caches" in window) {
            try {
              const cache = await caches.open("vibepdf-share-target");
              const res = await cache.match("/__shared-pdf__");
              if (res) {
                const rawName = res.headers.get("X-File-Name");
                const fileName = rawName ? decodeURIComponent(rawName) : "Shared Document.pdf";
                const blob = await res.blob();
                await cache.delete("/__shared-pdf__");
                const docId = `doc_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
                setActiveDoc({ id: docId, blob, title: fileName });
                // Inspect and persist in background without delaying open
                blob.arrayBuffer().then(async (buffer) => {
                  const info = await pdfWorker.inspectPdf(buffer).catch(() => ({ pageCount: 1 }));
                  await saveLocalDocument({
                    id: docId,
                    title: fileName,
                    blob,
                    pageCount: info.pageCount || 1,
                    sizeBytes: blob.size,
                    updatedAt: Date.now(),
                    createdAt: Date.now(),
                  });
                  refreshDocuments();
                });
              }
            } catch (shareErr) {
              console.error("[HomePage] Failed to open shared PDF:", shareErr);
            } finally {
              window.history.replaceState({}, "", "/");
            }
          }
        }
      } catch (err) {
        console.error("[HomePage] Failed to init local documents:", err);
      } finally {
        setLoading(false);
      }
    };

    initDocs();

    // Background idle pre-warming of PdfEditor & @embedpdf/viewer-react chunks
    const warmTimer = setTimeout(() => {
      import("@/components/PdfEditor").catch(() => {});
      import("@embedpdf/viewer-react").catch(() => {});
    }, 350);

    // Desktop PWA OS File Handler (clicking a .pdf directly in File Explorer / Finder)
    if (typeof window !== "undefined" && "launchQueue" in window && (window as any).launchQueue) {
      (window as any).launchQueue.setConsumer(async (launchParams: any) => {
        if (!launchParams?.files || launchParams.files.length === 0) return;
        try {
          for (let i = 0; i < launchParams.files.length; i++) {
            const handle = launchParams.files[i];
            const file: File = await handle.getFile();
            if (file && (file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf"))) {
              const docId = `doc_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
              if (i === 0) {
                setActiveDoc({ id: docId, blob: file, title: file.name });
              }
              file.arrayBuffer().then(async (buffer) => {
                const info = await pdfWorker.inspectPdf(buffer).catch(() => ({ pageCount: 1 }));
                await saveLocalDocument({
                  id: docId,
                  title: file.name,
                  blob: file,
                  pageCount: info.pageCount || 1,
                  sizeBytes: file.size,
                  updatedAt: Date.now(),
                  createdAt: Date.now(),
                });
                refreshDocuments();
              });
            }
          }
        } catch (launchErr) {
          console.error("[HomePage] Failed to open launched OS PDF file:", launchErr);
        }
      });
    }
    setConvexConfigured(isConvexConfigured());
    setConvexUrlInput(getActiveConvexUrl() || "");

    const handleUrlChange = () => {
      setConvexConfigured(isConvexConfigured());
      setConvexUrlInput(getActiveConvexUrl() || "");
    };
    window.addEventListener("vibepdf-convex-url-changed", handleUrlChange);
    return () => {
      clearTimeout(warmTimer);
      window.removeEventListener("vibepdf-convex-url-changed", handleUrlChange);
    };
  }, [handleLoadSmartyBunnySample, refreshDocuments]);

  // Open a file into Editor instantaneously without waiting for worker inspection
  const handleOpenFile = async (file: File) => {
    try {
      const docId = `doc_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
      setActiveDoc({ id: docId, blob: file, title: file.name });

      // Inspect metadata and persist to IndexedDB in background
      file.arrayBuffer().then(async (buffer) => {
        const info = await pdfWorker.inspectPdf(buffer).catch(() => ({ pageCount: 1 }));
        await saveLocalDocument({
          id: docId,
          title: file.name,
          blob: file,
          pageCount: info.pageCount || 1,
          sizeBytes: file.size,
          updatedAt: Date.now(),
          createdAt: Date.now(),
        });
        refreshDocuments();
      });
    } catch (err: any) {
      showToast(`Could not open PDF: ${err.message}`, "error");
    }
  };

  // Launch Built-In Interactive Demo PDF
  const handleLaunchDemoPdf = async () => {
    try {
      setIsDemoLoading(true);
      const demoBlob = await createSampleWelcomePdf();
      const buffer = await blobToArrayBuffer(demoBlob);
      const info = await pdfWorker.inspectPdf(buffer);
      const docId = `demo_${Date.now()}`;
      const demoTitle = "VibePDF Interactive Showcase.pdf";

      const newDoc: LocalDocument = {
        id: docId,
        title: demoTitle,
        blob: demoBlob,
        pageCount: info.pageCount || 4,
        sizeBytes: demoBlob.size,
        updatedAt: Date.now(),
        createdAt: Date.now(),
        starred: true,
      };

      await saveLocalDocument(newDoc);
      await refreshDocuments();
      setActiveDoc({ id: docId, blob: demoBlob, title: demoTitle });
    } catch (err: any) {
      showToast(`Failed to launch demo PDF: ${err.message}`, "error");
    } finally {
      setIsDemoLoading(false);
    }
  };

  // Merge multiple files selected from dropzone or quick action
  const handleMergeFiles = async (files: FileList | File[]) => {
    if (!files || files.length === 0) return;
    try {
      setLoading(true);
      const buffers: ArrayBuffer[] = [];
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        if (file.type === "application/pdf" || file.name.endsWith(".pdf")) {
          buffers.push(await file.arrayBuffer());
        }
      }

      if (buffers.length === 0) {
        showToast("Please select valid PDF files.", "error");
        return;
      }

      const mergedBuffer = await pdfWorker.mergePdfs(buffers);
      const mergedBlob = arrayBufferToBlob(mergedBuffer);
      const info = await pdfWorker.inspectPdf(mergedBuffer);
      const docId = `merged_${Date.now()}`;
      const title = `Merged Document (${buffers.length} files).pdf`;

      const newDoc: LocalDocument = {
        id: docId,
        title,
        blob: mergedBlob,
        pageCount: info.pageCount,
        sizeBytes: mergedBlob.size,
        updatedAt: Date.now(),
        createdAt: Date.now(),
      };

      await saveLocalDocument(newDoc);
      await refreshDocuments();
      setActiveDoc({ id: docId, blob: mergedBlob, title });
    } catch (err: any) {
      showToast(`Merge failed: ${err.message}`, "error");
    } finally {
      setLoading(false);
      if (mergeInputRef.current) mergeInputRef.current.value = "";
    }
  };

  // Star Toggle
  const handleToggleStar = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    await toggleStarLocalDocument(id);
    await refreshDocuments();
  };

  // Delete Document Execution
  const executeDeleteDoc = async () => {
    if (!docToDelete) return;
    const deletedTitle = docToDelete.title;
    try {
      await deleteLocalDocument(docToDelete.id);
      await refreshDocuments();
      showToast(`"${deletedTitle}" deleted from local storage`, "info");
    } catch (err: any) {
      showToast(`Failed to delete: ${err.message}`, "error");
    } finally {
      setDocToDelete(null);
    }
  };

  // Direct Download
  const handleDownloadDoc = (doc: LocalDocument, e: React.MouseEvent) => {
    e.stopPropagation();
    const url = URL.createObjectURL(doc.blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = doc.title.endsWith(".pdf") ? doc.title : `${doc.title}.pdf`;
    a.click();
    URL.revokeObjectURL(url);
    showToast(`Downloading "${doc.title}"`, "success");
  };

  // Sync to Convex Cloud from Hub
  const handleSyncToConvex = async (doc: LocalDocument, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!convexConfigured) {
      setIsConvexModalOpen(true);
      return;
    }

    const client = createSafeConvexClient();
    if (!client) {
      showToast("Could not connect to Convex client.", "error");
      return;
    }

    try {
      const res = await uploadDocumentToCloud(client, doc.blob, {
        title: doc.title,
        pageCount: doc.pageCount,
        sizeBytes: doc.sizeBytes,
        existingCloudDocId: doc.cloudDocId,
      });

      doc.cloudDocId = res.cloudDocId;
      doc.cloudSyncedAt = Date.now();
      await saveLocalDocument(doc);
      await refreshDocuments();
      showToast(`"${doc.title}" synchronized to Convex Cloud!`, "success");
    } catch (err: any) {
      showToast(`Cloud sync failed: ${err.message}`, "error");
    }
  };

  // Save Convex deployment URL
  const handleSaveConvexUrl = () => {
    setActiveConvexUrl(convexUrlInput.trim() || null);
    setIsConvexModalOpen(false);
    showToast("Convex connection updated!", "success");
  };

  // Format relative timestamp with tabular nums
  const formatTime = (ts: number) => {
    const diff = Math.floor((Date.now() - ts) / 1000);
    if (diff < 60) return "Just now";
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
    return `${Math.floor(diff / 86400)}d ago`;
  };

  // Filter tabs definition
  const filterTabs: TabItem[] = [
    { id: "all", label: "All Documents", count: documents.length },
    {
      id: "local",
      label: "Local Drafts",
      count: documents.filter((d) => !d.cloudDocId).length,
    },
    {
      id: "cloud",
      label: "Cloud Synced",
      count: documents.filter((d) => !!d.cloudDocId).length,
    },
    {
      id: "starred",
      label: "Starred",
      count: documents.filter((d) => !!d.starred).length,
    },
  ];

  // Filtered documents
  const filteredDocuments = documents.filter((doc) => {
    if (activeFilter === "local") return !doc.cloudDocId;
    if (activeFilter === "cloud") return !!doc.cloudDocId;
    if (activeFilter === "starred") return !!doc.starred;
    return true;
  });

  // If a document is currently active in Editor, render the PDF Editor view!
  if (activeDoc) {
    return (
      <PdfEditor
        initialDocId={activeDoc.id}
        initialBlob={activeDoc.blob}
        initialTitle={activeDoc.title}
        onBackToHub={() => {
          setActiveDoc(null);
          refreshDocuments();
        }}
        onDocumentCreatedOrUpdated={() => refreshDocuments()}
      />
    );
  }

  // ==========================================
  // RENDER WORKSPACE & HOME HUB
  // ==========================================
  return (
    <div className="min-h-screen bg-[#09090b] text-zinc-100 flex flex-col selection:bg-white/20 selection:text-white">
      {/* Non-blocking Inspora Toast Banner (Top Center) */}
      {toast && (
        <div
          className={`fixed top-4 left-1/2 -translate-x-1/2 z-50 flex items-center gap-2.5 px-4 py-2 rounded-full border shadow-2xl text-xs font-medium backdrop-blur-xl animate-in fade-in slide-in-from-top-2 duration-150 ${
            toast.type === "success"
              ? "bg-[#111113]/95 border-emerald-500/30 text-emerald-300"
              : toast.type === "error"
              ? "bg-[#111113]/95 border-red-500/30 text-red-300"
              : "bg-[#111113]/95 border-white/20 text-zinc-200"
          }`}
        >
          {toast.type === "success" && <Check className="w-3.5 h-3.5 text-emerald-400 shrink-0" />}
          {toast.type === "error" && <X className="w-3.5 h-3.5 text-red-400 shrink-0" />}
          {toast.type === "info" && <FileText className="w-3.5 h-3.5 text-zinc-300 shrink-0" />}
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

      {/* Delete Confirmation Modal */}
      {docToDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-in fade-in duration-150">
          <div className="relative w-full max-w-sm rounded-[20px] border border-red-500/30 bg-[#111113] text-zinc-100 shadow-2xl p-5 space-y-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400">
                <Trash2 className="w-5 h-5" />
              </div>
              <div className="min-w-0">
                <h3 className="text-sm font-bold text-white">Delete Document</h3>
                <p className="text-xs text-zinc-400">Remove from local storage</p>
              </div>
            </div>

            <p className="text-xs text-zinc-300 leading-relaxed">
              Are you sure you want to delete <span className="font-semibold text-white">&quot;{docToDelete.title}&quot;</span>? This action cannot be undone.
            </p>

            <div className="flex items-center justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={() => setDocToDelete(null)}
                className="px-3.5 py-1.5 rounded-lg border border-white/10 bg-white/[0.04] text-xs font-medium text-zinc-300 hover:text-white hover:bg-white/10 cursor-pointer transition-[transform,background-color] duration-150 active:scale-[0.98]"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={executeDeleteDoc}
                className="px-4 py-1.5 rounded-lg bg-red-600 hover:bg-red-500 text-xs font-semibold text-white transition-[transform,background-color] duration-150 shadow-md shadow-red-600/20 cursor-pointer active:scale-[0.98]"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================= */}
      {/* 1. ARCHITECTURAL SITE HEADER                             */}
      {/* ========================================================= */}
      <header className="sticky top-0 z-40 border-b border-white/[0.08] bg-[#09090b]/90 backdrop-blur-xl">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-2.5 sm:py-0 sm:h-16 flex flex-wrap sm:flex-nowrap items-center justify-between gap-3">
          {/* Brand Mark */}
          <div className="flex items-center gap-3 min-w-0 shrink-0">
            <div className="relative w-8 h-8 sm:w-9 sm:h-9 rounded-xl bg-[#161618] border border-white/15 p-[1px] shadow-[inset_0_1px_0_0_rgba(255,255,255,0.15)] flex items-center justify-center">
              <FileText className="w-4 h-4 text-white" />
            </div>

            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="font-bold tracking-tight text-sm sm:text-base text-white truncate">
                  VibePDF Studio
                </span>
                <span className="px-2 py-0.5 rounded text-[10px] font-mono font-medium bg-white/[0.08] text-zinc-300 border border-white/10 shrink-0">
                  WASM v1.0
                </span>
              </div>
              <p className="text-[11px] text-zinc-400 hidden sm:block">
                Client-Side High-Precision PDF Architecture
              </p>
            </div>
          </div>

          {/* Header Actions */}
          <div className="flex items-center gap-2 overflow-x-auto max-w-full py-0.5">
            <PwaInstallControl onInstalledToast={(msg) => showToast(msg, "success")} />

            {/* Convex Cloud Sync Pill Button */}
            <button
              type="button"
              onClick={() => setIsConvexModalOpen(true)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-xs font-medium transition-[transform,background-color] duration-150 cursor-pointer shrink-0 active:scale-[0.98] ${
                convexConfigured
                  ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300 hover:bg-emerald-500/20"
                  : "border-white/10 bg-white/[0.04] text-zinc-400 hover:text-white hover:bg-white/10"
              }`}
            >
              {convexConfigured ? (
                <CloudCheck className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
              ) : (
                <Cloud className="w-3.5 h-3.5 text-zinc-400 shrink-0" />
              )}
              <span className="hidden min-[480px]:inline">
                {convexConfigured ? "Convex Connected" : "Connect Cloud"}
              </span>
            </button>

            {/* Launch Demo PDF Button */}
            <ShimmerButton
              onClick={handleLaunchDemoPdf}
              disabled={isDemoLoading}
              className="!py-1.5 !px-3.5 text-xs font-semibold shrink-0"
            >
              {isDemoLoading ? (
                <div className="w-3.5 h-3.5 rounded-full border border-white border-t-transparent animate-spin mr-1" />
              ) : (
                <FileCheck2 className="w-3.5 h-3.5 mr-1 text-zinc-300 shrink-0" />
              )}
              <span>Interactive Demo</span>
            </ShimmerButton>
          </div>
        </div>
      </header>

      {/* ========================================================= */}
      {/* 2. ASYMMETRIC 60/40 EDITORIAL WORKBENCH (ANTI-SLOP HERO) */}
      {/* ========================================================= */}
      <section className="relative px-4 sm:px-6 pt-8 pb-10 max-w-7xl mx-auto w-full">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-stretch">
          
          {/* ------------------------------------------------------- */}
          {/* LEFT 60% (col-span-7) — DIRECT DOCUMENT INTAKE & DROPZONE */}
          {/* ------------------------------------------------------- */}
          <div
            onDragOver={(e) => {
              e.preventDefault();
              setIsDraggingOver(e.dataTransfer.types.includes("Files"));
            }}
            onDragLeave={() => setIsDraggingOver(false)}
            onDrop={(e) => {
              e.preventDefault();
              setIsDraggingOver(false);
              if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
                if (e.dataTransfer.files.length === 1) {
                  handleOpenFile(e.dataTransfer.files[0]);
                } else {
                  handleMergeFiles(e.dataTransfer.files);
                }
              }
            }}
            className={`lg:col-span-7 rounded-[20px] p-3 border transition-[border-color,background-color] duration-150 flex flex-col justify-between ${
              isDraggingOver
                ? "border-white/40 bg-[#161618] ring-1 ring-white/30"
                : "border-white/[0.08] bg-[#111113] shadow-[inset_0_1px_0_0_rgba(255,255,255,0.06)]"
            }`}
          >
            {/* Hidden inputs */}
            <input
              ref={fileInputRef}
              type="file"
              accept="application/pdf,.pdf"
              onChange={(e) => {
                if (e.target.files && e.target.files[0]) {
                  handleOpenFile(e.target.files[0]);
                }
              }}
              className="hidden"
            />
            <input
              ref={mergeInputRef}
              type="file"
              accept="application/pdf,.pdf"
              multiple
              onChange={(e) => {
                if (e.target.files && e.target.files.length > 0) {
                  handleMergeFiles(e.target.files);
                }
              }}
              className="hidden"
            />

            {/* Inner Dropzone Surface (Concentric Radius: 20px - 12px = 8px -> rounded-lg) */}
            <div className="rounded-lg border border-dashed border-white/15 bg-black/20 p-8 sm:p-10 flex flex-col items-center justify-center text-center flex-1">
              <div className="w-12 h-12 rounded-xl bg-white/[0.04] border border-white/10 flex items-center justify-center text-zinc-300 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.08)] mb-4">
                <Upload className="w-5 h-5 text-zinc-200" />
              </div>

              <div className="space-y-1.5 max-w-md">
                <h2 className="text-xl sm:text-2xl font-bold tracking-tight text-white">
                  Drop your PDF files here
                </h2>
                <p className="text-xs sm:text-sm text-zinc-400">
                  100% client-side computation via Web Workers & PDFium WebAssembly.
                </p>
              </div>

              {/* Action Buttons: High-Contrast Alabaster Primary CTA */}
              <div className="flex flex-wrap items-center justify-center gap-2.5 pt-6">
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="flex items-center gap-2 px-5 py-2.5 rounded-full bg-[#fafafa] hover:bg-white text-zinc-950 text-xs sm:text-sm font-semibold transition-[transform,background-color] duration-150 active:scale-[0.98] cursor-pointer shadow-sm"
                >
                  <FolderOpen className="w-4 h-4" />
                  <span>Browse Local PDF</span>
                </button>

                <button
                  type="button"
                  onClick={() => mergeInputRef.current?.click()}
                  className="flex items-center gap-2 px-4 py-2.5 rounded-full border border-white/10 bg-white/[0.04] hover:bg-white/10 text-xs sm:text-sm font-medium text-zinc-300 hover:text-white transition-[transform,background-color] duration-150 active:scale-[0.98] cursor-pointer"
                >
                  <Layers className="w-4 h-4 text-zinc-400" />
                  <span>Merge Multiple PDFs</span>
                </button>
              </div>
            </div>

            {/* Bottom Hardware Specs */}
            <div className="flex flex-wrap items-center justify-between gap-3 px-3 pt-3 text-[11px] text-zinc-500">
              <span className="flex items-center gap-1.5">
                <ShieldCheck className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                <span>Zero Server Uploads · 100% Air-Gapped Local</span>
              </span>
              <span className="flex items-center gap-1.5">
                <HardDrive className="w-3.5 h-3.5 text-zinc-400 shrink-0" />
                <span>Encrypted IndexedDB Cache</span>
              </span>
            </div>
          </div>

          {/* ------------------------------------------------------- */}
          {/* RIGHT 40% (col-span-5) — INSTANT WORKBENCH & SPEC ROSTER */}
          {/* ------------------------------------------------------- */}
          <div className="lg:col-span-5 rounded-[20px] p-3 border border-white/[0.08] bg-[#111113] shadow-[inset_0_1px_0_0_rgba(255,255,255,0.06)] flex flex-col justify-between">
            <div>
              <div className="flex items-center justify-between px-3 pt-2 pb-3 border-b border-white/[0.08]">
                <h3 className="text-xs font-mono font-semibold tracking-wider text-zinc-400 uppercase">
                  Instant Workbench & References
                </h3>
                <span className="text-[10px] font-mono text-zinc-500">READY</span>
              </div>

              {/* Dense Hairline Roster */}
              <div className="divide-y divide-white/[0.07]">
                {/* 01: The Smarty Bunny Proposal */}
                <div
                  onClick={handleOpenSmartyBunny}
                  className="group flex items-center justify-between py-3.5 px-3 rounded-lg hover:bg-white/[0.03] transition-[transform,background-color] duration-150 cursor-pointer active:scale-[0.99]"
                >
                  <div className="flex items-start gap-3 min-w-0 pr-2">
                    <span className="font-mono text-xs font-semibold text-zinc-500 group-hover:text-zinc-300 pt-0.5">
                      01
                    </span>
                    <div className="min-w-0">
                      <div className="text-xs font-semibold text-zinc-200 group-hover:text-white transition-colors truncate">
                        The Smarty Bunny Proposal
                      </div>
                      <div className="text-[11px] text-zinc-500 font-mono mt-0.5 tabular-nums">
                        9 pages · 822 KB · Theatre sample
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-1 text-xs font-medium text-zinc-400 group-hover:text-white shrink-0">
                    <span className="hidden sm:inline text-[11px]">Open</span>
                    <ArrowUpRight className="w-3.5 h-3.5 ml-0.5 translate-x-[1px] transition-transform group-hover:translate-x-[2px] group-hover:-translate-y-[1px]" />
                  </div>
                </div>

                {/* 02: Interactive PDF Capabilities */}
                <div
                  onClick={handleLaunchDemoPdf}
                  className="group flex items-center justify-between py-3.5 px-3 rounded-lg hover:bg-white/[0.03] transition-[transform,background-color] duration-150 cursor-pointer active:scale-[0.99]"
                >
                  <div className="flex items-start gap-3 min-w-0 pr-2">
                    <span className="font-mono text-xs font-semibold text-zinc-500 group-hover:text-zinc-300 pt-0.5">
                      02
                    </span>
                    <div className="min-w-0">
                      <div className="text-xs font-semibold text-zinc-200 group-hover:text-white transition-colors truncate">
                        Interactive Capabilities Testbench
                      </div>
                      <div className="text-[11px] text-zinc-500 font-mono mt-0.5 tabular-nums">
                        4 pages · AcroForm + Vector stamps
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-1 text-xs font-medium text-zinc-400 group-hover:text-white shrink-0">
                    <span className="hidden sm:inline text-[11px]">Inspect</span>
                    <ArrowUpRight className="w-3.5 h-3.5 ml-0.5 translate-x-[1px] transition-transform group-hover:translate-x-[2px] group-hover:-translate-y-[1px]" />
                  </div>
                </div>

                {/* 03: Batch PDF Merger */}
                <div
                  onClick={() => mergeInputRef.current?.click()}
                  className="group flex items-center justify-between py-3.5 px-3 rounded-lg hover:bg-white/[0.03] transition-[transform,background-color] duration-150 cursor-pointer active:scale-[0.99]"
                >
                  <div className="flex items-start gap-3 min-w-0 pr-2">
                    <span className="font-mono text-xs font-semibold text-zinc-500 group-hover:text-zinc-300 pt-0.5">
                      03
                    </span>
                    <div className="min-w-0">
                      <div className="text-xs font-semibold text-zinc-200 group-hover:text-white transition-colors truncate">
                        Batch PDF Document Merger
                      </div>
                      <div className="text-[11px] text-zinc-500 font-mono mt-0.5 tabular-nums">
                        Multi-file · Background Web Worker
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-1 text-xs font-medium text-zinc-400 group-hover:text-white shrink-0">
                    <span className="hidden sm:inline text-[11px]">Merge</span>
                    <ArrowRight className="w-3.5 h-3.5 ml-0.5 translate-x-[1px] transition-transform group-hover:translate-x-[2px]" />
                  </div>
                </div>

                {/* 04: Cryptographic & Ink Signature Studio */}
                <div
                  onClick={handleLaunchDemoPdf}
                  className="group flex items-center justify-between py-3.5 px-3 rounded-lg hover:bg-white/[0.03] transition-[transform,background-color] duration-150 cursor-pointer active:scale-[0.99]"
                >
                  <div className="flex items-start gap-3 min-w-0 pr-2">
                    <span className="font-mono text-xs font-semibold text-zinc-500 group-hover:text-zinc-300 pt-0.5">
                      04
                    </span>
                    <div className="min-w-0">
                      <div className="text-xs font-semibold text-zinc-200 group-hover:text-white transition-colors truncate">
                        E-Signature & Stamp Studio
                      </div>
                      <div className="text-[11px] text-zinc-500 font-mono mt-0.5 tabular-nums">
                        Vector seals · Calligraphic typography
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-1 text-xs font-medium text-zinc-400 group-hover:text-white shrink-0">
                    <span className="hidden sm:inline text-[11px]">Launch</span>
                    <ArrowRight className="w-3.5 h-3.5 ml-0.5 translate-x-[1px] transition-transform group-hover:translate-x-[2px]" />
                  </div>
                </div>
              </div>
            </div>

            <div className="px-3 pt-3 border-t border-white/[0.08] text-[10px] font-mono text-zinc-500 flex justify-between items-center">
              <span>WASM ARCHITECTURE</span>
              <span>ZERO DEPENDENCY BLOAT</span>
            </div>
          </div>
        </div>
      </section>

      {/* ========================================================= */}
      {/* 3. RECENT DOCUMENTS SECTION (CLEAN EDITORIAL CARDS)       */}
      {/* ========================================================= */}
      <section className="flex-1 px-4 sm:px-6 pb-16 max-w-7xl mx-auto w-full">
        {/* Section Navigation Bar */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-6">
          <div className="space-y-0.5">
            <h3 className="text-base font-bold text-white tracking-tight">
              Recent Documents
            </h3>
            <p className="text-xs text-zinc-400">
              Locally cached drafts and encrypted cloud-synced files.
            </p>
          </div>

          {/* Sliding Pill Tabs Filter with horizontal scroll containment */}
          <div className="overflow-x-auto max-w-full pb-1 scrollbar-none">
            <SlidingPillTabs
              tabs={filterTabs}
              activeId={activeFilter}
              onChange={setActiveFilter}
            />
          </div>
        </div>

        {/* Documents Grid */}
        {loading ? (
          <div className="flex flex-col items-center justify-center py-20 text-zinc-500 space-y-3">
            <div className="w-8 h-8 rounded-full border-2 border-white/20 border-t-white animate-spin" />
            <span className="text-xs font-mono">Querying IndexedDB repository...</span>
          </div>
        ) : filteredDocuments.length === 0 ? (
          <div className="rounded-[20px] border border-white/[0.08] bg-[#111113] p-8 sm:p-12 text-center space-y-4 max-w-md mx-auto my-6">
            <div className="w-12 h-12 rounded-xl bg-white/[0.04] border border-white/10 flex items-center justify-center mx-auto text-zinc-400">
              <FolderOpen className="w-5 h-5" />
            </div>
            <div className="space-y-1">
              <h4 className="text-sm font-semibold text-zinc-300">
                {activeFilter === "starred"
                  ? "No starred documents"
                  : activeFilter === "cloud"
                  ? "No cloud-synced documents"
                  : "No documents in workspace"}
              </h4>
              <p className="text-xs text-zinc-500">
                Drop a PDF above or click &apos;Interactive Demo&apos; to get started in 1 click.
              </p>
            </div>
            <button
              type="button"
              onClick={handleLaunchDemoPdf}
              className="px-4 py-2 rounded-full border border-white/15 bg-white/[0.06] text-xs font-medium text-zinc-200 hover:text-white hover:bg-white/10 transition-[transform,background-color] duration-150 cursor-pointer active:scale-[0.98]"
            >
              Launch Capabilities Demo PDF
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {filteredDocuments.map((doc) => (
              <div
                key={doc.id}
                onClick={() =>
                  setActiveDoc({
                    id: doc.id,
                    blob: doc.blob,
                    title: doc.title,
                  })
                }
                className="cursor-pointer group flex flex-col justify-between h-48 rounded-[18px] p-4 border border-white/[0.08] bg-[#111113] shadow-[inset_0_1px_0_0_rgba(255,255,255,0.05)] hover:border-white/20 hover:bg-[#151518] transition-[transform,border-color,background-color] duration-150 ease-out active:scale-[0.99] min-w-0 overflow-hidden"
              >
                <div className="min-w-0">
                  {/* Card Top: Semantic Status + Star (No 48x48 icon tile box!) */}
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2 min-w-0">
                      {doc.cloudDocId ? (
                        <InsporaBadge variant="success">CLOUD</InsporaBadge>
                      ) : (
                        <InsporaBadge variant="outline">LOCAL</InsporaBadge>
                      )}
                      {doc.pageCount && (
                        <span className="text-[11px] font-mono text-zinc-500 tabular-nums">
                          {doc.pageCount} {doc.pageCount === 1 ? "page" : "pages"}
                        </span>
                      )}
                    </div>

                    {/* Star Button */}
                    <button
                      type="button"
                      onClick={(e) => handleToggleStar(doc.id, e)}
                      className={`p-1.5 rounded-lg transition-colors cursor-pointer shrink-0 ${
                        doc.starred
                          ? "text-amber-400 hover:bg-amber-400/10"
                          : "text-zinc-500 hover:text-zinc-300 hover:bg-white/5"
                      }`}
                      title={doc.starred ? "Unstar" : "Star"}
                    >
                      <Star className={`w-3.5 h-3.5 ${doc.starred ? "fill-amber-400" : ""}`} />
                    </button>
                  </div>

                  {/* Title & Metadata with Tabular Numerals */}
                  <h4 className="text-sm font-semibold text-zinc-100 group-hover:text-white transition-colors truncate">
                    {doc.title}
                  </h4>
                  <div className="flex items-center gap-2 text-[11px] text-zinc-500 mt-1.5 tabular-nums font-mono truncate">
                    <span>{Math.round(doc.sizeBytes / 1024)} KB</span>
                    <span>·</span>
                    <span className="flex items-center gap-1">
                      <Clock className="w-3 h-3 text-zinc-500" />
                      {formatTime(doc.updatedAt)}
                    </span>
                  </div>
                </div>

                {/* Card Action Footer */}
                <div className="flex items-center justify-between pt-3 border-t border-white/[0.06] mt-auto">
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={(e) => handleDownloadDoc(doc, e)}
                      className="p-1.5 rounded-lg text-zinc-400 hover:text-white hover:bg-white/10 transition-colors cursor-pointer"
                      title="Download PDF"
                    >
                      <Download className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={(e) => handleSyncToConvex(doc, e)}
                      className={`p-1.5 rounded-lg transition-colors cursor-pointer ${
                        doc.cloudDocId
                          ? "text-emerald-400 hover:bg-emerald-400/10"
                          : "text-zinc-400 hover:text-white hover:bg-white/10"
                      }`}
                      title={doc.cloudDocId ? "Synced to Cloud" : "Sync to Convex"}
                    >
                      <Cloud className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setDocToDelete(doc);
                      }}
                      className="p-1.5 rounded-lg text-zinc-500 hover:text-red-400 hover:bg-white/10 transition-colors cursor-pointer"
                      title="Delete"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>

                  <span className="text-xs font-medium text-zinc-300 group-hover:text-white group-hover:translate-x-0.5 transition-all flex items-center gap-1">
                    Open <ArrowRight className="w-3 h-3 ml-0.5 translate-x-[1px]" />
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* ========================================================= */}
      {/* 4. CONVEX CLOUD CONFIGURATION MODAL                       */}
      {/* ========================================================= */}
      {isConvexModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-in fade-in duration-150">
          <div className="relative w-full max-w-md rounded-[20px] border border-white/[0.12] bg-[#111113] text-zinc-100 shadow-2xl p-6 space-y-4">
            <BorderBeam size={200} duration={8} colorFrom="transparent" colorTo="rgba(255, 255, 255, 0.4)" />

            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className="p-2 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-400">
                  <Cloud className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-white">Convex Cloud Sync</h3>
                  <p className="text-xs text-zinc-400">Private encrypted cloud storage</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIsConvexModalOpen(false)}
                className="p-1.5 rounded-lg text-zinc-400 hover:text-white hover:bg-white/10 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-2">
              <label className="block text-xs font-medium text-zinc-300">
                Convex Deployment URL:
              </label>
              <input
                type="text"
                placeholder="https://example-123.convex.cloud"
                value={convexUrlInput}
                onChange={(e) => setConvexUrlInput(e.target.value)}
                className="w-full px-3.5 py-2 rounded-xl border border-white/15 bg-black/40 text-xs text-white placeholder-zinc-500 focus:outline-none focus:border-white/40 font-mono"
              />
              <p className="text-[11px] text-zinc-500">
                Find this in your Convex Dashboard or by running <code className="text-zinc-300 font-mono">npx convex dev</code>.
              </p>
            </div>

            <div className="flex items-center justify-between pt-2">
              {convexConfigured ? (
                <button
                  type="button"
                  onClick={() => {
                    setActiveConvexUrl(null);
                    setConvexUrlInput("");
                    setIsConvexModalOpen(false);
                    showToast("Convex Cloud disconnected", "info");
                  }}
                  className="text-xs text-red-400 hover:underline cursor-pointer"
                >
                  Disconnect Cloud
                </button>
              ) : (
                <span className="text-xs text-zinc-500 font-mono">Local Only Mode</span>
              )}

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setIsConvexModalOpen(false)}
                  className="px-3.5 py-1.5 rounded-lg border border-white/10 bg-white/[0.04] text-xs font-medium text-zinc-300 hover:text-white hover:bg-white/10 cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleSaveConvexUrl}
                  className="px-4 py-1.5 rounded-lg bg-[#fafafa] hover:bg-white text-xs font-semibold text-zinc-950 transition-all cursor-pointer shadow-sm active:scale-[0.98]"
                >
                  Save Connection
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
