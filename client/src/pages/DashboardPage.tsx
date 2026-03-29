import { useState, useEffect, useMemo } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import api from "../services/api";
import type {
  DashboardSummary,
  DashboardScenario,
  DashboardCompany,
  DashboardActivity,
} from "../types";
import {
  Building2,
  FileSpreadsheet,
  GitMerge,
  ArrowRight,
  Trash2,
  TrendingUp,
  TrendingDown,
  Activity,
  Plus,
  BarChart3,
  Clock,
} from "lucide-react";
import { Spinner, ConfirmModal } from "../components/ui";

/* ─── Helpers ──────────────────────────────────────────────── */

/** Format number as NOKm with 0-1 decimal */
function fmtNokm(v: number | null | undefined): string {
  if (v == null) return "—";
  return `${v >= 1000 ? (v / 1000).toFixed(1) + "mrd" : v.toFixed(0)}`;
}

/** Format percent (value already in %, e.g. 14.8) */
function fmtPct(v: number | null | undefined): string {
  if (v == null) return "—";
  return `${v.toFixed(1)}%`;
}

/** Format multiple (e.g. 7.5x) */
function fmtMult(v: number | null | undefined): string {
  if (v == null) return "—";
  return `${v.toFixed(1)}x`;
}

/** Relative time string */
function timeAgo(
  dateStr: string,
  t: (key: string, opts?: Record<string, unknown>) => string
): string {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diffMs = now - then;
  const mins = Math.floor(diffMs / 60_000);
  if (mins < 1) return t("dashboard.timeAgo.justNow");
  if (mins < 60)
    return t("dashboard.timeAgo.minutesAgo", { count: mins });
  const hours = Math.floor(mins / 60);
  if (hours < 24)
    return t("dashboard.timeAgo.hoursAgo", { count: hours });
  const days = Math.floor(hours / 24);
  if (days < 14)
    return t("dashboard.timeAgo.daysAgo", { count: days });
  const weeks = Math.floor(days / 7);
  return t("dashboard.timeAgo.weeksAgo", { count: weeks });
}

/* ─── Sub-components ───────────────────────────────────────── */

function StatCard({
  label,
  value,
  sub,
  icon: Icon,
  color,
  bg,
}: {
  label: string;
  value: number | string;
  sub?: string;
  icon: React.ElementType;
  color: string;
  bg: string;
}) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-5">
      <div className="flex items-center gap-3">
        <div className={`p-2 rounded-lg ${bg}`}>
          <Icon size={20} className={color} />
        </div>
        <div>
          <p className="text-2xl font-bold text-gray-900">{value}</p>
          <p className="text-xs text-gray-500">{label}</p>
          {sub && <p className="text-[10px] text-gray-400 mt-0.5">{sub}</p>}
        </div>
      </div>
    </div>
  );
}

function StatusBadge({ status, t }: { status: string; t: (k: string) => string }) {
  const styles: Record<string, string> = {
    active: "bg-green-100 text-green-700",
    draft: "bg-amber-100 text-amber-700",
    archived: "bg-gray-100 text-gray-500",
  };
  const labels: Record<string, string> = {
    active: t("dashboard.active"),
    draft: t("dashboard.draft"),
    archived: t("dashboard.archived"),
  };
  return (
    <span className={`px-2 py-0.5 rounded text-xs font-medium ${styles[status] || styles.draft}`}>
      {labels[status] || status}
    </span>
  );
}

