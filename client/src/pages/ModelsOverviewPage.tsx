import { useState, useEffect } from "react";
import api from "../services/api";
import type { Company, FinancialModel } from "../types";
import { FileSpreadsheet, Building2 } from "lucide-react";
import { Link } from "react-router-dom";

export default function ModelsOverviewPage() {
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
    return (
      <div className="p-8 flex items-center justify-center h-full">
        <div className="text-gray-400">Laster modeller...</div>
      </div>
    );
  }

  const totalModels = Object.values(modelsByCompany).flat().length;

  return (
    <div className="p-8 max-w-6xl">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-gray-900">
          Alle modeller
        </h1>
        <p className="text-gray-500 mt-1">
          {totalModels} finansielle modeller pa tvers av {companies.length}{" "}
          selskaper
        </p>
      </div>

      {companies.length === 0 ? (
        <div className="bg-white rounded-xl border border-dashed border-gray-300 p-12 text-center text-gray-400">
          <p className="mb-2">Ingen selskaper registrert</p>
          <Link to="/companies" className="text-[#002C55] hover:underline">
            Opprett et selskap først
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
                        ? "text-[#002C55]"
                        : "text-[#57A5E4]"
                    }
                  />
                  <h2 className="text-lg font-semibold text-gray-900">
                    <Link
                      to={`/companies/${company.id}`}
                      className="hover:text-[#002C55]"
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
                      ? "Oppkjøper"
                      : "Target"}
                  </span>
                </div>

                {models.length === 0 ? (
                  <div className="bg-white rounded-lg border border-dashed border-gray-200 p-6 text-center text-sm text-gray-400">
                    Ingen modeller -{" "}
                    <Link
                      to={`/companies/${company.id}`}
                      className="text-[#002C55] hover:underline"
                    >
                      opprett en
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
                              className="text-[#002C55]"
                            />
                          </div>
                          <div>
                            <h3 className="font-medium text-gray-900">
                              {m.name}
                            </h3>
                            <p className="text-xs text-gray-400 mt-0.5">
                              {m.model_type} | {m.period_count || 0} perioder
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
