import { useState, useEffect, useCallback } from "react";
import { useParams, Link } from "react-router-dom";
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

export default function CompanyDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [company, setCompany] = useState<Company | null>(null);
  const [models, setModels] = useState<FinancialModel[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

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
    } catch (err: any) {
      setError(err.message);
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
    } catch (err: any) {
      setError(err.message);
    }
  };

  const handleDeleteModel = async (modelId: number, name: string) => {
    if (!confirm(`Slett modellen "${name}"? Alle finansdata fjernes.`)) return;
    try {
      await api.deleteModel(modelId);
      fetchData();
    } catch (err: any) {
      setError(err.message);
    }
  };

  const handleFileUpload = async (
    modelId: number,
    file: File
  ) => {
    setImportingModelId(modelId);
    setImportStatus("Importerer...");
    try {
      let result;
      if (file.name.endsWith(".csv")) {
        result = await api.importCsvFile(modelId, file);
      } else {
        result = await api.importJsonFile(modelId, file);
      }
      setImportStatus(`Importert ${result.count} perioder`);
      fetchData();
      setTimeout(() => {
        setImportStatus("");
        setImportingModelId(null);
      }, 3000);
    } catch (err: any) {
      setImportStatus(`Feil: ${err.message}`);
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
      setExcelError("Ugyldig filtype. Kun .xlsx-filer er støttet.");
      return;
    }

    // Validate file size (10 MB limit)
    if (file.size > 10 * 1024 * 1024) {
      setExcelError("Filen er for stor. Maks 10 MB.");
      return;
    }

    setExcelUploading(true);
    setExcelError("");
    setExcelResult(null);

    try {
      const result = await api.importExcelFile(Number(id), file);
      setExcelResult(result);
      fetchData(); // Refresh model list
    } catch (err: any) {
      setExcelError(err.message || "Excel-import feilet");
    } finally {
      setExcelUploading(false);
    }
  }, [id]);

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
    return (
      <div className="p-8 flex items-center justify-center h-full">
        <div className="text-gray-400">Laster...</div>
      </div>
    );
  }

  if (!company) {
    return (
      <div className="p-8">
        <p className="text-red-600">Selskap ikke funnet</p>
      </div>
    );
  }

  const modelTypeLabels: Record<string, string> = {
    base: "Basis",
    management: "Management case",
    sellside: "Sellside case",
    post_dd: "Post DD case",
    upside: "Oppside",
    downside: "Nedside",
    custom: "Egendefinert",
  };

  return (
    <div className="p-8 max-w-6xl">
      {/* Header */}
      <div className="mb-8">
        <Link
          to="/companies"
          className="flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700 mb-4"
        >
          <ArrowLeft size={14} />
          Tilbake til selskaper
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
                {company.company_type === "acquirer" ? "Oppkjøper" : "Target"}
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
            className="flex items-center gap-2 px-4 py-2.5 bg-[#03223F] text-white rounded-lg hover:bg-[#002C55] transition-colors text-sm font-medium"
          >
            <Plus size={16} />
            Ny modell
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
              ? "border-[#57A5E4] bg-blue-50/50"
              : "border-gray-300 hover:border-gray-400"
          } ${excelUploading ? "opacity-60 pointer-events-none" : ""}`}
        >
          <div className="flex flex-col items-center gap-2">
            <div className="p-3 rounded-full bg-blue-50">
              <FileSpreadsheet size={28} className="text-[#002C55]" />
            </div>
            <div>
              <p className="text-sm font-medium text-gray-700">
                {excelUploading ? "Importerer Excel-fil..." : "Last opp Excel-fil (.xlsx)"}
              </p>
              <p className="text-xs text-gray-400 mt-1">
                Dra og slipp, eller{" "}
                <label className="text-[#57A5E4] hover:text-[#002C55] cursor-pointer underline">
                  velg fil
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
                Modeller og perioder opprettes automatisk fra Excel-filen
              </p>
            </div>
          </div>

          {excelUploading && (
            <div className="absolute inset-0 flex items-center justify-center bg-white/60 rounded-xl">
              <div className="flex items-center gap-2 text-sm text-[#002C55] font-medium">
                <div className="w-4 h-4 border-2 border-[#002C55] border-t-transparent rounded-full animate-spin" />
                Leser Excel-fil...
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
                    Import fullført
                  </p>
                  <p className="text-xs text-green-700 mt-0.5">
                    {excelResult.models_created > 0 && `${excelResult.models_created} modell(er) opprettet`}
                    {excelResult.models_created > 0 && excelResult.models_updated > 0 && ", "}
                    {excelResult.models_updated > 0 && `${excelResult.models_updated} modell(er) oppdatert`}
                    {" — "}
                    {excelResult.total_periods} perioder totalt
                  </p>

                  {/* Model details */}
                  {excelResult.model_details.length > 0 && (
                    <div className="mt-2 space-y-1">
                      {excelResult.model_details.map((m, i) => (
                        <div key={i} className="flex items-center gap-2 text-xs text-green-700">
                          <FileSpreadsheet size={12} />
                          <span className="font-medium">{m.name}</span>
                          <span className="text-green-500">
                            ({m.periods} perioder, {m.action === "created" ? "ny" : "oppdatert"})
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
          <h2 className="text-lg font-semibold mb-4">Ny finansiell modell</h2>
          <div className="grid grid-cols-3 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Modellnavn
              </label>
              <input
                type="text"
                value={modelForm.name}
                onChange={(e) =>
                  setModelForm({ ...modelForm, name: e.target.value })
                }
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-[#002C55] outline-none"
                placeholder="f.eks. Management case"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Type
              </label>
              <select
                value={modelForm.model_type}
                onChange={(e) =>
                  setModelForm({ ...modelForm, model_type: e.target.value })
                }
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-[#002C55] outline-none"
              >
                {Object.entries(modelTypeLabels).map(([val, label]) => (
                  <option key={val} value={val}>
                    {label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Beskrivelse
              </label>
              <input
                type="text"
                value={modelForm.description}
                onChange={(e) =>
                  setModelForm({ ...modelForm, description: e.target.value })
                }
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-[#002C55] outline-none"
              />
            </div>
          </div>
          <div className="flex gap-2 mt-4">
            <button
              onClick={handleCreateModel}
              className="px-4 py-2 bg-[#03223F] text-white rounded-lg text-sm font-medium hover:bg-[#002C55]"
            >
              Opprett modell
            </button>
            <button
              onClick={() => setShowModelForm(false)}
              className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg text-sm font-medium hover:bg-gray-200"
            >
              Avbryt
            </button>
          </div>
        </div>
      )}

      {/* Models list */}
      <h2 className="text-lg font-semibold text-gray-900 mb-4">
        Finansielle modeller ({models.length})
      </h2>

      {models.length === 0 ? (
        <div className="bg-white rounded-xl border border-dashed border-gray-300 p-8 text-center text-gray-400">
          Ingen modeller ennå. Opprett en modell og importer finansdata.
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
                    <FileSpreadsheet size={20} className="text-[#002C55]" />
                  </div>
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <h3 className="font-semibold text-gray-900">
                        {model.name}
                      </h3>
                      <span className="px-2 py-0.5 bg-gray-100 text-gray-600 text-xs rounded-full">
                        {modelTypeLabels[model.model_type] || model.model_type}
                      </span>
                    </div>
                    {model.description && (
                      <p className="text-sm text-gray-500 mt-0.5">
                        {model.description}
                      </p>
                    )}
                    <div className="flex gap-4 mt-2 text-xs text-gray-400">
                      <span>{model.period_count || 0} perioder</span>
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
                    Importer
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
                    Vis data
                  </Link>

                  {/* Delete */}
                  <button
                    onClick={() => handleDeleteModel(model.id, model.name)}
                    className="p-1.5 rounded-lg hover:bg-red-50 text-gray-400 hover:text-red-600 transition-colors"
                    title="Slett modell"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>

              {/* Import status */}
              {importingModelId === model.id && importStatus && (
                <div
                  className={`mt-3 px-3 py-2 rounded-lg text-sm ${
                    importStatus.startsWith("Feil")
                      ? "bg-red-50 text-red-700"
                      : importStatus.includes("Importert")
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
    </div>
  );
}
