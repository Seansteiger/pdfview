"use client";

import React, { useState, useEffect, useMemo, useRef } from "react";
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  rectSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  X,
  RotateCw,
  RotateCcw,
  Trash2,
  Download,
  Upload,
  CheckSquare,
  Square,
  GripVertical,
  Scissors,
  Layers,
  FileCheck2,
  FileText,
  AlertCircle,
  Check,
} from "lucide-react";
import { pdfWorker, blobToArrayBuffer, arrayBufferToBlob } from "@/lib/pdfWorkerClient";
import type { PdfInspectionInfo } from "@/lib/pdfWorker";
import { renderPdfThumbnails } from "@/lib/pdfThumbnails";
import { ShimmerButton, BorderBeam, InsporaBadge } from "./ui/inspora-primitives";

export interface PageOrganizerModalProps {
  isOpen: boolean;
  onClose: () => void;
  pdfBlob: Blob | null;
  onPdfUpdated: (newBlob: Blob, description?: string) => Promise<void> | void;
  onExtractAsNewDraft?: (newBlob: Blob, title: string) => void;
}

interface PageItem {
  id: string; // unique drag id, e.g. "page-uuid"
  originalIndex: number; // 0-based index in the current PDF
  displayNumber: number; // 1-based display number
  rotation: number; // 0, 90, 180, 270
  width: number;
  height: number;
}

