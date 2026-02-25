/**
 * Robust Excel parser for financial model spreadsheets.
 *
 * Supports many different layouts:
 * - Model blocks separated by "Name:" rows (ECIT standard format)
 * - One sheet per model (sheet name = model name)
 * - Single flat table (one model inferred from filename or sheet name)
 * - Labels in any column (auto-detected)
 * - Year headers in any row/column (auto-detected)
 * - Norwegian and English financial labels
 * - Formula cells resolved to their result values
 */

import ExcelJS from "exceljs";

// ─── Types ──────────────────────────────────────────────────

export interface ParsedModelBlock {
  name: string;
  periods: PeriodYear[];
  /** Row-level data we could not map to a known field */
  unmappedRows: string[];
  /** Source info for debugging */
  source?: string;
}

export interface PeriodYear {
  year: number;
  period_date: string; // "YYYY-12-31"
  period_label: string; // "Dec-25" or "2025"
  period_type: string; // "budget" | "forecast" | "actual"
  // P&L
  revenue_total: number | null;
  revenue_managed_services: number | null;
  revenue_professional_services: number | null;
  revenue_other: number | null;
  revenue_organic: number | null;
  revenue_ma: number | null;
  revenue_growth: number | null;
  organic_growth: number | null;
  acquired_revenue: number | null;
  ebitda_total: number | null;
  ebitda_margin: number | null;
  ebitda_managed_services: number | null;
  ebitda_professional_services: number | null;
  ebitda_central_costs: number | null;
  ebitda_organic: number | null;
  ebitda_ma: number | null;
  // Margins per service line
  margin_managed_services: number | null;
  margin_professional_services: number | null;
  margin_central_costs: number | null;
  // Cash flow
  capex: number | null;
  capex_pct_revenue: number | null;
  change_nwc: number | null;
  other_cash_flow_items: number | null;
  operating_fcf: number | null;
  minority_interest: number | null;
  operating_fcf_excl_minorities: number | null;
  cash_conversion: number | null;
  // Equity bridge
  share_count: number | null;
  nibd: number | null;
  option_debt: number | null;
  adjustments: number | null;
  enterprise_value: number | null;
  equity_value: number | null;
  preferred_equity: number | null;
  per_share_pre: number | null;
  mip_amount: number | null;
  tso_amount: number | null;
  warrants_amount: number | null;
  eqv_post_dilution: number | null;
  per_share_post: number | null;
}

export interface InputParameters {
  shares_completion?: number;
  shares_year_end?: number;
  tso_warrants_count?: number;
  tso_warrants_price?: number;
  mip_share_pct?: number;
  existing_warrants_count?: number;
  existing_warrants_price?: number;
  acquired_companies_multiple?: number;
  acquired_with_shares_pct?: number;
  ev_multiple?: number;
  pref_growth_rate?: number;
}

export interface ExcelParseResult {
  models: ParsedModelBlock[];
  inputParameters: InputParameters;
  warnings: string[];
}

// ─── Cell value extraction ──────────────────────────────────

function cellValue(cell: ExcelJS.Cell): any {
  const v = cell.value;
  if (v === null || v === undefined) return null;
  // ExcelJS formula cells: { formula, result }
  if (typeof v === "object" && "result" in v) {
    return (v as any).result ?? null;
  }
  // Shared formula cells: { sharedFormula, result }
  if (typeof v === "object" && "sharedFormula" in v) {
    return (v as any).result ?? null;
  }
  // Rich text cells: { richText: [...] }
  if (typeof v === "object" && "richText" in v) {
    return (v as any).richText
      ?.map((rt: any) => rt.text || "")
      .join("")
      .trim() || null;
  }
  // Date cells
  if (v instanceof Date) {
    return v;
  }
  return v;
}

function cellNum(cell: ExcelJS.Cell): number | null {
  const v = cellValue(cell);
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return null;
  if (typeof v === "number") return isNaN(v) ? null : v;

  // String value — handle Norwegian number format:
  //   "1 105,0" → 1105.0  (space = thousands sep, comma = decimal sep)
  //   "1,105.0" → 1105.0  (English format)
  //   "-" or "--" → null
  const s = String(v).trim();
  if (!s || s === "-" || s === "--" || s === "n/a" || s === "N/A") return null;

  // Detect Norwegian format: has comma AND (has space-separated groups OR no dot)
  // Norwegian: "1 105,0" or "105,5" or "1 234 567,89"
  // English:   "1,105.0" or "1,234,567.89"
  let cleaned: string;
  const hasComma = s.includes(",");
  const hasDot = s.includes(".");
  if (hasComma && !hasDot) {
    // Likely Norwegian: comma is decimal separator, spaces are thousands
    cleaned = s.replace(/[\s\u00A0]/g, "").replace(",", ".");
  } else if (hasComma && hasDot) {
    // Ambiguous — if comma comes before dot, it's English thousands separator
    // If dot comes before comma, it's European (dot=thousands, comma=decimal)
    const commaIdx = s.indexOf(",");
    const dotIdx = s.indexOf(".");
    if (dotIdx < commaIdx) {
      // European: 1.105,0 → dot is thousands, comma is decimal
      cleaned = s.replace(/[\s\u00A0.]/g, "").replace(",", ".");
    } else {
      // English: 1,105.0 → comma is thousands, dot is decimal
      cleaned = s.replace(/[\s\u00A0,]/g, "");
    }
  } else {
    // No comma — strip spaces (thousands separators), keep dot as decimal
    cleaned = s.replace(/[\s\u00A0]/g, "");
  }

  const n = parseFloat(cleaned);
  return isNaN(n) ? null : n;
}

