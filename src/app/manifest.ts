import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "VibePDF Studio — Offline-First PDF Viewer & Editor",
    short_name: "VibePDF",
    description: "Pro-grade offline-first PDF viewer, editor, annotator and cloud-synced document workspace.",
    start_url: "/",
    display: "standalone",
    background_color: "#09090b",
    theme_color: "#09090b",
    orientation: "any",
    icons: [
      {
        src: "/icons/icon-192.svg",
        sizes: "192x192",
        type: "image/svg+xml",
        purpose: "any",
      },
      {
        src: "/icons/icon-512.svg",
        sizes: "512x512",
        type: "image/svg+xml",
        purpose: "any",
      },
      {
        src: "/icons/icon-maskable.svg",
        sizes: "512x512",
        type: "image/svg+xml",
        purpose: "maskable",
      },
    ],
    file_handlers: [
      {
        action: "/",
        accept: {
          "application/pdf": [".pdf"],
        },
      },
    ],
    share_target: {
      action: "/?share-target=true",
      method: "POST",
      enctype: "multipart/form-data",
      params: {
        title: "title",
        text: "text",
        url: "url",
        files: [
          {
            name: "file",
            accept: ["application/pdf", ".pdf"],
          },
        ],
      },
    },
  };
}
