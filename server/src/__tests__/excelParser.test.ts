/**
 * Comprehensive unit tests for the Excel parser module.
 *
 * Tests cover:
 * - Label mapping (bilingual, context-dependent)
 * - Sheet-type detection
 * - Multi-sheet merge logic
 * - Block parsing
 * - End-to-end parsing with in-memory Excel files
 */

import { describe, it, expect } from "vitest";
import ExcelJS from "exceljs";
import { mapLabelToField, normalizeLabel, type ParseContext } from "../services/excelParser/labelMapping.js";
import { detectSheetType, mergeMultiSheetModels } from "../services/excelParser/sheetMerge.js";
import { createEmptyPeriod, parseBlock } from "../services/excelParser/blockParser.js";
import { findYearHeader, findLabelColumn, findNameBlocks, findSectionBlocks } from "../services/excelParser/sheetDetection.js";
import { parseExcelBuffer } from "../services/excelParser/parseExcelBuffer.js";
import type { ParsedModelBlock, PeriodYear, SheetType } from "../services/excelParser/types.js";

// ─── Helpers ──────────────────────────────────────────────

/** Create an in-memory Excel workbook and return its buffer */
async function createWorkbookBuffer(
  sheets: { name: string; rows: (string | number | null)[][] }[]
): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  for (const sheet of sheets) {
    const ws = wb.addWorksheet(sheet.name);
    for (const row of sheet.rows) {
      ws.addRow(row);
    }
  }
  const arrayBuffer = await wb.xlsx.writeBuffer();
  return Buffer.from(arrayBuffer);
}

// ─── Label Mapping Tests ──────────────────────────────────

describe("normalizeLabel", () => {
  it("lowercases and trims", () => {
    expect(normalizeLabel("  Revenue  ")).toBe("revenue");
  });

  it("collapses whitespace", () => {
    expect(normalizeLabel("Total   revenue")).toBe("total revenue");
  });

  it("removes trailing punctuation", () => {
    expect(normalizeLabel("EBITDA:")).toBe("ebitda");
    expect(normalizeLabel("Revenue.")).toBe("revenue");
  });

  it("removes regular quotes", () => {
    // normalizeLabel removes regular single/double quotes (not Unicode smart quotes)
    expect(normalizeLabel('"Revenue"')).toBe("revenue");
    expect(normalizeLabel("'EBITDA'")).toBe("ebitda");
  });
});

