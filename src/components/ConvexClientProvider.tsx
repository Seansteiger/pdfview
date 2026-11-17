"use client";

import React, { createContext, useContext, useEffect, useMemo, useState } from "react";
import { ConvexProvider, ConvexReactClient } from "convex/react";
import { getActiveConvexUrl, setActiveConvexUrl, createSafeConvexClient } from "@/lib/convexCloud";

interface ConvexCloudContextType {
  isConfigured: boolean;
  activeUrl: string | null;
  setUrl: (url: string | null) => void;
  client: ConvexReactClient | null;
  isOnline: boolean;
}

const ConvexCloudContext = createContext<ConvexCloudContextType>({
  isConfigured: false,
  activeUrl: null,
  setUrl: () => {},
  client: null,
  isOnline: true,
});

export function useConvexCloud() {
  return useContext(ConvexCloudContext);
}

export function ConvexClientProvider({ children }: { children: React.ReactNode }) {
  const [activeUrl, setActiveUrlState] = useState<string | null>(null);
  const [client, setClient] = useState<ConvexReactClient | null>(null);
  const [isOnline, setIsOnline] = useState<boolean>(true);

  // Initialize URL & client after mount
  useEffect(() => {
    const syncClient = () => {
      const url = getActiveConvexUrl();
      setActiveUrlState(url);
      if (url) {
        try {
          const newClient = new ConvexReactClient(url);
          setClient(newClient);
        } catch (err) {
          console.warn("[VibePDF] Invalid Convex URL:", err);
          setClient(null);
        }
      } else {
        setClient(null);
      }
    };

    syncClient();

    const handleUrlChange = () => syncClient();
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);

    window.addEventListener("vibepdf-convex-url-changed", handleUrlChange);
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);

    if (typeof navigator !== "undefined") {
      setIsOnline(navigator.onLine);
    }

    return () => {
      window.removeEventListener("vibepdf-convex-url-changed", handleUrlChange);
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);

  const handleSetUrl = (newUrl: string | null) => {
    setActiveConvexUrl(newUrl);
  };

  const contextValue = useMemo<ConvexCloudContextType>(() => ({
    isConfigured: !!client && !!activeUrl,
    activeUrl,
    setUrl: handleSetUrl,
    client,
    isOnline,
  }), [client, activeUrl, isOnline]);

  return (
    <ConvexCloudContext.Provider value={contextValue}>
      {client ? (
        <ConvexProvider client={client}>
          {children}
        </ConvexProvider>
      ) : (
        children
      )}
    </ConvexCloudContext.Provider>
  );
}
