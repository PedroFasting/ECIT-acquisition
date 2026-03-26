/**
 * Slide 2 — Transaction Overview
 *
 * Key deal parameters table + entry EV summary.
 */
import PptxGenJS from "pptxgenjs";
import type { ExportData } from "../../excelExport/types.js";
import {
  COLORS, addSlideTitle, addSlideFooter,
  TABLE_HEADER, TABLE_CELL, TABLE_CELL_RIGHT,
  fmtNum, fmtPct, fmtMult, BODY_OPTS,
} from "../styles.js";

export function buildTransactionOverviewSlide(pres: PptxGenJS, data: ExportData): void {
  const slide = pres.addSlide();
  addSlideTitle(slide, "Transaction Overview", `${data.acquirerName} + ${data.targetName}`);

  const dp = data.dealParams;

  // --- Left side: Deal parameters table ---
  const paramRows: any[][] = [
    [
      { text: "Parameter", options: TABLE_HEADER },
      { text: "Verdi", options: TABLE_HEADER },
    ],
    [
      { text: "Pris betalt (EV)", options: TABLE_CELL },
      { text: `${fmtNum(dp.price_paid)} NOKm`, options: TABLE_CELL_RIGHT },
    ],
    [
      { text: "Oppkjøper Entry EV", options: TABLE_CELL },
      { text: `${fmtNum(dp.acquirer_entry_ev ?? 0)} NOKm`, options: TABLE_CELL_RIGHT },
    ],
    [
      { text: "Skattesats", options: TABLE_CELL },
      { text: fmtPct(dp.tax_rate), options: TABLE_CELL_RIGHT },
    ],
    [
      { text: "D&A % av omsetning", options: TABLE_CELL },
      { text: fmtPct(dp.da_pct_revenue ?? 0.01), options: TABLE_CELL_RIGHT },
    ],
    [
      { text: "Capex % av omsetning", options: TABLE_CELL },
      { text: fmtPct(dp.capex_pct_revenue ?? 0.01), options: TABLE_CELL_RIGHT },
    ],
  ];

  // Add Level 2 params if present
  if (dp.ordinary_equity) {
    paramRows.push([
      { text: "Ordinær egenkapital", options: TABLE_CELL },
      { text: `${fmtNum(dp.ordinary_equity)} NOKm`, options: TABLE_CELL_RIGHT },
    ]);
  }
  if (dp.net_debt) {
    paramRows.push([
      { text: "Netto gjeld", options: TABLE_CELL },
      { text: `${fmtNum(dp.net_debt)} NOKm`, options: TABLE_CELL_RIGHT },
    ]);
  }
  if (dp.interest_rate) {
    paramRows.push([
      { text: "Rente", options: TABLE_CELL },
      { text: fmtPct(dp.interest_rate), options: TABLE_CELL_RIGHT },
    ]);
  }
  if (dp.debt_amortisation) {
    paramRows.push([
      { text: "Årlig amort.", options: TABLE_CELL },
      { text: `${fmtNum(dp.debt_amortisation)} NOKm`, options: TABLE_CELL_RIGHT },
    ]);
  }
  if (dp.cash_sweep_pct) {
    paramRows.push([
      { text: "Cash Sweep", options: TABLE_CELL },
      { text: fmtPct(dp.cash_sweep_pct), options: TABLE_CELL_RIGHT },
    ]);
  }

  slide.addTable(paramRows, {
    x: 0.5, y: 1.1, w: 5.5,
    colW: [3.5, 2.0],
    rowH: 0.32,
    border: { type: "solid", pt: 0.5, color: COLORS.medGray },
  });

  // --- Right side: Capital structure summary ---
  const totalSources = data.sources.reduce((s, r) => s + (r.amount || 0), 0);
  const totalUses = data.uses.reduce((s, r) => s + (r.amount || 0), 0);

  const capRows: any[][] = [
    [
      { text: "Kapitalstruktur", options: TABLE_HEADER },
      { text: "NOKm", options: TABLE_HEADER },
    ],
    [
      { text: "Ordinær egenkapital (PF)", options: TABLE_CELL },
      { text: fmtNum(data.ordinaryEquity), options: TABLE_CELL_RIGHT },
    ],
    [
      { text: "Preferansekapital (PF)", options: TABLE_CELL },
      { text: fmtNum(data.preferredEquity), options: TABLE_CELL_RIGHT },
    ],
    [
      { text: "Netto gjeld (PF)", options: TABLE_CELL },
      { text: fmtNum(data.netDebt), options: TABLE_CELL_RIGHT },
    ],
    [
      { text: "Enterprise Value", options: { ...TABLE_CELL, bold: true, fill: { color: COLORS.lightBlue } } },
      { text: fmtNum(data.ordinaryEquity + data.preferredEquity + data.netDebt), options: { ...TABLE_CELL_RIGHT, bold: true, fill: { color: COLORS.lightBlue } } },
    ],
  ];

  slide.addTable(capRows, {
    x: 6.8, y: 1.1, w: 6.0,
    colW: [3.8, 2.2],
    rowH: 0.32,
    border: { type: "solid", pt: 0.5, color: COLORS.medGray },
  });

  // Exit multiples
  const multStr = (dp.exit_multiples || []).map(m => `${m}x`).join(", ");
  slide.addText(`Exit multipler: ${multStr}`, {
    x: 6.8, y: 3.1, w: 6.0, h: 0.3,
    ...BODY_OPTS,
    bold: true,
  });

  // Returns level indicator
  const cr = data.calculatedReturns;
  slide.addText(`Beregningsnivå: ${cr.level_label}`, {
    x: 6.8, y: 3.5, w: 6.0, h: 0.3,
    ...BODY_OPTS,
    italic: true,
  });

  addSlideFooter(slide, 2, 8);
}