function PipelineRow({
  s,
  t,
  onDelete,
}: {
  s: DashboardScenario;
  t: (k: string, opts?: Record<string, unknown>) => string;
  onDelete: (id: number, name: string) => void;
}) {
  const exitRange = useMemo(() => {
    if (!s.exit_multiples || s.exit_multiples.length === 0) return "—";
    const min = Math.min(...s.exit_multiples);
    const max = Math.max(...s.exit_multiples);
    return min === max ? fmtMult(min) : `${fmtMult(min)}–${fmtMult(max)}`;
  }, [s.exit_multiples]);

  return (
    <div className="flex items-center gap-3 p-3 rounded-lg hover:bg-gray-50 transition-colors group">
      <Link
        to={`/scenarios/${s.id}`}
        className="flex items-center gap-3 flex-1 min-w-0"
      >
        <GitMerge size={16} className="text-ecit-navy shrink-0" />
        <div className="flex-1 min-w-0">
          <p className="font-medium text-gray-900 text-sm truncate">{s.name}</p>
          <p className="text-xs text-gray-400 truncate">
            {s.acquirer_company_name} + {s.target_company_name}
          </p>
        </div>
        {/* Key metrics */}
        <div className="hidden md:flex items-center gap-4 text-xs text-gray-500 shrink-0">
          <div className="w-16 text-right" title={t("dashboard.entryMultiple")}>
            <span className="text-gray-400 mr-1">EV/</span>
            {fmtMult(s.entry_multiple)}
          </div>
          <div className="w-20 text-right" title={t("dashboard.exitRange")}>
            {exitRange}
          </div>
          <div className="w-20 text-right" title={t("dashboard.targetEbitda")}>
            {s.target_ebitda != null ? `${fmtNokm(s.target_ebitda)}` : "—"}
          </div>
          <div className="w-20 text-right" title={t("dashboard.pfEbitda")}>
            {s.pf_ebitda != null ? (
              <span className="text-ecit-navy font-medium">{fmtNokm(s.pf_ebitda)}</span>
            ) : (
              "—"
            )}
          </div>
        </div>
        <StatusBadge status={s.status} t={t} />
      </Link>
      <button
        onClick={(e) => {
          e.preventDefault();
          onDelete(s.id, s.name);
        }}
        className="p-1.5 rounded-lg text-gray-300 hover:text-red-500 hover:bg-red-50 transition-colors shrink-0 opacity-0 group-hover:opacity-100"
        title={t("dashboard.deleteScenario")}
      >
        <Trash2 size={14} />
      </button>
    </div>
  );
}

function CompanyCard({ c, t }: { c: DashboardCompany; t: (k: string) => string }) {
  const hasFinancials = c.revenue_total != null;
  const isAcquirer = c.company_type === "acquirer";

  return (
    <Link
      to={`/companies/${c.id}`}
      className="bg-white rounded-xl border border-gray-200 p-4 hover:border-ecit-navy/30 hover:shadow-sm transition-all"
    >
      <div className="flex items-start gap-3 mb-3">
        <Building2
          size={18}
          className={isAcquirer ? "text-ecit-navy mt-0.5" : "text-ecit-accent mt-0.5"}
        />
        <div className="flex-1 min-w-0">
          <p className="font-semibold text-gray-900 text-sm truncate">{c.name}</p>
          <p className="text-xs text-gray-400">
            {isAcquirer ? t("common.acquirer") : t("common.target")}
            {c.sector ? ` · ${c.sector}` : ""}
            {` · ${c.model_count || 0} ${t("common.models")}`}
          </p>
        </div>
      </div>
      {hasFinancials ? (
        <div className="grid grid-cols-3 gap-2 text-xs">
          <div>
            <p className="text-gray-400">{t("common.revenue")}</p>
            <p className="font-semibold text-gray-900">{fmtNokm(c.revenue_total)}</p>
          </div>
          <div>
            <p className="text-gray-400">EBITDA</p>
            <p className="font-semibold text-gray-900">{fmtNokm(c.ebitda_total)}</p>
          </div>
          <div>
            <p className="text-gray-400">{t("common.margin")}</p>
            <p className="font-semibold text-gray-900">{fmtPct(c.ebitda_margin)}</p>
          </div>
          {c.revenue_growth != null && (
            <div className="col-span-3 flex items-center gap-1 mt-1">
              {c.revenue_growth >= 0 ? (
                <TrendingUp size={12} className="text-ecit-positive" />
              ) : (
                <TrendingDown size={12} className="text-ecit-negative" />
              )}
              <span
                className={`text-xs font-medium ${c.revenue_growth >= 0 ? "text-ecit-positive" : "text-ecit-negative"}`}
              >
                {fmtPct(c.revenue_growth)} {t("common.growth")}
              </span>
              {c.period_label && (
                <span className="text-gray-400 text-[10px] ml-auto">{c.period_label}</span>
              )}
            </div>
          )}
        </div>
      ) : (
        <p className="text-xs text-gray-400 italic">{t("dashboard.noFinancialData")}</p>
      )}
    </Link>
  );
}

