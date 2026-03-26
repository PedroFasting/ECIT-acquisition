/**
 * Slide 5 — Leverage & Debt Profile
 *
 * Stacked bars for debt composition + line for leverage ratio.
 */
import type PptxGenJS from "pptxgenjs";
import type { ExportData } from "../../excelExport/types.js";
import type { DebtScheduleRow } from "../../dealReturns.js";
import {
  COLORS, addSlideTitle, addSlideFooter,
  TABLE_HEADER, TABLE_CELL, TABLE_CELL_RIGHT, TABLE_TOTAL_ROW,
  fmtNum, fmtMult, SLIDE_WIDTH,
} from "../styles.js";

export function buildDebtProfileSlide(pres: PptxGenJS, data: ExportData): void {
  const slide = pres.addSlide();
  addSlideTitle(slide, "Gjeldsplan & Leverage", "Nedbetaling, renter og gearing over tid");

  const ds: DebtScheduleRow[] = data.calculatedReturns.debt_schedule ?? [];

  if (!ds.length) {
    slide.addText("Ingen gjeldsplan tilgjengelig (krever Level 2 beregning)", {
      x: 1, y: 3, w: SLIDE_WIDTH - 2, h: 1,
      fontSize: 14, color: COLORS.darkGray, align: "center",
    });
    addSlideFooter(slide, 5, 8);
    return;
  }

  const labels = ds.map(r => r.period_label);
  const closingDebt = ds.map(r => r.closing_debt);
  const closingPref = ds.map(r => r.closing_pref);
  const leverageVals = ds.map(r => r.leverage ?? 0);

  // --- Combo chart: stacked bars (debt + pref) + line (leverage) ---
  // PptxGenJS doesn't support true combo charts, so we use bars for debt and a separate table for leverage

  slide.addChart(pres.ChartType.bar, [
    { name: "Senior gjeld", labels, values: closingDebt },
    { name: "Preferanse EK", labels, values: closingPref },
  ], {
    x: 0.5, y: 1.1, w: 8.0, h: 4.8,
    showTitle: false,
    showLegend: true,
    legendPos: "b",
    legendFontSize: 9,
    catAxisLabelFontSize: 8,
    valAxisLabelFontSize: 8,
    chartColors: [COLORS.chart3, COLORS.chart2],
    valAxisLabelFormatCode: "#,##0",
    barGrouping: "stacked",
    barGapWidthPct: 60,
  });

  // --- Right side: Debt metrics table ---
  const metricRows: any[][] = [
    [
      { text: "År", options: TABLE_HEADER },
      { text: "Gjeld", options: TABLE_HEADER },
      { text: "Rente", options: TABLE_HEADER },
      { text: "Amort.", options: TABLE_HEADER },
      { text: "Leverage", options: TABLE_HEADER },
    ],
  ];

  for (const r of ds) {
    metricRows.push([
      { text: r.period_label, options: TABLE_CELL },
      { text: fmtNum(r.closing_debt), options: TABLE_CELL_RIGHT },
      { text: fmtNum(r.interest), options: TABLE_CELL_RIGHT },
      { text: fmtNum(r.mandatory_amort + r.sweep), options: TABLE_CELL_RIGHT },
      { text: fmtMult(r.leverage), options: TABLE_CELL_RIGHT },
    ]);
  }

  slide.addTable(metricRows, {
    x: 8.8, y: 1.1, w: 4.2,
    colW: [0.8, 0.9, 0.8, 0.8, 0.9],
    rowH: 0.28,
    border: { type: "solid", pt: 0.5, color: COLORS.medGray },
  });

  addSlideFooter(slide, 5, 8);
}
