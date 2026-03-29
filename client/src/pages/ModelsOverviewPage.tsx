import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import api from "../services/api";
import type { Company, FinancialModel } from "../types";
import { FileSpreadsheet, Building2 } from "lucide-react";
import { Link } from "react-router-dom";
import { Spinner } from "../components/ui";

export default function ModelsOverviewPage() {
  const { t } = useTranslation();
  const [companies, setCompanies] = useState<Company[]>([]);
  const [modelsByCompany, setModelsByCompany] = useState<
    Record<number, FinancialModel[]>
  >({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const load = async () => {
      try {
        const comps = await api.getCompanies();
        setCompanies(comps);

        const modelsMap: Record<number, FinancialModel[]> = {};
        await Promise.all(
          comps.map(async (c) => {
            const models = await api.getModels(c.id);
            modelsMap[c.id] = models;
          })
        );
        setModelsByCompany(modelsMap);
      } catch (err) {
        console.error(err);
      } finally {
        setLoading(false);
      }
    };
    load();
  }, []);

  if (loading) {
    return <Spinner fullPage label={t("modelsOverview.loadingModels")} />;
  }

  const totalModels = Object.values(modelsByCompany).flat().length;

  return (
    <div className="p-8 max-w-7xl">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-gray-900">
          {t("modelsOverview.title")}
        </h1>
        <p className="text-gray-500 mt-1">
          {t("modelsOverview.subtitle", { total: totalModels, companies: companies.length })}
        </p>
      </div>

      {companies.length === 0 ? (
        <div className="bg-white rounded-xl border border-dashed border-gray-300 p-12 text-center text-gray-400">
          <p className="mb-2">{t("modelsOverview.noCompanies")}</p>
          <Link to="/companies" className="text-ecit-navy hover:underline">
            {t("modelsOverview.createCompanyFirst")}
          </Link>
        </div>
      ) : (
        <div className="space-y-8">
          {companies.map((company) => {
            const models = modelsByCompany[company.id] || [];
            return (
              <section key={company.id}>
                <div className="flex items-center gap-2 mb-3">
                  <Building2
                    size={18}
                    className={
                      company.company_type === "acquirer"
                        ? "text-ecit-navy"
                        : "text-ecit-accent"
                    }
                  />
                  <h2 className="text-lg font-semibold text-gray-900">
                    <Link
                      to={`/companies/${company.id}`}
                      className="hover:text-ecit-navy"
                    >
                      {company.name}
                    </Link>
                  </h2>
                  <span
                    className={`px-2 py-0.5 rounded-full text-xs ${
                      company.company_type === "acquirer"
                        ? "bg-blue-100 text-blue-700"
                        : "bg-sky-100 text-sky-700"
                    }`}
                  >
                    {company.company_type === "acquirer"
                      ? t("common.acquirer")
                      : t("common.target")}
                  </span>
                </div>

                {models.length === 0 ? (
                  <div className="bg-white rounded-lg border border-dashed border-gray-200 p-6 text-center text-sm text-gray-400">
                    {t("modelsOverview.noModels")}{" "}
                    <Link
                      to={`/companies/${company.id}`}
                      className="text-ecit-navy hover:underline"
                    >
                      {t("modelsOverview.createOne")}
                    </Link>
                  </div>
                ) : (
                  <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
                    {models.map((m) => (
                      <Link
                        key={m.id}
                        to={`/models/${m.id}`}
                        className="bg-white rounded-xl border border-gray-200 p-4 hover:shadow-md transition-shadow"
                      >
                        <div className="flex items-start gap-3">
                          <div className="p-2 rounded-lg bg-gray-50">
                            <FileSpreadsheet
                              size={18}
                              className="text-ecit-navy"
                            />
                          </div>
                          <div>
                            <h3 className="font-medium text-gray-900">
                              {m.name}
                            </h3>
                            <p className="text-xs text-gray-400 mt-0.5">
                              {m.model_type} | {m.period_count || 0} {t("common.periods")}
                            </p>
                            {m.first_period && m.last_period && (
                              <p className="text-xs text-gray-400">
                                {new Date(m.first_period).getFullYear()} -{" "}
                                {new Date(m.last_period).getFullYear()}
                              </p>
                            )}
                          </div>
                        </div>
                      </Link>
                    ))}
                  </div>
                )}
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}