function ActivityItem({
  a,
  t,
}: {
  a: DashboardActivity;
  t: (k: string, opts?: Record<string, unknown>) => string;
}) {
  const isScenario = a.entity_type === "scenario";
  const link = isScenario ? `/scenarios/${a.id}` : `/companies/${a.id}`;
  const label = isScenario
    ? t("dashboard.updatedScenario")
    : t("dashboard.updatedCompany");

  return (
    <Link
      to={link}
      className="flex items-center gap-3 py-2.5 px-1 hover:bg-gray-50 rounded-lg transition-colors"
    >
      <div
        className={`w-7 h-7 rounded-full flex items-center justify-center shrink-0 ${
          isScenario ? "bg-emerald-50" : "bg-blue-50"
        }`}
      >
        {isScenario ? (
          <GitMerge size={13} className="text-emerald-600" />
        ) : (
          <Building2 size={13} className="text-ecit-navy" />
        )}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm text-gray-900 font-medium truncate">{a.name}</p>
        <p className="text-[11px] text-gray-400">{label}</p>
      </div>
      {a.status && <StatusBadge status={a.status} t={t} />}
      <span className="text-[10px] text-gray-400 shrink-0 w-16 text-right">
        {timeAgo(a.updated_at, t)}
      </span>
    </Link>
  );
}

/* ─── Main Page ────────────────────────────────────────────── */

