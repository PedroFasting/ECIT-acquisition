import { useState, useEffect } from "react";
import { useParams, Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import api from "../services/api";
import type { FinancialModel, FinancialPeriod } from "../types";
import { ArrowLeft, Settings, TrendingUp } from "lucide-react";
import { Spinner } from "../components/ui";

export default function ModelDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { t } = useTranslation();
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
    return <Spinner fullPage label={t("modelDetail.loadingModel")} />;
  }

  if (!model) {
    return (
    <div className="p-8 max-w-7xl">
        <p className="text-red-600">{t("modelDetail.modelNotFound")} {error}</p>
      </div>
    );
  }

  const periods = model.periods || [];

  // Financial line items to display
  const lineItems: {
    key: keyof FinancialPeriod;
    labelKey: string;
    format: "number" | "pct" | "growth";
    bold?: boolean;
    indent?: boolean;
    sectionKey?: string;
  }[] = [
    { key: "revenue_managed_services", labelKey: "modelDetail.lineItems.managedServices", format: "number", sectionKey: "modelDetail.sections.revenue" },
    { key: "managed_services_growth", labelKey: "common.growth", format: "pct", indent: true },
    { key: "revenue_professional_services", labelKey: "modelDetail.lineItems.professionalServices", format: "number" },
    { key: "professional_services_growth", labelKey: "common.growth", format: "pct", indent: true },
    { key: "revenue_organic", labelKey: "modelDetail.lineItems.organicRevenue", format: "number", bold: true },
    { key: "organic_growth", labelKey: "common.growth", format: "pct", indent: true },
    { key: "revenue_ma", labelKey: "modelDetail.lineItems.revenueMA", format: "number" },
    { key: "revenue_total", labelKey: "modelDetail.lineItems.totalRevenue", format: "number", bold: true },
    { key: "revenue_growth", labelKey: "common.growth", format: "pct", indent: true },
    { key: "ebitda_managed_services", labelKey: "modelDetail.lineItems.ebitdaManagedServices", format: "number", sectionKey: "modelDetail.sections.ebitda" },
    { key: "margin_managed_services", labelKey: "common.margin", format: "pct", indent: true },
    { key: "ebitda_professional_services", labelKey: "modelDetail.lineItems.ebitdaProfessionalServices", format: "number" },
    { key: "margin_professional_services", labelKey: "common.margin", format: "pct", indent: true },
    { key: "ebitda_central_costs", labelKey: "modelDetail.lineItems.centralCosts", format: "number" },
    { key: "margin_central_costs", labelKey: "common.margin", format: "pct", indent: true },
    { key: "ebitda_organic", labelKey: "modelDetail.lineItems.organicEbitda", format: "number", bold: true },
    { key: "ebitda_margin", labelKey: "common.margin", format: "pct", indent: true },
    { key: "ebitda_ma", labelKey: "modelDetail.lineItems.ebitdaMA", format: "number" },
    { key: "ebitda_total", labelKey: "modelDetail.lineItems.totalEbitda", format: "number", bold: true },
    { key: "cost_synergies", labelKey: "modelDetail.lineItems.costSynergies", format: "number", sectionKey: "modelDetail.sections.cashFlow" },
    { key: "ebitda_incl_synergies", labelKey: "modelDetail.lineItems.ebitdaInclSynergies", format: "number", bold: true },
    { key: "capex", labelKey: "modelDetail.lineItems.totalCapex", format: "number" },
    { key: "capex_pct_revenue", labelKey: "modelDetail.lineItems.capexPctRevenue", format: "pct", indent: true },
    { key: "change_nwc", labelKey: "modelDetail.lineItems.changeNwc", format: "number" },
    { key: "other_cash_flow_items", labelKey: "modelDetail.lineItems.otherCashFlow", format: "number" },
    { key: "operating_fcf", labelKey: "modelDetail.lineItems.operatingFcf", format: "number", bold: true },
    { key: "minority_interest", labelKey: "modelDetail.lineItems.minorityInterest", format: "number" },
    { key: "operating_fcf_excl_minorities", labelKey: "modelDetail.lineItems.operatingFcfExclMinorities", format: "number", bold: true },
    { key: "cash_conversion", labelKey: "modelDetail.lineItems.cashConversion", format: "pct", indent: true },
  ];

  // Equity bridge line items
  const equityBridgeItems: {
    key: keyof FinancialPeriod;
    labelKey: string;
    format: "number" | "pct";
    bold?: boolean;
    indent?: boolean;
    sectionKey?: string;
  }[] = [
    { key: "enterprise_value", labelKey: "modelDetail.equityItems.enterpriseValue", format: "number", bold: true, sectionKey: "modelDetail.sections.valuation" },
    { key: "nibd", labelKey: "modelDetail.equityItems.nibd", format: "number" },
    { key: "option_debt", labelKey: "modelDetail.equityItems.optionDebt", format: "number" },
    { key: "adjustments", labelKey: "modelDetail.equityItems.adjustments", format: "number" },
    { key: "equity_value", labelKey: "modelDetail.equityItems.equityValue", format: "number", bold: true, sectionKey: "modelDetail.sections.equityBridge" },
    { key: "preferred_equity", labelKey: "modelDetail.equityItems.preferredEquity", format: "number" },
    { key: "per_share_pre", labelKey: "modelDetail.equityItems.perSharePre", format: "number", indent: true },
    { key: "mip_amount", labelKey: "modelDetail.equityItems.mip", format: "number" },
    { key: "tso_amount", labelKey: "modelDetail.equityItems.tso", format: "number" },
    { key: "warrants_amount", labelKey: "modelDetail.equityItems.warrants", format: "number" },
    { key: "eqv_post_dilution", labelKey: "modelDetail.equityItems.eqvPostDilution", format: "number", bold: true },
    { key: "per_share_post", labelKey: "modelDetail.equityItems.perSharePost", format: "number", indent: true },
    { key: "share_count", labelKey: "modelDetail.equityItems.shareCount", format: "number", sectionKey: "modelDetail.sections.shares" },
    { key: "acquired_revenue", labelKey: "modelDetail.equityItems.acquiredRevenue", format: "number" },
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
  const parameterLabelKeys: Record<string, string> = {
    shares_at_completion: "modelDetail.paramLabels.sharesAtCompletion",
    shares_at_year_end: "modelDetail.paramLabels.sharesAtYearEnd",
    tso_warrants: "modelDetail.paramLabels.tsoWarrants",
    mip_share_pct: "modelDetail.paramLabels.mipSharePct",
    existing_warrants: "modelDetail.paramLabels.existingWarrants",
    acquisition_multiple: "modelDetail.paramLabels.acquisitionMultiple",
    acquisition_share_pct: "modelDetail.paramLabels.acquisitionSharePct",
    preferred_equity_rate: "modelDetail.paramLabels.preferredEquityRate",
    ev_multiple: "modelDetail.paramLabels.evMultiple",
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
          to={`/companies/${model.company_id}`}
          className="flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700 mb-4"
        >
          <ArrowLeft size={14} />
          {t("modelDetail.back")}
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
          {periods.length} {t("common.periods")}
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
          <p className="text-lg mb-2">{t("modelDetail.noDataYet")}</p>
          <p className="text-sm">
            {t("modelDetail.importViaCompany")}
          </p>
        </div>
      ) : (
        <>
        {/* Financial data table */}
        <div className="bg-white rounded-xl border border-gray-200 overflow-x-auto">
          <table className="ecit-table">
            <thead>
              <tr>
                <th className="text-left sticky left-0 bg-ecit-navy min-w-[220px]">
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
              {lineItems.map((item, _idx) => {
                // Check if any period has data for this line
                const hasData = periods.some(
                  (p) =>
                    (p as any)[item.key] !== null &&
                    (p as any)[item.key] !== undefined
                );
                if (!hasData) return null;

                return (
                  <>
                    {item.sectionKey && (
                      <tr key={`section-${item.sectionKey}`}>
                        <td
                          colSpan={periods.length + 1}
                          className="px-4 py-2 text-xs font-bold text-ecit-navy uppercase tracking-wider !bg-ecit-cream border-t border-gray-200"
                        >
                          {t(item.sectionKey)}
                        </td>
                      </tr>
                    )}
                    <tr
                      key={item.key}
                      className={item.bold ? "!bg-ecit-cream" : ""}
                    >
                      <td
                        className={`sticky left-0 ${
                          item.indent ? "pl-8 text-gray-500 italic" : ""
                        } ${item.bold ? "font-semibold text-gray-900" : "text-gray-700"}`}
                      >
                        {t(item.labelKey)}
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
              <TrendingUp size={18} className="text-ecit-navy" />
              <h2 className="text-lg font-semibold text-gray-900">{t("modelDetail.equityBridge")}</h2>
            </div>
            <div className="bg-white rounded-xl border border-gray-200 overflow-x-auto">
              <table className="ecit-table">
                <thead>
                  <tr>
                     <th className="text-left sticky left-0 bg-ecit-navy min-w-[220px]">
                       {t("modelDetail.valuationAndEquity")}
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
                        {item.sectionKey && (
                          <tr key={`eq-section-${item.sectionKey}`}>
                            <td
                              colSpan={periods.length + 1}
                              className="px-4 py-2 text-xs font-bold text-ecit-navy uppercase tracking-wider !bg-ecit-cream border-t border-gray-200"
                            >
                              {t(item.sectionKey)}
                            </td>
                          </tr>
                        )}
                        <tr
                          key={item.key}
                          className={item.bold ? "!bg-ecit-cream" : ""}
                        >
                          <td
                            className={`sticky left-0 ${
                              item.indent ? "pl-8 text-gray-500 italic" : ""
                            } ${item.bold ? "font-semibold text-gray-900" : "text-gray-700"}`}
                          >
                            {t(item.labelKey)}
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
              <Settings size={18} className="text-ecit-navy" />
              <h2 className="text-lg font-semibold text-gray-900">{t("modelDetail.modelParameters")}</h2>
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
                        {parameterLabelKeys[key] ? t(parameterLabelKeys[key]) : key.replace(/_/g, " ")}
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
