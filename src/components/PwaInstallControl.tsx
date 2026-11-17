"use client";

import React, { useState, useEffect } from "react";
import { Download, Smartphone, Monitor, X, Check } from "lucide-react";

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

export function PwaInstallControl({
  onInstalledToast,
}: {
  onInstalledToast?: (msg: string) => void;
}) {
  const [deferredPrompt, setDeferredPrompt] =
    useState<BeforeInstallPromptEvent | null>(null);
  const [isStandalone, setIsStandalone] = useState(false);
  const [isIos, setIsIos] = useState(false);
  const [showGuideModal, setShowGuideModal] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const standalone =
      window.matchMedia("(display-mode: standalone)").matches ||
      (window.navigator as any).standalone === true;
    setIsStandalone(standalone);

    const ua = window.navigator.userAgent;
    setIsIos(/iPad|iPhone|iPod/.test(ua) && !(window as any).MSStream);

    const handleBeforeInstallPrompt = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
    };

    const handleAppInstalled = () => {
      setDeferredPrompt(null);
      setIsStandalone(true);
      onInstalledToast?.(
        "pdfview installed. You can now open .pdf files directly from your file manager."
      );
    };

    window.addEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
    window.addEventListener("appinstalled", handleAppInstalled);

    return () => {
      window.removeEventListener(
        "beforeinstallprompt",
        handleBeforeInstallPrompt
      );
      window.removeEventListener("appinstalled", handleAppInstalled);
    };
  }, [onInstalledToast]);

  if (isStandalone) {
    return null;
  }

  const handleInstallClick = async () => {
    if (deferredPrompt) {
      await deferredPrompt.prompt();
      const choice = await deferredPrompt.userChoice;
      if (choice.outcome === "accepted") {
        setDeferredPrompt(null);
      }
      return;
    }
    setShowGuideModal(true);
  };

  return (
    <>
      <button
        type="button"
        onClick={handleInstallClick}
        className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium border border-white/15 bg-white/[0.06] text-zinc-100 hover:bg-white/[0.12] transition-[transform,background-color] duration-150 ease-out active:scale-[0.98] cursor-pointer shrink-0"
        title="Install pdfview as a native desktop & mobile app"
      >
        <Download className="w-3.5 h-3.5 text-zinc-300" />
        <span>Install App</span>
      </button>

      {showGuideModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
          <div className="w-full max-w-md rounded-[20px] border border-white/[0.08] bg-[#111113] p-5 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.06)] space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-semibold text-white">
                Install pdfview on Your Device
              </h3>
              <button
                type="button"
                onClick={() => setShowGuideModal(false)}
                className="p-1.5 rounded-lg text-zinc-400 hover:text-white hover:bg-white/10 transition-colors cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-3 text-xs text-zinc-300 leading-relaxed">
              {isIos ? (
                <div className="rounded-xl border border-white/[0.07] bg-[#161618] p-3.5 space-y-2">
                  <div className="flex items-center gap-2 font-medium text-white">
                    <Smartphone className="w-4 h-4 text-zinc-400" />
                    <span>iPhone &amp; iPad (Safari)</span>
                  </div>
                  <p className="text-zinc-400">
                    1. Tap the <strong className="text-zinc-200">Share</strong>{" "}
                    button at the bottom of Safari.
                    <br />
                    2. Scroll down and tap{" "}
                    <strong className="text-zinc-200">
                      Add to Home Screen
                    </strong>
                    .
                    <br />
                    3. Open PDFs anytime from the Files app via{" "}
                    <strong className="text-zinc-200">Share → pdfview</strong>.
                  </p>
                </div>
              ) : (
                <>
                  <div className="rounded-xl border border-white/[0.07] bg-[#161618] p-3.5 space-y-2">
                    <div className="flex items-center gap-2 font-medium text-white">
                      <Monitor className="w-4 h-4 text-zinc-400" />
                      <span>Desktop (Windows / macOS)</span>
                    </div>
                    <p className="text-zinc-400">
                      1. Click the{" "}
                      <strong className="text-zinc-200">Install</strong> icon in
                      your browser&apos;s address bar (Chrome or Edge).
                      <br />
                      2. Once installed, right-click any{" "}
                      <code className="text-zinc-200">.pdf</code> in File
                      Explorer →{" "}
                      <strong className="text-zinc-200">
                        Open with → pdfview
                      </strong>{" "}
                      → <strong className="text-zinc-200">Always</strong> to open
                      PDFs by double-clicking them.
                    </p>
                  </div>
                  <div className="rounded-xl border border-white/[0.07] bg-[#161618] p-3.5 space-y-2">
                    <div className="flex items-center gap-2 font-medium text-white">
                      <Smartphone className="w-4 h-4 text-zinc-400" />
                      <span>Android (Chrome)</span>
                    </div>
                    <p className="text-zinc-400">
                      Tap{" "}
                      <strong className="text-zinc-200">
                        ⋮ Menu → Add to Home screen → Install
                      </strong>
                      . You can then open PDFs directly from your Files app via{" "}
                      <strong className="text-zinc-200">
                        Open with / Share → pdfview
                      </strong>
                      .
                    </p>
                  </div>
                </>
              )}
            </div>

            <div className="flex justify-end">
              <button
                type="button"
                onClick={() => setShowGuideModal(false)}
                className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-medium bg-[#fafafa] text-zinc-950 hover:bg-white transition-[transform,background-color] duration-150 active:scale-[0.98] cursor-pointer"
              >
                <Check className="w-3.5 h-3.5" />
                Got it
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