export default function DashboardPage() {
  const [data, setData] = useState<DashboardSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<{
    id: number;
    name: string;
  } | null>(null);
  const { t } = useTranslation();

  const loadData = async () => {
    try {
      setError("");
      setLoading(true);
      const summary = await api.getDashboardSummary();
      setData(summary);
    } catch (err) {
      console.error(err);
      setError(
        err instanceof Error ? err.message : t("errors.runtimeError")
      );
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const handleDeleteScenarioConfirm = async () => {
    if (!deleteTarget || !data) return;
    try {
      await api.deleteScenario(deleteTarget.id);
      setData({
        ...data,
        scenarios: data.scenarios.filter((s) => s.id !== deleteTarget.id),
        counts: {
          ...data.counts,
          scenarios: data.counts.scenarios - 1,
          active_scenarios:
            data.scenarios.find((s) => s.id === deleteTarget.id)?.status ===
            "active"
              ? data.counts.active_scenarios - 1
              : data.counts.active_scenarios,
          draft_scenarios:
            data.scenarios.find((s) => s.id === deleteTarget.id)?.status ===
            "draft"
              ? data.counts.draft_scenarios - 1
              : data.counts.draft_scenarios,
        },
      });
      setDeleteTarget(null);
    } catch (err) {
      console.error(err);
      setError(
        err instanceof Error ? err.message : t("errors.runtimeError")
      );
      setDeleteTarget(null);
    }
  };

  if (loading) {
    return <Spinner fullPage label={t("common.loading")} />;
  }

  if (!data) {
    return (
      <div className="p-8 max-w-7xl">
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-red-700 text-sm">
          {error || t("errors.runtimeError")}
          <button
            onClick={loadData}
            className="ml-4 text-xs font-medium text-red-600 hover:underline"
          >
            {t("dashboard.retry")}
          </button>
        </div>
      </div>
    );
  }

  const { counts, scenarios, companies, activity } = data;
  const isEmpty = companies.length === 0;

  return (
    <div className="p-8 max-w-7xl">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-gray-900">
          {t("dashboard.title")}
        </h1>
        <p className="text-gray-500 mt-1">{t("dashboard.subtitle")}</p>
      </div>

      {/* Error banner */}
      {error && (
        <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-xl text-red-700 text-sm flex items-center justify-between">
          <span>{error}</span>
          <button
            onClick={() => {
              setError("");
              loadData();
            }}
            className="text-xs font-medium text-red-600 hover:underline ml-4"
          >
            {t("dashboard.retry")}
          </button>
        </div>
      )}

      {/* ─── Stat Cards ──────────────────────────── */}
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4 mb-8">
        <StatCard
          label={t("dashboard.acquirers")}
          value={counts.acquirers}
          icon={Building2}
          color="text-ecit-navy"
          bg="bg-blue-50"
        />
        <StatCard
          label={t("dashboard.targetCompanies")}
          value={counts.targets}
          icon={Building2}
          color="text-ecit-accent"
          bg="bg-sky-50"
        />
        <StatCard
          label={t("dashboard.models")}
          value={counts.models}
          icon={FileSpreadsheet}
          color="text-blue-600"
          bg="bg-blue-50"
        />
        <StatCard
          label={t("dashboard.scenarios")}
          value={counts.scenarios}
          icon={GitMerge}
          color="text-emerald-600"
          bg="bg-emerald-50"
        />
        <StatCard
          label={t("dashboard.activeScenarios")}
          value={counts.active_scenarios}
          icon={BarChart3}
          color="text-ecit-positive"
          bg="bg-green-50"
        />
        <StatCard
          label={t("dashboard.draftScenarios")}
          value={counts.draft_scenarios}
          icon={Clock}
          color="text-amber-600"
          bg="bg-amber-50"
        />
      </div>

      {/* ─── Quick start guide (only when empty) ── */}
      {isEmpty && (
        <div className="bg-white rounded-xl border border-gray-200 p-8 mb-8">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">
            {t("dashboard.getStarted")}
          </h2>
          <div className="space-y-4">
            {[
              {
                step: 1,
                title: t("dashboard.step1Title"),
                desc: t("dashboard.step1Desc"),
                link: "/companies",
              },
              {
                step: 2,
                title: t("dashboard.step2Title"),
                desc: t("dashboard.step2Desc"),
                link: "/companies",
              },
              {
                step: 3,
                title: t("dashboard.step3Title"),
                desc: t("dashboard.step3Desc"),
                link: "/companies",
              },
              {
                step: 4,
                title: t("dashboard.step4Title"),
                desc: t("dashboard.step4Desc"),
                link: "/scenarios",
              },
            ].map((item) => (
              <Link
                key={item.step}
                to={item.link}
                className="flex items-center gap-4 p-4 rounded-lg border border-gray-100 hover:border-ecit-navy hover:bg-blue-50/30 transition-all"
              >
                <div className="w-8 h-8 rounded-full bg-ecit-dark text-white flex items-center justify-center text-sm font-bold">
                  {item.step}
                </div>
                <div className="flex-1">
                  <h3 className="font-medium text-gray-900">{item.title}</h3>
                  <p className="text-sm text-gray-500">{item.desc}</p>
                </div>
                <ArrowRight size={16} className="text-gray-400" />
              </Link>
            ))}
          </div>
        </div>
      )}

      {/* ─── Pipeline (Scenarios) ──────────────── */}
      {!isEmpty && (
        <div className="bg-white rounded-xl border border-gray-200 p-6 mb-6">
          <div className="flex items-center justify-between mb-1">
            <h2 className="text-lg font-semibold text-gray-900">
              {t("dashboard.pipeline")}
            </h2>
            <div className="flex items-center gap-3">
              <Link
                to="/scenarios"
                className="text-sm text-ecit-navy hover:underline"
              >
                {t("dashboard.viewAll")}
              </Link>
            </div>
          </div>
          <p className="text-xs text-gray-400 mb-4">
            {t("dashboard.pipelineDesc")}
          </p>

          {scenarios.length > 0 ? (
            <>
              {/* Column headers (desktop only) */}
              <div className="hidden md:flex items-center gap-3 px-3 pb-2 text-[10px] text-gray-400 uppercase tracking-wider">
                <div className="flex-1" />
                <div className="w-16 text-right">Entry</div>
                <div className="w-20 text-right">{t("dashboard.exitRange")}</div>
                <div className="w-20 text-right">Target</div>
                <div className="w-20 text-right">PF EBITDA</div>
                <div className="w-14" />
                <div className="w-8" />
              </div>
              <div className="space-y-1 divide-y divide-gray-50">
                {scenarios.map((s) => (
                  <PipelineRow
                    key={s.id}
                    s={s}
                    t={t}
                    onDelete={(id, name) => setDeleteTarget({ id, name })}
                  />
                ))}
              </div>
            </>
          ) : (
            <div className="text-center py-8 text-gray-400">
              <GitMerge size={32} className="mx-auto mb-2 opacity-30" />
              <p className="text-sm">{t("dashboard.noScenarios")}</p>
              <p className="text-xs mt-1">{t("dashboard.createFirstScenario")}</p>
              <Link
                to="/scenarios"
                className="inline-flex items-center gap-1.5 mt-3 text-sm text-ecit-navy hover:underline"
              >
                <Plus size={14} /> {t("dashboard.newScenario")}
              </Link>
            </div>
          )}
        </div>
      )}

      {/* ─── Two-column: Companies + Activity ──── */}
      {!isEmpty && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Companies (2/3 width) */}
          <div className="lg:col-span-2">
            <div className="bg-white rounded-xl border border-gray-200 p-6">
              <div className="flex items-center justify-between mb-1">
                <h2 className="text-lg font-semibold text-gray-900">
                  {t("dashboard.companyOverview")}
                </h2>
                <Link
                  to="/companies"
                  className="text-sm text-ecit-navy hover:underline"
                >
                  {t("dashboard.manage")}
                </Link>
              </div>
              <p className="text-xs text-gray-400 mb-4">
                {t("dashboard.companyOverviewDesc")}
              </p>
              <div className="grid gap-4 sm:grid-cols-2">
                {companies.map((c) => (
                  <CompanyCard key={c.id} c={c} t={t} />
                ))}
              </div>
            </div>
          </div>

          {/* Activity feed (1/3 width) */}
          <div className="lg:col-span-1">
            <div className="bg-white rounded-xl border border-gray-200 p-6">
              <div className="flex items-center gap-2 mb-1">
                <Activity size={16} className="text-gray-400" />
                <h2 className="text-lg font-semibold text-gray-900">
                  {t("dashboard.recentActivity")}
                </h2>
              </div>
              <p className="text-xs text-gray-400 mb-4">
                {t("dashboard.recentActivityDesc")}
              </p>
              {activity.length > 0 ? (
                <div className="space-y-0.5">
                  {activity.map((a, i) => (
                    <ActivityItem key={`${a.entity_type}-${a.id}-${i}`} a={a} t={t} />
                  ))}
                </div>
              ) : (
                <p className="text-sm text-gray-400 text-center py-6">—</p>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ─── Delete confirmation ──────────────── */}
      <ConfirmModal
        open={deleteTarget !== null}
        title={t("common.confirmDelete")}
        message={t("dashboard.confirmDeleteScenario", {
          name: deleteTarget?.name ?? "",
        })}
        variant="danger"
        onConfirm={handleDeleteScenarioConfirm}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
}