describe("mapLabelToField", () => {
  // ── Revenue labels ──
  it("maps English revenue labels", () => {
    expect(mapLabelToField("Revenue")).toBe("revenue_total");
    expect(mapLabelToField("Total revenue")).toBe("revenue_total");
    expect(mapLabelToField("Turnover")).toBe("revenue_total");
    expect(mapLabelToField("Net revenue")).toBe("revenue_total");
  });

  it("maps Norwegian revenue labels", () => {
    expect(mapLabelToField("Omsetning")).toBe("revenue_total");
    expect(mapLabelToField("Total omsetning")).toBe("revenue_total");
    expect(mapLabelToField("Driftsinntekter")).toBe("revenue_total");
    expect(mapLabelToField("Totale driftsinntekter")).toBe("revenue_total");
    expect(mapLabelToField("Netto omsetning")).toBe("revenue_total");
    expect(mapLabelToField("Salgsinntekter")).toBe("revenue_total");
  });

  // ── Revenue subcategories ──
  it("maps ECIT service line labels", () => {
    expect(mapLabelToField("A&P")).toBe("revenue_managed_services");
    expect(mapLabelToField("Advisory")).toBe("revenue_professional_services");
    expect(mapLabelToField("Licenses")).toBe("revenue_other");
  });

  it("maps managed/professional services labels", () => {
    expect(mapLabelToField("Managed services revenue")).toBe("revenue_managed_services");
    expect(mapLabelToField("Professional services")).toBe("revenue_professional_services");
  });

  // ── EBITDA labels ──
  it("maps EBITDA labels", () => {
    expect(mapLabelToField("EBITDA")).toBe("ebitda_total");
    expect(mapLabelToField("Total EBITDA")).toBe("ebitda_total");
    expect(mapLabelToField("EBITDA (pre IFRS)")).toBe("ebitda_total");
    expect(mapLabelToField("Driftsresultat")).toBe("ebitda_total");
  });

  it("maps EBITDA margin labels", () => {
    expect(mapLabelToField("EBITDA %")).toBe("ebitda_margin");
    expect(mapLabelToField("EBITDA margin")).toBe("ebitda_margin");
    expect(mapLabelToField("EBITDA-margin")).toBe("ebitda_margin");
    // "% margin" without context returns null (needs ParseContext)
    expect(mapLabelToField("% margin")).toBeNull();
  });

  // ── Cash flow labels ──
  it("maps cash flow labels", () => {
    expect(mapLabelToField("Capex")).toBe("capex");
    expect(mapLabelToField("Investeringer")).toBe("capex");
    expect(mapLabelToField("Investments")).toBe("capex");
  });

  it("maps NWC labels including NWC effect", () => {
    expect(mapLabelToField("Change in NWC")).toBe("change_nwc");
    expect(mapLabelToField("NWC")).toBe("change_nwc");
    expect(mapLabelToField("NWC effect")).toBe("change_nwc");
    expect(mapLabelToField("Endring arbeidskapital")).toBe("change_nwc");
    expect(mapLabelToField("Working capital change")).toBe("change_nwc");
  });

  it("maps tax labels", () => {
    expect(mapLabelToField("Tax")).toBe("tax");
    expect(mapLabelToField("Skatt")).toBe("tax");
    expect(mapLabelToField("Income tax")).toBe("tax");
    expect(mapLabelToField("Tax expense")).toBe("tax");
  });

  it("maps net cashflow labels", () => {
    expect(mapLabelToField("Cashflow net")).toBe("net_cashflow");
    expect(mapLabelToField("Netto kontantstrøm")).toBe("net_cashflow");
  });

  it("maps FCF / free cashflow labels", () => {
    expect(mapLabelToField("Free cashflow")).toBe("operating_fcf");
    expect(mapLabelToField("Operating FCF")).toBe("operating_fcf");
    expect(mapLabelToField("Op. FCF")).toBe("operating_fcf");
    expect(mapLabelToField("Total FCF")).toBe("operating_fcf");
    expect(mapLabelToField("Fri kontantstrøm")).toBe("operating_fcf");
  });

  // ── Equity bridge ──
  it("maps equity bridge labels", () => {
    expect(mapLabelToField("Number of shares")).toBe("share_count");
    expect(mapLabelToField("Antall aksjer")).toBe("share_count");
    expect(mapLabelToField("NIBD")).toBe("nibd");
    expect(mapLabelToField("NIBD (incl various)")).toBe("nibd");
    expect(mapLabelToField("Netto rentebærende gjeld")).toBe("nibd");
    expect(mapLabelToField("EV")).toBe("enterprise_value");
    expect(mapLabelToField("Enterprise value")).toBe("enterprise_value");
    expect(mapLabelToField("EQV")).toBe("equity_value");
    expect(mapLabelToField("Equity value")).toBe("equity_value");
    expect(mapLabelToField("Option debt")).toBe("option_debt");
    expect(mapLabelToField("Adjustments")).toBe("adjustments");
    expect(mapLabelToField("Pref")).toBe("preferred_equity");
    expect(mapLabelToField("MIP")).toBe("mip_amount");
    expect(mapLabelToField("TSO")).toBe("tso_amount");
    expect(mapLabelToField("Existing warrants")).toBe("warrants_amount");
  });

  it("maps per-share labels", () => {
    expect(mapLabelToField("Per share (before MIP &TSO)")).toBe("per_share_pre");
    expect(mapLabelToField("Per share  (post MIP, TSO, ExW")).toBe("per_share_post");
  });

  it("maps dilution labels", () => {
    expect(mapLabelToField("EQV (post MIP, TSO, ExW)")).toBe("eqv_post_dilution");
  });

  // ── Growth ──
  it("maps growth labels", () => {
    expect(mapLabelToField("Organic growth")).toBe("organic_growth");
    expect(mapLabelToField("Organisk vekst")).toBe("organic_growth");
    expect(mapLabelToField("Acquired revenue")).toBe("acquired_revenue");
  });

  // ── Unknown labels ──
  it("returns null for unknown labels", () => {
    expect(mapLabelToField("Something random")).toBeNull();
    expect(mapLabelToField("")).toBeNull();
    expect(mapLabelToField("Input")).toBeNull();
  });

  // ── Context-dependent labels ──
  it("resolves '% vekst' based on context", () => {
    const ctx: ParseContext = { lastSection: "revenue", lastField: "revenue_total" };
    expect(mapLabelToField("% vekst", ctx)).toBe("revenue_growth");

    ctx.lastSection = "ebitda";
    expect(mapLabelToField("% vekst", ctx)).toBeNull();
  });

  it("resolves '% margin' based on context", () => {
    const ctx: ParseContext = { lastSection: "ebitda", lastField: "ebitda_total" };
    expect(mapLabelToField("% margin", ctx)).toBe("ebitda_margin");

    ctx.lastField = "ebitda_managed_services";
    expect(mapLabelToField("% margin", ctx)).toBe("margin_managed_services");

    ctx.lastField = "ebitda_professional_services";
    expect(mapLabelToField("% margin", ctx)).toBe("margin_professional_services");
  });
});

