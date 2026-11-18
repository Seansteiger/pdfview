// Client-side Flat-PDF Smart Form Field Detector powered by pdfjs-dist
import { getPdfjsLib } from "./pdfThumbnails";

export type StandardPdfFont = "Helvetica" | "Times-Roman" | "Courier";
export type EmbedPdfStandardFont = "helvetica" | "times-roman" | "courier";

export interface DetectedFieldStyle {
  fontFamily: StandardPdfFont;
  fontSize: number;
  fontColor: string;
  interiorColor: null;
  strokeWidth: number;
  borderStyle?: "solid" | "underline";
  color?: string | null;
}

export interface PageTypography {
  fontFamily: StandardPdfFont;
  fontSize: number;
}

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
  style: DetectedFieldStyle;
}

interface TextItemSpan {
  str: string;
  x: number;
  yTop: number;
  yBaselineTop: number;
  width: number;
  height: number;
  fontFamily: StandardPdfFont;
}

const DEFAULT_INK_COLOR = "#18181b";

/**
 * Maps a raw PDF font name and pdfjs style fontFamily string into one of
 * the three standard PDF typeface families.
 */
export function inferStandardPdfFont(
  rawFontName: string,
  styleFamily?: string
): StandardPdfFont {
  const combined = `${rawFontName || ""} ${styleFamily || ""}`;
  if (/times|serif|georgia|garamond|cambria|palatino|minion|roman/i.test(combined)) {
    return "Times-Roman";
  }
  if (/courier|mono|consolas|menlo|typewriter|code|fixed/i.test(combined)) {
    return "Courier";
  }
  return "Helvetica";
}

/**
 * Converts a PDF standard font name into the lowercase wire format expected by
 * @embedpdf/engine-core (`helvetica` | `times-roman` | `courier`).
 */
export function toEmbedPdfFontFamily(
  font: StandardPdfFont | EmbedPdfStandardFont | string
): EmbedPdfStandardFont {
  const lower = (font || "").toLowerCase();
  if (lower.includes("times") || lower.includes("serif")) return "times-roman";
  if (lower.includes("courier") || lower.includes("mono")) return "courier";
  return "helvetica";
}

/**
 * Extracts text spans and computes the page's dominant font family & median label size.
 */
async function extractPageSpansAndTypography(
  pdf: any,
  pageIndex: number
): Promise<{
  pageWidth: number;
  spans: TextItemSpan[];
  pageStyle: PageTypography;
}> {
  const page = await pdf.getPage(pageIndex + 1);
  const viewport = page.getViewport({ scale: 1 });
  const textContent = await page.getTextContent();
  const styles: Record<string, { fontFamily?: string; ascent?: number; descent?: number }> =
    (textContent.styles as Record<string, { fontFamily?: string; ascent?: number; descent?: number }>) ||
    {};

  const spans: TextItemSpan[] = [];
  const fontWeights: Record<StandardPdfFont, number> = {
    Helvetica: 0,
    "Times-Roman": 0,
    Courier: 0,
  };
  const bodyFontSizes: number[] = [];

  for (const item of textContent.items as any[]) {
    if (!item.str || !item.str.trim()) continue;
    const tx = item.transform;
    const x = tx[4];
    const rawH = Math.hypot(tx[2], tx[3]) || item.height || 11;
    const h = Math.max(6, rawH);
    const yBaselineBottom = tx[5];
    const yBaselineTop = viewport.height - yBaselineBottom;
    const yTop = yBaselineTop - h;

    const rawFontName = typeof item.fontName === "string" ? item.fontName : "";
    const styleFamily = rawFontName ? styles[rawFontName]?.fontFamily : undefined;
    const fontFamily = inferStandardPdfFont(rawFontName, styleFamily);

    const charWeight = item.str.trim().length;
    fontWeights[fontFamily] += charWeight;

    // Collect normal label/body sizes (ignore tiny footnotes or giant display headings)
    if (h >= 7 && h <= 20) {
      bodyFontSizes.push(h);
    }

    spans.push({
      str: item.str,
      x,
      yTop,
      yBaselineTop,
      width: Math.max(6, item.width || item.str.length * (h * 0.5)),
      height: h,
      fontFamily,
    });
  }

  let dominantFontFamily: StandardPdfFont = "Helvetica";
  let topWeight = -1;
  (Object.keys(fontWeights) as StandardPdfFont[]).forEach((family) => {
    if (fontWeights[family] > topWeight) {
      topWeight = fontWeights[family];
      dominantFontFamily = family;
    }
  });

  let medianFontSize = 11;
  if (bodyFontSizes.length > 0) {
    bodyFontSizes.sort((a, b) => a - b);
    const mid = Math.floor(bodyFontSizes.length / 2);
    const rawMedian =
      bodyFontSizes.length % 2 === 0
        ? (bodyFontSizes[mid - 1] + bodyFontSizes[mid]) / 2
        : bodyFontSizes[mid];
    medianFontSize = Math.round(Math.max(8, Math.min(16, rawMedian * 0.96)) * 2) / 2;
  }

  return {
    pageWidth: viewport.width,
    spans,
    pageStyle: {
      fontFamily: dominantFontFamily,
      fontSize: medianFontSize,
    },
  };
}

/**
 * Fast helper returning the dominant PDF font family and median font size on a page
 * so manually added fields also match the document's native typography.
 */
