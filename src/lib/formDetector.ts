// Client-side Flat-PDF Smart Form Field Detector powered by pdfjs-dist
import { getPdfjsLib } from "./pdfThumbnails";

export interface DetectedFieldDraft {
  name: string;
  label: string;
  kind: "text" | "checkbox";
  pageIndex: number;
  // Page coordinates (top-left origin, PDF points) matching @embedpdf PageBox
  rect: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
}

interface TextItemSpan {
  str: string;
  x: number;
  yTop: number;
  width: number;
  height: number;
}

/**
 * Internal single-page field scanner operating on an already-loaded pdfjs document.
 */
async function detectFieldsOnPdfPage(
  pdf: any,
  pageIndex: number,
  usedNames: Set<string>
): Promise<DetectedFieldDraft[]> {
  if (pageIndex < 0 || pageIndex >= pdf.numPages) return [];

  const page = await pdf.getPage(pageIndex + 1);
  const viewport = page.getViewport({ scale: 1 });
  const textContent = await page.getTextContent();

  const pageWidth = viewport.width;
  const spans: TextItemSpan[] = [];

  for (const item of textContent.items as any[]) {
    if (!item.str || !item.str.trim()) continue;
    const tx = item.transform;
    const x = tx[4];
    // PDF bottom-left y -> top-left yTop
    const h = Math.max(10, Math.hypot(tx[2], tx[3]) || item.height || 12);
    const yBottom = tx[5];
    const yTop = viewport.height - yBottom - h;
    spans.push({
      str: item.str,
      x,
      yTop,
      width: Math.max(6, item.width || item.str.length * (h * 0.5)),
      height: h,
    });
  }

  // Group spans into visual rows (within 6pt vertical tolerance)
  spans.sort((a, b) => a.yTop - b.yTop || a.x - b.x);
  const rows: TextItemSpan[][] = [];
  for (const span of spans) {
    const lastRow = rows[rows.length - 1];
    if (lastRow && Math.abs(lastRow[0].yTop - span.yTop) <= 6) {
      lastRow.push(span);
    } else {
      rows.push([span]);
    }
  }

  const detected: DetectedFieldDraft[] = [];

  const uniqueName = (base: string) => {
    const clean =
      base
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "_")
        .replace(/^_+|_+$/g, "")
        .slice(0, 32) || `field_${pageIndex + 1}`;
    let candidate = clean;
    let n = 2;
    while (usedNames.has(candidate)) {
      candidate = `${clean}_${n++}`;
    }
    usedNames.add(candidate);
    return candidate;
  };

  for (const row of rows) {
    row.sort((a, b) => a.x - b.x);

    for (let i = 0; i < row.length; i++) {
      const span = row[i];
      const text = span.str.trim();

      // Pattern 1: Empty checkbox symbols ("[ ]", "☐", "□")
      if (/^(?:\[\s*\]|☐|□|\(\s*\))/.test(text)) {
        const nextSpan = row[i + 1];
        const label = nextSpan ? nextSpan.str.trim().slice(0, 40) : `Checkbox ${detected.length + 1}`;
        detected.push({
          name: uniqueName(`check_${label}`),
          label,
          kind: "checkbox",
          pageIndex,
          rect: {
            x: Math.max(12, span.x),
            y: Math.max(12, span.yTop - 1),
            width: 15,
            height: 15,
          },
        });
        continue;
      }

      // Pattern 2: Inline "Label: ________" or standalone underscore run "________"
      const underscoreMatch = text.match(/^(.*?)(_{3,})\s*$/);
      if (underscoreMatch) {
        const prefix = underscoreMatch[1].replace(/[:\-]+$/, "").trim();
        const prevSpan = !prefix && i > 0 ? row[i - 1].str.replace(/[:\-]+$/, "").trim() : "";
        const label = prefix || prevSpan || `Field ${detected.length + 1}`;
        const prefixRatio = prefix ? prefix.length / Math.max(1, text.length) : 0;
        const fieldX = span.x + span.width * prefixRatio + (prefix ? 4 : 0);
        const fieldWidth = Math.max(90, Math.min(pageWidth - fieldX - 36, span.width * (1 - prefixRatio) + 12));

        detected.push({
          name: uniqueName(label),
          label,
          kind: "text",
          pageIndex,
          rect: {
            x: Math.max(18, fieldX),
            y: Math.max(12, span.yTop - 3),
            width: fieldWidth,
            height: Math.max(18, span.height + 6),
          },
        });
        continue;
      }

      // Pattern 3: Label ending with ":" where the space to the right on the same row is open
      if (/^[A-Za-z][A-Za-z0-9\s/()&-]{1,36}:$/.test(text)) {
        const nextSpan = row[i + 1];
        const rightEdge = span.x + span.width;
        const availableSpace = nextSpan ? nextSpan.x - rightEdge : pageWidth - 42 - rightEdge;

        if (availableSpace >= 80) {
          const label = text.slice(0, -1).trim();
          // Skip obvious section headings
          if (/^(section|note|step|part|chapter|page)\b/i.test(label)) continue;

          detected.push({
            name: uniqueName(label),
            label,
            kind: "text",
            pageIndex,
            rect: {
              x: rightEdge + 8,
              y: Math.max(12, span.yTop - 4),
              width: Math.min(240, Math.max(95, availableSpace - 14)),
              height: Math.max(20, span.height + 8),
            },
          });
        }
      }
    }
  }

  return detected.slice(0, 35);
}

/**
 * Scans a flat PDF page for common fillable form patterns:
 * 1. Underscore blanks ("Name: __________", "Date: _______", "_______")
 * 2. Empty checkbox glyphs ("[ ]", "☐", "□")
 * 3. Trailing colon labels with open space to the right ("Full Name:", "Email Address:")
 *
 * Returns positioned field drafts ready for `viewer.get("form").create(...)`.
 */
export async function detectFormFieldsOnPage(
  blob: Blob,
  pageIndex: number
): Promise<DetectedFieldDraft[]> {
  if (typeof window === "undefined" || !blob) return [];

  const pdfjs = await getPdfjsLib();
  if (!pdfjs) return [];

  const buffer = await blob.arrayBuffer();
  const clone = new Uint8Array(buffer.slice(0));
  const pdf = await pdfjs.getDocument({ data: clone }).promise;

  try {
    return await detectFieldsOnPdfPage(pdf, pageIndex, new Set<string>());
  } finally {
    await pdf.destroy?.();
  }
}

/**
 * Scans every page in a flat PDF document for fillable form patterns,
 * returning deduplicated field drafts across all pages.
 */
export async function detectFormFieldsAllPages(
  blob: Blob
): Promise<DetectedFieldDraft[]> {
  if (typeof window === "undefined" || !blob) return [];

  const pdfjs = await getPdfjsLib();
  if (!pdfjs) return [];

  const buffer = await blob.arrayBuffer();
  const clone = new Uint8Array(buffer.slice(0));
  const pdf = await pdfjs.getDocument({ data: clone }).promise;

  try {
    const usedNames = new Set<string>();
    const allDetected: DetectedFieldDraft[] = [];

    for (let pageIndex = 0; pageIndex < pdf.numPages; pageIndex++) {
      const pageDrafts = await detectFieldsOnPdfPage(pdf, pageIndex, usedNames);
      allDetected.push(...pageDrafts);
      if (allDetected.length >= 200) break;
    }

    return allDetected.slice(0, 200);
  } finally {
    await pdf.destroy?.();
  }
}