// ─── Sheet Type Detection ─────────────────────────────────

describe("detectSheetType", () => {
  it("detects P&L sheets", () => {
    expect(detectSheetType("P&L")).toBe("pnl");
    expect(detectSheetType("Profit and Loss")).toBe("pnl");
    expect(detectSheetType("Income Statement")).toBe("pnl");
    expect(detectSheetType("Resultatregnskap")).toBe("pnl");
    expect(detectSheetType("Resultat")).toBe("pnl");
  });

  it("detects Balance sheets", () => {
    expect(detectSheetType("Balance Sheet")).toBe("balance");
    expect(detectSheetType("Balance")).toBe("balance");
    expect(detectSheetType("Balanse")).toBe("balance");
  });

  it("detects Cash Flow sheets", () => {
    expect(detectSheetType("Cash Flow")).toBe("cashflow");
    expect(detectSheetType("Cashflow")).toBe("cashflow");
    expect(detectSheetType("Kontantstrøm")).toBe("cashflow");
    expect(detectSheetType("CF Statement")).toBe("cashflow");
  });

  it("detects Equity sheets", () => {
    expect(detectSheetType("Equity Bridge")).toBe("equity");
    expect(detectSheetType("Equity Value")).toBe("equity");
    expect(detectSheetType("Egenkapital")).toBe("equity");
    expect(detectSheetType("Share Analysis")).toBe("equity");
  });

  it("detects DCF/Valuation sheets", () => {
    expect(detectSheetType("DCF")).toBe("dcf");
    expect(detectSheetType("Valuation")).toBe("dcf");
    expect(detectSheetType("Verdsettelse")).toBe("dcf");
  });

  it("returns unknown for generic names", () => {
    expect(detectSheetType("Ark1")).toBe("unknown");
    expect(detectSheetType("Sheet1")).toBe("unknown");
    expect(detectSheetType("Data")).toBe("unknown");
  });
});

// ─── Multi-Sheet Merge ────────────────────────────────────

