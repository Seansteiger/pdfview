import { PDFDocument, StandardFonts, rgb, degrees } from "pdf-lib";
import type { SerializedAnnotation } from "./localDb";
import { sanitizeWinAnsi } from "./pdfEncoding";

export type PdfWorkerAction =
  | "INSPECT_PDF"
  | "REORDER_PAGES"
  | "ROTATE_PAGES"
  | "DELETE_PAGES"
  | "EXTRACT_PAGES"
  | "MERGE_PDFS"
  | "STAMP_AND_FLATTEN";

export interface PdfInspectionInfo {
  pageCount: number;
  pageDimensions: { width: number; height: number; rotation: number }[];
  title: string;
  author: string;
  sizeBytes: number;
}

export interface PdfWorkerRequest {
  id: string;
  action: PdfWorkerAction;
  buffer?: ArrayBuffer;
  buffers?: ArrayBuffer[];
  pageIndices?: number[];
  newOrder?: number[];
  degrees?: 90 | 180 | 270 | -90;
  rangeString?: string;
  annotations?: SerializedAnnotation[];
  flattenForms?: boolean;
}

export interface PdfWorkerResponse {
  id: string;
  action: PdfWorkerAction;
  success: boolean;
  error?: string;
  buffer?: ArrayBuffer;
  info?: PdfInspectionInfo;
}

function parseHexColor(hex?: string): { r: number; g: number; b: number } {
  if (!hex) return { r: 0, g: 0, b: 0 };
  const clean = hex.replace("#", "");
  if (clean.length === 3) {
    return {
      r: parseInt(clean[0] + clean[0], 16) / 255,
      g: parseInt(clean[1] + clean[1], 16) / 255,
      b: parseInt(clean[2] + clean[2], 16) / 255,
    };
  }
  if (clean.length >= 6) {
    return {
      r: parseInt(clean.substring(0, 2), 16) / 255,
      g: parseInt(clean.substring(2, 4), 16) / 255,
      b: parseInt(clean.substring(4, 6), 16) / 255,
    };
  }
  return { r: 0, g: 0, b: 0 };
}

function parseRangeString(ranges: string, totalPages: number): number[] {
  const result: number[] = [];
  const parts = ranges.split(",").map((s) => s.trim());
  for (const part of parts) {
    if (!part) continue;
    if (part.includes("-")) {
      const [startStr, endStr] = part.split("-");
      let start = parseInt(startStr, 10);
      let end = parseInt(endStr, 10);
      if (isNaN(start) || start < 1) start = 1;
      if (isNaN(end) || end > totalPages) end = totalPages;
      if (start > end) [start, end] = [end, start];
      for (let i = start - 1; i <= end - 1; i++) {
        if (i < totalPages && !result.includes(i)) result.push(i);
      }
    } else {
      const single = parseInt(part, 10);
      if (!isNaN(single) && single >= 1 && single <= totalPages) {
        const idx = single - 1;
        if (!result.includes(idx)) result.push(idx);
      }
    }
  }
  return result;
}

async function dataUrlToArrayBuffer(dataUrl: string): Promise<ArrayBuffer> {
  const base64 = dataUrl.split(",")[1];
  const binaryString = atob(base64);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes.buffer;
}