// ==========================================
// Sortable Page Card Component
// ==========================================
function SortablePageCard({
  page,
  isSelected,
  thumbnailUrl,
  onToggleSelect,
  onRotateOne,
  onDeleteOne,
  isSinglePage,
}: {
  page: PageItem;
  isSelected: boolean;
  thumbnailUrl?: string;
  onToggleSelect: (idx: number) => void;
  onRotateOne: (idx: number, degrees: 90 | -90) => void;
  onDeleteOne: (idx: number) => void;
  isSinglePage: boolean;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: page.id });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    zIndex: isDragging ? 50 : 1,
    opacity: isDragging ? 0.6 : 1,
  };

  const isLandscape = (page.rotation % 180 !== 0)
    ? page.width < page.height
    : page.width > page.height;

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`group relative flex flex-col rounded-xl border transition-[transform,border-color,background-color] duration-150 select-none ${
        isSelected
          ? "border-white/40 bg-white/[0.08] shadow-[inset_0_1px_0_0_rgba(255,255,255,0.15)] ring-1 ring-white/20"
          : "border-white/[0.08] bg-[#111113] hover:border-white/20 hover:bg-[#161618]"
      }`}
    >
      {/* Top Card Controls */}
      <div className="flex items-center justify-between px-2.5 py-1.5 border-b border-white/[0.06] bg-white/[0.02]">
        <button
          type="button"
          onClick={() => onToggleSelect(page.originalIndex)}
          className="flex items-center gap-1.5 text-xs text-zinc-400 hover:text-white transition-colors cursor-pointer"
        >
          {isSelected ? (
            <CheckSquare className="w-3.5 h-3.5 text-white" />
          ) : (
            <Square className="w-3.5 h-3.5" />
          )}
          <span className="font-semibold text-zinc-200 font-mono tabular-nums">p.{page.displayNumber}</span>
        </button>

        {/* Drag Handle */}
        <div
          {...attributes}
          {...listeners}
          className="cursor-grab active:cursor-grabbing p-1 rounded hover:bg-white/10 text-zinc-500 hover:text-zinc-200"
          title="Drag to reorder"
        >
          <GripVertical className="w-3.5 h-3.5" />
        </div>
      </div>

      {/* Visual Page Preview with Real Rendered Image */}
      <div className="relative flex items-center justify-center p-2.5 h-44 overflow-hidden bg-black/40">
        <div
          style={{
            transform: `rotate(${page.rotation}deg)`,
            transition: "transform 0.2s cubic-bezier(0.2, 0.8, 0.2, 1)",
            aspectRatio: isLandscape ? "4/3" : "3/4",
          }}
          className="relative w-28 max-h-36 rounded-md bg-white text-zinc-900 shadow-xl overflow-hidden flex flex-col justify-between pointer-events-none"
        >
          {thumbnailUrl ? (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img
              src={thumbnailUrl}
              alt={`Page ${page.displayNumber}`}
              className="w-full h-full object-contain pointer-events-none"
            />
          ) : (
            /* Stylized Sheet Texture Skeleton Fallback while rendering */
            <div className="p-2.5 flex flex-col justify-between h-full">
              <div className="space-y-1.5">
                <div className="h-1.5 w-10/12 rounded bg-zinc-700" />
                <div className="h-1 w-full rounded bg-zinc-300" />
                <div className="h-1 w-full rounded bg-zinc-300" />
                <div className="h-1 w-8/12 rounded bg-zinc-300" />
              </div>

              <div className="space-y-1">
                <div className="h-1 w-11/12 rounded bg-zinc-200" />
                <div className="h-1 w-9/12 rounded bg-zinc-200" />
              </div>

              <div className="flex items-center justify-between text-[8px] font-mono font-bold text-zinc-400 border-t border-zinc-200 pt-1 tabular-nums">
                <span>{Math.round(page.width)}×{Math.round(page.height)}</span>
                <span>#{page.displayNumber}</span>
              </div>
            </div>
          )}
        </div>

        {/* Rotation Badge overlay if rotated */}
        {page.rotation !== 0 && (
          <div className="absolute top-2 right-2 px-1.5 py-0.5 rounded text-[10px] font-mono tabular-nums bg-black/85 text-zinc-200 border border-white/20 backdrop-blur-sm shadow">
            {page.rotation}°
          </div>
        )}
      </div>

      {/* Card Quick Surgery Action Bar */}
      <div className="flex items-center justify-around px-2 py-1.5 border-t border-white/[0.06] bg-white/[0.02]">
        <button
          type="button"
          onClick={() => onRotateOne(page.originalIndex, -90)}
          className="p-1 rounded hover:bg-white/10 text-zinc-400 hover:text-white transition-colors cursor-pointer"
          title="Rotate 90° CCW"
        >
          <RotateCcw className="w-3.5 h-3.5" />
        </button>
        <button
          type="button"
          onClick={() => onRotateOne(page.originalIndex, 90)}
          className="p-1 rounded hover:bg-white/10 text-zinc-400 hover:text-white transition-colors cursor-pointer"
          title="Rotate 90° CW"
        >
          <RotateCw className="w-3.5 h-3.5" />
        </button>
        <button
          type="button"
          disabled={isSinglePage}
          onClick={() => onDeleteOne(page.originalIndex)}
          className="p-1 rounded hover:bg-red-500/20 text-zinc-400 hover:text-red-400 transition-colors disabled:opacity-30 disabled:pointer-events-none cursor-pointer"
          title="Delete Page"
        >
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
}