describe("mergeMultiSheetModels", () => {
  function makePeriod(year: number, overrides: Partial<PeriodYear> = {}): PeriodYear {
    return { ...createEmptyPeriod(year), ...overrides };
  }

  function makeModel(name: string, sheetType: SheetType, periods: PeriodYear[]): ParsedModelBlock {
    return { name, periods, unmappedRows: [], source: `${name}:1-10`, sheetType };
  }

  it("returns single model unchanged", () => {
    const model = makeModel("Test", "pnl", [makePeriod(2025, { revenue_total: 100 })]);
    const warnings: string[] = [];
    const result = mergeMultiSheetModels([model], warnings);
    expect(result).toHaveLength(1);
    expect(result[0]).toBe(model);
  });

  it("merges P&L + Cash Flow sheets with overlapping years", () => {
    const pnl = makeModel("P&L", "pnl", [
      makePeriod(2025, { revenue_total: 500, ebitda_total: 60 }),
      makePeriod(2026, { revenue_total: 550, ebitda_total: 70 }),
    ]);
    const cf = makeModel("Cash Flow", "cashflow", [
      makePeriod(2025, { capex: 10, change_nwc: 5, tax: 15 }),
      makePeriod(2026, { capex: 12, change_nwc: 6, tax: 18 }),
    ]);

    const warnings: string[] = [];
    const result = mergeMultiSheetModels([pnl, cf], warnings);

    expect(result).toHaveLength(1);
    expect(result[0].periods).toHaveLength(2);

    const p2025 = result[0].periods.find((p) => p.year === 2025)!;
    expect(p2025.revenue_total).toBe(500);
    expect(p2025.ebitda_total).toBe(60);
    expect(p2025.capex).toBe(10);
    expect(p2025.change_nwc).toBe(5);
    expect(p2025.tax).toBe(15);

    expect(warnings.some((w) => w.includes("Slått sammen"))).toBe(true);
  });

  it("merges P&L + Balance + Cash Flow sheets", () => {
    const pnl = makeModel("P&L", "pnl", [
      makePeriod(2025, { revenue_total: 500, ebitda_total: 60 }),
    ]);
    const balance = makeModel("Balance", "balance", [
      makePeriod(2025, { nibd: 200, equity_value: 300 }),
    ]);
    const cf = makeModel("CF", "cashflow", [
      makePeriod(2025, { capex: 10, operating_fcf: 45 }),
    ]);

    const warnings: string[] = [];
    const result = mergeMultiSheetModels([pnl, balance, cf], warnings);

    expect(result).toHaveLength(1);
    const p = result[0].periods[0];
    expect(p.revenue_total).toBe(500);
    expect(p.nibd).toBe(200);
    expect(p.capex).toBe(10);
  });

  it("does NOT merge models with same sheet type (different scenarios)", () => {
    const m1 = makeModel("Base Case", "pnl", [
      makePeriod(2025, { revenue_total: 500 }),
    ]);
    const m2 = makeModel("Upside Case", "pnl", [
      makePeriod(2025, { revenue_total: 600 }),
    ]);

    const warnings: string[] = [];
    const result = mergeMultiSheetModels([m1, m2], warnings);

    expect(result).toHaveLength(2);
  });

  it("does NOT merge models with non-overlapping years", () => {
    const m1 = makeModel("Historical", "pnl", [
      makePeriod(2022, { revenue_total: 400 }),
      makePeriod(2023, { revenue_total: 450 }),
    ]);
    const m2 = makeModel("Forecast", "cashflow", [
      makePeriod(2025, { capex: 10 }),
      makePeriod(2026, { capex: 12 }),
    ]);

    const warnings: string[] = [];
    const result = mergeMultiSheetModels([m1, m2], warnings);

    expect(result).toHaveLength(2);
  });

  it("keeps all unknown-type models separate", () => {
    const m1 = makeModel("Sheet1", "unknown", [
      makePeriod(2025, { revenue_total: 500 }),
    ]);
    const m2 = makeModel("Sheet2", "unknown", [
      makePeriod(2025, { ebitda_total: 60 }),
    ]);

    const warnings: string[] = [];
    const result = mergeMultiSheetModels([m1, m2], warnings);

    expect(result).toHaveLength(2);
  });

  it("merges extra_data from different sheets", () => {
    const m1 = makeModel("P&L", "pnl", [
      makePeriod(2025, { revenue_total: 500, extra_data: { gross_profit: 300 } }),
    ]);
    const m2 = makeModel("CF", "cashflow", [
      makePeriod(2025, { capex: 10, extra_data: { depreciation: 20 } }),
    ]);

    const warnings: string[] = [];
    const result = mergeMultiSheetModels([m1, m2], warnings);

    expect(result).toHaveLength(1);
    expect(result[0].periods[0].extra_data).toEqual({
      gross_profit: 300,
      depreciation: 20,
    });
  });

  it("first value wins when both sheets have same field", () => {
    const m1 = makeModel("P&L", "pnl", [
      makePeriod(2025, { revenue_total: 500, ebitda_total: 60 }),
    ]);
    const m2 = makeModel("Summary", "cashflow", [
      makePeriod(2025, { revenue_total: 510, capex: 10 }),
    ]);

    const warnings: string[] = [];
    const result = mergeMultiSheetModels([m1, m2], warnings);

    expect(result).toHaveLength(1);
    // First model's revenue_total should win (already non-null)
    expect(result[0].periods[0].revenue_total).toBe(500);
    // Second model's capex should be added (was null in first)
    expect(result[0].periods[0].capex).toBe(10);
  });
});

// ─── Sheet Detection ──────────────────────────────────────

