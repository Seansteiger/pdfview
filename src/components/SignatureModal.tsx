"use client";

import React, { useState, useEffect, useRef } from "react";
import {
  X,
  PenTool,
  Type,
  Bookmark,
  Trash2,
  Check,
  RotateCcw,
  Download,
} from "lucide-react";
import {
  saveSignature,
  listSignatures,
  deleteSignature,
  SavedSignature,
} from "@/lib/localDb";
import { pdfWorker, blobToArrayBuffer, arrayBufferToBlob } from "@/lib/pdfWorkerClient";
import { ShimmerButton, BorderBeam, InsporaBadge } from "./ui/inspora-primitives";

export interface SignatureModalProps {
  isOpen: boolean;
  onClose: () => void;
  pdfBlob: Blob | null;
  currentPageIndex: number;
  totalPages: number;
  onPdfUpdated: (newBlob: Blob, description?: string) => Promise<void> | void;
}

type TabMode = "draw" | "type" | "saved";

export function SignatureModal({
  isOpen,
  onClose,
  pdfBlob,
  currentPageIndex,
  totalPages,
  onPdfUpdated,
}: SignatureModalProps) {
  const [activeTab, setActiveTab] = useState<TabMode>("draw");

  // Draw State
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [drawColor, setDrawColor] = useState("#000000");
  const [strokeWidth, setStrokeWidth] = useState(2.5);
  const [history, setHistory] = useState<ImageData[]>([]);
  const [hasDrawn, setHasDrawn] = useState(false);

  // Type State
  const [typedName, setTypedName] = useState("");
  const [fontFamily, setFontFamily] = useState<"cursive" | "serif" | "sans-serif">("cursive");
  const [typeColor, setTypeColor] = useState("#18181b");

  // Saved Signatures
  const [savedSignatures, setSavedSignatures] = useState<SavedSignature[]>([]);
  const [loading, setLoading] = useState(false);

  // Feedback Toast state (non-blocking Inspora banner)
  const [toast, setToast] = useState<{ message: string; type: "success" | "error" | "info" } | null>(null);

  const showToast = (message: string, type: "success" | "error" | "info" = "info") => {
    setToast({ message, type });
    setTimeout(() => {
      setToast((cur) => (cur?.message === message ? null : cur));
    }, 3500);
  };

  // Stamp placement options
  const [targetPage, setTargetPage] = useState<number>(currentPageIndex);
  const [targetPlacement, setTargetPlacement] = useState<"bottom-right" | "bottom-center" | "bottom-left">("bottom-right");

  // Update target page when prop changes
  useEffect(() => {
    setTargetPage(currentPageIndex);
  }, [currentPageIndex]);

  // Load saved signatures from IndexedDB
  const refreshSaved = async () => {
    try {
      const sigs = await listSignatures();
      setSavedSignatures(sigs);
    } catch (err) {
      console.error("[SignatureModal] Failed to load signatures:", err);
    }
  };

  useEffect(() => {
    if (isOpen) {
      refreshSaved();
      setToast(null);
    }
  }, [isOpen]);

  // Clear Canvas
  const handleClear = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    setHistory([]);
    setHasDrawn(false);
  };

  // Undo last stroke
  const handleUndo = () => {
    const canvas = canvasRef.current;
    if (!canvas || history.length === 0) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const newHistory = [...history];
    newHistory.pop(); // Remove current
    const previous = newHistory[newHistory.length - 1];

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (previous) {
      ctx.putImageData(previous, 0, 0);
    } else {
      setHasDrawn(false);
    }
    setHistory(newHistory);
  };

  // Pointer drawing events
  const startDrawing = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    canvas.setPointerCapture(e.pointerId);
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.strokeStyle = drawColor;
    ctx.lineWidth = strokeWidth;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";

    setIsDrawing(true);
    setHasDrawn(true);
  };

  const draw = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!isDrawing) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    ctx.lineTo(x, y);
    ctx.stroke();
  };

  const stopDrawing = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!isDrawing) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    try {
      canvas.releasePointerCapture(e.pointerId);
    } catch (_) {}

    ctx.closePath();
    setIsDrawing(false);

    // Save history snapshot
    const snapshot = ctx.getImageData(0, 0, canvas.width, canvas.height);
    setHistory((prev) => [...prev, snapshot]);
  };

  // Generate PNG data URL for typed signature
  const generateTypedDataUrl = (): string => {
    const hiddenCanvas = document.createElement("canvas");
    hiddenCanvas.width = 600;
    hiddenCanvas.height = 200;
    const ctx = hiddenCanvas.getContext("2d");
    if (!ctx) return "";

    ctx.clearRect(0, 0, 600, 200);

    let fontSpec = "italic 48px 'Brush Script MT', 'Dancing Script', cursive";
    if (fontFamily === "serif") {
      fontSpec = "italic 44px 'Playfair Display', Georgia, serif";
    } else if (fontFamily === "sans-serif") {
      fontSpec = "italic 42px 'Helvetica Neue', Arial, sans-serif";
    }

    ctx.font = fontSpec;
    ctx.fillStyle = typeColor;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";

    ctx.fillText(typedName || "Your Signature", 300, 100);

    // Subtle underline flourishes
    ctx.beginPath();
    ctx.moveTo(120, 140);
    ctx.quadraticCurveTo(300, 155, 480, 138);
    ctx.strokeStyle = typeColor;
    ctx.lineWidth = 2;
    ctx.stroke();

    return hiddenCanvas.toDataURL("image/png");
  };

  // Get active signature data URL
  const getActiveDataUrl = (): string | null => {
    if (activeTab === "draw") {
      const canvas = canvasRef.current;
      if (!canvas || !hasDrawn) return null;
      return canvas.toDataURL("image/png");
    } else if (activeTab === "type") {
      if (!typedName.trim()) return null;
      return generateTypedDataUrl();
    }
    return null;
  };

  // Reactivity check: is there a ready signature to stamp or save?
  const isSignatureReady =
    (activeTab === "draw" && hasDrawn) ||
    (activeTab === "type" && typedName.trim().length > 0);

  // Save to IndexedDB
  const handleSaveToLibrary = async () => {
    const dataUrl = getActiveDataUrl();
    if (!dataUrl) {
      showToast("Please draw or type a signature first.", "error");
      return;
    }

    try {
      const label = activeTab === "type" ? typedName.trim() : "Drawn Signature";
      await saveSignature(dataUrl, label);
      await refreshSaved();
      showToast(`Signature "${label}" saved to local library!`, "success");
    } catch (err: any) {
      showToast(`Failed to save: ${err.message}`, "error");
    }
  };

  // Delete saved signature
  const handleDeleteSaved = async (id: string) => {
    try {
      await deleteSignature(id);
      await refreshSaved();
      showToast("Signature removed from library.", "info");
    } catch (err: any) {
      console.error(err);
      showToast("Failed to remove signature.", "error");
    }
  };

  // Stamp signature directly onto PDF via Web Worker!
  const stampSignatureOnPdf = async (dataUrlToStamp: string) => {
    if (!pdfBlob) return;
    setLoading(true);

    try {
      const buffer = await blobToArrayBuffer(pdfBlob);

      // Determine PDF coordinates (PDF origin is bottom-left, standard page ~595x842)
      // Place a 150x60 pt signature stamp
      const stampWidth = 150;
      const stampHeight = 60;

      let x = 380;
      let y = 80;

      if (targetPlacement === "bottom-center") {
        x = 222;
        y = 80;
      } else if (targetPlacement === "bottom-left") {
        x = 60;
        y = 80;
      }

      const annotation = {
        id: `sig_${Date.now()}`,
        type: "signature" as const,
        pageIndex: targetPage,
        x,
        y,
        width: stampWidth,
        height: stampHeight,
        dataUrl: dataUrlToStamp,
        createdAt: Date.now(),
      };

      const outBuffer = await pdfWorker.stampAndFlatten(buffer, [annotation], false);
      const newBlob = arrayBufferToBlob(outBuffer);

      await onPdfUpdated(newBlob, `Stamped signature on Page ${targetPage + 1}`);
      onClose();
    } catch (err: any) {
      console.error("[SignatureModal] Failed to stamp signature:", err);
      showToast(`Failed to stamp signature: ${err.message}`, "error");
    } finally {
      setLoading(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6 bg-black/80 backdrop-blur-md animate-in fade-in duration-150">
      <div className="relative flex flex-col w-full max-w-xl rounded-[20px] border border-white/[0.12] bg-[#111113] text-zinc-100 shadow-2xl overflow-hidden">
        <BorderBeam size={220} duration={10} colorFrom="transparent" colorTo="rgba(255, 255, 255, 0.4)" />

        {/* Modal Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/[0.08] bg-[#161618]">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-xl bg-white/[0.06] border border-white/10 text-zinc-300">
              <PenTool className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base sm:text-lg font-bold tracking-tight text-white">
                E-Signature & Stamp Studio
              </h2>
              <p className="text-xs text-zinc-400">
                Create reusable signatures or stamp vector seals onto your document.
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

        {/* Non-blocking Inspora Toast Banner */}
        {toast && (
          <div
            className={`flex items-center justify-between px-5 py-2 text-xs border-b animate-in fade-in duration-150 ${
              toast.type === "success"
                ? "bg-emerald-500/15 border-emerald-500/25 text-emerald-200"
                : toast.type === "error"
                ? "bg-red-500/15 border-red-500/25 text-red-200"
                : "bg-white/[0.06] border-white/15 text-zinc-200"
            }`}
          >
            <div className="flex items-center gap-2">
              {toast.type === "success" && <Check className="w-3.5 h-3.5 text-emerald-400 shrink-0" />}
              {toast.type === "error" && <X className="w-3.5 h-3.5 text-red-400 shrink-0" />}
              {toast.type === "info" && <PenTool className="w-3.5 h-3.5 text-zinc-300 shrink-0" />}
              <span>{toast.message}</span>
            </div>
            <button
              type="button"
              onClick={() => setToast(null)}
              className="text-zinc-400 hover:text-white p-0.5 cursor-pointer"
            >
              <X className="w-3 h-3" />
            </button>
          </div>
        )}

        {/* Tab Switcher */}
        <div className="flex items-center justify-center p-3 border-b border-white/[0.06] bg-[#0c0d12]">
          <div className="inline-flex rounded-full bg-white/[0.05] p-1 border border-white/10">
            <button
              type="button"
              onClick={() => setActiveTab("draw")}
              className={`flex items-center gap-1.5 px-4 py-1.5 rounded-full text-xs font-medium transition-[transform,background-color] duration-150 cursor-pointer active:scale-[0.98] ${
                activeTab === "draw"
                  ? "bg-white/15 text-white shadow-sm"
                  : "text-zinc-400 hover:text-zinc-200"
              }`}
            >
              <PenTool className="w-3.5 h-3.5" />
              <span>Draw</span>
            </button>
            <button
              type="button"
              onClick={() => setActiveTab("type")}
              className={`flex items-center gap-1.5 px-4 py-1.5 rounded-full text-xs font-medium transition-[transform,background-color] duration-150 cursor-pointer active:scale-[0.98] ${
                activeTab === "type"
                  ? "bg-white/15 text-white shadow-sm"
                  : "text-zinc-400 hover:text-zinc-200"
              }`}
            >
              <Type className="w-3.5 h-3.5" />
              <span>Type</span>
            </button>
            <button
              type="button"
              onClick={() => setActiveTab("saved")}
              className={`flex items-center gap-1.5 px-4 py-1.5 rounded-full text-xs font-medium transition-[transform,background-color] duration-150 cursor-pointer active:scale-[0.98] ${
                activeTab === "saved"
                  ? "bg-white/15 text-white shadow-sm"
                  : "text-zinc-400 hover:text-zinc-200"
              }`}
            >
              <Bookmark className="w-3.5 h-3.5" />
              <span>Saved (<span className="tabular-nums">{savedSignatures.length}</span>)</span>
            </button>
          </div>
        </div>

        {/* Tab Body */}
        <div className="p-5 flex-1 min-h-[260px] bg-[#111113]">
          {/* DRAW TAB */}
          {activeTab === "draw" && (
            <div className="space-y-4">
              <div className="relative rounded-xl border border-white/15 bg-white overflow-hidden shadow-inner touch-none">
                <canvas
                  ref={canvasRef}
                  width={520}
                  height={180}
                  onPointerDown={startDrawing}
                  onPointerMove={draw}
                  onPointerUp={stopDrawing}
                  className="w-full h-44 cursor-crosshair block"
                />

                {!hasDrawn && (
                  <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-xs text-zinc-400 select-none">
                    Sign with mouse, trackpad, or finger here
                  </div>
                )}
              </div>

              {/* Ink Controls */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="text-xs text-zinc-400">Ink Color:</span>
                  {[
                    { color: "#000000", label: "Black" },
                    { color: "#1e3a8a", label: "Navy" },
                    { color: "#991b1b", label: "Burgundy" },
                  ].map((c) => (
                    <button
                      key={c.color}
                      type="button"
                      onClick={() => setDrawColor(c.color)}
                      style={{ backgroundColor: c.color }}
                      className={`w-5 h-5 rounded-full border-2 transition-transform cursor-pointer ${
                        drawColor === c.color
                          ? "border-white scale-125"
                          : "border-transparent hover:scale-110"
                      }`}
                      title={c.label}
                    />
                  ))}
                </div>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={handleUndo}
                    disabled={history.length === 0}
                    className="flex items-center gap-1 px-2.5 py-1 rounded-lg border border-white/10 text-xs text-zinc-400 hover:text-white hover:bg-white/10 disabled:opacity-30 disabled:pointer-events-none cursor-pointer"
                  >
                    <RotateCcw className="w-3 h-3" />
                    <span>Undo</span>
                  </button>
                  <button
                    type="button"
                    onClick={handleClear}
                    disabled={!hasDrawn}
                    className="flex items-center gap-1 px-2.5 py-1 rounded-lg border border-white/10 text-xs text-zinc-400 hover:text-white hover:bg-white/10 disabled:opacity-30 disabled:pointer-events-none cursor-pointer"
                  >
                    <Trash2 className="w-3 h-3" />
                    <span>Clear</span>
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* TYPE TAB */}
          {activeTab === "type" && (
            <div className="space-y-3.5">
              <div>
                <label className="block text-xs font-medium text-zinc-400 mb-1.5">
                  Type Your Full Legal Name:
                </label>
                <input
                  type="text"
                  placeholder="e.g. Jane Doe"
                  value={typedName}
                  autoFocus
                  onChange={(e) => setTypedName(e.target.value)}
                  className="w-full px-3.5 py-2.5 rounded-xl border border-white/15 bg-black/50 text-sm text-white placeholder-zinc-500 focus:outline-none focus:border-white/40 transition-colors font-mono"
                />
              </div>

              {/* Live Calligraphic Signature Preview Card */}
              <div className="relative flex flex-col items-center justify-center h-28 rounded-xl border border-white/15 bg-white shadow-inner overflow-hidden p-3 transition-all">
                {typedName.trim() ? (
                  <div
                    style={{
                      color: typeColor,
                      fontFamily:
                        fontFamily === "cursive"
                          ? "'Brush Script MT', 'Dancing Script', 'Caveat', cursive"
                          : fontFamily === "serif"
                          ? "'Playfair Display', Georgia, serif"
                          : "'Helvetica Neue', Arial, sans-serif",
                    }}
                    className="text-3xl italic select-none text-center font-normal tracking-wide transition-all"
                  >
                    {typedName}
                  </div>
                ) : (
                  <div className="text-xs text-zinc-400 select-none text-center">
                    Type your name above to see your live calligraphic preview
                  </div>
                )}
                {typedName.trim() && (
                  <div className="absolute bottom-2 right-3 text-[10px] font-mono text-zinc-400 uppercase tracking-widest">
                    {fontFamily} style
                  </div>
                )}
              </div>

              {/* Calligraphy Style Picker */}
              <div className="grid grid-cols-3 gap-2.5">
                {[
                  { id: "cursive", label: "Cursive Script", style: "italic font-serif" },
                  { id: "serif", label: "Formal Serif", style: "italic font-serif tracking-wide" },
                  { id: "sans-serif", label: "Modern Clean", style: "italic font-sans" },
                ].map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => setFontFamily(item.id as any)}
                    className={`p-2.5 rounded-xl border text-center transition-all cursor-pointer ${
                      fontFamily === item.id
                        ? "border-white/40 bg-white/[0.1] text-white shadow-[inset_0_1px_0_0_rgba(255,255,255,0.12)]"
                        : "border-white/10 bg-white/[0.02] text-zinc-400 hover:text-white hover:bg-white/[0.05]"
                    }`}
                  >
                    <div className="text-[11px] font-semibold mb-0.5">{item.label}</div>
                    <div className={`text-sm ${item.style} text-zinc-200 truncate`}>
                      {typedName.trim() || "Jane Doe"}
                    </div>
                  </button>
                ))}
              </div>

              {/* Typed Color */}
              <div className="flex items-center gap-2 pt-0.5">
                <span className="text-xs text-zinc-400">Color:</span>
                {[
                  { color: "#000000", label: "Black" },
                  { color: "#1e3a8a", label: "Navy" },
                  { color: "#991b1b", label: "Burgundy" },
                ].map((c) => (
                  <button
                    key={c.color}
                    type="button"
                    onClick={() => setTypeColor(c.color)}
                    style={{ backgroundColor: c.color }}
                    className={`w-5 h-5 rounded-full border-2 transition-transform cursor-pointer ${
                      typeColor === c.color
                        ? "border-white scale-125"
                        : "border-transparent hover:scale-110"
                    }`}
                    title={c.label}
                  />
                ))}
              </div>
            </div>
          )}

          {/* SAVED TAB */}
          {activeTab === "saved" && (
            <div className="space-y-3">
              {savedSignatures.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-48 text-zinc-500 space-y-2">
                  <Bookmark className="w-8 h-8 opacity-40" />
                  <p className="text-xs">No saved signatures yet. Draw or type one and click &apos;Save to Library&apos;.</p>
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 max-h-56 overflow-y-auto">
                  {savedSignatures.map((sig) => (
                    <div
                      key={sig.id}
                      className="group relative flex flex-col justify-between p-3 rounded-xl border border-white/[0.08] bg-[#161618] hover:border-white/20 transition-all"
                    >
                      <div className="h-16 flex items-center justify-center bg-white rounded-lg p-2">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={sig.dataUrl}
                          alt={sig.label}
                          className="max-h-full object-contain"
                        />
                      </div>
                      <div className="flex items-center justify-between mt-2 pt-2 border-t border-white/[0.06]">
                        <span className="text-xs font-medium text-zinc-300 truncate max-w-[120px]">
                          {sig.label}
                        </span>
                        <div className="flex items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => handleDeleteSaved(sig.id)}
                            className="p-1 rounded text-zinc-500 hover:text-red-400 hover:bg-white/5 transition-colors cursor-pointer"
                            title="Delete"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => stampSignatureOnPdf(sig.dataUrl)}
                            className="px-2.5 py-1 rounded-md text-[11px] font-semibold bg-white/[0.08] text-white border border-white/15 hover:bg-white/[0.12] transition-colors cursor-pointer"
                          >
                            Stamp
                          </button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Placement & Stamping Controls */}
        <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-3 border-t border-white/[0.08] bg-[#161618]">
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1.5 text-xs text-zinc-400">
              <span>Page:</span>
              <select
                value={targetPage}
                onChange={(e) => setTargetPage(Number(e.target.value))}
                className="px-2 py-1 rounded border border-white/10 bg-black/40 text-xs text-white focus:outline-none tabular-nums font-mono"
              >
                {Array.from({ length: totalPages || 1 }).map((_, i) => (
                  <option key={i} value={i} className="bg-zinc-900 text-white">
                    Page {i + 1}
                  </option>
                ))}
              </select>
            </div>

            <div className="flex items-center gap-1.5 text-xs text-zinc-400">
              <span>Position:</span>
              <select
                value={targetPlacement}
                onChange={(e) => setTargetPlacement(e.target.value as any)}
                className="px-2 py-1 rounded border border-white/10 bg-black/40 text-xs text-white focus:outline-none"
              >
                <option value="bottom-right" className="bg-zinc-900 text-white">Bottom Right</option>
                <option value="bottom-center" className="bg-zinc-900 text-white">Bottom Center</option>
                <option value="bottom-left" className="bg-zinc-900 text-white">Bottom Left</option>
              </select>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {activeTab !== "saved" && (
              <button
                type="button"
                onClick={handleSaveToLibrary}
                disabled={!isSignatureReady || loading}
                className={`px-3 py-1.5 rounded-lg border text-xs font-medium transition-all ${
                  isSignatureReady && !loading
                    ? "border-white/15 bg-white/[0.06] text-zinc-200 hover:text-white hover:bg-white/10 cursor-pointer shadow-sm"
                    : "border-white/5 bg-white/[0.01] text-zinc-600 cursor-not-allowed opacity-40"
                }`}
              >
                Save to Library
              </button>
            )}

            <button
              type="button"
              onClick={() => {
                const dataUrl = getActiveDataUrl();
                if (dataUrl) stampSignatureOnPdf(dataUrl);
                else showToast("Please draw or type a signature first.", "error");
              }}
              disabled={loading || !isSignatureReady}
              className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg bg-[#fafafa] hover:bg-white text-zinc-950 text-xs font-semibold disabled:opacity-30 disabled:pointer-events-none transition-[transform,background-color] duration-150 active:scale-[0.98] cursor-pointer shadow-sm"
            >
              <Check className="w-3.5 h-3.5 mr-0.5 text-emerald-600" />
              Stamp on Page <span className="tabular-nums font-mono">{targetPage + 1}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
