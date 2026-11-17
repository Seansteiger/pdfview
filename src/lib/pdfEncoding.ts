/**
 * Utilities for WinAnsi (Windows-1252) encoding sanitization for pdf-lib standard fonts.
 * Standard PDF fonts (Helvetica, TimesRoman, Courier) only support WinAnsi character encoding.
 * Any non-WinAnsi character (like ▲, ►, emojis, Asian characters, etc.) will throw an uncaught exception:
 * `WinAnsi cannot encode "..."`
 */

const WIN_ANSI_EXTRA_CHARS = new Set([
  0x20AC, // €
  0x201A, // ‚
  0x0192, // ƒ
  0x201E, // „
  0x2026, // …
  0x2020, // †
  0x2021, // ‡
  0x02C6, // ˆ
  0x2030, // ‰
  0x0160, // Š
  0x2039, // ‹
  0x0152, // Œ
  0x017D, // Ž
  0x2018, // ‘
  0x2019, // ’
  0x201C, // “
  0x201D, // ”
  0x2022, // •
  0x2013, // –
  0x2014, // —
  0x02DC, // ˜
  0x2122, // ™
  0x0161, // š
  0x203A, // ›
  0x0153, // œ
  0x017E, // ž
  0x0178, // Ÿ
]);

export function isWinAnsiSafe(code: number): boolean {
  if (code >= 0x20 && code <= 0x7E) return true; // Standard ASCII printable
  if (code >= 0xA0 && code <= 0xFF) return true; // Latin-1 Supplement (includes ° at 0xB0)
  if (code === 0x0A || code === 0x0D || code === 0x09) return true; // Newline, carriage return, tab
  return WIN_ANSI_EXTRA_CHARS.has(code);
}

/**
 * Sanitizes arbitrary text so it is 100% safe to pass to pdf-lib page.drawText() with StandardFonts.
 * Converts common arrows, checkmarks, bullets, and emojis to WinAnsi equivalents,
 * and strips/replaces any remaining unmappable Unicode characters with '?'.
 */
export function sanitizeWinAnsi(text: string): string {
  if (!text) return "";

  // Step 1: Map common Unicode symbols to WinAnsi / ASCII equivalents
  const cleaned = text
    .replace(/[▲▴▵↑]/g, "^")
    .replace(/[▼▾▿↓]/g, "v")
    .replace(/[►▶▸→]/g, ">")
    .replace(/[◄◀◂←]/g, "<")
    .replace(/[✓✔]/g, "[v]")
    .replace(/[✕✖✗]/g, "[x]")
    .replace(/[★☆]/g, "*")
    .replace(/…/g, "...");

  // Step 2: Ensure every character is strictly encodable in WinAnsi
  let result = "";
  for (let i = 0; i < cleaned.length; i++) {
    const code = cleaned.charCodeAt(i);
    if (isWinAnsiSafe(code)) {
      result += cleaned[i];
    } else {
      result += "?";
    }
  }
  return result;
}