describe("findYearHeader", () => {
  it("finds year header row with numeric years", async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("Test");
    ws.addRow(["Label", 2025, 2026, 2027]);
    ws.addRow(["Revenue", 100, 110, 120]);

    const result = findYearHeader(ws, 1, 2);
    expect(result).not.toBeNull();
    expect(result!.headerRow).toBe(1);
    expect(result!.yearCols).toHaveLength(3);
    expect(result!.yearCols[0].year).toBe(2025);
  });

  it("finds year header with string years (FY2025, 2025E)", async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("Test");
    ws.addRow(["", "FY2025", "2026E", "2027F"]);
    ws.addRow(["Revenue", 100, 110, 120]);

    const result = findYearHeader(ws, 1, 2);
    expect(result).not.toBeNull();
    expect(result!.yearCols).toHaveLength(3);
    expect(result!.yearCols.map((yc) => yc.year)).toEqual([2025, 2026, 2027]);
  });

  it("returns null when no years found", async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("Test");
    ws.addRow(["Label", "A", "B", "C"]);

    const result = findYearHeader(ws, 1, 1);
    expect(result).toBeNull();
  });

  it("returns null when only 1 year (default minCols=2)", async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("Test");
    ws.addRow(["Label", 2025]);

    const result = findYearHeader(ws, 1, 1);
    expect(result).toBeNull();
  });

  it("finds 1 year when minCols=1", async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("Test");
    ws.addRow(["Label", 2025]);

    const result = findYearHeader(ws, 1, 1, 1);
    expect(result).not.toBeNull();
    expect(result!.yearCols).toHaveLength(1);
  });
});

describe("findLabelColumn", () => {
  it("finds column with most financial labels", async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("Test");
    // Col A: empty, Col B: labels, Col C: numbers
    ws.addRow([null, "Revenue", 100]);
    ws.addRow([null, "EBITDA", 60]);
    ws.addRow([null, "Capex", 10]);

    const result = findLabelColumn(ws, 1, 3);
    expect(result).toBe(2);
  });

  it("detects labels in column A", async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("Test");
    ws.addRow(["Revenue", 100, 110]);
    ws.addRow(["EBITDA", 60, 70]);
    ws.addRow(["NIBD", 200, 180]);

    const result = findLabelColumn(ws, 1, 3);
    expect(result).toBe(1);
  });

  it("defaults to column B when no financial labels found", async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("Test");
    ws.addRow(["Foo", "Bar"]);

    const result = findLabelColumn(ws, 1, 1);
    expect(result).toBe(2);
  });
});

describe("findNameBlocks", () => {
  it("finds Name: blocks", async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("Test");
    ws.addRow(["Name: Base Case"]);
    ws.addRow(["", 2025, 2026]);
    ws.addRow(["Revenue", 100, 110]);
    ws.addRow(["Name: Upside Case"]);
    ws.addRow(["", 2025, 2026]);
    ws.addRow(["Revenue", 200, 220]);

    const blocks = findNameBlocks(ws);
    expect(blocks).toHaveLength(2);
    expect(blocks[0].name).toBe("Base Case");
    expect(blocks[1].name).toBe("Upside Case");
    expect(blocks[0].endRow).toBe(4); // ends at start of next block
  });

  it("handles Name: in any column", async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("Test");
    ws.addRow([null, "Name: Test Model"]);
    ws.addRow([null, "", 2025]);
    ws.addRow([null, "Revenue", 100]);

    const blocks = findNameBlocks(ws);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].name).toBe("Test Model");
  });

  it("returns empty array when no Name: found", async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("Test");
    ws.addRow(["Revenue", 100]);

    const blocks = findNameBlocks(ws);
    expect(blocks).toHaveLength(0);
  });
});

// ─── Block Parsing ────────────────────────────────────────

