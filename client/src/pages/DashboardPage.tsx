import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import api from "../services/api";
import type { Company, AcquisitionScenario } from "../types";
import { Building2, FileSpreadsheet, GitMerge, ArrowRight, Trash2 } from "lucide-react";
import { Spinner, ConfirmModal } from "../components/ui";

export default function DashboardPage() {
  const [companies, setCompanies] = useState<Company[]>([]);
  const [scenarios, setScenarios] = useState<AcquisitionScenario[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<{ id: number; name: string } | null>(null);
  const { t } = useTranslation();

  const loadData = async () => {
    try {
      setError("");
      const [comps, scens] = await Promise.all([
        api.getCompanies(),
        api.getScenarios(),
      ]);
      setCompanies(comps);
      setScenarios(scens);
    } catch (err) {
      console.error(err);
      setError(err instanceof Error ? err.message : t("errors.loadFailed"));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const handleDeleteScenarioClick = (id: number, name: string) => {
    setDeleteTarget({ id, name });
  };

  const handleDeleteScenarioConfirm = async () => {
    if (!deleteTarget) return;
    try {
      await api.deleteScenario(deleteTarget.id);
      setDeleteTarget(null);
      setScenarios((prev) => prev.filter((s) => s.id !== deleteTarget.id));
    } catch (err) {
      console.error(err);
      setError(err instanceof Error ? err.message : t("errors.deleteFailed"));
      setDeleteTarget(null);
    }
  };

  if (loading) {
    return <Spinner fullPage label={t("common.loading")} />;
  }

  const acquirers = companies.filter((c) => c.company_type === "acquirer");
  const targets = companies.filter((c) => c.company_type === "target");
  const totalModels = companies.reduce(
    (sum, c) => sum + (Number(c.model_count) || 0),
    0
  );

  return (
    <div className="p-8 max-w-7xl">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-gray-900">{t("dashboard.title")}</h1>
        <p className="text-gray-500 mt-1">
          {t("dashboard.subtitle")}
        </p>
      </div>

      {/* Error banner */}
      {error && (
        <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-xl text-red-700 text-sm flex items-center justify-between">
          <span>{error}</span>
          <button onClick={() => { setError(""); loadData(); }} className="text-xs font-medium text-red-600 hover:underline ml-4">{t("common.retry") || "Retry"}</button>
        </div>
      )}

      {/* Stats */}
      <div className="grid grid-cols-4 gap-4 mb-8">
        {[
          {
            label: t("dashboard.acquirers"),
            value: acquirers.length,
            icon: Building2,
            color: "text-ecit-navy",
            bg: "bg-blue-50",
          },
          {
            label: t("dashboard.targetCompanies"),
            value: targets.length,
            icon: Building2,
            color: "text-ecit-accent",
            bg: "bg-sky-50",
          },
          {
            label: t("dashboard.models"),
            value: totalModels,
            icon: FileSpreadsheet,
            color: "text-blue-600",
            bg: "bg-blue-50",
          },
          {
            label: t("dashboard.scenarios"),
            value: scenarios.length,
            icon: GitMerge,
            color: "text-emerald-600",
            bg: "bg-emerald-50",
          },
        ].map((stat, i) => (
          <div
            key={i}
            className="bg-white rounded-xl border border-gray-200 p-5"
          >
            <div className="flex items-center gap-3">
              <div className={`p-2 rounded-lg ${stat.bg}`}>
                <stat.icon size={20} className={stat.color} />
              </div>
              <div>
                <p className="text-2xl font-bold text-gray-900">{stat.value}</p>
                <p className="text-xs text-gray-500">{stat.label}</p>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Quick start guide */}
      {companies.length === 0 && (
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

      {/* Recent scenarios */}
      {scenarios.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-gray-900">
              {t("dashboard.recentScenarios")}
            </h2>
            <Link
              to="/scenarios"
              className="text-sm text-ecit-navy hover:underline"
            >
              {t("dashboard.viewAll")}
            </Link>
          </div>
          <div className="space-y-3">
            {scenarios.slice(0, 5).map((s) => (
              <div
                key={s.id}
                className="flex items-center gap-3 p-3 rounded-lg hover:bg-gray-50 transition-colors"
              >
                <Link
                  to={`/scenarios/${s.id}`}
                  className="flex items-center gap-3 flex-1 min-w-0"
                >
                  <GitMerge size={16} className="text-ecit-navy shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-gray-900 text-sm truncate">
                      {s.name}
                    </p>
                    <p className="text-xs text-gray-400">
                      {s.acquirer_company_name} + {s.target_company_name}
                    </p>
                  </div>
                  <span
                    className={`px-2 py-0.5 rounded text-xs shrink-0 ${
                      s.status === "active"
                        ? "bg-green-100 text-green-700"
                        : "bg-amber-100 text-amber-700"
                    }`}
                  >
                    {s.status === "active" ? t("dashboard.active") : s.status === "draft" ? t("dashboard.draft") : t("dashboard.archived")}
                  </span>
                </Link>
                <button
                  onClick={() => handleDeleteScenarioClick(s.id, s.name)}
                  className="p-1.5 rounded-lg text-gray-300 hover:text-red-500 hover:bg-red-50 transition-colors shrink-0"
                  title={t("dashboard.deleteScenario")}
                >
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Companies list */}
      {companies.length > 0 && (
        <div className="mt-6 bg-white rounded-xl border border-gray-200 p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-gray-900">
              {t("dashboard.companies")}
            </h2>
            <Link
              to="/companies"
              className="text-sm text-ecit-navy hover:underline"
            >
              {t("dashboard.manage")}
            </Link>
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            {companies.map((c) => (
              <Link
                key={c.id}
                to={`/companies/${c.id}`}
                className="flex items-center gap-3 p-3 rounded-lg hover:bg-gray-50 transition-colors border border-gray-100"
              >
                <Building2
                  size={16}
                  className={
                    c.company_type === "acquirer"
                      ? "text-ecit-navy"
                      : "text-ecit-accent"
                  }
                />
                <div className="flex-1">
                  <p className="font-medium text-gray-900 text-sm">{c.name}</p>
                  <p className="text-xs text-gray-400">
                    {c.company_type === "acquirer" ? t("common.acquirer") : t("common.target")} |{" "}
                    {c.model_count || 0} {t("common.models")}
                  </p>
                </div>
              </Link>
            ))}
          </div>
        </div>
      )}

      <ConfirmModal
        open={deleteTarget !== null}
        title={t("common.confirmDelete")}
        message={t("dashboard.confirmDeleteScenario", { name: deleteTarget?.name ?? "" })}
        variant="danger"
        onConfirm={handleDeleteScenarioConfirm}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
}