export async function detectPageTypography(
  blob: Blob,
  pageIndex: number
): Promise<PageTypography> {
  if (typeof window === "undefined" || !blob) {
    return { fontFamily: "Helvetica", fontSize: 11 };
  }

  const pdfjs = await getPdfjsLib();
  if (!pdfjs) {
    return { fontFamily: "Helvetica", fontSize: 11 };
  }

  const buffer = await blob.arrayBuffer();
  const clone = new Uint8Array(buffer.slice(0));
  const pdf = await pdfjs.getDocument({ data: clone }).promise;

  try {
    const safePageIdx = Math.min(Math.max(0, pageIndex), Math.max(0, pdf.numPages - 1));
    const { pageStyle } = await extractPageSpansAndTypography(pdf, safePageIdx);
    return pageStyle;
  } finally {
    await pdf.destroy?.();
  }
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

  const { pageWidth, spans, pageStyle } = await extractPageSpansAndTypography(pdf, pageIndex);

  // Group spans into visual rows (within 6pt vertical tolerance on baseline)
  spans.sort((a, b) => a.yBaselineTop - b.yBaselineTop || a.x - b.x);
  const rows: TextItemSpan[][] = [];
  for (const span of spans) {
    const lastRow = rows[rows.length - 1];
    if (lastRow && Math.abs(lastRow[0].yBaselineTop - span.yBaselineTop) <= 6) {
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
      const matchedFontSize =
        Math.round(Math.max(8, Math.min(16, span.height * 0.96)) * 2) / 2;

      // Pattern 1: Empty checkbox symbols ("[ ]", "☐", "□", "( )")
      if (/^(?:\[\s*\]|☐|□|\(\s*\))/.test(text)) {
        const nextSpan = row[i + 1];
        const label = nextSpan
          ? nextSpan.str.trim().slice(0, 40)
          : `Checkbox ${detected.length + 1}`;
        const boxSize = Math.round(Math.max(12, Math.min(18, span.height * 1.05)));
        const fontFamily = nextSpan?.fontFamily || span.fontFamily || pageStyle.fontFamily;

        detected.push({
          name: uniqueName(`check_${label}`),
          label,
          kind: "checkbox",
          pageIndex,
          rect: {
            x: Math.max(12, span.x),
            y: Math.max(8, span.yTop - 1),
            width: boxSize,
            height: boxSize,
          },
          style: {
            fontFamily,
            fontSize: matchedFontSize,
            fontColor: DEFAULT_INK_COLOR,
            interiorColor: null,
            // Transparent border over existing printed checkbox glyph so it doesn't draw a double box
            strokeWidth: 0,
            borderStyle: "solid",
            color: null,
          },
        });
        continue;
      }

      // Pattern 2: Inline "Label: ________" or standalone underscore run "________"
      const underscoreMatch = text.match(/^(.*?)(_{3,})\s*$/);
      if (underscoreMatch) {
        const prefix = underscoreMatch[1].replace(/[:\-]+$/, "").trim();
        const prevSpan =
          !prefix && i > 0 ? row[i - 1].str.replace(/[:\-]+$/, "").trim() : "";
        const label = prefix || prevSpan || `Field ${detected.length + 1}`;
        const prefixRatio = prefix ? prefix.length / Math.max(1, text.length) : 0;
        const fieldX = span.x + span.width * prefixRatio + (prefix ? 4 : 0);
        const fieldWidth = Math.max(
          90,
          Math.min(pageWidth - fieldX - 36, span.width * (1 - prefixRatio) + 12)
        );
        const fieldHeight = Math.round(matchedFontSize * 1.45);
        const fieldY = Math.max(8, span.yTop - (fieldHeight - span.height) * 0.65);
        const fontFamily =
          (!prefix && i > 0 ? row[i - 1].fontFamily : span.fontFamily) ||
          pageStyle.fontFamily;

        detected.push({
          name: uniqueName(label),
          label,
          kind: "text",
          pageIndex,
          rect: {
            x: Math.max(18, fieldX),
            y: fieldY,
            width: fieldWidth,
            height: fieldHeight,
          },
          style: {
            fontFamily,
            fontSize: matchedFontSize,
            fontColor: DEFAULT_INK_COLOR,
            interiorColor: null,
            strokeWidth: 0,
            borderStyle: "solid",
            color: null,
          },
        });
        continue;
      }

      // Pattern 3: Label ending with ":" where the space to the right on the same row is open
      if (/^[A-Za-z][A-Za-z0-9\s/()&-]{1,36}:$/.test(text)) {
        const nextSpan = row[i + 1];
        const rightEdge = span.x + span.width;
        const availableSpace = nextSpan
          ? nextSpan.x - rightEdge
          : pageWidth - 42 - rightEdge;

        if (availableSpace >= 80) {
          const label = text.slice(0, -1).trim();
          // Skip obvious section headings
          if (/^(section|note|step|part|chapter|page)\b/i.test(label)) continue;

          const fieldHeight = Math.round(matchedFontSize * 1.45);
          const fieldY = Math.max(8, span.yTop - (fieldHeight - span.height) * 0.65);

          detected.push({
            name: uniqueName(label),
            label,
            kind: "text",
            pageIndex,
            rect: {
              x: rightEdge + 8,
              y: fieldY,
              width: Math.min(240, Math.max(95, availableSpace - 14)),
              height: fieldHeight,
            },
            style: {
              fontFamily: span.fontFamily || pageStyle.fontFamily,
              fontSize: matchedFontSize,
              fontColor: DEFAULT_INK_COLOR,
              interiorColor: null,
              strokeWidth: 0,
              borderStyle: "solid",
              color: null,
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
 * Returns baseline-aligned, font-matched field drafts ready for `viewer.get("form").create(...)`.
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
 * returning deduplicated, typography-matched field drafts across all pages.
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
