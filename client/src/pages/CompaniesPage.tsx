import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import api from "../services/api";
import type { Company } from "../types";
import { Building2, Plus, Trash2, Target, Crown } from "lucide-react";

export default function CompaniesPage() {
  const [companies, setCompanies] = useState<Company[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [formData, setFormData] = useState({
    name: "",
    company_type: "target" as "acquirer" | "target",
    description: "",
    country: "",
    sector: "",
    currency: "NOKm",
  });
  const [error, setError] = useState("");

  const fetchCompanies = async () => {
    try {
      const data = await api.getCompanies();
      setCompanies(data);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchCompanies();
  }, []);

  const handleCreate = async () => {
    try {
      setError("");
      await api.createCompany(formData);
      setShowForm(false);
      setFormData({
        name: "",
        company_type: "target",
        description: "",
        country: "",
        sector: "",
        currency: "NOKm",
      });
      fetchCompanies();
    } catch (err: any) {
      setError(err.message);
    }
  };

  const handleDelete = async (id: number, name: string) => {
    if (!confirm(`Slett ${name}? Alle modeller og data fjernes.`)) return;
    try {
      await api.deleteCompany(id);
      fetchCompanies();
    } catch (err: any) {
      setError(err.message);
    }
  };

  const acquirers = companies.filter((c) => c.company_type === "acquirer");
  const targets = companies.filter((c) => c.company_type === "target");

  if (loading) {
    return (
      <div className="p-8 flex items-center justify-center h-full">
        <div className="text-gray-400">Laster selskaper...</div>
      </div>
    );
  }

  return (
    <div className="p-8 max-w-6xl">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Selskaper</h1>
          <p className="text-gray-500 mt-1">
            Administrer ECIT (oppkjøper) og target-selskaper
          </p>
        </div>
        <button
          onClick={() => setShowForm(!showForm)}
          className="flex items-center gap-2 px-4 py-2.5 bg-[#03223F] text-white rounded-lg hover:bg-[#002C55] transition-colors text-sm font-medium"
        >
          <Plus size={16} />
          Nytt selskap
        </button>
      </div>

      {error && (
        <div className="bg-red-50 text-red-700 px-4 py-3 rounded-lg mb-6 text-sm">
          {error}
        </div>
      )}

      {/* Create form */}
      {showForm && (
        <div className="bg-white rounded-xl border border-gray-200 p-6 mb-8">
          <h2 className="text-lg font-semibold mb-4">Legg til selskap</h2>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Selskapsnavn
              </label>
              <input
                type="text"
                value={formData.name}
                onChange={(e) =>
                  setFormData({ ...formData, name: e.target.value })
                }
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-[#002C55] outline-none"
                placeholder="f.eks. Argon"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Type
              </label>
              <select
                value={formData.company_type}
                onChange={(e) =>
                  setFormData({
                    ...formData,
                    company_type: e.target.value as "acquirer" | "target",
                  })
                }
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-[#002C55] outline-none"
              >
                <option value="acquirer">Oppkjøper</option>
                <option value="target">Target-selskap</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Land
              </label>
              <input
                type="text"
                value={formData.country}
                onChange={(e) =>
                  setFormData({ ...formData, country: e.target.value })
                }
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-[#002C55] outline-none"
                placeholder="Norge"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Sektor
              </label>
              <input
                type="text"
                value={formData.sector}
                onChange={(e) =>
                  setFormData({ ...formData, sector: e.target.value })
                }
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-[#002C55] outline-none"
                placeholder="IT & BPO"
              />
            </div>
            <div className="col-span-2">
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Beskrivelse
              </label>
              <input
                type="text"
                value={formData.description}
                onChange={(e) =>
                  setFormData({ ...formData, description: e.target.value })
                }
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-[#002C55] outline-none"
                placeholder="Kort beskrivelse"
              />
            </div>
          </div>
          <div className="flex gap-2 mt-4">
            <button
              onClick={handleCreate}
              className="px-4 py-2 bg-[#03223F] text-white rounded-lg text-sm font-medium hover:bg-[#002C55]"
            >
              Opprett
            </button>
            <button
              onClick={() => setShowForm(false)}
              className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg text-sm font-medium hover:bg-gray-200"
            >
              Avbryt
            </button>
          </div>
        </div>
      )}

      {/* Acquirer section */}
      <section className="mb-8">
        <h2 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
          <Crown size={20} className="text-[#002C55]" />
          Oppkjøper
        </h2>
        {acquirers.length === 0 ? (
          <div className="bg-white rounded-xl border border-dashed border-gray-300 p-8 text-center text-gray-400">
            Ingen oppkjøper registrert. Legg til ECIT som oppkjøper.
          </div>
        ) : (
          <div className="grid gap-4">
            {acquirers.map((c) => (
              <CompanyCard
                key={c.id}
                company={c}
                onDelete={() => handleDelete(c.id, c.name)}
              />
            ))}
          </div>
        )}
      </section>

      {/* Targets section */}
      <section>
        <h2 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
          <Target size={20} className="text-[#57A5E4]" />
          Target-selskaper
        </h2>
        {targets.length === 0 ? (
          <div className="bg-white rounded-xl border border-dashed border-gray-300 p-8 text-center text-gray-400">
            Ingen target-selskaper registrert ennå.
          </div>
        ) : (
          <div className="grid gap-4 md:grid-cols-2">
            {targets.map((c) => (
              <CompanyCard
                key={c.id}
                company={c}
                onDelete={() => handleDelete(c.id, c.name)}
              />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function CompanyCard({
  company,
  onDelete,
}: {
  company: Company;
  onDelete: () => void;
}) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-5 hover:shadow-md transition-shadow">
      <div className="flex items-start justify-between">
        <Link
          to={`/companies/${company.id}`}
          className="flex items-start gap-3 flex-1"
        >
          <div className="p-2 rounded-lg bg-gray-50">
            <Building2
              size={20}
              className={
                company.company_type === "acquirer"
                  ? "text-[#002C55]"
                  : "text-[#57A5E4]"
              }
            />
          </div>
          <div>
            <h3 className="font-semibold text-gray-900">{company.name}</h3>
            <p className="text-sm text-gray-500">{company.description}</p>
            <div className="flex gap-3 mt-2 text-xs text-gray-400">
              {company.country && <span>{company.country}</span>}
              {company.sector && <span>{company.sector}</span>}
              <span>{company.currency}</span>
              <span>
                {company.model_count || 0} modell
                {(company.model_count || 0) !== 1 ? "er" : ""}
              </span>
            </div>
          </div>
        </Link>
        <button
          onClick={onDelete}
          className="p-2 rounded-lg hover:bg-red-50 text-gray-400 hover:text-red-600 transition-colors"
          title="Slett"
        >
          <Trash2 size={16} />
        </button>
      </div>
    </div>
  );
}
