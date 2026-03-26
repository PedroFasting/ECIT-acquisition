/**
 * Slide 8 — Sensitivity
 *
 * Compact heatmap grid across exit multiples, showing IRR/MoM
 * with color coding. Also shows synergies timeline if available.
 */
import type PptxGenJS from "pptxgenjs";
import type { ExportData } from "../../excelExport/types.js";
import {
  COLORS, addSlideTitle, addSlideFooter,
  TABLE_HEADER, TABLE_CELL, TABLE_CELL_RIGHT, TABLE_TOTAL_ROW,
  fmtNum, fmtPct, fmtMult, irrColor, momColor,
  SLIDE_WIDTH, BODY_OPTS,
} from "../styles.js";

export function buildSensitivitySlide(pres: PptxGenJS, data: ExportData): void {
  const slide = pres.addSlide();
  addSlideTitle(slide, "Sensitivitet & Synergier", "Avkastning ved ulike multipler + synergiprofil");

  const cr = data.calculatedReturns;
  const combinedCases = cr.cases.filter(c => c.return_case === "Kombinert");

  // --- Left: IRR/MoM heatmap ---
  if (combinedCases.length) {
    slide.addText("Kombinert IRR & MoM", {
      x: 0.5, y: 1.05, w: 6.5, h: 0.3,
      fontSize: 12, bold: true, color: COLORS.navy, fontFace: "Calibri",
    });

    const heatRows: any[][] = [
      [
        { text: "Exit Multiple", options: TABLE_HEADER },
        { text: "IRR", options: TABLE_HEADER },
        { text: "MoM", options: TABLE_HEADER },
        { text: "Per-aksje IRR", options: TABLE_HEADER },
        { text: "Per-aksje MoM", options: TABLE_HEADER },
      ],
    ];

    for (const c of combinedCases) {
      heatRows.push([
        { text: `${c.exit_multiple}x`, options: { ...TABLE_CELL_RIGHT, bold: true } },
        {
          text: fmtPct(c.irr),
          options: {
            ...TABLE_CELL_RIGHT,
            color: COLORS.white,
            fill: { color: irrColor(c.irr) },
            bold: true,
          },
        },
        {
          text: fmtMult(c.mom),
          options: {
            ...TABLE_CELL_RIGHT,
            color: COLORS.white,
            fill: { color: momColor(c.mom) },
            bold: true,
          },
        },
        {
          text: c.per_share_irr != null ? fmtPct(c.per_share_irr) : "–",
          options: {
            ...TABLE_CELL_RIGHT,
            color: c.per_share_irr != null ? COLORS.white : COLORS.darkGray,
            fill: c.per_share_irr != null ? { color: irrColor(c.per_share_irr) } : undefined,
            bold: true,
          },
        },
        {
          text: c.per_share_mom != null ? fmtMult(c.per_share_mom) : "–",
          options: {
            ...TABLE_CELL_RIGHT,
            color: c.per_share_mom != null ? COLORS.white : COLORS.darkGray,
            fill: c.per_share_mom != null ? { color: momColor(c.per_share_mom) } : undefined,
            bold: true,
          },
        },
      ]);
    }

    slide.addTable(heatRows, {
      x: 0.5, y: 1.4, w: 6.5,
      colW: [1.2, 1.2, 1.2, 1.5, 1.4],
      rowH: 0.38,
      border: { type: "solid", pt: 0.5, color: COLORS.medGray },
    });
  }

  // --- Right: Synergies timeline ---
  const syn = data.synergiesTimeline || {};
  const synYears = Object.keys(syn).sort();

  if (synYears.length > 0) {
    slide.addText("Kostnadssynergier (NOKm)", {
      x: 7.5, y: 1.05, w: 5.5, h: 0.3,
      fontSize: 12, bold: true, color: COLORS.navy, fontFace: "Calibri",
    });

    const synLabels = synYears;
    const synValues = synYears.map(y => syn[y] || 0);

    slide.addChart(pres.ChartType.bar, [
      { name: "Synergier", labels: synLabels, values: synValues },
    ], {
      x: 7.5, y: 1.4, w: 5.3, h: 3.5,
      showTitle: false,
      showLegend: false,
      catAxisLabelFontSize: 8,
      valAxisLabelFontSize: 8,
      chartColors: [COLORS.chart2],
      valAxisLabelFormatCode: "#,##0",
      barGapWidthPct: 60,
    });

    // Total synergies
    const totalSyn = synValues.reduce((a, b) => a + b, 0);
    slide.addText(`Total synergier: ${fmtNum(totalSyn)} NOKm`, {
      x: 7.5, y: 5.0, w: 5.3, h: 0.3,
      ...BODY_OPTS,
      bold: true,
    });
  }

  // --- Bottom: Standalone comparison ---
  const sa = cr.standalone_by_multiple || {};
  const saKeys = Object.keys(sa).map(Number).sort((a, b) => a - b);
  if (saKeys.length > 0 && combinedCases.length > 0) {
    slide.addText("Sammenligning: Standalone vs. Kombinert", {
      x: 0.5, y: 5.3, w: 6.5, h: 0.3,
      fontSize: 10, bold: true, color: COLORS.navy, fontFace: "Calibri",
    });

    const compRows: any[][] = [
      [
        { text: "Multiple", options: TABLE_HEADER },
        { text: "SA IRR", options: TABLE_HEADER },
        { text: "Komb IRR", options: TABLE_HEADER },
        { text: "Δ IRR", options: TABLE_HEADER },
      ],
    ];

    for (const c of combinedCases) {
      const saData = sa[c.exit_multiple];
      const saIrr = saData?.irr ?? null;
      const kombIrr = c.irr;
      const delta = (saIrr != null && kombIrr != null) ? kombIrr - saIrr : null;
      compRows.push([
        { text: `${c.exit_multiple}x`, options: { ...TABLE_CELL_RIGHT, bold: true } },
        { text: fmtPct(saIrr), options: TABLE_CELL_RIGHT },
        { text: fmtPct(kombIrr), options: TABLE_CELL_RIGHT },
        {
          text: delta != null ? `+${fmtPct(delta)}` : "–",
          options: {
            ...TABLE_CELL_RIGHT,
            color: delta != null && delta > 0 ? COLORS.green : COLORS.darkGray,
            bold: true,
          },
        },
      ]);
    }

    slide.addTable(compRows, {
      x: 0.5, y: 5.65, w: 6.0,
      colW: [1.2, 1.5, 1.5, 1.8],
      rowH: 0.28,
      border: { type: "solid", pt: 0.5, color: COLORS.medGray },
    });
  }

  addSlideFooter(slide, 8, 8);
}