// ==========================================
// Main Modal Component
// ==========================================
export function PageOrganizerModal({
  isOpen,
  onClose,
  pdfBlob,
  onPdfUpdated,
  onExtractAsNewDraft,
}: PageOrganizerModalProps) {
  const [pages, setPages] = useState<PageItem[]>([]);
  const [thumbnails, setThumbnails] = useState<string[]>([]);
  const [selectedIndices, setSelectedIndices] = useState<number[]>([]);
  const [loading, setLoading] = useState(false);
  const [statusMessage, setStatusMessage] = useState<{ text: string; type: "info" | "success" | "error" } | null>(null);
  const [rangeInput, setRangeInput] = useState("");
  const mergeInputRef = useRef<HTMLInputElement>(null);

  // Non-blocking Inline Confirmations
  const [deleteConfirmation, setDeleteConfirmation] = useState<{ indices: number[] } | null>(null);
  const [flattenConfirmation, setFlattenConfirmation] = useState(false);

  // Setup sensors for drag & drop (distance activation to allow normal tapping)
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 6,
      },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  const showStatus = (text: string, type: "info" | "success" | "error" = "info", duration = 3000) => {
    setStatusMessage({ text, type });
    if (duration > 0) {
      setTimeout(() => {
        setStatusMessage((cur) => (cur?.text === text ? null : cur));
      }, duration);
    }
  };

  // Load PDF info & render visual thumbnails whenever blob changes or modal opens
  useEffect(() => {
    if (!isOpen || !pdfBlob) return;

    let isMounted = true;
    setLoading(true);
    setStatusMessage(null);
    setDeleteConfirmation(null);
    setFlattenConfirmation(false);

    (async () => {
      try {
        const buffer = await blobToArrayBuffer(pdfBlob);
        const info: PdfInspectionInfo = await pdfWorker.inspectPdf(buffer);

        if (!isMounted) return;

        const items: PageItem[] = info.pageDimensions.map((dim, i) => ({
          id: `page-${i}-${Date.now()}`,
          originalIndex: i,
          displayNumber: i + 1,
          rotation: dim.rotation || 0,
          width: dim.width,
          height: dim.height,
        }));

        setPages(items);
        setSelectedIndices([]);

        // Asynchronously render real high-speed client-side visual thumbnails
        try {
          const renderedThumbs = await renderPdfThumbnails(pdfBlob);
          if (isMounted) {
            setThumbnails(renderedThumbs);
          }
        } catch (thumbErr) {
          console.warn("[PageOrganizerModal] Could not generate page thumbnails:", thumbErr);
        }
      } catch (err: any) {
        console.error("[PageOrganizerModal] Failed to inspect PDF:", err);
        if (isMounted) {
          showStatus(`Failed to read PDF pages: ${err.message}`, "error", 5000);
        }
      } finally {
        if (isMounted) setLoading(false);
      }
    })();

    return () => {
      isMounted = false;
    };
  }, [isOpen, pdfBlob]);

  // Handle Drag & Drop reorder
  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const oldIndex = pages.findIndex((p) => p.id === active.id);
    const newIndex = pages.findIndex((p) => p.id === over.id);

    if (oldIndex !== -1 && newIndex !== -1) {
      const newPages = arrayMove(pages, oldIndex, newIndex);
      setPages(newPages);
    }
  };

  // Toggle selection
  const toggleSelect = (idx: number) => {
    setSelectedIndices((prev) =>
      prev.includes(idx) ? prev.filter((i) => i !== idx) : [...prev, idx]
    );
  };

  const selectAll = () => {
    if (selectedIndices.length === pages.length) {
      setSelectedIndices([]);
    } else {
      setSelectedIndices(pages.map((p) => p.originalIndex));
    }
  };

  // Check if order changed
  const isOrderChanged = useMemo(() => {
    return pages.some((p, i) => p.originalIndex !== i);
  }, [pages]);

  // Commit Page Reorder to PDF
  const applyReorder = async () => {
    if (!pdfBlob || !isOrderChanged) return;
    setLoading(true);
    showStatus("Reordering pages via Web Worker...", "info", 0);

    try {
      const buffer = await blobToArrayBuffer(pdfBlob);
      const newOrder = pages.map((p) => p.originalIndex);
      const outBuffer = await pdfWorker.reorderPages(buffer, newOrder);
      const newBlob = arrayBufferToBlob(outBuffer);

      await onPdfUpdated(newBlob, `Reordered ${pages.length} pages`);
      showStatus("Pages reordered successfully!", "success", 2500);
    } catch (err: any) {
      console.error("[PageOrganizerModal] Reorder error:", err);
      showStatus(`Error reordering: ${err.message}`, "error", 4000);
    } finally {
      setLoading(false);
    }
  };

  // Rotate selected or single page
  const rotatePages = async (pageIndices: number[], degrees: 90 | 180 | 270 | -90) => {
    if (!pdfBlob || pageIndices.length === 0) return;
    setLoading(true);
    showStatus(`Rotating ${pageIndices.length} page(s)...`, "info", 0);

    try {
      const buffer = await blobToArrayBuffer(pdfBlob);
      const outBuffer = await pdfWorker.rotatePages(buffer, pageIndices, degrees);
      const newBlob = arrayBufferToBlob(outBuffer);

      // Optimistically update local state
      setPages((prev) =>
        prev.map((p) =>
          pageIndices.includes(p.originalIndex)
            ? { ...p, rotation: (p.rotation + degrees + 360) % 360 }
            : p
        )
      );

      await onPdfUpdated(newBlob, `Rotated ${pageIndices.length} page(s) by ${degrees}°`);
      showStatus("Rotation complete!", "success", 2500);
    } catch (err: any) {
      console.error("[PageOrganizerModal] Rotation error:", err);
      showStatus(`Error rotating: ${err.message}`, "error", 4000);
    } finally {
      setLoading(false);
    }
  };

  // Delete prompt & execution
  const promptDeletePages = (pageIndices: number[]) => {
    if (!pdfBlob || pageIndices.length === 0) return;
    if (pageIndices.length >= pages.length) {
      showStatus("Cannot delete all pages in document.", "error", 3500);
      return;
    }
    setDeleteConfirmation({ indices: pageIndices });
  };

  const executeDeletePages = async (pageIndices: number[]) => {
    if (!pdfBlob) return;
    setDeleteConfirmation(null);
    setLoading(true);
    showStatus(`Deleting ${pageIndices.length} page(s)...`, "info", 0);

    try {
      const buffer = await blobToArrayBuffer(pdfBlob);
      const outBuffer = await pdfWorker.deletePages(buffer, pageIndices);
      const newBlob = arrayBufferToBlob(outBuffer);

      await onPdfUpdated(newBlob, `Deleted ${pageIndices.length} page(s)`);
      showStatus("Pages deleted successfully!", "success", 2500);
    } catch (err: any) {
      console.error("[PageOrganizerModal] Delete error:", err);
      showStatus(`Error deleting: ${err.message}`, "error", 4000);
    } finally {
      setLoading(false);
    }
  };

  // Extract / Split Pages
  const handleExtract = async () => {
    if (!pdfBlob) return;
    const hasRange = rangeInput.trim().length > 0;
    const hasSelected = selectedIndices.length > 0;

    if (!hasRange && !hasSelected) {
      showStatus("Please select at least one page or enter a page range (e.g. 1-2, 4).", "error", 3500);
      return;
    }

    setLoading(true);
    showStatus("Extracting pages into new PDF...", "info", 0);

    try {
      const buffer = await blobToArrayBuffer(pdfBlob);
      const outBuffer = await pdfWorker.extractPages(buffer, {
        pageIndices: hasRange ? undefined : selectedIndices,
        rangeString: hasRange ? rangeInput.trim() : undefined,
      });

      const extractedBlob = arrayBufferToBlob(outBuffer);

      if (onExtractAsNewDraft) {
        onExtractAsNewDraft(
          extractedBlob,
          `Extracted Pages (${hasRange ? rangeInput : selectedIndices.map((i) => i + 1).join(",")})`
        );
        onClose();
      } else {
        // Trigger browser download
        const url = URL.createObjectURL(extractedBlob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `extracted_pages_${Date.now()}.pdf`;
        a.click();
        URL.revokeObjectURL(url);
        showStatus("Extracted PDF downloaded!", "success", 3000);
      }
    } catch (err: any) {
      console.error("[PageOrganizerModal] Extract error:", err);
      showStatus(`Error extracting: ${err.message}`, "error", 4000);
    } finally {
      setLoading(false);
    }
  };

  // Merge external PDF files
  const handleMergeFiles = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0 || !pdfBlob) return;

    setLoading(true);
    showStatus(`Merging ${files.length} document(s)...`, "info", 0);

    try {
      const currentBuffer = await blobToArrayBuffer(pdfBlob);
      const newBuffers: ArrayBuffer[] = [];

      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        if (file.type === "application/pdf" || file.name.endsWith(".pdf")) {
          newBuffers.push(await file.arrayBuffer());
        }
      }

      if (newBuffers.length === 0) {
        throw new Error("No valid PDF files selected.");
      }

      const mergedBuffer = await pdfWorker.mergePdfs([currentBuffer, ...newBuffers]);
      const mergedBlob = arrayBufferToBlob(mergedBuffer);

      await onPdfUpdated(mergedBlob, `Merged ${files.length} external document(s)`);
      showStatus("PDFs merged successfully!", "success", 3000);
    } catch (err: any) {
      console.error("[PageOrganizerModal] Merge error:", err);
      showStatus(`Error merging PDFs: ${err.message}`, "error", 4000);
    } finally {
      setLoading(false);
      if (mergeInputRef.current) mergeInputRef.current.value = "";
    }
  };

  // Stamp & Flatten Document execution
  const executeFlattenDocument = async () => {
    if (!pdfBlob) return;
    setFlattenConfirmation(false);
    setLoading(true);
    showStatus("Flattening form fields and annotations...", "info", 0);

    try {
      const buffer = await blobToArrayBuffer(pdfBlob);
      const outBuffer = await pdfWorker.stampAndFlatten(buffer, [], true);
      const flattenedBlob = arrayBufferToBlob(outBuffer);

      await onPdfUpdated(flattenedBlob, "Flattened interactive form fields");
      showStatus("Document flattened permanently!", "success", 3000);
    } catch (err: any) {
      console.error("[PageOrganizerModal] Flatten error:", err);
      showStatus(`Error flattening: ${err.message}`, "error", 4000);
    } finally {
      setLoading(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6 bg-black/80 backdrop-blur-md animate-in fade-in duration-150">
      <div className="relative flex flex-col w-full max-w-6xl max-h-[92vh] rounded-[20px] border border-white/[0.12] bg-[#0c0d12] text-zinc-100 shadow-2xl overflow-hidden">
        <BorderBeam size={250} duration={12} colorFrom="transparent" colorTo="rgba(255, 255, 255, 0.4)" />

        {/* Modal Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/[0.08] bg-[#111113]">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-xl bg-white/[0.06] border border-white/10 text-zinc-300">
              <Layers className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base sm:text-lg font-bold tracking-tight text-white">
                  Page Surgery & Grid Organizer
                </h2>
                <InsporaBadge variant="accent">
                  <span className="tabular-nums">{pages.length}</span> {pages.length === 1 ? "Page" : "Pages"}
                </InsporaBadge>
              </div>
              <p className="text-xs text-zinc-400">
                Drag to reorder, rotate 90°, delete, extract ranges, or merge PDFs via Web Workers.
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="p-2 rounded-lg text-zinc-400 hover:text-white hover:bg-white/10 transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Action Toolbar */}
        <div className="flex flex-wrap items-center justify-between gap-2.5 px-5 py-3 border-b border-white/[0.08] bg-[#09090b]">
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={selectAll}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-white/10 bg-white/[0.04] text-xs font-medium text-zinc-300 hover:text-white hover:bg-white/10 transition-all cursor-pointer"
            >
              {selectedIndices.length === pages.length ? (
                <CheckSquare className="w-3.5 h-3.5 text-white" />
              ) : (
                <Square className="w-3.5 h-3.5" />
              )}
              <span>{selectedIndices.length === pages.length ? "Deselect All" : "Select All"}</span>
            </button>

            {/* Batch Rotation */}
            <div className="flex items-center rounded-lg border border-white/10 bg-white/[0.04] overflow-hidden">
              <button
                type="button"
                disabled={selectedIndices.length === 0}
                onClick={() => rotatePages(selectedIndices, -90)}
                className="flex items-center gap-1 px-2.5 py-1.5 text-xs text-zinc-300 hover:text-white hover:bg-white/10 transition-colors disabled:opacity-30 disabled:pointer-events-none cursor-pointer"
                title="Rotate selected CCW"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">Rotate CCW</span>
              </button>
              <div className="w-[1px] h-4 bg-white/10" />
              <button
                type="button"
                disabled={selectedIndices.length === 0}
                onClick={() => rotatePages(selectedIndices, 90)}
                className="flex items-center gap-1 px-2.5 py-1.5 text-xs text-zinc-300 hover:text-white hover:bg-white/10 transition-colors disabled:opacity-30 disabled:pointer-events-none cursor-pointer"
                title="Rotate selected CW"
              >
                <RotateCw className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">Rotate CW</span>
              </button>
            </div>

            {/* Batch Delete */}
            <button
              type="button"
              disabled={selectedIndices.length === 0 || selectedIndices.length >= pages.length}
              onClick={() => promptDeletePages(selectedIndices)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-red-500/20 bg-red-500/10 text-xs font-medium text-red-400 hover:bg-red-500/20 transition-all disabled:opacity-30 disabled:pointer-events-none cursor-pointer"
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span>Delete (<span className="tabular-nums">{selectedIndices.length}</span>)</span>
            </button>

            {/* Merge PDF trigger */}
            <input
              ref={mergeInputRef}
              type="file"
              accept="application/pdf,.pdf"
              multiple
              onChange={handleMergeFiles}
              className="hidden"
            />
            <button
              type="button"
              onClick={() => mergeInputRef.current?.click()}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-white/10 bg-white/[0.04] text-xs font-medium text-zinc-300 hover:text-white hover:bg-white/10 transition-all cursor-pointer"
            >
              <Upload className="w-3.5 h-3.5" />
              <span>Merge PDFs</span>
            </button>

            {/* Flatten trigger */}
            <button
              type="button"
              onClick={() => setFlattenConfirmation(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-amber-500/20 bg-amber-500/10 text-xs font-medium text-amber-300/90 hover:bg-amber-500/20 transition-all cursor-pointer"
            >
              <FileCheck2 className="w-3.5 h-3.5" />
              <span>Flatten AcroForms</span>
            </button>
          </div>

          {/* Reorder Apply button */}
          {isOrderChanged && (
            <ShimmerButton
              onClick={applyReorder}
              disabled={loading}
              className="!py-1.5 !px-4 text-xs font-semibold"
            >
              <Check className="w-3.5 h-3.5 mr-1 text-emerald-400" />
              Apply New Page Order
            </ShimmerButton>
          )}
        </div>

        {/* Delete Confirmation Banner */}
        {deleteConfirmation && (
          <div className="flex items-center justify-between px-5 py-2.5 bg-red-950/40 border-b border-red-500/30 text-xs text-red-200 animate-in fade-in duration-150">
            <div className="flex items-center gap-2">
              <Trash2 className="w-4 h-4 text-red-400 shrink-0" />
              <span>Permanently delete <span className="tabular-nums font-semibold">{deleteConfirmation.indices.length}</span> page(s)? This cannot be undone.</span>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setDeleteConfirmation(null)}
                className="px-2.5 py-1 rounded-md border border-white/10 bg-white/5 text-zinc-300 hover:text-white cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => executeDeletePages(deleteConfirmation.indices)}
                className="px-2.5 py-1 rounded-md bg-red-600 hover:bg-red-500 text-white font-medium cursor-pointer"
              >
                Confirm Delete
              </button>
            </div>
          </div>
        )}

        {/* Flatten Confirmation Banner */}
        {flattenConfirmation && (
          <div className="flex items-center justify-between px-5 py-2.5 bg-amber-950/40 border-b border-amber-500/30 text-xs text-amber-200 animate-in fade-in duration-150">
            <div className="flex items-center gap-2">
              <FileCheck2 className="w-4 h-4 text-amber-400 shrink-0" />
              <span>Flattening commits interactive form fields & annotations into permanent PDF vectors. Proceed?</span>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setFlattenConfirmation(false)}
                className="px-2.5 py-1 rounded-md border border-white/10 bg-white/5 text-zinc-300 hover:text-white cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={executeFlattenDocument}
                className="px-2.5 py-1 rounded-md bg-amber-600 hover:bg-amber-500 text-white font-medium cursor-pointer"
              >
                Confirm Flatten
              </button>
            </div>
          </div>
        )}

        {/* Status Notification Banner */}
        {statusMessage && (
          <div
            className={`flex items-center justify-between px-5 py-2 text-xs border-b animate-in fade-in duration-150 ${
              statusMessage.type === "success"
                ? "bg-emerald-500/15 border-emerald-500/20 text-emerald-200"
                : statusMessage.type === "error"
                ? "bg-red-500/15 border-red-500/20 text-red-200"
                : "bg-white/[0.06] border-white/15 text-zinc-200"
            }`}
          >
            <div className="flex items-center gap-2">
              <AlertCircle className="w-3.5 h-3.5 shrink-0" />
              <span>{statusMessage.text}</span>
            </div>
            <button
              type="button"
              onClick={() => setStatusMessage(null)}
              className="text-zinc-400 hover:text-white p-0.5 cursor-pointer"
            >
              <X className="w-3 h-3" />
            </button>
          </div>
        )}

        {/* Scrollable Page Grid */}
        <div className="flex-1 overflow-y-auto p-5 min-h-[300px]">
          {loading && pages.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-64 text-zinc-400 space-y-3">
              <div className="w-8 h-8 rounded-full border-2 border-white/30 border-t-white animate-spin" />
              <p className="text-xs font-mono">Inspecting PDF structure & rendering page thumbnails...</p>
            </div>
          ) : (
            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              onDragEnd={handleDragEnd}
            >
              <SortableContext
                items={pages.map((p) => p.id)}
                strategy={rectSortingStrategy}
              >
                <div className="grid grid-cols-2 min-[480px]:grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 gap-3.5">
                  {pages.map((page) => (
                    <SortablePageCard
                      key={page.id}
                      page={page}
                      isSelected={selectedIndices.includes(page.originalIndex)}
                      thumbnailUrl={thumbnails[page.originalIndex]}
                      onToggleSelect={toggleSelect}
                      onRotateOne={(idx, deg) => rotatePages([idx], deg)}
                      onDeleteOne={(idx) => promptDeletePages([idx])}
                      isSinglePage={pages.length <= 1}
                    />
                  ))}
                </div>
              </SortableContext>
            </DndContext>
          )}
        </div>

        {/* Modal Footer: Extraction & Split Bar */}
        <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-3 border-t border-white/[0.08] bg-[#111113]">
          <div className="flex items-center gap-2 w-full sm:w-auto">
            <span className="text-xs text-zinc-400 shrink-0">Extract Range:</span>
            <input
              type="text"
              placeholder="e.g. 1-2, 4"
              value={rangeInput}
              onChange={(e) => setRangeInput(e.target.value)}
              className="px-3 py-1.5 rounded-lg border border-white/10 bg-black/40 text-xs text-white placeholder-zinc-500 focus:outline-none focus:border-white/30 w-36 font-mono"
            />
            <button
              type="button"
              disabled={loading || (selectedIndices.length === 0 && rangeInput.trim().length === 0)}
              onClick={handleExtract}
              className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg border border-white/15 bg-white/[0.06] text-xs font-medium text-zinc-200 hover:bg-white/[0.1] transition-all disabled:opacity-30 disabled:pointer-events-none cursor-pointer active:scale-[0.98]"
            >
              <Scissors className="w-3.5 h-3.5" />
              <span>Extract / Split</span>
            </button>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-1.5 rounded-lg bg-[#fafafa] hover:bg-white text-zinc-950 text-xs font-semibold transition-all cursor-pointer shadow-sm active:scale-[0.98]"
            >
              Done
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
