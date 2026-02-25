import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import api from "../services/api";
import type { Company, AcquisitionScenario } from "../types";
import { Building2, FileSpreadsheet, GitMerge, ArrowRight, Trash2 } from "lucide-react";

export default function DashboardPage() {
  const [companies, setCompanies] = useState<Company[]>([]);
  const [scenarios, setScenarios] = useState<AcquisitionScenario[]>([]);
  const [loading, setLoading] = useState(true);

  const loadData = async () => {
    try {
      const [comps, scens] = await Promise.all([
        api.getCompanies(),
        api.getScenarios(),
      ]);
      setCompanies(comps);
      setScenarios(scens);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const handleDeleteScenario = async (id: number, name: string) => {
    if (!confirm(`Slett scenario "${name}"? Dette kan ikke angres.`)) return;
    try {
      await api.deleteScenario(id);
      setScenarios((prev) => prev.filter((s) => s.id !== id));
    } catch (err) {
      console.error(err);
    }
  };

  if (loading) {
    return (
      <div className="p-8 flex items-center justify-center h-full">
        <div className="text-gray-400">Laster dashboard...</div>
      </div>
    );
  }

  const acquirers = companies.filter((c) => c.company_type === "acquirer");
  const targets = companies.filter((c) => c.company_type === "target");
  const totalModels = companies.reduce(
    (sum, c) => sum + (Number(c.model_count) || 0),
    0
  );

  return (
    <div className="p-8 max-w-6xl">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-gray-900">Oversikt</h1>
        <p className="text-gray-500 mt-1">
          Oversikt over selskaper, modeller og oppkjøpsscenarier
        </p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-4 gap-4 mb-8">
        {[
          {
            label: "Oppkjøpere",
            value: acquirers.length,
            icon: Building2,
            color: "text-[#002C55]",
            bg: "bg-blue-50",
          },
          {
            label: "Target-selskaper",
            value: targets.length,
            icon: Building2,
            color: "text-[#57A5E4]",
            bg: "bg-sky-50",
          },
          {
            label: "Modeller",
            value: totalModels,
            icon: FileSpreadsheet,
            color: "text-blue-600",
            bg: "bg-blue-50",
          },
          {
            label: "Scenarier",
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
            Kom i gang
          </h2>
          <div className="space-y-4">
            {[
              {
                step: 1,
                title: "Opprett ECIT som oppkjøper",
                desc: "Legg til ECIT med type 'Oppkjøper'",
                link: "/companies",
              },
              {
                step: 2,
                title: "Legg til target-selskaper",
                desc: "Registrer selskaper du vurderer a kjope",
                link: "/companies",
              },
              {
                step: 3,
                title: "Opprett finansielle modeller",
                desc: "Lag modeller (Management case, Sellside, Post DD) og importer data",
                link: "/companies",
              },
              {
                step: 4,
                title: "Opprett oppkjøpsscenarier",
                desc: "Kombiner modeller og analyser pro forma",
                link: "/scenarios",
              },
            ].map((item) => (
              <Link
                key={item.step}
                to={item.link}
                className="flex items-center gap-4 p-4 rounded-lg border border-gray-100 hover:border-[#002C55] hover:bg-blue-50/30 transition-all"
              >
                <div className="w-8 h-8 rounded-full bg-[#03223F] text-white flex items-center justify-center text-sm font-bold">
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
              Siste scenarier
            </h2>
            <Link
              to="/scenarios"
              className="text-sm text-[#002C55] hover:underline"
            >
              Se alle
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
                  <GitMerge size={16} className="text-[#002C55] shrink-0" />
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
                    {s.status === "active" ? "Aktiv" : s.status === "draft" ? "Utkast" : "Arkivert"}
                  </span>
                </Link>
                <button
                  onClick={() => handleDeleteScenario(s.id, s.name)}
                  className="p-1.5 rounded-lg text-gray-300 hover:text-red-500 hover:bg-red-50 transition-colors shrink-0"
                  title="Slett scenario"
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
              Selskaper
            </h2>
            <Link
              to="/companies"
              className="text-sm text-[#002C55] hover:underline"
            >
              Administrer
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
                      ? "text-[#002C55]"
                      : "text-[#57A5E4]"
                  }
                />
                <div className="flex-1">
                  <p className="font-medium text-gray-900 text-sm">{c.name}</p>
                  <p className="text-xs text-gray-400">
                    {c.company_type === "acquirer" ? "Oppkjøper" : "Target"} |{" "}
                    {c.model_count || 0} modeller
                  </p>
                </div>
              </Link>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
