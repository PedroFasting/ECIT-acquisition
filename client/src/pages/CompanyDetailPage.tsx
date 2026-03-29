import { useState, useEffect, useCallback } from "react";
import { useParams, Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import api from "../services/api";
import type { Company, FinancialModel, ExcelImportResult } from "../types";
import {
  ArrowLeft,
  Plus,
  Upload,
  FileSpreadsheet,
  Trash2,
  Eye,
  CheckCircle,
  AlertTriangle,
  X,
} from "lucide-react";
import CompanyAssumptions from "../components/CompanyAssumptions";
import { getErrorMessage } from "../utils/errors";
import { Spinner, ConfirmModal } from "../components/ui";

export default function CompanyDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [company, setCompany] = useState<Company | null>(null);
  const [models, setModels] = useState<FinancialModel[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<{ id: number; name: string } | null>(null);
  const { t } = useTranslation();

  // New model form
  const [showModelForm, setShowModelForm] = useState(false);
  const [modelForm, setModelForm] = useState({
    name: "",
    description: "",
    model_type: "base",
  });

  // Import state
  const [importingModelId, setImportingModelId] = useState<number | null>(null);
  const [importStatus, setImportStatus] = useState("");

  // Excel upload state
  const [excelUploading, setExcelUploading] = useState(false);
  const [excelDragOver, setExcelDragOver] = useState(false);
  const [excelResult, setExcelResult] = useState<ExcelImportResult | null>(null);
  const [excelError, setExcelError] = useState("");

  const fetchData = async () => {
    if (!id) return;
    try {
      const [companyData, modelsData] = await Promise.all([
        api.getCompany(Number(id)),
        api.getModels(Number(id)),
      ]);
      setCompany(companyData);
      setModels(modelsData);
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, [id]);

  const handleCreateModel = async () => {
    if (!id) return;
    try {
      setError("");
      await api.createModel({
        company_id: Number(id),
        name: modelForm.name,
        description: modelForm.description,
        model_type: modelForm.model_type,
      });
      setShowModelForm(false);
      setModelForm({ name: "", description: "", model_type: "base" });
      fetchData();
    } catch (err) {
      setError(getErrorMessage(err));
    }
  };

  const handleDeleteModelClick = (modelId: number, name: string) => {
    setDeleteTarget({ id: modelId, name });
  };

  const handleDeleteModelConfirm = async () => {
    if (!deleteTarget) return;
    try {
      await api.deleteModel(deleteTarget.id);
      setDeleteTarget(null);
      fetchData();
    } catch (err) {
      setError(getErrorMessage(err));
      setDeleteTarget(null);
    }
  };

  const handleFileUpload = async (
    modelId: number,
    file: File
  ) => {
    setImportingModelId(modelId);
    setImportStatus(t("companyDetail.importing"));
    try {
      let result;
      if (file.name.endsWith(".csv")) {
        result = await api.importCsvFile(modelId, file);
      } else {
        result = await api.importJsonFile(modelId, file);
      }
      setImportStatus(t("companyDetail.imported", { count: result.count }));
      fetchData();
      setTimeout(() => {
        setImportStatus("");
        setImportingModelId(null);
      }, 3000);
    } catch (err) {
      setImportStatus(t("companyDetail.importError", { message: getErrorMessage(err) }));
      setTimeout(() => {
        setImportStatus("");
        setImportingModelId(null);
      }, 5000);
    }
  };

  const handleExcelUpload = useCallback(async (file: File) => {
    if (!id) return;

    // Validate file type
    const ext = file.name.split(".").pop()?.toLowerCase();
    if (ext !== "xlsx" && ext !== "xls") {
      setExcelError(t("companyDetail.invalidFileType"));
      return;
    }

    // Validate file size (10 MB limit)
    if (file.size > 10 * 1024 * 1024) {
      setExcelError(t("companyDetail.fileTooLarge"));
      return;
    }

    setExcelUploading(true);
    setExcelError("");
    setExcelResult(null);

    try {
      const result = await api.importExcelFile(Number(id), file);
      setExcelResult(result);
      fetchData(); // Refresh model list
    } catch (err) {
      setExcelError(getErrorMessage(err) || t("companyDetail.importFailed"));
    } finally {
      setExcelUploading(false);
    }
  }, [id, t]);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setExcelDragOver(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setExcelDragOver(false);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setExcelDragOver(false);

    const file = e.dataTransfer.files[0];
    if (file) {
      handleExcelUpload(file);
    }
  }, [handleExcelUpload]);

  if (loading) {
    return <Spinner fullPage label={t("common.loading")} />;
  }

  if (!company) {
    return (
      <div className="p-8">
        <p className="text-red-600">{t("companyDetail.companyNotFound")}</p>
      </div>
    );
  }

  const modelTypeKeys = ["base", "management", "sellside", "post_dd", "upside", "downside", "custom"] as const;

  return (
    <div className="p-8 max-w-7xl">
      {/* Header */}
      <div className="mb-8">
        <Link
          to="/companies"
          className="flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700 mb-4"
        >
          <ArrowLeft size={14} />
          {t("companyDetail.backToCompanies")}
        </Link>
        <div className="flex items-center justify-between">
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-bold text-gray-900">
                {company.name}
              </h1>
              <span
                className={`px-2.5 py-0.5 rounded-full text-xs font-medium ${
                  company.company_type === "acquirer"
                    ? "bg-blue-100 text-blue-800"
                    : "bg-sky-100 text-sky-800"
                }`}
              >
                {company.company_type === "acquirer" ? t("common.acquirer") : t("common.target")}
              </span>
            </div>
            {company.description && (
              <p className="text-gray-500 mt-1">{company.description}</p>
            )}
            <div className="flex gap-4 mt-2 text-sm text-gray-400">
              {company.country && <span>{company.country}</span>}
              {company.sector && <span>{company.sector}</span>}
              <span>{company.currency}</span>
            </div>
          </div>
          <button
            onClick={() => setShowModelForm(!showModelForm)}
            className="flex items-center gap-2 px-4 py-2.5 bg-ecit-dark text-white rounded-lg hover:bg-ecit-navy transition-colors text-sm font-medium"
          >
            <Plus size={16} />
            {t("companyDetail.newModel")}
          </button>
        </div>
      </div>

      {error && (
        <div className="bg-red-50 text-red-700 px-4 py-3 rounded-lg mb-6 text-sm">
          {error}
        </div>
      )}

      {/* Excel Upload Zone */}
      <div className="mb-8">
        <div
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          className={`relative border-2 border-dashed rounded-xl p-6 text-center transition-colors ${
            excelDragOver
              ? "border-ecit-accent bg-blue-50/50"
              : "border-gray-300 hover:border-gray-400"
          } ${excelUploading ? "opacity-60 pointer-events-none" : ""}`}
        >
          <div className="flex flex-col items-center gap-2">
            <div className="p-3 rounded-full bg-blue-50">
              <FileSpreadsheet size={28} className="text-ecit-navy" />
            </div>
            <div>
              <p className="text-sm font-medium text-gray-700">
                {excelUploading ? t("companyDetail.uploadExcelActive") : t("companyDetail.uploadExcel")}
              </p>
              <p className="text-xs text-gray-400 mt-1">
                {t("companyDetail.dragAndDrop")}{" "}
                <label className="text-ecit-accent hover:text-ecit-navy cursor-pointer underline">
                  {t("companyDetail.selectFile")}
                  <input
                    type="file"
                    accept=".xlsx,.xls"
                    className="hidden"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) handleExcelUpload(file);
                      e.target.value = "";
                    }}
                  />
                </label>
              </p>
              <p className="text-xs text-gray-400 mt-0.5">
                {t("companyDetail.autoCreateModels")}
              </p>
            </div>
          </div>

          {excelUploading && (
            <div className="absolute inset-0 flex items-center justify-center bg-white/60 rounded-xl">
              <div className="flex items-center gap-2 text-sm text-ecit-navy font-medium">
                <div className="w-4 h-4 border-2 border-ecit-navy border-t-transparent rounded-full animate-spin" />
                {t("companyDetail.readingExcel")}
              </div>
            </div>
          )}
        </div>

        {/* Excel Import Error */}
        {excelError && (
          <div className="mt-3 flex items-start gap-2 bg-red-50 text-red-700 px-4 py-3 rounded-lg text-sm">
            <AlertTriangle size={16} className="mt-0.5 flex-shrink-0" />
            <div className="flex-1">{excelError}</div>
            <button onClick={() => setExcelError("")} className="text-red-400 hover:text-red-600">
              <X size={14} />
            </button>
          </div>
        )}

        {/* Excel Import Result */}
        {excelResult && (
          <div className="mt-3 bg-green-50 border border-green-200 rounded-lg p-4">
            <div className="flex items-start justify-between">
              <div className="flex items-start gap-2">
                <CheckCircle size={18} className="text-green-600 mt-0.5 flex-shrink-0" />
                <div>
                  <p className="text-sm font-medium text-green-800">
                    {t("companyDetail.importComplete")}
                  </p>
                  <p className="text-xs text-green-700 mt-0.5">
                    {excelResult.models_created > 0 && t("companyDetail.modelsCreated", { count: excelResult.models_created })}
                    {excelResult.models_created > 0 && excelResult.models_updated > 0 && ", "}
                    {excelResult.models_updated > 0 && t("companyDetail.modelsUpdated", { count: excelResult.models_updated })}
                    {" — "}
                    {t("companyDetail.totalPeriods", { count: excelResult.total_periods })}
                  </p>

                  {/* Model details */}
                  {excelResult.model_details.length > 0 && (
                    <div className="mt-2 space-y-1">
                      {excelResult.model_details.map((m, i) => (
                        <div key={i} className="flex items-center gap-2 text-xs text-green-700">
                          <FileSpreadsheet size={12} />
                          <span className="font-medium">{m.name}</span>
                          <span className="text-green-500">
                            ({m.periods} {t("common.periods")}, {m.action === "created" ? t("companyDetail.new") : t("companyDetail.updated")})
                          </span>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Warnings */}
                  {excelResult.warnings.length > 0 && (
                    <div className="mt-2 space-y-0.5">
                      {excelResult.warnings.map((w, i) => (
                        <div key={i} className="flex items-center gap-1.5 text-xs text-amber-700">
                          <AlertTriangle size={10} />
                          {w}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
              <button onClick={() => setExcelResult(null)} className="text-green-400 hover:text-green-600">
                <X size={14} />
              </button>
            </div>
          </div>
        )}
      </div>

      {/* New model form */}
      {showModelForm && (
        <div className="bg-white rounded-xl border border-gray-200 p-6 mb-8">
          <h2 className="text-lg font-semibold mb-4">{t("companyDetail.newFinancialModel")}</h2>
          <div className="grid grid-cols-3 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                {t("companyDetail.modelName")}
              </label>
              <input
                type="text"
                value={modelForm.name}
                onChange={(e) =>
                  setModelForm({ ...modelForm, name: e.target.value })
                }
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-ecit-navy outline-none"
                placeholder={t("companyDetail.modelNamePlaceholder")}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                {t("common.type")}
              </label>
              <select
                value={modelForm.model_type}
                onChange={(e) =>
                  setModelForm({ ...modelForm, model_type: e.target.value })
                }
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-ecit-navy outline-none"
              >
                {modelTypeKeys.map((val) => (
                  <option key={val} value={val}>
                    {t(`companyDetail.modelTypes.${val}`)}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                {t("common.description")}
              </label>
              <input
                type="text"
                value={modelForm.description}
                onChange={(e) =>
                  setModelForm({ ...modelForm, description: e.target.value })
                }
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-ecit-navy outline-none"
              />
            </div>
          </div>
          <div className="flex gap-2 mt-4">
            <button
              onClick={handleCreateModel}
              className="px-4 py-2 bg-ecit-dark text-white rounded-lg text-sm font-medium hover:bg-ecit-navy"
            >
              {t("companyDetail.createModel")}
            </button>
            <button
              onClick={() => setShowModelForm(false)}
              className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg text-sm font-medium hover:bg-gray-200"
            >
              {t("common.cancel")}
            </button>
          </div>
        </div>
      )}

      {/* Company Assumptions Section */}
      {models.length > 0 && <CompanyAssumptions companyId={Number(id)} />}

      {/* Models list */}
      <h2 className="text-lg font-semibold text-gray-900 mb-4">
        {t("companyDetail.financialModels")} ({models.length})
      </h2>

      {models.length === 0 ? (
        <div className="bg-white rounded-xl border border-dashed border-gray-300 p-8 text-center text-gray-400">
          {t("companyDetail.noModels")}
        </div>
      ) : (
        <div className="space-y-4">
          {models.map((model) => (
            <div
              key={model.id}
              className="bg-white rounded-xl border border-gray-200 p-5"
            >
              <div className="flex items-start justify-between">
                <div className="flex items-start gap-3 flex-1">
                  <div className="p-2 rounded-lg bg-gray-50">
                    <FileSpreadsheet size={20} className="text-ecit-navy" />
                  </div>
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <h3 className="font-semibold text-gray-900">
                        {model.name}
                      </h3>
                      <span className="px-2 py-0.5 bg-gray-100 text-gray-600 text-xs rounded-full">
                        {t(`companyDetail.modelTypes.${model.model_type}`, model.model_type)}
                      </span>
                    </div>
                    {model.description && (
                      <p className="text-sm text-gray-500 mt-0.5">
                        {model.description}
                      </p>
                    )}
                    <div className="flex gap-4 mt-2 text-xs text-gray-400">
                      <span>{model.period_count || 0} {t("common.periods")}</span>
                      {model.first_period && (
                        <span>
                          {new Date(model.first_period).getFullYear()} -{" "}
                          {new Date(model.last_period!).getFullYear()}
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  {/* Import button (JSON/CSV per-model) */}
                  <label className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-50 text-blue-700 rounded-lg text-xs font-medium hover:bg-blue-100 cursor-pointer transition-colors">
                    <Upload size={14} />
                    {t("common.import")}
                    <input
                      type="file"
                      accept=".json,.csv"
                      className="hidden"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) handleFileUpload(model.id, file);
                        e.target.value = "";
                      }}
                    />
                  </label>

                  {/* View button */}
                  <Link
                    to={`/models/${model.id}`}
                    className="flex items-center gap-1.5 px-3 py-1.5 bg-gray-50 text-gray-700 rounded-lg text-xs font-medium hover:bg-gray-100 transition-colors"
                  >
                    <Eye size={14} />
                    {t("companyDetail.viewData")}
                  </Link>

                  {/* Delete */}
                  <button
                    onClick={() => handleDeleteModelClick(model.id, model.name)}
                    className="p-1.5 rounded-lg hover:bg-red-50 text-gray-400 hover:text-red-600 transition-colors"
                    title={t("companyDetail.deleteModel")}
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>

              {/* Import status */}
              {importingModelId === model.id && importStatus && (
                <div
                  className={`mt-3 px-3 py-2 rounded-lg text-sm ${
                    importStatus.includes(t("common.error")) || importStatus.includes("Error")
                      ? "bg-red-50 text-red-700"
                      : importStatus.includes(t("common.periods")) || importStatus.includes("period")
                      ? "bg-green-50 text-green-700"
                      : "bg-blue-50 text-blue-700"
                  }`}
                >
                  {importStatus}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      <ConfirmModal
        open={deleteTarget !== null}
        title={t("common.confirmDelete")}
        message={t("companyDetail.confirmDeleteModel", { name: deleteTarget?.name ?? "" })}
        variant="danger"
        onConfirm={handleDeleteModelConfirm}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
}
