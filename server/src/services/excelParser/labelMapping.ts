/**
 * Row label normalization and mapping to PeriodYear fields.
 */

import type { FieldKey } from "./types.js";

export function normalizeLabel(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/[,.:;()]+$/g, "")
    .replace(/[""'']/g, "")
    .trim();
}

/**
 * Comprehensive bilingual (NO + EN) label → field mapping.
 * Each entry: [regex, fieldKey]
 * Order matters — first match wins.
 */
export const LABEL_MAPPINGS: [RegExp, FieldKey][] = [
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
  [/(m&a|ma)\s*(revenue|omsetning)/, "revenue_ma"],
  [/oppkjøpt\s*(omsetning|inntekt)/, "revenue_ma"],

  // Acquired revenue (the specific amount in MNOK from input parameters)
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
  [/^investments?$/, "capex"],
  [/capex.*%\s*(of\s+)?rev/, "capex_pct_revenue"],
  [/capex\s*%/, "capex_pct_revenue"],

  [/^(change\s+in\s+)?n(et\s+)?w(orking\s+)?c(apital)?/, "change_nwc"],
  [/^endring\s*(i\s+)?arbeidskapital/, "change_nwc"],
  [/^δ?\s*nwc/, "change_nwc"],
  [/^working\s*capital\s*(change)?/, "change_nwc"],
  [/^nwc\s*effect/, "change_nwc"],
  [/^nwc\s*effekt/, "change_nwc"],

  // Tax
  [/^(income\s+)?tax$/, "tax"],
  [/^skatt$/, "tax"],
  [/^(total\s+)?tax\s*(expense)?$/, "tax"],
  [/^skattekostnad$/, "tax"],

  // Net cashflow / free cash flow variants
  // "Cashflow net" is a specific format from Herjedal-style files
  [/^(net\s+)?cashflow\s*net$/, "net_cashflow"],
  [/^cashflow\s+net$/, "net_cashflow"],
  [/^netto\s*(kontant)?strøm/, "net_cashflow"],

  [/^other\s*(cash\s*flow|cf)\s*(items)?/, "other_cash_flow_items"],
  [/^andre\s*(kontantstrøm|cf)\s*(poster)?/, "other_cash_flow_items"],
  [/^øvrige\s*(poster|kontantstrøm)/, "other_cash_flow_items"],

  // Operating FCF — "Free cashflow" and "Fri kontantstrøm" map here
  [/^operating\s*(fcf|free\s*cash\s*flow)$/, "operating_fcf"],
  [/^operasjonell\s*(fcf|fri\s*kontantstrøm)/, "operating_fcf"],
  [/^op\.?\s*fcf/, "operating_fcf"],
  [/^(total\s+)?fcf$/, "operating_fcf"],
  [/^free\s+cashflow$/, "operating_fcf"],
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
  [/^nibd\s*\(?(incl|inkl)/, "nibd"],
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

  // Per-share labels must come BEFORE eqv_post_dilution to avoid false matches
  [/per\s+share.*post/, "per_share_post"],
  [/per\s+aksje.*etter/, "per_share_post"],
  [/^verdi\s*per\s*aksje\s*\(?(post|etter)/, "per_share_post"],

  [/eqv.*post/, "eqv_post_dilution"],
  [/^post\s*(mip|dilution)/, "eqv_post_dilution"],
  [/egenkapital.*etter\s*(utvanning)?/, "eqv_post_dilution"],
];

/**
 * Parse context tracks positional state so that ambiguous labels like
 * "% vekst" or "% margin" can be resolved by position.
 */
export interface ParseContext {
  /** Tracks the last "section" we saw — 'revenue' | 'ebitda' | 'cashflow' | 'equity' | null */
  lastSection: "revenue" | "ebitda" | "cashflow" | "equity" | null;
  /** Last concrete field that was mapped — used for sub-item margin context */
  lastField: FieldKey | null;
}

/**
 * Map a row label to the period field it populates.
 * Returns null if the label is not recognized.
 *
 * `context` is updated as we scan rows so that ambiguous labels like
 * "% vekst" or "% margin" can be resolved by position.
 */
export function mapLabelToField(label: string, ctx?: ParseContext): FieldKey | null {
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
