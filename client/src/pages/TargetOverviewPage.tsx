import { useState, useEffect, useMemo } from "react";
import { useParams, Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import api from "../services/api";
import type {
  Company,
  FinancialModel,
  FinancialPeriod,
  AcquisitionScenario,
} from "../types";
import { fmt, pct, cagr } from "../components/scenario/helpers";
import {
  ArrowLeft,
  TrendingUp,
  TrendingDown,
  BarChart3,
  DollarSign,
  Layers,
  GitMerge,
  ChevronDown,
  PieChart,
  Activity,
  Building2,
} from "lucide-react";
import { Spinner } from "../components/ui";

// ── Key Metric Card ──────────────────────────────────────────────────────

function MetricCard({
  label,
  value,
  subtitle,
  icon: Icon,
  color = "text-ecit-navy",
  bg = "bg-blue-50",
}: {
  label: string;
  value: string;
  subtitle?: string;
  icon: React.ElementType;
  color?: string;
  bg?: string;
}) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-4">
      <div className="flex items-start gap-3">
        <div className={`p-2 rounded-lg ${bg}`}>
          <Icon size={18} className={color} />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-xs text-gray-500 mb-0.5">{label}</p>
          <p className="text-xl font-bold text-gray-900 tabular-nums">
            {value}
          </p>
          {subtitle && (
            <p className="text-xs text-gray-400 mt-0.5">{subtitle}</p>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Revenue Mix Bar ──────────────────────────────────────────────────────

function RevenueMixBar({
  periods,
}: {
  periods: FinancialPeriod[];
}) {
  const { t } = useTranslation();
  // Use last period with data
  const latestWithData = [...periods]
    .reverse()
    .find(
      (p) =>
        p.revenue_managed_services != null ||
        p.revenue_professional_services != null
    );
  if (!latestWithData) return null;

  const ms = Number(latestWithData.revenue_managed_services) || 0;
  const ps = Number(latestWithData.revenue_professional_services) || 0;
  const other = Number(latestWithData.revenue_other) || 0;
  const total = ms + ps + other;
  if (total === 0) return null;

  const segments = [
    { label: t("targetOverview.managedServices"), value: ms, color: "bg-ecit-navy" },
    { label: t("targetOverview.professionalServices"), value: ps, color: "bg-ecit-accent" },
    { label: t("targetOverview.other"), value: other, color: "bg-ecit-cream" },
  ].filter((s) => s.value > 0);

  return (
    <div>
      <div className="flex h-8 rounded-lg overflow-hidden border border-gray-200">
        {segments.map((s) => (
          <div
            key={s.label}
            className={`${s.color} relative group`}
            style={{ width: `${(s.value / total) * 100}%` }}
          >
            <div className="absolute inset-0 flex items-center justify-center text-xs font-medium text-white opacity-0 group-hover:opacity-100 transition-opacity">
              {((s.value / total) * 100).toFixed(0)}%
            </div>
          </div>
        ))}
      </div>
      <div className="flex gap-4 mt-2">
        {segments.map((s) => (
          <div key={s.label} className="flex items-center gap-1.5 text-xs text-gray-500">
            <div className={`w-2.5 h-2.5 rounded ${s.color}`} />
            <span>
              {s.label}: {fmt(s.value)} ({((s.value / total) * 100).toFixed(0)}%)
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Main Component ───────────────────────────────────────────────────────

export default function TargetOverviewPage() {
  const { id } = useParams<{ id: string }>();
  const { t } = useTranslation();

  const [company, setCompany] = useState<Company | null>(null);
  const [models, setModels] = useState<FinancialModel[]>([]);
  const [selectedModelId, setSelectedModelId] = useState<number | null>(null);
  const [modelDetail, setModelDetail] = useState<FinancialModel | null>(null);
  const [scenarios, setScenarios] = useState<AcquisitionScenario[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // Load company + models + scenarios
  useEffect(() => {
    if (!id) return;
    const companyId = Number(id);
    setLoading(true);

    Promise.all([
      api.getCompany(companyId),
      api.getModels(companyId),
      api.getScenarios(),
    ])
      .then(([comp, mods, scens]) => {
        setCompany(comp);
        setModels(mods);
        // Filter scenarios that reference any of this company's models
        const modelIds = new Set(mods.map((m) => m.id));
        setScenarios(
          scens.filter((s) => modelIds.has(s.target_model_id))
        );
        // Auto-select first model (only if none selected yet)
        if (mods.length > 0) {
          setSelectedModelId((prev) => prev ?? mods[0].id);
        }
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [id]);

  // Load full model detail when selection changes
  useEffect(() => {
    if (!selectedModelId) return;
    api
      .getModel(selectedModelId)
      .then(setModelDetail)
      .catch((err) => setError(err.message));
  }, [selectedModelId]);

  const periods = useMemo(
    () => modelDetail?.periods || [],
    [modelDetail]
  );

  // Derived metrics
  const latestPeriod = periods.length > 0 ? periods[periods.length - 1] : null;
  const firstPeriod = periods.length > 0 ? periods[0] : null;
  const nPeriods = periods.length;

  const revenueCagr = useMemo(() => {
    if (!firstPeriod || !latestPeriod || nPeriods < 2) return null;
    return cagr(
      Number(firstPeriod.revenue_total) || 0,
      Number(latestPeriod.revenue_total) || 0,
      nPeriods - 1
    );
  }, [firstPeriod, latestPeriod, nPeriods]);

  const ebitdaCagr = useMemo(() => {
    if (!firstPeriod || !latestPeriod || nPeriods < 2) return null;
    return cagr(
      Number(firstPeriod.ebitda_total) || 0,
      Number(latestPeriod.ebitda_total) || 0,
      nPeriods - 1
    );
  }, [firstPeriod, latestPeriod, nPeriods]);

  // ── Financial table line items ──
  const lineItems: {
    key: keyof FinancialPeriod;
    label: string;
    format: "number" | "pct";
    bold?: boolean;
    indent?: boolean;
    section?: string;
  }[] = [
    { key: "revenue_managed_services", label: t("targetOverview.lineItems.managedServices"), format: "number", section: t("common.revenue") },
    { key: "revenue_professional_services", label: t("targetOverview.lineItems.professionalServices"), format: "number" },
    { key: "revenue_other", label: t("targetOverview.lineItems.other"), format: "number" },
    { key: "revenue_total", label: t("targetOverview.lineItems.totalRevenue"), format: "number", bold: true },
    { key: "revenue_growth", label: t("targetOverview.lineItems.growthPct"), format: "pct", indent: true },
    { key: "ebitda_managed_services", label: t("targetOverview.lineItems.ebitdaManagedServices"), format: "number", section: t("common.ebitda") },
    { key: "margin_managed_services", label: t("targetOverview.lineItems.marginPct"), format: "pct", indent: true },
    { key: "ebitda_professional_services", label: t("targetOverview.lineItems.ebitdaProfessionalServices"), format: "number" },
    { key: "margin_professional_services", label: t("targetOverview.lineItems.marginPct"), format: "pct", indent: true },
    { key: "ebitda_central_costs", label: t("targetOverview.lineItems.centralCosts"), format: "number" },
    { key: "ebitda_organic", label: t("targetOverview.lineItems.organicEbitda"), format: "number", bold: true },
    { key: "ebitda_margin", label: t("targetOverview.lineItems.marginPct"), format: "pct", indent: true },
    { key: "ebitda_ma", label: t("targetOverview.lineItems.ebitdaMA"), format: "number" },
    { key: "ebitda_total", label: t("targetOverview.lineItems.totalEbitda"), format: "number", bold: true },
    { key: "cost_synergies", label: t("targetOverview.lineItems.costSynergies"), format: "number", section: t("targets.cashflow") },
    { key: "ebitda_incl_synergies", label: t("targetOverview.lineItems.ebitdaInclSynergies"), format: "number", bold: true },
    { key: "capex", label: t("targetOverview.lineItems.capex"), format: "number" },
    { key: "capex_pct_revenue", label: t("targetOverview.lineItems.pctOfRevenue"), format: "pct", indent: true },
    { key: "change_nwc", label: t("targetOverview.lineItems.changeNwc"), format: "number" },
    { key: "other_cash_flow_items", label: t("targetOverview.lineItems.otherCashFlow"), format: "number" },
    { key: "operating_fcf", label: t("targetOverview.lineItems.operatingFcf"), format: "number", bold: true },
    { key: "minority_interest", label: t("targetOverview.lineItems.minorityInterest"), format: "number" },
    { key: "operating_fcf_excl_minorities", label: t("targetOverview.lineItems.operatingFcfExclMinorities"), format: "number", bold: true },
    { key: "cash_conversion", label: t("targetOverview.lineItems.cashConversionPct"), format: "pct", indent: true },
  ];

  // Equity bridge items
  const equityItems: {
    key: keyof FinancialPeriod;
    label: string;
    format: "number" | "pct";
    bold?: boolean;
    indent?: boolean;
    section?: string;
  }[] = [
    { key: "enterprise_value", label: t("targetOverview.equityItems.enterpriseValue"), format: "number", bold: true, section: t("targets.valuation") },
    { key: "nibd", label: t("targetOverview.equityItems.nibd"), format: "number" },
    { key: "option_debt", label: t("targetOverview.equityItems.optionDebt"), format: "number" },
    { key: "adjustments", label: t("targetOverview.equityItems.adjustments"), format: "number" },
    { key: "equity_value", label: t("targetOverview.equityItems.equityValue"), format: "number", bold: true, section: t("targetOverview.equityBridge") },
    { key: "preferred_equity", label: t("targetOverview.equityItems.preferredEquity"), format: "number" },
    { key: "per_share_pre", label: t("targetOverview.equityItems.perSharePre"), format: "number", indent: true },
    { key: "mip_amount", label: t("targetOverview.equityItems.mip"), format: "number" },
    { key: "tso_amount", label: t("targetOverview.equityItems.tso"), format: "number" },
    { key: "warrants_amount", label: t("targetOverview.equityItems.warrants"), format: "number" },
    { key: "eqv_post_dilution", label: t("targetOverview.equityItems.eqvPostDilution"), format: "number", bold: true },
    { key: "per_share_post", label: t("targetOverview.equityItems.perSharePost"), format: "number", indent: true },
    { key: "share_count", label: t("targetOverview.equityItems.shareCount"), format: "number", section: t("modelDetail.sections.shares") },
  ];

  const equityKeys = equityItems.map((i) => i.key);
  const hasEquityData = periods.some((p) =>
    equityKeys.some((k) => (p as any)[k] != null)
  );

  // ── NIBD trend for simple chart ──
  const nibdData = useMemo(() => {
    return periods
      .filter((p) => p.nibd != null)
      .map((p) => ({
        label: p.period_label,
        value: Number(p.nibd),
      }));
  }, [periods]);

  // ── Render ─────────────────────────────────────────────────────────────

  if (loading) {
    return <Spinner fullPage label={t("targetOverview.loading")} />;
  }

  if (!company) {
    return (
      <div className="p-8">
        <p className="text-red-600">{t("targetOverview.companyNotFound")} {error}</p>
      </div>
    );
  }

  return (
    <div className="p-8 max-w-7xl">
      {/* Header */}
      <div className="mb-6">
        <Link
          to="/targets"
          className="flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700 mb-4"
        >
          <ArrowLeft size={14} />
          {t("targetOverview.backToTargets")}
        </Link>
        <div className="flex items-center justify-between">
          <div>
            <div className="flex items-center gap-3">
              <div className="p-2.5 rounded-xl bg-sky-50">
                <Building2 size={24} className="text-ecit-accent" />
              </div>
              <div>
                <h1 className="text-2xl font-bold text-gray-900">
                  {company.name}
                </h1>
                <div className="flex items-center gap-3 mt-0.5 text-sm text-gray-500">
                  {company.sector && <span>{company.sector}</span>}
                  {company.country && (
                    <>
                      <span className="text-gray-300">|</span>
                      <span>{company.country}</span>
                    </>
                  )}
                  <span className="text-gray-300">|</span>
                  <span>{company.currency}</span>
                </div>
              </div>
            </div>
            {company.description && (
              <p className="text-gray-500 mt-2 text-sm max-w-2xl">
                {company.description}
              </p>
            )}
          </div>

          {/* Model selector */}
          {models.length > 1 && (
            <div className="relative">
              <select
                value={selectedModelId || ""}
                onChange={(e) => setSelectedModelId(Number(e.target.value))}
                className="appearance-none bg-white border border-gray-200 rounded-lg px-4 py-2.5 pr-10 text-sm font-medium text-gray-700 focus:ring-2 focus:ring-ecit-navy outline-none cursor-pointer"
              >
                {models.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}{" "}
                    ({m.model_type})
                  </option>
                ))}
              </select>
              <ChevronDown
                size={16}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none"
              />
            </div>
          )}
        </div>
      </div>

      {error && (
        <div className="bg-red-50 text-red-700 px-4 py-3 rounded-lg mb-6 text-sm">
          {error}
        </div>
      )}

      {periods.length === 0 ? (
         <div className="bg-white rounded-xl border border-dashed border-gray-300 p-12 text-center text-gray-400">
           <p className="text-lg mb-2">{t("targetOverview.noFinancialData")}</p>
           <p className="text-sm">
             {t("targetOverview.importDataVia")}{" "}
             <Link to={`/companies/${company.id}`} className="text-ecit-accent underline">
               {t("targetOverview.companyPage")}
             </Link>
           </p>
         </div>
      ) : (
        <>
          {/* ── Key Metrics Cards ─────────────────────────────────── */}
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3 mb-6">
            <MetricCard
              label={t("targetOverview.revenueLatest")}
              value={fmt(latestPeriod?.revenue_total)}
              subtitle={latestPeriod?.period_label}
              icon={DollarSign}
              color="text-ecit-navy"
              bg="bg-blue-50"
            />
            <MetricCard
              label={t("targetOverview.ebitdaLatest")}
              value={fmt(latestPeriod?.ebitda_total)}
              subtitle={t("targetOverview.marginLabel", { value: pct(latestPeriod?.ebitda_margin) })}
              icon={BarChart3}
              color="text-emerald-600"
              bg="bg-emerald-50"
            />
            <MetricCard
              label={t("targetOverview.ebitdaMargin")}
              value={pct(latestPeriod?.ebitda_margin)}
              subtitle={latestPeriod?.period_label}
              icon={Activity}
              color="text-amber-600"
              bg="bg-amber-50"
            />
            <MetricCard
              label={t("targetOverview.nibd")}
              value={fmt(latestPeriod?.nibd)}
              subtitle={latestPeriod?.period_label}
              icon={Layers}
              color="text-red-600"
              bg="bg-red-50"
            />
            <MetricCard
              label={t("targetOverview.revenueCagr")}
              value={revenueCagr != null ? pct(revenueCagr) : "-"}
              subtitle={
                firstPeriod && latestPeriod
                  ? `${firstPeriod.period_label}-${latestPeriod.period_label}`
                  : undefined
              }
              icon={TrendingUp}
              color="text-ecit-accent"
              bg="bg-sky-50"
            />
            <MetricCard
              label={t("targetOverview.ebitdaCagr")}
              value={ebitdaCagr != null ? pct(ebitdaCagr) : "-"}
              subtitle={
                firstPeriod && latestPeriod
                  ? `${firstPeriod.period_label}-${latestPeriod.period_label}`
                  : undefined
              }
              icon={TrendingUp}
              color="text-purple-600"
              bg="bg-purple-50"
            />
          </div>

          {/* ── Revenue Mix ───────────────────────────────────────── */}
          <div className="bg-white rounded-xl border border-gray-200 p-5 mb-6">
            <div className="flex items-center gap-2 mb-3">
              <PieChart size={16} className="text-ecit-navy" />
              <h2 className="text-sm font-semibold text-gray-900">
                {t("targetOverview.revenueMix", { period: latestPeriod?.period_label })}
              </h2>
            </div>
            <RevenueMixBar periods={periods} />
          </div>

          {/* ── EBITDA Trend Mini Chart ────────────────────────────── */}
          <div className="bg-white rounded-xl border border-gray-200 p-5 mb-6">
            <div className="flex items-center gap-2 mb-3">
              <BarChart3 size={16} className="text-emerald-600" />
              <h2 className="text-sm font-semibold text-gray-900">
                {t("targetOverview.ebitdaMarginTrend")}
              </h2>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-200">
                     <th className="text-left py-2 px-3 text-xs text-gray-500 font-medium">
                       {t("targetOverview.period")}
                     </th>
                    {periods.map((p) => (
                      <th
                        key={p.id}
                        className="text-right py-2 px-3 text-xs text-gray-500 font-medium"
                      >
                        {p.period_label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  <tr className="border-b border-gray-100">
                     <td className="py-2 px-3 text-gray-700 font-medium">
                       {t("targetOverview.revenue")}
                     </td>
                    {periods.map((p) => (
                      <td
                        key={p.id}
                        className="text-right py-2 px-3 tabular-nums"
                      >
                        {fmt(p.revenue_total)}
                      </td>
                    ))}
                  </tr>
                  <tr className="border-b border-gray-100">
                     <td className="py-2 px-3 text-gray-700 font-medium">
                       {t("targetOverview.ebitda")}
                     </td>
                    {periods.map((p) => (
                      <td
                        key={p.id}
                        className="text-right py-2 px-3 tabular-nums font-semibold"
                      >
                        {fmt(p.ebitda_total)}
                      </td>
                    ))}
                  </tr>
                  <tr className="border-b border-gray-100">
                     <td className="py-2 px-3 text-gray-500 italic pl-6">
                       {t("targetOverview.margin")}
                     </td>
                    {periods.map((p) => (
                      <td
                        key={p.id}
                        className="text-right py-2 px-3 tabular-nums text-gray-500 italic"
                      >
                        {pct(p.ebitda_margin)}
                      </td>
                    ))}
                  </tr>
                  {/* EBITDA bar visualization */}
                  <tr>
                    <td className="py-2 px-3"></td>
                    {periods.map((p) => {
                      const maxEbitda = Math.max(
                        ...periods
                          .map((pp) => Number(pp.ebitda_total) || 0)
                      );
                      const ebitda = Number(p.ebitda_total) || 0;
                      const heightPct =
                        maxEbitda > 0 ? (ebitda / maxEbitda) * 100 : 0;
                      return (
                        <td key={p.id} className="px-3 py-1">
                          <div className="flex items-end justify-center h-16">
                            <div
                              className="w-8 bg-emerald-500/20 rounded-t border-t-2 border-emerald-500 transition-all"
                              style={{ height: `${heightPct}%` }}
                            />
                          </div>
                        </td>
                      );
                    })}
                  </tr>
                </tbody>
              </table>
            </div>
          </div>

          {/* ── NIBD Trend ──────────────────────────────────────── */}
          {nibdData.length > 0 && (
            <div className="bg-white rounded-xl border border-gray-200 p-5 mb-6">
              <div className="flex items-center gap-2 mb-3">
                <TrendingDown size={16} className="text-red-500" />
                 <h2 className="text-sm font-semibold text-gray-900">
                   {t("targetOverview.nibdTrajectory")}
                 </h2>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-200">
                       <th className="text-left py-2 px-3 text-xs text-gray-500 font-medium">
                         {t("targetOverview.period")}
                       </th>
                      {nibdData.map((d) => (
                        <th
                          key={d.label}
                          className="text-right py-2 px-3 text-xs text-gray-500 font-medium"
                        >
                          {d.label}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    <tr className="border-b border-gray-100">
                       <td className="py-2 px-3 text-gray-700 font-medium">
                         {t("targetOverview.nibd")}
                       </td>
                      {nibdData.map((d) => (
                        <td
                          key={d.label}
                          className={`text-right py-2 px-3 tabular-nums font-semibold ${
                            d.value < 0 ? "text-red-600" : "text-gray-900"
                          }`}
                        >
                          {fmt(d.value)}
                        </td>
                      ))}
                    </tr>
                    {/* Leverage if EBITDA available */}
                    {periods.some((p) => p.ebitda_total != null && p.nibd != null) && (
                      <tr>
                         <td className="py-2 px-3 text-gray-500 italic pl-6">
                           {t("targetOverview.leverage")}
                         </td>
                        {periods
                          .filter((p) => p.nibd != null)
                          .map((p) => {
                            const leverage =
                              p.ebitda_total && Number(p.ebitda_total) !== 0
                                ? Number(p.nibd) / Number(p.ebitda_total)
                                : null;
                            return (
                              <td
                                key={p.period_label}
                                className="text-right py-2 px-3 tabular-nums text-gray-500 italic"
                              >
                                {leverage != null
                                  ? `${leverage.toLocaleString("nb-NO", {
                                      minimumFractionDigits: 1,
                                      maximumFractionDigits: 1,
                                    })}x`
                                  : "-"}
                              </td>
                            );
                          })}
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* ── Full Financial Table ───────────────────────────────── */}
          <div className="bg-white rounded-xl border border-gray-200 overflow-x-auto mb-6">
            <table className="ecit-table">
              <thead>
                <tr>
                  <th className="text-left sticky left-0 bg-ecit-navy min-w-[220px]">
                    {company.name}
                    {modelDetail && ` (${modelDetail.name})`}
                  </th>
                  {periods.map((p) => (
                    <th key={p.id} className="num min-w-[90px]">
                      {p.period_label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {lineItems.map((item) => {
                  const hasData = periods.some(
                    (p) => (p as any)[item.key] != null
                  );
                  if (!hasData) return null;
                  return (
                    <tr key={item.key}>
                      {item.section && (
                        <td
                          colSpan={0}
                          className="hidden"
                        />
                      )}
                      <td
                        className={`sticky left-0 ${
                          item.indent
                            ? "pl-8 text-gray-500 italic"
                            : ""
                        } ${
                          item.bold
                            ? "font-semibold text-gray-900"
                            : "text-gray-700"
                        }`}
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
                          {item.format === "pct"
                            ? pct((p as any)[item.key])
                            : fmt((p as any)[item.key])}
                        </td>
                      ))}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* ── Equity Bridge ──────────────────────────────────────── */}
          {hasEquityData && (
            <div className="mb-6">
              <div className="flex items-center gap-2 mb-3">
                <TrendingUp size={16} className="text-ecit-navy" />
                 <h2 className="text-sm font-semibold text-gray-900">
                   {t("targetOverview.equityBridge")}
                 </h2>
              </div>
              <div className="bg-white rounded-xl border border-gray-200 overflow-x-auto">
                <table className="ecit-table">
                  <thead>
                    <tr>
                       <th className="text-left sticky left-0 bg-ecit-navy min-w-[220px]">
                         {t("targetOverview.valuationAndEquity")}
                       </th>
                      {periods.map((p) => (
                        <th key={p.id} className="num min-w-[90px]">
                          {p.period_label}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {equityItems.map((item) => {
                      const hasData = periods.some(
                        (p) => (p as any)[item.key] != null
                      );
                      if (!hasData) return null;
                      return (
                        <tr
                          key={item.key}
                          className={item.bold ? "!bg-ecit-cream" : ""}
                        >
                          <td
                            className={`sticky left-0 ${
                              item.indent
                                ? "pl-8 text-gray-500 italic"
                                : ""
                            } ${
                              item.bold
                                ? "font-semibold text-gray-900"
                                : "text-gray-700"
                            }`}
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
                              {fmt((p as any)[item.key])}
                            </td>
                          ))}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* ── Linked Scenarios ───────────────────────────────────── */}
          {scenarios.length > 0 && (
            <div className="bg-white rounded-xl border border-gray-200 p-5">
              <div className="flex items-center gap-2 mb-3">
                <GitMerge size={16} className="text-emerald-600" />
                 <h2 className="text-sm font-semibold text-gray-900">
                   {t("targetOverview.linkedScenarios", { count: scenarios.length })}
                 </h2>
              </div>
              <div className="space-y-2">
                {scenarios.map((s) => (
                  <Link
                    key={s.id}
                    to={`/scenarios/${s.id}`}
                    className="flex items-center gap-3 p-3 rounded-lg hover:bg-gray-50 transition-colors border border-gray-100"
                  >
                    <GitMerge size={14} className="text-ecit-navy shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-gray-900 truncate">
                        {s.name}
                      </p>
                      <p className="text-xs text-gray-400">
                        {s.acquirer_company_name} + {s.target_company_name}
                        {s.acquirer_model_name && ` (${s.acquirer_model_name})`}
                      </p>
                    </div>
                    <span
                      className={`px-2 py-0.5 rounded text-xs shrink-0 ${
                        s.status === "active"
                          ? "bg-green-100 text-green-700"
                          : "bg-amber-100 text-amber-700"
                      }`}
                    >
                     {s.status === "active"
                       ? t("targetOverview.active")
                       : s.status === "draft"
                       ? t("targetOverview.draft")
                       : t("targetOverview.archived")}
                    </span>
                  </Link>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