describe("parseBlock", () => {
  it("parses a simple revenue+ebitda block", async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("Test");
    ws.addRow(["", 2025, 2026, 2027]);
    ws.addRow(["Revenue", 500, 550, 600]);
    ws.addRow(["EBITDA", 60, 70, 80]);
    ws.addRow(["EBITDA %", 0.12, 0.127, 0.133]);

    const result = parseBlock(ws, 1, 5, "Test Model");
    expect(result.model).not.toBeNull();
    expect(result.model!.name).toBe("Test Model");
    expect(result.model!.periods).toHaveLength(3);

    const p2025 = result.model!.periods.find((p) => p.year === 2025)!;
    expect(p2025.revenue_total).toBe(500);
    expect(p2025.ebitda_total).toBe(60);
    expect(p2025.ebitda_margin).toBe(0.12);
  });

  it("maps Norwegian labels correctly", async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("Test");
    ws.addRow(["", 2025, 2026]);
    ws.addRow(["Omsetning", 500, 550]);
    ws.addRow(["Driftsresultat", 60, 70]);
    ws.addRow(["Investeringer", 10, 12]);

    const result = parseBlock(ws, 1, 5, "Norsk modell");
    expect(result.model).not.toBeNull();

    const p = result.model!.periods[0];
    expect(p.revenue_total).toBe(500);
    expect(p.ebitda_total).toBe(60);
    expect(p.capex).toBe(10);
  });

  it("captures unmapped rows in extra_data", async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("Test");
    ws.addRow(["", 2025, 2026]);
    ws.addRow(["Revenue", 500, 550]);
    ws.addRow(["Gross profit", 300, 330]);
    ws.addRow(["EBITDA", 60, 70]);

    const result = parseBlock(ws, 1, 5, "Test");
    expect(result.model).not.toBeNull();
    expect(result.model!.unmappedRows).toContain("Gross profit");

    const p = result.model!.periods[0];
    expect(p.extra_data).not.toBeNull();
    expect(p.extra_data!.gross_profit).toBe(300);
  });

  it("skips section header rows (P&L, Balanse, etc.)", async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("Test");
    ws.addRow(["", 2025, 2026]);
    ws.addRow(["P&L"]);
    ws.addRow(["Revenue", 500, 550]);
    ws.addRow(["EBITDA", 60, 70]);

    const result = parseBlock(ws, 1, 5, "Test");
    expect(result.model).not.toBeNull();
    expect(result.model!.unmappedRows).not.toContain("P&L");
  });

  it("maps tax and net cashflow labels", async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("Test");
    ws.addRow(["", 2025, 2026]);
    ws.addRow(["Revenue", 500, 550]);
    ws.addRow(["EBITDA", 60, 70]);
    ws.addRow(["Tax", 15, 18]);
    ws.addRow(["Cashflow net", 45, 52]);

    const result = parseBlock(ws, 1, 6, "Test");
    expect(result.model).not.toBeNull();

    const p = result.model!.periods[0];
    expect(p.tax).toBe(15);
    expect(p.net_cashflow).toBe(45);
  });

  it("returns null when no year headers found", async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("Test");
    ws.addRow(["Just some text"]);
    ws.addRow(["More text"]);

    const result = parseBlock(ws, 1, 3, "No years");
    expect(result.model).toBeNull();
    expect(result.warnings.length).toBeGreaterThan(0);
  });

  it("returns null when no financial data found", async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("Test");
    ws.addRow(["", 2025, 2026]);
    ws.addRow(["Random label", "text", "more text"]);

    const result = parseBlock(ws, 1, 3, "No data");
    expect(result.model).toBeNull();
  });
});

describe("createEmptyPeriod", () => {
  it("creates period with all null fields", () => {
    const p = createEmptyPeriod(2025);
    expect(p.year).toBe(2025);
    expect(p.period_date).toBe("2025-12-31");
    expect(p.revenue_total).toBeNull();
    expect(p.ebitda_total).toBeNull();
    expect(p.tax).toBeNull();
    expect(p.net_cashflow).toBeNull();
    expect(p.extra_data).toBeNull();
  });

  it("classifies current year as budget", () => {
    const currentYear = new Date().getFullYear();
    const p = createEmptyPeriod(currentYear);
    expect(p.period_type).toBe("budget");
  });

  it("classifies past years as actual", () => {
    const p = createEmptyPeriod(2020);
    expect(p.period_type).toBe("actual");
  });

  it("classifies future years as forecast", () => {
    const p = createEmptyPeriod(2040);
    expect(p.period_type).toBe("forecast");
  });
});

// ─── End-to-End Parsing ───────────────────────────────────