// Worker message listener
self.onmessage = async (e: MessageEvent<PdfWorkerRequest>) => {
  const req = e.data;
  const { id, action } = req;

  try {
    switch (action) {
      case "INSPECT_PDF": {
        if (!req.buffer) throw new Error("INSPECT_PDF requires a buffer");
        const pdfDoc = await PDFDocument.load(req.buffer, { ignoreEncryption: true });
        const pageCount = pdfDoc.getPageCount();
        const pages = pdfDoc.getPages();
        const pageDimensions = pages.map((p) => {
          const { width, height } = p.getSize();
          return {
            width,
            height,
            rotation: p.getRotation().angle,
          };
        });

        const title = pdfDoc.getTitle() || "";
        const author = pdfDoc.getAuthor() || "";

        const response: PdfWorkerResponse = {
          id,
          action,
          success: true,
          info: {
            pageCount,
            pageDimensions,
            title,
            author,
            sizeBytes: req.buffer.byteLength,
          },
        };
        self.postMessage(response);
        break;
      }

      case "REORDER_PAGES": {
        if (!req.buffer || !req.newOrder) throw new Error("REORDER_PAGES requires buffer and newOrder");
        const pdfDoc = await PDFDocument.load(req.buffer, { ignoreEncryption: true });
        const newPdf = await PDFDocument.create();
        const total = pdfDoc.getPageCount();
        const validOrder = req.newOrder.filter((idx) => idx >= 0 && idx < total);

        const copiedPages = await newPdf.copyPages(pdfDoc, validOrder);
        copiedPages.forEach((p) => newPdf.addPage(p));

        const saved = await newPdf.save();
        const outBuffer = saved.buffer.slice(saved.byteOffset, saved.byteOffset + saved.byteLength) as ArrayBuffer;

        const response: PdfWorkerResponse = {
          id,
          action,
          success: true,
          buffer: outBuffer,
        };
        self.postMessage(response, [outBuffer]);
        break;
      }

      case "ROTATE_PAGES": {
        if (!req.buffer || !req.pageIndices || req.degrees === undefined) {
          throw new Error("ROTATE_PAGES requires buffer, pageIndices, and degrees");
        }
        const pdfDoc = await PDFDocument.load(req.buffer, { ignoreEncryption: true });
        const pages = pdfDoc.getPages();
        const deg = req.degrees;

        for (const idx of req.pageIndices) {
          if (pages[idx]) {
            const current = pages[idx].getRotation().angle;
            const target = (current + deg + 360) % 360;
            pages[idx].setRotation(degrees(target));
          }
        }

        const saved = await pdfDoc.save();
        const outBuffer = saved.buffer.slice(saved.byteOffset, saved.byteOffset + saved.byteLength) as ArrayBuffer;

        const response: PdfWorkerResponse = {
          id,
          action,
          success: true,
          buffer: outBuffer,
        };
        self.postMessage(response, [outBuffer]);
        break;
      }

      case "DELETE_PAGES": {
        if (!req.buffer || !req.pageIndices) throw new Error("DELETE_PAGES requires buffer and pageIndices");
        const pdfDoc = await PDFDocument.load(req.buffer, { ignoreEncryption: true });
        const sorted = [...req.pageIndices].sort((a, b) => b - a);

        for (const idx of sorted) {
          if (idx >= 0 && idx < pdfDoc.getPageCount()) {
            pdfDoc.removePage(idx);
          }
        }

        const saved = await pdfDoc.save();
        const outBuffer = saved.buffer.slice(saved.byteOffset, saved.byteOffset + saved.byteLength) as ArrayBuffer;

        const response: PdfWorkerResponse = {
          id,
          action,
          success: true,
          buffer: outBuffer,
        };
        self.postMessage(response, [outBuffer]);
        break;
      }

      case "EXTRACT_PAGES": {
        if (!req.buffer) throw new Error("EXTRACT_PAGES requires buffer");
        const pdfDoc = await PDFDocument.load(req.buffer, { ignoreEncryption: true });
        const total = pdfDoc.getPageCount();

        let indices: number[] = [];
        if (req.rangeString && req.rangeString.trim().length > 0) {
          indices = parseRangeString(req.rangeString, total);
        } else if (req.pageIndices && req.pageIndices.length > 0) {
          indices = req.pageIndices.filter((i) => i >= 0 && i < total);
        }

        if (indices.length === 0) {
          throw new Error("No valid pages selected for extraction");
        }

        const newPdf = await PDFDocument.create();
        const copiedPages = await newPdf.copyPages(pdfDoc, indices);
        copiedPages.forEach((p) => newPdf.addPage(p));

        const saved = await newPdf.save();
        const outBuffer = saved.buffer.slice(saved.byteOffset, saved.byteOffset + saved.byteLength) as ArrayBuffer;

        const response: PdfWorkerResponse = {
          id,
          action,
          success: true,
          buffer: outBuffer,
        };
        self.postMessage(response, [outBuffer]);
        break;
      }

      case "MERGE_PDFS": {
        if (!req.buffers || req.buffers.length === 0) throw new Error("MERGE_PDFS requires buffers array");
        const mergedPdf = await PDFDocument.create();

        for (const buf of req.buffers) {
          const doc = await PDFDocument.load(buf, { ignoreEncryption: true });
          const indices = doc.getPageIndices();
          const copied = await mergedPdf.copyPages(doc, indices);
          copied.forEach((p) => mergedPdf.addPage(p));
        }

        const saved = await mergedPdf.save();
        const outBuffer = saved.buffer.slice(saved.byteOffset, saved.byteOffset + saved.byteLength) as ArrayBuffer;

        const response: PdfWorkerResponse = {
          id,
          action,
          success: true,
          buffer: outBuffer,
        };
        self.postMessage(response, [outBuffer]);
        break;
      }

      case "STAMP_AND_FLATTEN": {
        if (!req.buffer) throw new Error("STAMP_AND_FLATTEN requires buffer");
        const pdfDoc = await PDFDocument.load(req.buffer, { ignoreEncryption: true });
        const pages = pdfDoc.getPages();
        const annotations = req.annotations || [];

        // Embed standard fonts for text notes and watermarks
        const helvetica = await pdfDoc.embedFont(StandardFonts.Helvetica);
        const helveticaBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

        for (const ann of annotations) {
          const page = pages[ann.pageIndex];
          if (!page) continue;

          const { r, g, b } = parseHexColor(ann.color || "#000000");
          const opacity = ann.opacity ?? 1.0;

          switch (ann.type) {
            case "highlight": {
              page.drawRectangle({
                x: ann.x,
                y: ann.y,
                width: ann.width || 100,
                height: ann.height || 16,
                color: rgb(r, g, b),
                opacity: 0.35,
              });
              break;
            }

            case "strikeout": {
              const yMid = ann.y + (ann.height || 16) / 2;
              page.drawLine({
                start: { x: ann.x, y: yMid },
                end: { x: ann.x + (ann.width || 100), y: yMid },
                thickness: 2,
                color: rgb(r, g, b),
                opacity,
              });
              break;
            }

            case "underline": {
              page.drawLine({
                start: { x: ann.x, y: ann.y },
                end: { x: ann.x + (ann.width || 100), y: ann.y },
                thickness: 1.5,
                color: rgb(r, g, b),
                opacity,
              });
              break;
            }

            case "redaction": {
              // Permanent opaque black box redaction burn-in
              page.drawRectangle({
                x: ann.x,
                y: ann.y,
                width: ann.width || 100,
                height: ann.height || 20,
                color: rgb(0, 0, 0),
                opacity: 1.0,
              });
              if (ann.text) {
                page.drawText(sanitizeWinAnsi(ann.text), {
                  x: ann.x + 4,
                  y: ann.y + 4,
                  size: 8,
                  font: helveticaBold,
                  color: rgb(1, 1, 1),
                });
              }
              break;
            }

            case "note": {
              if (ann.text) {
                // Background bubble
                page.drawRectangle({
                  x: ann.x,
                  y: ann.y,
                  width: ann.width || 120,
                  height: ann.height || 40,
                  color: rgb(1, 0.95, 0.7),
                  borderColor: rgb(0.8, 0.7, 0.2),
                  borderWidth: 1,
                  opacity: 0.95,
                });
                page.drawText(sanitizeWinAnsi(ann.text), {
                  x: ann.x + 6,
                  y: ann.y + (ann.height || 40) - 14,
                  size: 9,
                  font: helvetica,
                  color: rgb(0.1, 0.1, 0.1),
                });
              }
              break;
            }

            case "signature": {
              if (ann.dataUrl) {
                const imgBuffer = await dataUrlToArrayBuffer(ann.dataUrl);
                let image;
                if (ann.dataUrl.startsWith("data:image/jpeg") || ann.dataUrl.startsWith("data:image/jpg")) {
                  image = await pdfDoc.embedJpg(imgBuffer);
                } else {
                  image = await pdfDoc.embedPng(imgBuffer);
                }
                page.drawImage(image, {
                  x: ann.x,
                  y: ann.y,
                  width: ann.width || 120,
                  height: ann.height || 60,
                  opacity,
                });
              }
              break;
            }

            case "ink": {
              if (ann.points && ann.points.length > 1) {
                for (let i = 0; i < ann.points.length - 1; i++) {
                  page.drawLine({
                    start: { x: ann.points[i].x, y: ann.points[i].y },
                    end: { x: ann.points[i + 1].x, y: ann.points[i + 1].y },
                    thickness: 2,
                    color: rgb(r, g, b),
                    opacity,
                  });
                }
              }
              break;
            }

            case "watermark": {
              if (ann.text) {
                page.drawText(sanitizeWinAnsi(ann.text), {
                  x: ann.x,
                  y: ann.y,
                  size: 36,
                  font: helveticaBold,
                  color: rgb(r, g, b),
                  opacity: 0.25,
                  rotate: degrees(45),
                });
              }
              break;
            }
          }
        }

        // Flatten interactive form fields if requested
        if (req.flattenForms !== false) {
          try {
            const form = pdfDoc.getForm();
            if (form) form.flatten();
          } catch (_) {
            // Document might not contain an AcroForm
          }
        }

        const saved = await pdfDoc.save();
        const outBuffer = saved.buffer.slice(saved.byteOffset, saved.byteOffset + saved.byteLength) as ArrayBuffer;

        const response: PdfWorkerResponse = {
          id,
          action,
          success: true,
          buffer: outBuffer,
        };
        self.postMessage(response, [outBuffer]);
        break;
      }

      default:
        throw new Error(`Unknown action: ${action}`);
    }
  } catch (error: any) {
    const errorResponse: PdfWorkerResponse = {
      id,
      action,
      success: false,
      error: error?.message || String(error),
    };
    self.postMessage(errorResponse);
  }
};
