/**
 * Slide 4 — Sources & Uses / Capital Structure
 *
 * Side-by-side S&U tables + EV composition donut chart.
 */
import PptxGenJS from "pptxgenjs";
import type { ExportData } from "../../excelExport/types.js";
import {
  COLORS, addSlideTitle, addSlideFooter,
  TABLE_HEADER, TABLE_CELL, TABLE_CELL_RIGHT, TABLE_TOTAL_ROW,
  fmtNum,
} from "../styles.js";

export function buildSourcesUsesSlide(pres: PptxGenJS, data: ExportData): void {
  const slide = pres.addSlide();
  addSlideTitle(slide, "Sources & Uses", "Finansieringsstruktur og kapitalsammensetning");

  // --- Sources table ---
  const srcRows: any[][] = [
    [
      { text: "Sources (Kilder)", options: TABLE_HEADER },
      { text: "NOKm", options: TABLE_HEADER },
    ],
  ];
  let srcTotal = 0;
  for (const s of data.sources) {
    srcTotal += s.amount || 0;
    srcRows.push([
      { text: s.name, options: TABLE_CELL },
      { text: fmtNum(s.amount), options: TABLE_CELL_RIGHT },
    ]);
  }
  srcRows.push([
    { text: "Total Sources", options: TABLE_TOTAL_ROW },
    { text: fmtNum(srcTotal), options: { ...TABLE_TOTAL_ROW, align: "right" as const } },
  ]);

  slide.addTable(srcRows, {
    x: 0.5, y: 1.1, w: 4.0,
    colW: [2.5, 1.5],
    rowH: 0.3,
    border: { type: "solid", pt: 0.5, color: COLORS.medGray },
  });

  // --- Uses table ---
  const usesRows: any[][] = [
    [
      { text: "Uses (Anvendelser)", options: TABLE_HEADER },
      { text: "NOKm", options: TABLE_HEADER },
    ],
  ];
  let usesTotal = 0;
  for (const u of data.uses) {
    usesTotal += u.amount || 0;
    usesRows.push([
      { text: u.name, options: TABLE_CELL },
      { text: fmtNum(u.amount), options: TABLE_CELL_RIGHT },
    ]);
  }
  usesRows.push([
    { text: "Total Uses", options: TABLE_TOTAL_ROW },
    { text: fmtNum(usesTotal), options: { ...TABLE_TOTAL_ROW, align: "right" as const } },
  ]);

  slide.addTable(usesRows, {
    x: 4.8, y: 1.1, w: 4.0,
    colW: [2.5, 1.5],
    rowH: 0.3,
    border: { type: "solid", pt: 0.5, color: COLORS.medGray },
  });

  // --- Right side: EV composition donut ---
  const oe = Math.max(data.ordinaryEquity, 0);
  const pe = Math.max(data.preferredEquity, 0);
  const nd = Math.max(data.netDebt, 0);
  const donutTotal = oe + pe + nd;

  if (donutTotal > 0) {
    slide.addChart(pres.ChartType.doughnut, [
      {
        name: "EV",
        labels: ["Ordinær EK", "Preferanse EK", "Netto gjeld"],
        values: [oe, pe, nd],
      },
    ], {
      x: 9.2, y: 1.1, w: 3.8, h: 3.8,
      showTitle: true,
      title: "EV Sammensetning",
      titleFontSize: 11,
      titleColor: COLORS.navy,
      showLegend: true,
      legendPos: "b",
      legendFontSize: 8,
      chartColors: [COLORS.chart1, COLORS.chart2, COLORS.chart3],
      dataLabelPosition: "outEnd",
      showPercent: true,
      dataLabelFontSize: 8,
    });
  }

  // Balance check
  const diff = srcTotal - usesTotal;
  if (Math.abs(diff) > 0.5) {
    slide.addText(`⚠ Differanse: ${fmtNum(diff)} NOKm`, {
      x: 0.5, y: 6.0, w: 4.0, h: 0.3,
      fontSize: 9, color: COLORS.red, bold: true,
    });
  }

  addSlideFooter(slide, 4, 8);
}
