import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import api from "../services/api";
import type { Company } from "../types";
import { Building2, Plus, Trash2, Target, Crown } from "lucide-react";
import { getErrorMessage } from "../utils/errors";
import { Spinner, ConfirmModal } from "../components/ui";

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
  const [deleteTarget, setDeleteTarget] = useState<{ id: number; name: string } | null>(null);
  const { t } = useTranslation();

  const fetchCompanies = async () => {
    try {
      const data = await api.getCompanies();
      setCompanies(data);
    } catch (err) {
      setError(getErrorMessage(err));
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
    } catch (err) {
      setError(getErrorMessage(err));
    }
  };

  const handleDeleteClick = (id: number, name: string) => {
    setDeleteTarget({ id, name });
  };

  const handleDeleteConfirm = async () => {
    if (!deleteTarget) return;
    try {
      await api.deleteCompany(deleteTarget.id);
      setDeleteTarget(null);
      fetchCompanies();
    } catch (err) {
      setError(getErrorMessage(err));
      setDeleteTarget(null);
    }
  };

  const acquirers = companies.filter((c) => c.company_type === "acquirer");
  const targets = companies.filter((c) => c.company_type === "target");

  if (loading) {
    return <Spinner fullPage label={t("common.loading")} />;
  }

  return (
    <div className="p-8 max-w-7xl">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{t("companies.title")}</h1>
          <p className="text-gray-500 mt-1">
            {t("companies.subtitle")}
          </p>
        </div>
        <button
          onClick={() => setShowForm(!showForm)}
          className="flex items-center gap-2 px-4 py-2.5 bg-ecit-dark text-white rounded-lg hover:bg-ecit-navy transition-colors text-sm font-medium"
        >
          <Plus size={16} />
          {t("companies.newCompany")}
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
          <h2 className="text-lg font-semibold mb-4">{t("companies.addCompany")}</h2>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                {t("companies.companyName")}
              </label>
              <input
                type="text"
                value={formData.name}
                onChange={(e) =>
                  setFormData({ ...formData, name: e.target.value })
                }
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-ecit-navy outline-none"
                placeholder={t("companies.companyNamePlaceholder")}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                {t("common.type")}
              </label>
              <select
                value={formData.company_type}
                onChange={(e) =>
                  setFormData({
                    ...formData,
                    company_type: e.target.value as "acquirer" | "target",
                  })
                }
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-ecit-navy outline-none"
              >
                <option value="acquirer">{t("companies.acquirerType")}</option>
                <option value="target">{t("companies.targetType")}</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                {t("common.country")}
              </label>
              <input
                type="text"
                value={formData.country}
                onChange={(e) =>
                  setFormData({ ...formData, country: e.target.value })
                }
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-ecit-navy outline-none"
                placeholder={t("companies.countryPlaceholder")}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                {t("common.sector")}
              </label>
              <input
                type="text"
                value={formData.sector}
                onChange={(e) =>
                  setFormData({ ...formData, sector: e.target.value })
                }
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-ecit-navy outline-none"
                placeholder={t("companies.sectorPlaceholder")}
              />
            </div>
            <div className="col-span-2">
              <label className="block text-sm font-medium text-gray-700 mb-1">
                {t("common.description")}
              </label>
              <input
                type="text"
                value={formData.description}
                onChange={(e) =>
                  setFormData({ ...formData, description: e.target.value })
                }
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-ecit-navy outline-none"
                placeholder={t("companies.descriptionPlaceholder")}
              />
            </div>
          </div>
          <div className="flex gap-2 mt-4">
            <button
              onClick={handleCreate}
              className="px-4 py-2 bg-ecit-dark text-white rounded-lg text-sm font-medium hover:bg-ecit-navy"
            >
              {t("common.create")}
            </button>
            <button
              onClick={() => setShowForm(false)}
              className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg text-sm font-medium hover:bg-gray-200"
            >
              {t("common.cancel")}
            </button>
          </div>
        </div>
      )}

      {/* Acquirer section */}
      <section className="mb-8">
        <h2 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
          <Crown size={20} className="text-ecit-navy" />
          {t("companies.acquirerSection")}
        </h2>
        {acquirers.length === 0 ? (
          <div className="bg-white rounded-xl border border-dashed border-gray-300 p-8 text-center text-gray-400">
            {t("companies.noAcquirer")}
          </div>
        ) : (
          <div className="grid gap-4">
            {acquirers.map((c) => (
              <CompanyCard
                key={c.id}
                company={c}
                onDelete={() => handleDeleteClick(c.id, c.name)}
              />
            ))}
          </div>
        )}
      </section>

      {/* Targets section */}
      <section>
        <h2 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
          <Target size={20} className="text-ecit-accent" />
          {t("companies.targetSection")}
        </h2>
        {targets.length === 0 ? (
          <div className="bg-white rounded-xl border border-dashed border-gray-300 p-8 text-center text-gray-400">
            {t("companies.noTargets")}
          </div>
        ) : (
          <div className="grid gap-4 md:grid-cols-2">
            {targets.map((c) => (
              <CompanyCard
                key={c.id}
                company={c}
                onDelete={() => handleDeleteClick(c.id, c.name)}
              />
            ))}
          </div>
        )}
      </section>

      <ConfirmModal
        open={deleteTarget !== null}
        title={t("common.confirmDelete")}
        message={t("companies.confirmDelete", { name: deleteTarget?.name ?? "" })}
        variant="danger"
        onConfirm={handleDeleteConfirm}
        onCancel={() => setDeleteTarget(null)}
      />
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
  const { t } = useTranslation();

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
? "text-ecit-navy"
                   : "text-ecit-accent"
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
                {company.model_count || 0} {t("common.models")}
              </span>
            </div>
          </div>
        </Link>
        <button
          onClick={onDelete}
          className="p-2 rounded-lg hover:bg-red-50 text-gray-400 hover:text-red-600 transition-colors"
          title={t("common.delete")}
        >
          <Trash2 size={16} />
        </button>
      </div>
    </div>
  );
}