function cellStr(cell: ExcelJS.Cell): string {
  const v = cellValue(cell);
  if (v === null || v === undefined) return "";
  if (v instanceof Date) return v.toISOString();
  return String(v).trim();
}

// ─── Row label normalization + mapping ──────────────────────

function normalizeLabel(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/[,.:;()]+$/g, "")
    .replace(/[""'']/g, "")
    .trim();
}

type FieldKey = keyof PeriodYear;

/**
 * Comprehensive bilingual (NO + EN) label → field mapping.
 * Each entry: [regex, fieldKey]
 * Order matters — first match wins.
 */
const LABEL_MAPPINGS: [RegExp, FieldKey][] = [
  // ── Revenue / Omsetning ──
  [/^(total\s+)?revenue$/, "revenue_total"],
  [/^(total\s+)?omsetning$/, "revenue_total"],
  [/^(totale?\s+)?driftsinntekter$/, "revenue_total"],
  [/^inntekter?\s*(total)?$/, "revenue_total"],
  [/^turnover$/, "revenue_total"],
  [/^net\s+(revenue|sales)/, "revenue_total"],
  [/^netto\s+omsetning/, "revenue_total"],
  [/^salgsinntekt/, "revenue_total"],

  // Revenue subcategories
  [/managed\s+services?\s*(revenue|omsetning)?/, "revenue_managed_services"],
  [/^a&p$/, "revenue_managed_services"], // Accounting & Payroll — ECIT service line
  [/^accounting\s*(&|and)\s*payroll/, "revenue_managed_services"],
  [/professional\s+services?\s*(revenue|omsetning)?/, "revenue_professional_services"],
  [/^advisory$/, "revenue_professional_services"], // Advisory — ECIT service line
  [/^rådgivning$/, "revenue_professional_services"],
  [/^licen[sc]e[sr]?$/, "revenue_other"], // Licenses / Lisenser
  [/(other|annen|øvrig)\s*(revenue|omsetning|inntekt)/, "revenue_other"],
  [/organic\s*(revenue|omsetning)/, "revenue_organic"],
  [/organisk\s*(omsetning|inntekt)/, "revenue_organic"],
  [/(m&a|ma|acquired)\s*(revenue|omsetning)/, "revenue_ma"],
  [/oppkjøpt\s*(omsetning|inntekt)/, "revenue_ma"],

  // Acquired revenue
  [/acquired\s+revenue/, "acquired_revenue"],
  [/oppkjøpt\s+omsetning/, "acquired_revenue"],

  // Revenue growth
  [/^(total\s+)?(revenue|omsetning)\s*(growth|vekst)/, "revenue_growth"],
  [/^(total\s+)?vekst\s*%?$/, "revenue_growth"],
  [/^%\s*growth$/, "revenue_growth"],

  // Organic growth
  [/organic\s+growth/, "organic_growth"],
  [/organisk\s+vekst/, "organic_growth"],

  // ── EBITDA ──
  [/^(total\s+)?ebitda$/, "ebitda_total"],
  [/^(total\s+)?ebitda\s*\(?(pre|ex|excl)/, "ebitda_total"],
  [/^driftsresultat\s*(før\s*avskr)?/, "ebitda_total"],

  // EBITDA margin
  [/^ebitda\s*(%|margin|prosent)/, "ebitda_margin"],
  [/^ebitda-margin/, "ebitda_margin"],
  [/^margin\s*%?$/, "ebitda_margin"],

  // EBITDA subcategories
  [/ebitda\s*managed/, "ebitda_managed_services"],
  [/ebitda\s*professional/, "ebitda_professional_services"],
  [/^(central|sentrale?)\s*(costs?|kostnader?)/, "ebitda_central_costs"],
  [/ebitda\s*organic/, "ebitda_organic"],
  [/ebitda\s*organisk/, "ebitda_organic"],
  [/^organic\s+ebitda/, "ebitda_organic"],
  [/^organisk\s+ebitda/, "ebitda_organic"],
  [/ebitda\s*(m&a|ma|acquired)/, "ebitda_ma"],

  // ── Cash flow / Kontantstrøm ──
  [/^capex$/, "capex"],
  [/^(total\s+)?capex/, "capex"],
  [/^investering(er)?$/, "capex"],
  [/capex.*%\s*(of\s+)?rev/, "capex_pct_revenue"],
  [/capex\s*%/, "capex_pct_revenue"],

  [/^(change\s+in\s+)?n(et\s+)?w(orking\s+)?c(apital)?/, "change_nwc"],
  [/^endring\s*(i\s+)?arbeidskapital/, "change_nwc"],
  [/^δ?\s*nwc/, "change_nwc"],
  [/^working\s*capital\s*(change)?/, "change_nwc"],

  [/^other\s*(cash\s*flow|cf)\s*(items)?/, "other_cash_flow_items"],
  [/^andre\s*(kontantstrøm|cf)\s*(poster)?/, "other_cash_flow_items"],
  [/^øvrige\s*(poster|kontantstrøm)/, "other_cash_flow_items"],

  [/^operating\s*(fcf|free\s*cash\s*flow)$/, "operating_fcf"],
  [/^operasjonell\s*(fcf|fri\s*kontantstrøm)/, "operating_fcf"],
  [/^op\.?\s*fcf/, "operating_fcf"],
  [/^(total\s+)?fcf$/, "operating_fcf"],
  [/^fri\s*kontantstrøm/, "operating_fcf"],

  [/^minority\s*(interest)?$/, "minority_interest"],
  [/^minoritet(sinteresse)?/, "minority_interest"],

  [/^(operating\s+)?fcf\s*(excl|ex|etter)\s*minor/, "operating_fcf_excl_minorities"],

  [/^cash\s*conversion/, "cash_conversion"],
  [/^kontant(konvertering|omregning)/, "cash_conversion"],

  // ── Equity bridge / Aksjebroanalyse ──
  [/^number\s+of\s+shares/, "share_count"],
  [/^antall\s+aksjer/, "share_count"],
  [/^aksjer\s*(utestående)?$/, "share_count"],

  [/^nibd/, "nibd"],
  [/^net(to)?\s*(interest\s+bearing\s+)?debt/, "nibd"],
  [/^netto\s*(rente(bærende)?\s*)?gjeld/, "nibd"],

  [/^option\s*debt/, "option_debt"],
  [/^opsjonsgjeld/, "option_debt"],

  [/^adjustments?$/, "adjustments"],
  [/^justeringer?$/, "adjustments"],

  [/^ev$/, "enterprise_value"],
  [/^enterprise\s+value/, "enterprise_value"],
  [/^selskapsverdi$/, "enterprise_value"],
  [/^virksomhetsverdi$/, "enterprise_value"],

  [/^eqv$/, "equity_value"],
  [/^equity\s+value/, "equity_value"],
  [/^egenkapitalverdi$/, "equity_value"],

  [/^pref(erred)?(\s+eq(uity)?)?$/, "preferred_equity"],
  [/^preferanse(aksjer)?$/, "preferred_equity"],

  [/per\s+share.*before/, "per_share_pre"],
  [/per\s+share.*pre/, "per_share_pre"],
  [/per\s+aksje.*før/, "per_share_pre"],
  [/^verdi\s*per\s*aksje\s*\(?(pre|før)/, "per_share_pre"],

  [/^mip$/, "mip_amount"],
  [/^mip\s+share/, "mip_amount"],

  [/^tso$/, "tso_amount"],
  [/^tso\s+warrant/, "tso_amount"],

  [/^ex(isting)?\s*warr(a|e)nts?/, "warrants_amount"],
  [/^eksisterende\s*warrants?/, "warrants_amount"],

  [/eqv.*post/, "eqv_post_dilution"],
  [/post\s*(mip|dilution)/, "eqv_post_dilution"],
  [/egenkapital.*etter\s*(utvanning)?/, "eqv_post_dilution"],

  [/per\s+share.*post/, "per_share_post"],
  [/per\s+aksje.*etter/, "per_share_post"],
  [/^verdi\s*per\s*aksje\s*\(?(post|etter)/, "per_share_post"],
];

/**
 * Map a row label to the period field it populates.
 * Returns null if the label is not recognized.
 *
 * `context` is updated as we scan rows so that ambiguous labels like
 * "% vekst" or "% margin" can be resolved by position.
 */
interface ParseContext {
  /** Tracks the last "section" we saw — 'revenue' | 'ebitda' | 'cashflow' | 'equity' | null */
  lastSection: "revenue" | "ebitda" | "cashflow" | "equity" | null;
  /** Last concrete field that was mapped — used for sub-item margin context */
  lastField: FieldKey | null;
}

function mapLabelToField(label: string, ctx?: ParseContext): FieldKey | null {
  const l = normalizeLabel(label);
  if (!l) return null;

  // First try exact label mappings
  for (const [regex, field] of LABEL_MAPPINGS) {
    if (regex.test(l)) {
      // Update context if provided
      if (ctx) {
        ctx.lastField = field;
        if (field.startsWith("revenue")) ctx.lastSection = "revenue";
        else if (field.startsWith("ebitda")) ctx.lastSection = "ebitda";
        else if (
          field === "capex" || field === "change_nwc" || field === "operating_fcf" ||
          field === "cash_conversion" || field === "other_cash_flow_items"
        ) ctx.lastSection = "cashflow";
        else if (
          field === "share_count" || field === "nibd" || field === "enterprise_value" ||
          field === "equity_value"
        ) ctx.lastSection = "equity";
      }
      return field;
    }
  }

  // ── Context-dependent labels ──
  // These labels are ambiguous on their own and need positional context.
  if (ctx) {
    // "% vekst" / "% growth" → depends on whether we're in revenue or ebitda section
    if (/^%\s*vekst$/.test(l) || /^%\s*growth$/.test(l)) {
      if (ctx.lastSection === "ebitda") return null; // EBITDA growth not a standard field
      return "revenue_growth"; // default: revenue growth
    }

    // "% margin" → depends on context
    if (/^%\s*margin$/.test(l)) {
      // After a specific EBITDA subcategory → map to corresponding margin
      if (ctx.lastField === "ebitda_managed_services" || ctx.lastField === "revenue_managed_services") {
        return "margin_managed_services";
      }
      if (ctx.lastField === "ebitda_professional_services" || ctx.lastField === "revenue_professional_services") {
        return "margin_professional_services";
      }
      if (ctx.lastField === "ebitda_central_costs") {
        return "margin_central_costs";
      }
      if (ctx.lastSection === "ebitda" || ctx.lastField === "ebitda_total" || ctx.lastField === "ebitda_organic") {
        return "ebitda_margin";
      }
      // After revenue → this might be a margin following total revenue, treat as ebitda_margin
      if (ctx.lastSection === "revenue") {
        return "ebitda_margin";
      }
      return "ebitda_margin"; // fallback
    }
  }

  return null;
}

// ─── Input parameter detection ──────────────────────────────

function parseInputParameters(
  ws: ExcelJS.Worksheet,
  endRow: number,
  labelCol: number
): InputParameters {
  const params: InputParameters = {};
  const valCol1 = labelCol + 1;
  const valCol2 = labelCol + 2;

  for (let r = 1; r < endRow; r++) {
    const row = ws.getRow(r);
    const label = normalizeLabel(cellStr(row.getCell(labelCol)));
    const v1 = cellNum(row.getCell(valCol1));
    const v2 = cellNum(row.getCell(valCol2));

    if (label.includes("number of ord shares completion") || label.includes("antall ordinære aksjer ved closing")) {
      params.shares_completion = v1 ?? undefined;
    } else if (label.includes("number of ord shares") || label.includes("number of  ord shares") || label.includes("antall ordinære aksjer")) {
      params.shares_year_end = v1 ?? undefined;
    } else if ((label.includes("tso warrants") || label.includes("tso-warranter")) && !label.includes("share")) {
      params.tso_warrants_count = v1 ?? undefined;
      if (v2 !== null) params.tso_warrants_price = v2;
    } else if (label.includes("mip share") || label.includes("mip andel") || label.includes("mip-andel")) {
      params.mip_share_pct = v1 ?? undefined;
    } else if (label.includes("existing warrants share") || label.includes("eksisterende warranter")) {
      params.existing_warrants_count = v1 ?? undefined;
      if (v2 !== null) params.existing_warrants_price = v2;
    } else if (label.includes("acquired companies multiple") || label.includes("oppkjøpsmultippel")) {
      if (v2 !== null) params.acquired_companies_multiple = v2;
      else if (v1 !== null) params.acquired_companies_multiple = v1;
    } else if (label.includes("acquired with shares") || label.includes("oppkjøp med aksjer")) {
      if (v2 !== null) params.acquired_with_shares_pct = v2;
      else if (v1 !== null) params.acquired_with_shares_pct = v1;
    }
  }

  return params;
}

// ─── Year detection ─────────────────────────────────────────

interface YearColumn {
  col: number;
  year: number;
}

/**
 * Scan a range of rows for a row containing 4-digit years (2020-2040).
 * Returns the header row number, the year columns, and optionally
 * inferred period labels.
 */
function findYearHeader(
  ws: ExcelJS.Worksheet,
  startRow: number,
  endRow: number,
  minCols: number = 2
): { headerRow: number; yearCols: YearColumn[] } | null {
  const maxCol = Math.min(30, ws.columnCount);

  for (let r = startRow; r <= Math.min(endRow, ws.rowCount); r++) {
    const row = ws.getRow(r);
    const candidates: YearColumn[] = [];

    for (let c = 1; c <= maxCol; c++) {
      const v = cellValue(row.getCell(c));
      let yearNum: number | null = null;

      if (typeof v === "number" && v >= 2020 && v <= 2040) {
        yearNum = v;
      } else if (typeof v === "string") {
        // Handle "2025E", "2025F", "2025B", "FY2025", "Dec-25", etc.
        const m = v.match(/(?:FY)?(\d{4})/);
        if (m) {
          const y = parseInt(m[1]);
          if (y >= 2020 && y <= 2040) yearNum = y;
        }
      } else if (v instanceof Date) {
        const y = v.getFullYear();
        if (y >= 2020 && y <= 2040) yearNum = y;
      }

      if (yearNum !== null) {
        candidates.push({ col: c, year: yearNum });
      }
    }

    // Need at least `minCols` consecutive-ish years
    if (candidates.length >= minCols) {
      // Sort by column and check they look like a series of years
      candidates.sort((a, b) => a.col - b.col);

      // Filter to unique years (in case of duplicates)
      const seen = new Set<number>();
      const unique = candidates.filter((c) => {
        if (seen.has(c.year)) return false;
        seen.add(c.year);
        return true;
      });

      if (unique.length >= minCols) {
        return { headerRow: r, yearCols: unique };
      }
    }
  }

  return null;
}

// ─── Label column detection ─────────────────────────────────

/**
 * Find which column contains the row labels by looking for known
 * financial terms.
 */
function findLabelColumn(
  ws: ExcelJS.Worksheet,
  startRow: number,
  endRow: number
): number {
  const knownLabels = /revenue|omsetning|ebitda|driftsinntekt|turnover|inntekt|resultat|nibd|fcf|capex|gjeld|aksjer/i;
  const colScores = new Map<number, number>();

  const maxCol = Math.min(10, ws.columnCount);
  const maxRow = Math.min(endRow, ws.rowCount);

  for (let r = startRow; r <= maxRow; r++) {
    const row = ws.getRow(r);
    for (let c = 1; c <= maxCol; c++) {
      const str = cellStr(row.getCell(c));
      if (str && knownLabels.test(str)) {
        colScores.set(c, (colScores.get(c) || 0) + 1);
      }
    }
  }

  if (colScores.size === 0) return 2; // default to B

  // Return column with most matches
  let bestCol = 2;
  let bestScore = 0;
  for (const [col, score] of colScores) {
    if (score > bestScore) {
      bestScore = score;
      bestCol = col;
    }
  }
  return bestCol;
}

// ─── Model block detection ──────────────────────────────────

interface RawBlock {
  name: string;
  sheetName: string;
  startRow: number;
  endRow: number;
}

/**
 * Strategy 1: Find "Name:" rows in a sheet to split into blocks.
 */
function findNameBlocks(ws: ExcelJS.Worksheet): RawBlock[] {
  const blocks: RawBlock[] = [];
  const maxCol = Math.min(10, ws.columnCount);

  // Scan all columns for "Name:" patterns
  for (let r = 1; r <= ws.rowCount; r++) {
    for (let c = 1; c <= maxCol; c++) {
      const label = cellStr(ws.getRow(r).getCell(c));
      if (/^name:\s*/i.test(label)) {
        const name = label.replace(/^name:\s*/i, "").trim();
        if (name) {
          blocks.push({
            name,
            sheetName: ws.name,
            startRow: r,
            endRow: ws.rowCount + 1, // will be adjusted below
          });
        }
        break; // found Name: in this row, move to next row
      }
    }
  }

  // Adjust end rows
  for (let i = 0; i < blocks.length - 1; i++) {
    blocks[i].endRow = blocks[i + 1].startRow;
  }

  return blocks;
}

/**
 * Strategy 2: Look for separator patterns — bold headers, section titles,
 * or large gaps of empty rows.
 */
function findSectionBlocks(ws: ExcelJS.Worksheet): RawBlock[] {
  const blocks: RawBlock[] = [];
  const labelCol = findLabelColumn(ws, 1, ws.rowCount);

  // Look for rows that might be section headers:
  // - Text in label column that is NOT a known financial label
  // - Followed by rows with year data
  // - Common patterns: "Scenario A", "Base case", "Modell 1", company names
  const sectionPattern = /^(scenario|case|modell|plan|budget|forecast|prognose|alternativ)\b/i;
  const knownFinancialLabel = /revenue|omsetning|ebitda|nibd|capex|aksjer|share|vekst|growth|margin|fcf|gjeld|debt|adjustments?|justeringer|pref|mip|tso|warrant|turnover|driftsinnt/i;

  let gapStart = -1;
  let lastNonEmptyRow = 0;

  for (let r = 1; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    const label = cellStr(row.getCell(labelCol));

    // Check if row has any content at all
    let hasContent = false;
    for (let c = 1; c <= Math.min(15, ws.columnCount); c++) {
      if (cellStr(row.getCell(c))) {
        hasContent = true;
        break;
      }
    }

    if (!hasContent) {
      if (gapStart < 0) gapStart = r;
      continue;
    }

    // If we had a gap of 3+ empty rows, that likely separates blocks
    if (gapStart > 0 && r - gapStart >= 3 && lastNonEmptyRow > 0) {
      // End previous block (if any)
      if (blocks.length > 0) {
        blocks[blocks.length - 1].endRow = gapStart;
      }
    }
    gapStart = -1;
    lastNonEmptyRow = r;

    // Check for section header
    if (label && sectionPattern.test(label) && !knownFinancialLabel.test(label)) {
      if (blocks.length > 0) {
        blocks[blocks.length - 1].endRow = r;
      }
      blocks.push({
        name: label,
        sheetName: ws.name,
        startRow: r,
        endRow: ws.rowCount + 1,
      });
    }
  }

  return blocks;
}

// ─── Block parsing ──────────────────────────────────────────

function createEmptyPeriod(year: number): PeriodYear {
  const currentYear = new Date().getFullYear();
  return {
    year,
    period_date: `${year}-12-31`,
    period_label: `${year}`,
    period_type: year < currentYear ? "actual" : year === currentYear ? "budget" : "forecast",
    revenue_total: null,
    revenue_managed_services: null,
    revenue_professional_services: null,
    revenue_other: null,
    revenue_organic: null,
    revenue_ma: null,
    revenue_growth: null,
    organic_growth: null,
    acquired_revenue: null,
    ebitda_total: null,
    ebitda_margin: null,
    ebitda_managed_services: null,
    ebitda_professional_services: null,
    ebitda_central_costs: null,
    ebitda_organic: null,
    ebitda_ma: null,
    margin_managed_services: null,
    margin_professional_services: null,
    margin_central_costs: null,
    capex: null,
    capex_pct_revenue: null,
    change_nwc: null,
    other_cash_flow_items: null,
    operating_fcf: null,
    minority_interest: null,
    operating_fcf_excl_minorities: null,
    cash_conversion: null,
    share_count: null,
    nibd: null,
    option_debt: null,
    adjustments: null,
    enterprise_value: null,
    equity_value: null,
    preferred_equity: null,
    per_share_pre: null,
    mip_amount: null,
    tso_amount: null,
    warrants_amount: null,
    eqv_post_dilution: null,
    per_share_post: null,
  };
}

/**
 * Parse a block of rows in a worksheet into a model.
 * Dynamically finds label column, year header, and data rows.
 */
function parseBlock(
  ws: ExcelJS.Worksheet,
  startRow: number,
  endRow: number,
  fallbackName: string
): { model: ParsedModelBlock | null; warnings: string[] } {
  const warnings: string[] = [];
  const effectiveEnd = Math.min(endRow, ws.rowCount + 1);

  // Find label column within this block
  const labelCol = findLabelColumn(ws, startRow, effectiveEnd);

  // Find year header within this block
  const yearInfo = findYearHeader(ws, startRow, effectiveEnd);

  if (!yearInfo) {
    // Try relaxed search: even 1 year column might work for small models
    const relaxed = findYearHeader(ws, startRow, effectiveEnd, 1);
    if (!relaxed) {
      warnings.push(
        `Blokk "${fallbackName}" (ark "${ws.name}", rad ${startRow}-${effectiveEnd}): Ingen årstall funnet i kolonneoverskrifter. Hopper over.`
      );
      return { model: null, warnings };
    }
    // Use relaxed match
    return parseBlockWithYears(ws, startRow, effectiveEnd, fallbackName, labelCol, relaxed, warnings);
  }

  return parseBlockWithYears(ws, startRow, effectiveEnd, fallbackName, labelCol, yearInfo, warnings);
}

function parseBlockWithYears(
  ws: ExcelJS.Worksheet,
  startRow: number,
  endRow: number,
  name: string,
  labelCol: number,
  yearInfo: { headerRow: number; yearCols: YearColumn[] },
  warnings: string[]
): { model: ParsedModelBlock | null; warnings: string[] } {
  const { yearCols } = yearInfo;

  // Initialize periods
  const periods: PeriodYear[] = yearCols.map((yc) => createEmptyPeriod(yc.year));
  const unmappedRows: string[] = [];
  const ctx: ParseContext = { lastSection: null, lastField: null };

  // Scan data rows
  for (let r = startRow; r < endRow; r++) {
    if (r === yearInfo.headerRow) continue;
    const row = ws.getRow(r);

    // Try label from the detected label column first, then try adjacent columns
    let rawLabel = cellStr(row.getCell(labelCol));
    if (!rawLabel) {
      // Try column A and column labelCol+1
      for (const tryCol of [1, labelCol - 1, labelCol + 1]) {
        if (tryCol >= 1 && tryCol !== labelCol) {
          const alt = cellStr(row.getCell(tryCol));
          if (alt && alt.length > 1) {
            rawLabel = alt;
            break;
          }
        }
      }
    }
    if (!rawLabel) continue;

    // Skip known non-data rows
    const lower = rawLabel.toLowerCase();
    if (
      lower.startsWith("name:") ||
      lower === "input" ||
      lower === "inndata" ||
      lower === "consolidated p&l" ||
      lower === "konsolidert resultat" ||
      lower === "comment" ||
      lower === "kommentar" ||
      /^(p&l|resultat(regnskap)?|balanse|balance|summary|sammendrag|notes?|noter?)$/i.test(lower)
    ) {
      continue;
    }

    const field = mapLabelToField(rawLabel, ctx);

    if (!field) {
      // Only log rows that have at least one numeric value in year columns
      const hasData = yearCols.some((yc) => cellNum(row.getCell(yc.col)) !== null);
      if (hasData && rawLabel.length > 1) {
        unmappedRows.push(rawLabel);
      }
      continue;
    }

    // Populate period values
    for (let pi = 0; pi < yearCols.length; pi++) {
      const val = cellNum(row.getCell(yearCols[pi].col));
      if (val !== null) {
        (periods[pi] as any)[field] = val;
      }
    }
  }

  // Check that we got at least some data
  const hasAnyData = periods.some(
    (p) =>
      p.revenue_total !== null ||
      p.ebitda_total !== null ||
      p.enterprise_value !== null ||
      p.equity_value !== null ||
      p.nibd !== null ||
      p.share_count !== null
  );

  if (!hasAnyData) {
    warnings.push(
      `Blokk "${name}" (ark "${ws.name}"): Ingen gjenkjente finansielle data funnet. Hopper over.`
    );
    return { model: null, warnings };
  }

  // Filter out periods that are entirely null
  const nonEmptyPeriods = periods.filter((p) => {
    const keys = Object.keys(p) as (keyof PeriodYear)[];
    return keys.some(
      (k) =>
        k !== "year" &&
        k !== "period_date" &&
        k !== "period_label" &&
        k !== "period_type" &&
        p[k] !== null
    );
  });

  if (nonEmptyPeriods.length === 0) {
    warnings.push(
      `Blokk "${name}" (ark "${ws.name}"): Alle perioder er tomme. Hopper over.`
    );
    return { model: null, warnings };
  }

  if (unmappedRows.length > 0) {
    warnings.push(
      `Blokk "${name}": ${unmappedRows.length} ukjente rader: ${unmappedRows.join(", ")}`
    );
  }

  return {
    model: {
      name,
      periods: nonEmptyPeriods,
      unmappedRows,
      source: `${ws.name}:${startRow}-${Math.min(endRow, ws.rowCount)}`,
    },
    warnings,
  };
}

// ─── Post-parse enrichment ──────────────────────────────────

/**
 * After initial parse, try to extract EV multiple and pref growth rate
 * from model data rows (these are sometimes in a separate column like C).
 */
function enrichInputParameters(
  ws: ExcelJS.Worksheet,
  params: InputParameters,
  startRow: number,
  endRow: number,
  labelCol: number
): void {
  const valCol = labelCol + 1;

  for (let r = startRow; r <= Math.min(endRow, ws.rowCount); r++) {
    const row = ws.getRow(r);
    const label = normalizeLabel(cellStr(row.getCell(labelCol)));

    if (label === "ev" && params.ev_multiple === undefined) {
      const m = cellNum(row.getCell(valCol));
      if (m !== null && m > 0 && m < 100) params.ev_multiple = m;
    }
    if (label.startsWith("pref") && params.pref_growth_rate === undefined) {
      const m = cellNum(row.getCell(valCol));
      if (m !== null && m > 0 && m < 1) params.pref_growth_rate = m;
    }
  }
}

// ─── Main parse function ────────────────────────────────────

export async function parseExcelBuffer(
  buffer: Buffer | ArrayBuffer,
  filename?: string
): Promise<ExcelParseResult> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer as any);

  if (workbook.worksheets.length === 0) {
    throw new Error("Filen inneholder ingen ark (sheets).");
  }

  const warnings: string[] = [];
  const allModels: ParsedModelBlock[] = [];
  let inputParameters: InputParameters = {};

  // Log what we found
  const sheetNames = workbook.worksheets.map((ws) => ws.name);
  if (sheetNames.length > 1) {
    warnings.push(`Fant ${sheetNames.length} ark: ${sheetNames.join(", ")}`);
  }

  // ─── Process each sheet ─────────────────────────────────
  for (const ws of workbook.worksheets) {
    if (ws.rowCount === 0 || ws.columnCount === 0) {
      warnings.push(`Ark "${ws.name}" er tomt. Hopper over.`);
      continue;
    }

    // Strategy 1: Look for "Name:" blocks
    const nameBlocks = findNameBlocks(ws);

    if (nameBlocks.length > 0) {
      // Parse input parameters from rows before first Name: block
      const labelCol = findLabelColumn(ws, 1, nameBlocks[0].startRow);
      const params = parseInputParameters(ws, nameBlocks[0].startRow, labelCol);
      if (Object.keys(params).length > 0 && Object.keys(inputParameters).length === 0) {
        inputParameters = params;
      }

      // Enrich with EV multiple / pref rate from model rows
      enrichInputParameters(ws, inputParameters, nameBlocks[0].startRow, ws.rowCount, labelCol);

      // Parse each Name: block
      for (const block of nameBlocks) {
        const result = parseBlock(ws, block.startRow, block.endRow, block.name);
        warnings.push(...result.warnings);
        if (result.model) {
          allModels.push(result.model);
        }
      }
      continue; // Done with this sheet
    }

    // Strategy 2: Look for section-style blocks (gaps, headers)
    const sectionBlocks = findSectionBlocks(ws);
    if (sectionBlocks.length > 1) {
      for (const block of sectionBlocks) {
        const result = parseBlock(ws, block.startRow, block.endRow, block.name);
        warnings.push(...result.warnings);
        if (result.model) {
          allModels.push(result.model);
        }
      }
      continue;
    }

    // Strategy 3: Treat entire sheet as one model
    const sheetModelName =
      sheetNames.length > 1
        ? ws.name
        : filename
          ? filename.replace(/\.[^.]+$/, "").replace(/[-_]/g, " ").trim()
          : ws.name;

    // Try to parse input parameters from the top of the sheet
    const labelCol = findLabelColumn(ws, 1, ws.rowCount);
    const yearInfo = findYearHeader(ws, 1, ws.rowCount);
    const paramsEndRow = yearInfo ? yearInfo.headerRow : Math.min(20, ws.rowCount);
    const params = parseInputParameters(ws, paramsEndRow, labelCol);
    if (Object.keys(params).length > 0 && Object.keys(inputParameters).length === 0) {
      inputParameters = params;
    }

    // Enrich input parameters
    enrichInputParameters(ws, inputParameters, 1, ws.rowCount, labelCol);

    const result = parseBlock(ws, 1, ws.rowCount + 1, sheetModelName);
    warnings.push(...result.warnings);
    if (result.model) {
      allModels.push(result.model);
    }
  }

  if (allModels.length === 0) {
    // Provide a helpful diagnostic message
    const diagLines: string[] = [];
    for (const ws of workbook.worksheets) {
      const firstRows: string[] = [];
      for (let r = 1; r <= Math.min(10, ws.rowCount); r++) {
        const row = ws.getRow(r);
        const cells: string[] = [];
        for (let c = 1; c <= Math.min(8, ws.columnCount); c++) {
          const v = cellStr(row.getCell(c));
          if (v) cells.push(`${String.fromCharCode(64 + c)}:"${v.substring(0, 30)}"`);
        }
        if (cells.length > 0) firstRows.push(`  Rad ${r}: ${cells.join(", ")}`);
      }
      diagLines.push(`Ark "${ws.name}" (${ws.rowCount} rader, ${ws.columnCount} kolonner):`);
      diagLines.push(...firstRows);
    }

    throw new Error(
      `Kunne ikke finne finansielle data i filen.\n\n` +
      `Parseren leter etter:\n` +
      `  • Rader med labels som "Revenue", "EBITDA", "Omsetning", "Driftsinntekter" osv.\n` +
      `  • Kolonner med årstall (2020-2040)\n` +
      `  • Evt. "Name:" rader for å skille modellblokker\n\n` +
      `Filens struktur:\n${diagLines.join("\n")}`
    );
  }

  return { models: allModels, inputParameters, warnings };
}
