/**
 * PPT Export — Shared styles, colors, and formatting constants
 *
 * ECIT brand palette + IC deck formatting conventions.
 */

// ── ECIT Color Palette ─────────────────────────────────────────────
export const COLORS = {
  navy: "002C55",         // primary dark navy
  gold: "C9A84C",         // accent gold
  darkBlue: "1B2A4A",     // header backgrounds
  lightBlue: "B4C6E7",    // totals, highlights
  mediumBlue: "4472C4",   // chart primary
  accentBlue: "5B9BD5",   // chart secondary
  green: "70AD47",        // positive / good
  red: "FF4444",          // negative / bad
  orange: "ED7D31",       // warning / caution
  lightGray: "F2F2F2",    // alternate row bg
  medGray: "D9D9D9",      // borders
  darkGray: "404040",     // body text
  white: "FFFFFF",
  black: "000000",
  // Chart series palette
  chart1: "002C55",       // navy
  chart2: "C9A84C",       // gold
  chart3: "4472C4",       // blue
  chart4: "70AD47",       // green
  chart5: "ED7D31",       // orange
  chart6: "5B9BD5",       // light blue
};

// ── Slide dimensions (16:9 widescreen) ─────────────────────────────
export const SLIDE_WIDTH = 13.33;
export const SLIDE_HEIGHT = 7.5;

// ── Font presets ───────────────────────────────────────────────────
export const FONTS = {
  title: "Calibri",
  body: "Calibri",
  mono: "Consolas",
};

// ── Common text options ───────────────────────────────────────────
export const TITLE_OPTS = {
  fontFace: FONTS.title,
  fontSize: 24,
  bold: true,
  color: COLORS.navy,
};

export const SUBTITLE_OPTS = {
  fontFace: FONTS.body,
  fontSize: 14,
  color: COLORS.darkGray,
};

export const SECTION_TITLE_OPTS = {
  fontFace: FONTS.title,
  fontSize: 18,
  bold: true,
  color: COLORS.navy,
};

export const BODY_OPTS = {
  fontFace: FONTS.body,
  fontSize: 10,
  color: COLORS.darkGray,
};

export const SMALL_OPTS = {
  fontFace: FONTS.body,
  fontSize: 8,
  color: COLORS.darkGray,
};

// ── Table styling ─────────────────────────────────────────────────
export const TABLE_HEADER = {
  fill: { color: COLORS.darkBlue },
  color: COLORS.white,
  fontSize: 9,
  bold: true,
  fontFace: FONTS.body,
  align: "center" as const,
  valign: "middle" as const,
};

export const TABLE_CELL = {
  fontSize: 9,
  fontFace: FONTS.body,
  color: COLORS.darkGray,
  valign: "middle" as const,
  border: { type: "solid" as const, pt: 0.5, color: COLORS.medGray },
};

export const TABLE_CELL_RIGHT = {
  ...TABLE_CELL,
  align: "right" as const,
};

export const TABLE_CELL_CENTER = {
  ...TABLE_CELL,
  align: "center" as const,
};

export const TABLE_TOTAL_ROW = {
  ...TABLE_CELL,
  bold: true,
  fill: { color: COLORS.lightBlue },
};

// ── Helpers ───────────────────────────────────────────────────────

/** Format number as "1,234" or "1,234.5" (NOKm style) */
export function fmtNum(v: number | null | undefined, decimals = 0): string {
  if (v == null || isNaN(v)) return "–";
  return v.toLocaleString("nb-NO", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

/** Format as percentage "12.3%" */
export function fmtPct(v: number | null | undefined, decimals = 1): string {
  if (v == null || isNaN(v)) return "–";
  return (v * 100).toLocaleString("nb-NO", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }) + "%";
}

/** Format as multiple "12.3x" */
export function fmtMult(v: number | null | undefined, decimals = 1): string {
  if (v == null || isNaN(v)) return "–";
  return v.toLocaleString("nb-NO", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }) + "x";
}

/** Add a standard slide title bar */
export function addSlideTitle(
  slide: any,
  title: string,
  subtitle?: string,
): void {
  // Navy accent bar at top
  slide.addShape("rect", {
    x: 0, y: 0, w: SLIDE_WIDTH, h: 0.06,
    fill: { color: COLORS.gold },
  });

  slide.addText(title, {
    x: 0.5, y: 0.2, w: SLIDE_WIDTH - 1, h: 0.5,
    ...SECTION_TITLE_OPTS,
  });

  if (subtitle) {
    slide.addText(subtitle, {
      x: 0.5, y: 0.65, w: SLIDE_WIDTH - 1, h: 0.3,
      ...SUBTITLE_OPTS,
      fontSize: 10,
    });
  }
}

/** Add a footer with page number and date */
export function addSlideFooter(
  slide: any,
  pageNum: number,
  totalPages: number,
): void {
  const now = new Date();
  const dateStr = now.toLocaleDateString("nb-NO", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
  slide.addText(`${dateStr}  |  Side ${pageNum}/${totalPages}`, {
    x: 0.5, y: SLIDE_HEIGHT - 0.35, w: SLIDE_WIDTH - 1, h: 0.25,
    ...SMALL_OPTS,
    color: "999999",
    align: "right",
  });

  // Bottom navy line
  slide.addShape("rect", {
    x: 0, y: SLIDE_HEIGHT - 0.06, w: SLIDE_WIDTH, h: 0.06,
    fill: { color: COLORS.navy },
  });
}

/** IRR color coding: green ≥15%, orange 8–15%, red <8% */
export function irrColor(irr: number | null | undefined): string {
  if (irr == null || isNaN(irr)) return COLORS.darkGray;
  if (irr >= 0.15) return COLORS.green;
  if (irr >= 0.08) return COLORS.orange;
  return COLORS.red;
}

/** MoM color coding: green ≥2.0x, orange 1.5–2.0x, red <1.5x */
export function momColor(mom: number | null | undefined): string {
  if (mom == null || isNaN(mom)) return COLORS.darkGray;
  if (mom >= 2.0) return COLORS.green;
  if (mom >= 1.5) return COLORS.orange;
  return COLORS.red;
}