describe("parseExcelBuffer", () => {
  it("parses a single-sheet file with revenue and EBITDA", async () => {
    const buffer = await createWorkbookBuffer([
      {
        name: "Ark1",
        rows: [
          ["", 2025, 2026, 2027],
          ["Revenue", 500, 550, 600],
          ["EBITDA", 60, 70, 80],
          ["EBITDA %", 0.12, 0.127, 0.133],
        ],
      },
    ]);

    const result = await parseExcelBuffer(buffer, "Test Company.xlsx");
    expect(result.models).toHaveLength(1);
    expect(result.models[0].name).toBe("Test Company");

    const p = result.models[0].periods;
    expect(p).toHaveLength(3);
    expect(p[0].revenue_total).toBe(500);
    expect(p[0].ebitda_total).toBe(60);
  });

  it("parses Name: block format (ECIT standard)", async () => {
    const buffer = await createWorkbookBuffer([
      {
        name: "Ark1",
        rows: [
          [null, "Input"],
          [null, "Number of ord shares Completion", 331.6],
          [null, ""],
          [null, "Name: Baseline Plan"],
          [null, "Consolidated P&L", null, 2025, 2026],
          [null, "Revenue", null, 5150, 5709],
          [null, "EBITDA", null, 450, 500],
          [null, "EBITDA %", null, 0.12, 0.12],
          [null, "NIBD (incl various)", null, 1780, 563],
          [null, ""],
          [null, "Name: Ambitious Plan"],
          [null, "Consolidated P&L", null, 2025, 2026],
          [null, "Revenue", null, 5500, 6200],
          [null, "EBITDA", null, 500, 600],
        ],
      },
    ]);

    const result = await parseExcelBuffer(buffer, "ECIT Model.xlsx");

    expect(result.models).toHaveLength(2);
    expect(result.models[0].name).toBe("Baseline Plan");
    expect(result.models[1].name).toBe("Ambitious Plan");

    // Input parameters should be extracted
    expect(result.inputParameters.shares_completion).toBe(331.6);

    // First model should have data
    const bp = result.models[0].periods;
    expect(bp).toHaveLength(2);
    expect(bp[0].revenue_total).toBe(5150);
    expect(bp[0].nibd).toBe(1780);
  });

  it("parses section-style blocks (Herjedal format)", async () => {
    const buffer = await createWorkbookBuffer([
      {
        name: "Ark1",
        rows: [
          [null, null],
          [null, null],
          ["Scenario A"],
          ["", 2025, 2026, 2027],
          ["Revenue", 567, 614, 665],
          ["EBITDA", 71, 74, 77],
          ["EBITDA %", 0.125, 0.12, 0.116],
          [null, null], // gap
          [null, null],
          [null, null],
          [null, null], // 3+ empty rows
          ["Scenario B"],
          ["", 2025, 2026, 2027],
          ["Revenue", 567, 539, 555],
          ["EBITDA", 58, 55, 62],
        ],
      },
    ]);

    const result = await parseExcelBuffer(buffer, "Test.xlsx");

    // Should detect 2 section blocks
    expect(result.models.length).toBeGreaterThanOrEqual(2);
  });

  it("handles empty sheets gracefully", async () => {
    const wb = new ExcelJS.Workbook();
    wb.addWorksheet("Empty");
    const ws2 = wb.addWorksheet("WithData");
    ws2.addRow(["", 2025, 2026]);
    ws2.addRow(["Revenue", 100, 110]);
    ws2.addRow(["EBITDA", 10, 12]);

    const arrayBuffer = await wb.xlsx.writeBuffer();
    const buffer = Buffer.from(arrayBuffer);

    const result = await parseExcelBuffer(buffer, "Mixed.xlsx");
    expect(result.models.length).toBeGreaterThanOrEqual(1);
    expect(result.warnings.some((w) => w.includes("tomt"))).toBe(true);
  });

  it("throws when file contains no financial data", async () => {
    const buffer = await createWorkbookBuffer([
      {
        name: "Ark1",
        rows: [
          ["Just some text"],
          ["Nothing financial here"],
        ],
      },
    ]);

    await expect(parseExcelBuffer(buffer, "empty.xlsx")).rejects.toThrow(
      /Kunne ikke finne finansielle data/
    );
  });

  it("parses a DCF-style model with tax and cashflow", async () => {
    const buffer = await createWorkbookBuffer([
      {
        name: "Ark1",
        rows: [
          [null, null, null, null, null, 2025, 2026],
          [null, null, null, null, "Revenue", 1540, 1694],
          [null, null, null, null, "EBITDA", 184, 207],
          [null, null, null, null, "Tax", -37, -41],
          [null, null, null, null, "Investments", -20, -22],
          [null, null, null, null, "Cashflow net", 157, 173],
        ],
      },
    ]);

    const result = await parseExcelBuffer(buffer, "DCF.xlsx");
    expect(result.models).toHaveLength(1);

    const p = result.models[0].periods[0];
    expect(p.revenue_total).toBe(1540);
    expect(p.ebitda_total).toBe(184);
    expect(p.tax).toBe(-37);
    expect(p.capex).toBe(-20);
    expect(p.net_cashflow).toBe(157);
  });

  it("merges multi-sheet workbook (P&L + Cash Flow)", async () => {
    const buffer = await createWorkbookBuffer([
      {
        name: "P&L",
        rows: [
          ["", 2025, 2026, 2027],
          ["Revenue", 500, 550, 600],
          ["EBITDA", 60, 70, 80],
        ],
      },
      {
        name: "Cash Flow",
        rows: [
          ["", 2025, 2026, 2027],
          ["Capex", 10, 12, 14],
          ["Tax", 15, 18, 20],
          ["Change in NWC", 5, 6, 7],
          ["Operating FCF", 30, 34, 39],
        ],
      },
    ]);

    const result = await parseExcelBuffer(buffer, "Multi.xlsx");

    // Should merge into 1 model
    expect(result.models).toHaveLength(1);

    const p = result.models[0].periods[0];
    expect(p.revenue_total).toBe(500);
    expect(p.ebitda_total).toBe(60);
    expect(p.capex).toBe(10);
    expect(p.tax).toBe(15);
    expect(p.change_nwc).toBe(5);
    expect(p.operating_fcf).toBe(30);
  });

  it("merges P&L + Balance + Equity sheets", async () => {
    const buffer = await createWorkbookBuffer([
      {
        name: "Resultat",
        rows: [
          ["", 2025, 2026],
          ["Omsetning", 500, 550],
          ["EBITDA", 60, 70],
        ],
      },
      {
        name: "Balanse",
        rows: [
          ["", 2025, 2026],
          ["NIBD", 200, 180],
        ],
      },
      {
        name: "Equity Bridge",
        rows: [
          ["", 2025, 2026],
          ["Number of shares", 100, 110],
          ["EV", 800, 900],
          ["EQV", 600, 720],
        ],
      },
    ]);

    const result = await parseExcelBuffer(buffer, "Full.xlsx");

    expect(result.models).toHaveLength(1);
    const p = result.models[0].periods[0];
    expect(p.revenue_total).toBe(500);
    expect(p.nibd).toBe(200);
    expect(p.share_count).toBe(100);
    expect(p.enterprise_value).toBe(800);
    expect(p.equity_value).toBe(600);
  });

  it("keeps sheets separate when all have unknown sheet type", async () => {
    const buffer = await createWorkbookBuffer([
      {
        name: "Ark1",
        rows: [
          ["", 2025, 2026],
          ["Revenue", 500, 550],
          ["EBITDA", 60, 70],
        ],
      },
      {
        name: "Ark2",
        rows: [
          ["", 2025, 2026],
          ["Revenue", 600, 660],
          ["EBITDA", 72, 84],
        ],
      },
    ]);

    const result = await parseExcelBuffer(buffer, "TwoSheets.xlsx");

    // Both sheets have unknown type — should stay separate (likely different scenarios)
    expect(result.models).toHaveLength(2);
  });

  it("preserves backward compatibility: single-sheet with filename as name", async () => {
    const buffer = await createWorkbookBuffer([
      {
        name: "Ark1",
        rows: [
          ["", 2025, 2026],
          ["Revenue", 100, 110],
          ["EBITDA", 10, 12],
        ],
      },
    ]);

    const result = await parseExcelBuffer(buffer, "My-Company_Model.xlsx");
    expect(result.models).toHaveLength(1);
    expect(result.models[0].name).toBe("My Company Model");
  });

  it("includes equity bridge fields from Herjedal-style files", async () => {
    const buffer = await createWorkbookBuffer([
      {
        name: "Ark1",
        rows: [
          ["", null, 2025, 2026],
          ["Revenue", null, 567, 614],
          ["EBITDA (pre IFRS)", null, 71, 74],
          ["% margin", null, 0.125, 0.12],
          ["NIBD effect", null, 0, 92.4],
          ["Capex", 0.01, 5.67, 6.14],
          ["NWC effect", 0.0097, 5.5, 5.96],
          ["Tax", 0.22, 14.37, 14.93],
          ["Cashflow net", null, 45.46, 46.97],
        ],
      },
    ]);

    const result = await parseExcelBuffer(buffer, "Herjedal.xlsx");
    expect(result.models).toHaveLength(1);

    const p = result.models[0].periods[0];
    expect(p.revenue_total).toBe(567);
    expect(p.ebitda_total).toBe(71);
    expect(p.ebitda_margin).toBe(0.125);
    expect(p.capex).toBe(5.67);
    expect(p.change_nwc).toBe(5.5);
    expect(p.tax).toBe(14.37);
    expect(p.net_cashflow).toBe(45.46);
  });
});
