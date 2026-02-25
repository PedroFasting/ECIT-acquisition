import { useState, useEffect } from "react";
import { useParams, Link } from "react-router-dom";
import api from "../services/api";
import type { FinancialModel, FinancialPeriod } from "../types";
import { ArrowLeft, Settings, TrendingUp } from "lucide-react";

export default function ModelDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [model, setModel] = useState<FinancialModel | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!id) return;
    api
      .getModel(Number(id))
      .then(setModel)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [id]);

  if (loading) {
    return (
      <div className="p-8 flex items-center justify-center h-full">
        <div className="text-gray-400">Laster modell...</div>
      </div>
    );
  }

  if (!model) {
    return (
      <div className="p-8">
        <p className="text-red-600">Modell ikke funnet. {error}</p>
      </div>
    );
  }

  const periods = model.periods || [];

  // Financial line items to display
  const lineItems: {
    key: keyof FinancialPeriod;
    label: string;
    format: "number" | "pct" | "growth";
    bold?: boolean;
    indent?: boolean;
    section?: string;
  }[] = [
    { key: "revenue_managed_services", label: "Managed services", format: "number", section: "Revenue" },
    { key: "managed_services_growth", label: "% vekst", format: "pct", indent: true },
    { key: "revenue_professional_services", label: "Professional services", format: "number" },
    { key: "professional_services_growth", label: "% vekst", format: "pct", indent: true },
    { key: "revenue_organic", label: "Organisk omsetning", format: "number", bold: true },
    { key: "organic_growth", label: "% vekst", format: "pct", indent: true },
    { key: "revenue_ma", label: "Revenue - M&A", format: "number" },
    { key: "revenue_total", label: "Total omsetning", format: "number", bold: true },
    { key: "revenue_growth", label: "% vekst", format: "pct", indent: true },
    { key: "ebitda_managed_services", label: "EBITDA Managed services", format: "number", section: "EBITDA" },
    { key: "margin_managed_services", label: "% margin", format: "pct", indent: true },
    { key: "ebitda_professional_services", label: "EBITDA Professional services", format: "number" },
    { key: "margin_professional_services", label: "% margin", format: "pct", indent: true },
    { key: "ebitda_central_costs", label: "Sentrale kostnader", format: "number" },
    { key: "margin_central_costs", label: "% margin", format: "pct", indent: true },
    { key: "ebitda_organic", label: "Organic EBITDA (pre-IFRS)", format: "number", bold: true },
    { key: "ebitda_margin", label: "% margin", format: "pct", indent: true },
    { key: "ebitda_ma", label: "EBITDA - M&A", format: "number" },
    { key: "ebitda_total", label: "Total EBITDA (pre-IFRS)", format: "number", bold: true },
    { key: "cost_synergies", label: "Kostnadssynergier", format: "number", section: "Kontantstrøm" },
    { key: "ebitda_incl_synergies", label: "EBITDA inkl. synergier", format: "number", bold: true },
    { key: "capex", label: "Totale investeringer", format: "number" },
    { key: "capex_pct_revenue", label: "% of revenue", format: "pct", indent: true },
    { key: "change_nwc", label: "Total endring i arbeidskapital", format: "number" },
    { key: "other_cash_flow_items", label: "Andre kontantstrømposter", format: "number" },
    { key: "operating_fcf", label: "Operasjonell FCF", format: "number", bold: true },
    { key: "minority_interest", label: "Minoritetsinteresser", format: "number" },
    { key: "operating_fcf_excl_minorities", label: "Operasjonell FCF (ekskl. minoriteter)", format: "number", bold: true },
    { key: "cash_conversion", label: "% kontantkonvertering", format: "pct", indent: true },
  ];

  // Equity bridge line items
  const equityBridgeItems: {
    key: keyof FinancialPeriod;
    label: string;
    format: "number" | "pct";
    bold?: boolean;
    indent?: boolean;
    section?: string;
  }[] = [
    { key: "enterprise_value", label: "Enterprise Value (EV)", format: "number", bold: true, section: "Verdsettelse" },
    { key: "nibd", label: "NIBD (inkl. diverse)", format: "number" },
    { key: "option_debt", label: "Opsjonsgjeld", format: "number" },
    { key: "adjustments", label: "Justeringer", format: "number" },
    { key: "equity_value", label: "Egenkapitalverdi (EQV)", format: "number", bold: true, section: "Egenkapitalbrygge" },
    { key: "preferred_equity", label: "Preferanseaksjer", format: "number" },
    { key: "per_share_pre", label: "Per aksje (pre-dilution)", format: "number", indent: true },
    { key: "mip_amount", label: "MIP", format: "number" },
    { key: "tso_amount", label: "TSO", format: "number" },
    { key: "warrants_amount", label: "Tegningsretter", format: "number" },
    { key: "eqv_post_dilution", label: "EQV (post MIP, TSO, Warrants)", format: "number", bold: true },
    { key: "per_share_post", label: "Per aksje (post-dilution)", format: "number", indent: true },
    { key: "share_count", label: "Antall aksjer", format: "number", section: "Aksjer" },
    { key: "acquired_revenue", label: "Omsetning fra oppkjøp", format: "number" },
  ];

  // Check if equity bridge has any data
  const equityBridgeKeys = equityBridgeItems.map((item) => item.key);
  const hasEquityBridgeData = periods.some((p) =>
    equityBridgeKeys.some(
      (k) => (p as any)[k] !== null && (p as any)[k] !== undefined
    )
  );

  // Check if model parameters exist
  const params = model.model_parameters;
  const hasModelParameters = params && Object.keys(params).length > 0;

  // Format parameter labels for display
  const parameterLabels: Record<string, string> = {
    shares_at_completion: "Aksjer ved completion",
    shares_at_year_end: "Aksjer ved årsslutt",
    tso_warrants: "TSO warrants",
    mip_share_pct: "MIP-andel (%)",
    existing_warrants: "Eksisterende warrants",
    acquisition_multiple: "Oppkjøpsmultippel",
    acquisition_share_pct: "Oppkjøp med aksjer (%)",
    preferred_equity_rate: "Preferanseavkastning (%)",
    ev_multiple: "EV-multippel",
  };

  const formatValue = (val: any, format: string) => {
    if (val === null || val === undefined) return "-";
    const num = typeof val === "string" ? parseFloat(val) : val;
    if (isNaN(num)) return "-";

    if (format === "pct") {
      // Stored as decimal (0.158 = 15.8%)
      return `${(num * 100).toLocaleString("nb-NO", { minimumFractionDigits: 1, maximumFractionDigits: 1 })} %`;
    }
    // Number format with parentheses for negatives
    if (num < 0) return `(${Math.abs(num).toLocaleString("nb-NO", { minimumFractionDigits: 1, maximumFractionDigits: 1 })})`;
    return num.toLocaleString("nb-NO", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  };

  return (
    <div className="p-8">
      {/* Header */}
      <div className="mb-6">
        <Link
          to={`/companies/${model.company_name ? "" : ""}`.replace(/\/$/, "") || "/companies"}
          className="flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700 mb-4"
        >
          <ArrowLeft size={14} />
          Tilbake
        </Link>
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-bold text-gray-900">
            {model.company_name} - {model.name}
          </h1>
          <span className="px-2.5 py-0.5 bg-gray-100 text-gray-600 text-xs rounded-full">
            {model.model_type}
          </span>
        </div>
        <p className="text-gray-500 mt-1">
          {periods.length} perioder
          {model.description && ` | ${model.description}`}
        </p>
      </div>

      {error && (
        <div className="bg-red-50 text-red-700 px-4 py-3 rounded-lg mb-6 text-sm">
          {error}
        </div>
      )}

      {periods.length === 0 ? (
        <div className="bg-white rounded-xl border border-dashed border-gray-300 p-12 text-center text-gray-400">
          <p className="text-lg mb-2">Ingen data ennå</p>
          <p className="text-sm">
            Importer JSON eller CSV-data via selskapssiden
          </p>
        </div>
      ) : (
        <>
        {/* Financial data table */}
        <div className="bg-white rounded-xl border border-gray-200 overflow-x-auto">
          <table className="ecit-table">
            <thead>
              <tr>
                <th className="text-left sticky left-0 bg-[#002C55] min-w-[220px]">
                  {model.company_name} ({model.name})
                </th>
                {periods.map((p) => (
                  <th
                    key={p.id}
                    className={`num min-w-[90px]`}
                  >
                    {p.period_label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {lineItems.map((item, idx) => {
                // Check if any period has data for this line
                const hasData = periods.some(
                  (p) =>
                    (p as any)[item.key] !== null &&
                    (p as any)[item.key] !== undefined
                );
                if (!hasData) return null;

                return (
                  <>
                    {item.section && (
                      <tr key={`section-${item.section}`}>
                        <td
                          colSpan={periods.length + 1}
                          className="px-4 py-2 text-xs font-bold text-[#002C55] uppercase tracking-wider !bg-[#F4EDDC] border-t border-gray-200"
                        >
                          {item.section}
                        </td>
                      </tr>
                    )}
                    <tr
                      key={item.key}
                      className={item.bold ? "!bg-[#F4EDDC]" : ""}
                    >
                      <td
                        className={`sticky left-0 ${
                          item.indent ? "pl-8 text-gray-500 italic" : ""
                        } ${item.bold ? "font-semibold text-gray-900" : "text-gray-700"}`}
                      >
                        {item.label}
                      </td>
                      {periods.map((p) => (
                        <td
                          key={p.id}
                          className={`num ${
                            item.bold ? "font-semibold" : ""
                          } ${
                            item.format === "pct"
                              ? "text-gray-500 italic"
                              : ""
                          }`}
                        >
                          {formatValue((p as any)[item.key], item.format)}
                        </td>
                      ))}
                    </tr>
                  </>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Equity Bridge Table */}
        {hasEquityBridgeData && (
          <div className="mt-8">
            <div className="flex items-center gap-2 mb-4">
              <TrendingUp size={18} className="text-[#002C55]" />
              <h2 className="text-lg font-semibold text-gray-900">Egenkapitalbrygge</h2>
            </div>
            <div className="bg-white rounded-xl border border-gray-200 overflow-x-auto">
              <table className="ecit-table">
                <thead>
                  <tr>
                    <th className="text-left sticky left-0 bg-[#002C55] min-w-[220px]">
                      Verdsettelse & Egenkapital
                    </th>
                    {periods.map((p) => (
                      <th
                        key={p.id}
                        className={`num min-w-[90px]`}
                      >
                        {p.period_label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {equityBridgeItems.map((item) => {
                    const hasData = periods.some(
                      (p) =>
                        (p as any)[item.key] !== null &&
                        (p as any)[item.key] !== undefined
                    );
                    if (!hasData) return null;

                    return (
                      <>
                        {item.section && (
                          <tr key={`eq-section-${item.section}`}>
                            <td
                              colSpan={periods.length + 1}
                              className="px-4 py-2 text-xs font-bold text-[#002C55] uppercase tracking-wider !bg-[#F4EDDC] border-t border-gray-200"
                            >
                              {item.section}
                            </td>
                          </tr>
                        )}
                        <tr
                          key={item.key}
                          className={item.bold ? "!bg-[#F4EDDC]" : ""}
                        >
                          <td
                            className={`sticky left-0 ${
                              item.indent ? "pl-8 text-gray-500 italic" : ""
                            } ${item.bold ? "font-semibold text-gray-900" : "text-gray-700"}`}
                          >
                            {item.label}
                          </td>
                          {periods.map((p) => (
                            <td
                              key={p.id}
                              className={`num ${
                                item.bold ? "font-semibold" : ""
                              }`}
                            >
                              {formatValue((p as any)[item.key], item.format)}
                            </td>
                          ))}
                        </tr>
                      </>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Model Parameters Card */}
        {hasModelParameters && (
          <div className="mt-8">
            <div className="flex items-center gap-2 mb-4">
              <Settings size={18} className="text-[#002C55]" />
              <h2 className="text-lg font-semibold text-gray-900">Modellparametere</h2>
            </div>
            <div className="bg-white rounded-xl border border-gray-200 p-5">
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
                {Object.entries(params!).map(([key, value]) => {
                  if (value === null || value === undefined) return null;

                  let displayValue: string;
                  if (typeof value === "object" && value !== null) {
                    // Handle nested objects like tso_warrants: { count, strike }
                    const obj = value as Record<string, any>;
                    displayValue = Object.entries(obj)
                      .map(([k, v]) => `${k}: ${typeof v === "number" ? v.toLocaleString("nb-NO") : v}`)
                      .join(", ");
                  } else if (typeof value === "number") {
                    // Format percentages differently
                    if (key.includes("pct") || key.includes("rate")) {
                      displayValue = `${(value * 100).toLocaleString("nb-NO", { minimumFractionDigits: 1, maximumFractionDigits: 1 })} %`;
                    } else if (key.includes("multiple")) {
                      displayValue = `${value.toLocaleString("nb-NO", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}x`;
                    } else {
                      displayValue = value.toLocaleString("nb-NO");
                    }
                  } else {
                    displayValue = String(value);
                  }

                  return (
                    <div key={key} className="p-3 bg-gray-50 rounded-lg">
                      <p className="text-xs text-gray-500 mb-1">
                        {parameterLabels[key] || key.replace(/_/g, " ")}
                      </p>
                      <p className="text-sm font-medium text-gray-900">{displayValue}</p>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}
      </>
    )}
    </div>
  );
}
