/**
 * Slide 3 — Pro Forma P&L
 *
 * Clustered bar chart for Revenue + EBITDA, plus a compact margin table.
 */
import type PptxGenJS from "pptxgenjs";
import type { ExportData } from "../../excelExport/types.js";
import {
  COLORS, addSlideTitle, addSlideFooter,
  TABLE_HEADER, TABLE_CELL, TABLE_CELL_RIGHT, TABLE_TOTAL_ROW,
  fmtNum, fmtPct, SLIDE_WIDTH,
} from "../styles.js";

export function buildProFormaSlide(pres: PptxGenJS, data: ExportData): void {
  const slide = pres.addSlide();
  addSlideTitle(slide, "Pro Forma P&L", "Kombinert — omsetning, EBITDA, marginer og FCF");

  const pf = data.proFormaPeriods;
  if (!pf.length) {
    slide.addText("Ingen pro forma data tilgjengelig", {
      x: 1, y: 3, w: SLIDE_WIDTH - 2, h: 1,
      fontSize: 14, color: COLORS.darkGray, align: "center",
    });
    addSlideFooter(slide, 3, 8);
    return;
  }

  const labels = pf.map((p: any) => p.period_label || String(p.year));
  const revenueData = pf.map((p: any) => (p.total_revenue ?? p.revenue ?? 0) / 1);
  const ebitdaData = pf.map((p: any) => (p.ebitda ?? p.ebitda_excl_synergies ?? 0) / 1);

  // --- Bar chart: Revenue & EBITDA ---
  slide.addChart(pres.ChartType.bar, [
    { name: "Omsetning", labels, values: revenueData },
    { name: "EBITDA", labels, values: ebitdaData },
  ], {
    x: 0.5, y: 1.1, w: 7.5, h: 4.5,
    showTitle: false,
    showLegend: true,
    legendPos: "b",
    legendFontSize: 9,
    catAxisLabelFontSize: 8,
    valAxisLabelFontSize: 8,
    chartColors: [COLORS.chart1, COLORS.chart2],
    valAxisLabelFormatCode: "#,##0",
    barGrouping: "clustered",
    barGapWidthPct: 80,
  });

  // --- Right side: Margin table ---
  const tableRows: any[][] = [
    [
      { text: "År", options: TABLE_HEADER },
      { text: "Oms.", options: TABLE_HEADER },
      { text: "EBITDA", options: TABLE_HEADER },
      { text: "Margin", options: TABLE_HEADER },
    ],
  ];

  for (const p of pf) {
    const rev = (p as any).total_revenue ?? (p as any).revenue ?? 0;
    const ebitda = (p as any).ebitda ?? (p as any).ebitda_excl_synergies ?? 0;
    const margin = rev > 0 ? ebitda / rev : 0;
    const label = (p as any).period_label || String((p as any).year);
    tableRows.push([
      { text: label, options: TABLE_CELL },
      { text: fmtNum(rev), options: TABLE_CELL_RIGHT },
      { text: fmtNum(ebitda), options: TABLE_CELL_RIGHT },
      { text: fmtPct(margin), options: TABLE_CELL_RIGHT },
    ]);
  }

  slide.addTable(tableRows, {
    x: 8.5, y: 1.1, w: 4.5,
    colW: [0.8, 1.2, 1.2, 1.0],
    rowH: 0.28,
    border: { type: "solid", pt: 0.5, color: COLORS.medGray },
  });

  addSlideFooter(slide, 3, 8);
}
