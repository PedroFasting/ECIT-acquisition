/**
 * Slide 6 — Equity Bridge
 *
 * EV → NIBD → Option Debt → EQV → PE → Ordinary Equity, per exit multiple.
 * Shows the step-by-step waterfall from enterprise value to per-share value.
 */
import PptxGenJS from "pptxgenjs";
import type { ExportData } from "../../excelExport/types.js";
import {
  COLORS, addSlideTitle, addSlideFooter,
  TABLE_HEADER, TABLE_CELL, TABLE_CELL_RIGHT, TABLE_TOTAL_ROW,
  fmtNum, fmtMult, SLIDE_WIDTH,
} from "../styles.js";

export function buildEquityBridgeSlide(pres: PptxGenJS, data: ExportData): void {
  const slide = pres.addSlide();
  addSlideTitle(slide, "Equity Bridge", "EV → EQV → Per aksje (ved exit)");

  const cr = data.calculatedReturns;
  const cases = cr.cases.filter(c => c.return_case === "Kombinert");

  if (!cases.length) {
    slide.addText("Ingen Kombinert-beregning tilgjengelig", {
      x: 1, y: 3, w: SLIDE_WIDTH - 2, h: 1,
      fontSize: 14, color: COLORS.darkGray, align: "center",
    });
    addSlideFooter(slide, 6, 8);
    return;
  }

  // Use share_summary for dilution info
  const ss = cr.share_summary;

  // Build equity bridge table across exit multiples
  const dp = data.dealParams;

  // Get last-year EBITDA from pro forma
  const lastPF = data.proFormaPeriods[data.proFormaPeriods.length - 1];
  const exitEbitda = lastPF ? ((lastPF as any).ebitda ?? (lastPF as any).ebitda_excl_synergies ?? 0) : 0;

  // Entry column
  const entryEV = (dp.acquirer_entry_ev ?? 0) + dp.price_paid;

  // Table header
  const headerRow: any[] = [
    { text: "", options: TABLE_HEADER },
    { text: "Inngang", options: TABLE_HEADER },
  ];
  for (const c of cases) {
    headerRow.push({ text: `${c.exit_multiple}x`, options: TABLE_HEADER });
  }

  const rows: any[][] = [headerRow];

  // Exit EBITDA row
  const ebitdaRow: any[] = [
    { text: "Exit EBITDA", options: TABLE_CELL },
    { text: "–", options: TABLE_CELL_RIGHT },
  ];
  for (const _c of cases) {
    ebitdaRow.push({ text: fmtNum(exitEbitda), options: TABLE_CELL_RIGHT });
  }
  rows.push(ebitdaRow);

  // Exit EV row
  const evRow: any[] = [
    { text: "Enterprise Value", options: { ...TABLE_CELL, bold: true } },
    { text: fmtNum(entryEV), options: { ...TABLE_CELL_RIGHT, bold: true } },
  ];
  for (const c of cases) {
    evRow.push({ text: fmtNum(exitEbitda * c.exit_multiple), options: { ...TABLE_CELL_RIGHT, bold: true } });
  }
  rows.push(evRow);

  // NIBD row (from debt schedule last year, or static)
  const nibdRow: any[] = [
    { text: "(-) NIBD", options: TABLE_CELL },
    { text: fmtNum(data.netDebt), options: TABLE_CELL_RIGHT },
  ];
  for (const _c of cases) {
    // Use exit NIBD from share_summary if available
    nibdRow.push({ text: "–", options: TABLE_CELL_RIGHT });
  }
  rows.push(nibdRow);

  // EQV row
  const eqvRow: any[] = [
    { text: "Equity Value (EQV)", options: { ...TABLE_CELL, bold: true, fill: { color: COLORS.lightBlue } } },
    { text: "–", options: { ...TABLE_CELL_RIGHT, bold: true, fill: { color: COLORS.lightBlue } } },
  ];
  for (const c of cases) {
    const eqv = ss?.exit_eqv_gross ?? (exitEbitda * c.exit_multiple - data.netDebt);
    eqvRow.push({ text: fmtNum(eqv), options: { ...TABLE_CELL_RIGHT, bold: true, fill: { color: COLORS.lightBlue } } });
  }
  rows.push(eqvRow);

  // Preferred equity row
  const peRow: any[] = [
    { text: "(-) Preferanse EK", options: TABLE_CELL },
    { text: fmtNum(data.preferredEquity), options: TABLE_CELL_RIGHT },
  ];
  for (const _c of cases) {
    peRow.push({ text: "–", options: TABLE_CELL_RIGHT });
  }
  rows.push(peRow);

  // Per-share metrics if available
  if (ss && ss.entry_price_per_share > 0) {
    const ppsEntryRow: any[] = [
      { text: "PPS (inngang)", options: TABLE_CELL },
      { text: `NOK ${fmtNum(ss.entry_price_per_share, 1)}`, options: TABLE_CELL_RIGHT },
    ];
    for (const c of cases) {
      const exitPps = c.per_share_exit ?? 0;
      ppsEntryRow.push({ text: `NOK ${fmtNum(exitPps, 1)}`, options: TABLE_CELL_RIGHT });
    }
    rows.push(ppsEntryRow);

    const momRow: any[] = [
      { text: "MoM (per aksje)", options: { ...TABLE_CELL, bold: true } },
      { text: "–", options: TABLE_CELL_RIGHT },
    ];
    for (const c of cases) {
      const mom = c.per_share_mom ?? c.mom ?? 0;
      momRow.push({ text: fmtMult(mom), options: { ...TABLE_CELL_RIGHT, bold: true } });
    }
    rows.push(momRow);
  }

  // Compute column widths
  const labelW = 2.2;
  const dataW = 1.5;
  const colWidths = [labelW, dataW, ...cases.map(() => dataW)];
  const totalW = colWidths.reduce((s, w) => s + w, 0);

  slide.addTable(rows, {
    x: 0.5, y: 1.1, w: Math.min(totalW, SLIDE_WIDTH - 1),
    colW: colWidths,
    rowH: 0.32,
    border: { type: "solid", pt: 0.5, color: COLORS.medGray },
  });

  addSlideFooter(slide, 6, 8);
}
