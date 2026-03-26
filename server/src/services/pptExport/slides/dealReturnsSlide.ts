/**
 * Slide 7 — Deal Returns
 *
 * Traffic-light heatmap matrices for IRR and MoM (Standalone vs Kombinert).
 */
import type PptxGenJS from "pptxgenjs";
import type { ExportData } from "../../excelExport/types.js";
import type { CaseReturn } from "../../dealReturns.js";
import {
  COLORS, addSlideTitle, addSlideFooter,
  TABLE_HEADER, TABLE_CELL_RIGHT,
  fmtNum, fmtPct, fmtMult, irrColor, momColor,
  SLIDE_WIDTH,
} from "../styles.js";

function buildReturnMatrix(
  slide: any,
  title: string,
  cases: CaseReturn[],
  standalone: Record<number, { irr: number | null; mom: number | null }>,
  x: number,
  y: number,
  w: number,
): void {
  if (!cases.length) return;

  // Title
  slide.addText(title, {
    x, y: y - 0.35, w, h: 0.3,
    fontSize: 12, bold: true, color: COLORS.navy,
    fontFace: "Calibri",
  });

  // Table: Exit Multiple | SA IRR | SA MoM | Komb IRR | Komb MoM
  const headerRow = [
    { text: "Exit\nMultiple", options: { ...TABLE_HEADER, rowspan: 1 } },
    { text: "SA IRR", options: TABLE_HEADER },
    { text: "SA MoM", options: TABLE_HEADER },
    { text: "Komb IRR", options: TABLE_HEADER },
    { text: "Komb MoM", options: TABLE_HEADER },
  ];

  const rows: any[][] = [headerRow];

  for (const c of cases) {
    const sa = standalone[c.exit_multiple];
    const saIrr = sa?.irr ?? null;
    const saMom = sa?.mom ?? null;

    rows.push([
      { text: `${c.exit_multiple}x`, options: { ...TABLE_CELL_RIGHT, bold: true } },
      { text: fmtPct(saIrr), options: { ...TABLE_CELL_RIGHT, color: irrColor(saIrr) } },
      { text: fmtMult(saMom), options: { ...TABLE_CELL_RIGHT, color: momColor(saMom) } },
      { text: fmtPct(c.irr), options: { ...TABLE_CELL_RIGHT, color: irrColor(c.irr), bold: true } },
      { text: fmtMult(c.mom), options: { ...TABLE_CELL_RIGHT, color: momColor(c.mom), bold: true } },
    ]);
  }

  slide.addTable(rows, {
    x, y, w,
    colW: [w * 0.18, w * 0.2, w * 0.2, w * 0.21, w * 0.21],
    rowH: 0.35,
    border: { type: "solid", pt: 0.5, color: COLORS.medGray },
  });
}

export function buildDealReturnsSlide(pres: PptxGenJS, data: ExportData): void {
  const slide = pres.addSlide();
  addSlideTitle(slide, "Deal Returns", "IRR og MoM — Standalone vs. Kombinert");

  const cr = data.calculatedReturns;
  const combinedCases = cr.cases.filter(c => c.return_case === "Kombinert");
  const sa = cr.standalone_by_multiple || {};

  if (!combinedCases.length) {
    slide.addText("Ingen avkastningsberegninger tilgjengelig", {
      x: 1, y: 3, w: SLIDE_WIDTH - 2, h: 1,
      fontSize: 14, color: COLORS.darkGray, align: "center",
    });
    addSlideFooter(slide, 7, 8);
    return;
  }

  // EV-level returns matrix (left)
  buildReturnMatrix(
    slide,
    "EV-basert avkastning",
    combinedCases,
    sa,
    0.5, 1.5, 5.8,
  );

  // Per-share returns matrix (right) — if share data available
  const hasPerShare = combinedCases.some(c => c.per_share_irr != null);
  if (hasPerShare) {
    // Build per-share table
    slide.addText("Per-aksje avkastning", {
      x: 7.0, y: 1.15, w: 5.8, h: 0.3,
      fontSize: 12, bold: true, color: COLORS.navy,
      fontFace: "Calibri",
    });

    const psHeaderRow = [
      { text: "Exit\nMultiple", options: TABLE_HEADER },
      { text: "Entry PPS", options: TABLE_HEADER },
      { text: "Exit PPS", options: TABLE_HEADER },
      { text: "IRR", options: TABLE_HEADER },
      { text: "MoM", options: TABLE_HEADER },
    ];
    const psRows: any[][] = [psHeaderRow];

    for (const c of combinedCases) {
      psRows.push([
        { text: `${c.exit_multiple}x`, options: { ...TABLE_CELL_RIGHT, bold: true } },
        { text: c.per_share_entry ? `${fmtNum(c.per_share_entry, 1)}` : "–", options: TABLE_CELL_RIGHT },
        { text: c.per_share_exit ? `${fmtNum(c.per_share_exit, 1)}` : "–", options: TABLE_CELL_RIGHT },
        { text: fmtPct(c.per_share_irr), options: { ...TABLE_CELL_RIGHT, color: irrColor(c.per_share_irr), bold: true } },
        { text: fmtMult(c.per_share_mom), options: { ...TABLE_CELL_RIGHT, color: momColor(c.per_share_mom), bold: true } },
      ]);
    }

    slide.addTable(psRows, {
      x: 7.0, y: 1.5, w: 5.8,
      colW: [1.0, 1.1, 1.1, 1.3, 1.3],
      rowH: 0.35,
      border: { type: "solid", pt: 0.5, color: COLORS.medGray },
    });
  }

  // Key takeaway box
  const medianCase = combinedCases[Math.floor(combinedCases.length / 2)];
  if (medianCase) {
    const irrStr = medianCase.irr != null ? fmtPct(medianCase.irr) : "–";
    const momStr = medianCase.mom != null ? fmtMult(medianCase.mom) : "–";
    slide.addShape("roundRect", {
      x: 0.5, y: 5.8, w: SLIDE_WIDTH - 1, h: 0.7,
      fill: { color: COLORS.lightBlue },
      rectRadius: 0.1,
    });
    slide.addText(
      `Base case (${medianCase.exit_multiple}x):  IRR ${irrStr}  |  MoM ${momStr}`,
      {
        x: 0.7, y: 5.85, w: SLIDE_WIDTH - 1.4, h: 0.6,
        fontSize: 13, bold: true, color: COLORS.navy,
        fontFace: "Calibri",
        align: "center",
        valign: "middle",
      },
    );
  }

  addSlideFooter(slide, 7, 8);
}
