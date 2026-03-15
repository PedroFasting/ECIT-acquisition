import { useState, useEffect, useCallback } from "react";
import api from "../services/api";
import type { CompanyAssumptions as CompanyAssumptionsType } from "../types";
import { Settings, Save, RefreshCw, CheckCircle, AlertTriangle, Info } from "lucide-react";

interface Props {
  companyId: number;
}

// Number formatting helpers (nb-NO)
const fmtNum = (v: number | null | undefined, decimals = 1): string => {
  if (v == null) return "—";
  return v.toLocaleString("nb-NO", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
};

const fmtPct = (v: number | null | undefined): string => {
  if (v == null) return "—";
  return (v * 100).toFixed(2) + " %";
};

interface FieldDef {
  key: keyof CompanyAssumptionsType;
  label: string;
  unit: string;
  decimals?: number;
  isPct?: boolean;
  tooltip?: string;
}

const FIELD_GROUPS: { title: string; fields: FieldDef[] }[] = [
  {
    title: "Aksjer",
    fields: [
      { key: "shares_at_completion", label: "Aksjer ved inngang", unit: "mill.", decimals: 2, tooltip: "Antall utestående aksjer ved transaksjonsdato" },
      { key: "shares_at_year_end", label: "Aksjer ved utgang", unit: "mill.", decimals: 2, tooltip: "Antall aksjer ved exit (siste periode)" },
    ],
  },
  {
    title: "Preferansekapital",
    fields: [
      { key: "preferred_equity", label: "Preferansekapital", unit: "NOKm", decimals: 1, tooltip: "Total preferansekapital (inngående)" },
      { key: "preferred_equity_rate", label: "PIK-rente", unit: "%", isPct: true, tooltip: "Payment-in-kind rente på preferansekapital (f.eks. 0.095 = 9,5%)" },
    ],
  },
  {
    title: "MIP (Management Incentive Programme)",
    fields: [
      { key: "mip_share_pct", label: "MIP-andel", unit: "%", isPct: true, tooltip: "MIP pool som % av EQV (f.eks. 0.0559 = 5,59%)" },
    ],
  },
  {
    title: "TSO-warrants",
    fields: [
      { key: "tso_warrants_count", label: "Antall TSO-warrants", unit: "mill.", decimals: 2, tooltip: "Antall TSO warrant-enheter (i millioner)" },
      { key: "tso_warrants_strike", label: "Strike-pris TSO", unit: "NOK", decimals: 2, tooltip: "Strike-pris per TSO-warrant" },
    ],
  },
  {
    title: "Eksisterende warrants",
    fields: [
      { key: "existing_warrants_count", label: "Antall warrants", unit: "mill.", decimals: 2, tooltip: "Antall eksisterende warrant-enheter (i millioner)" },
      { key: "existing_warrants_strike", label: "Strike-pris", unit: "NOK", decimals: 2, tooltip: "Strike-pris per eksisterende warrant" },
    ],
  },
  {
    title: "Kapitalstruktur",
    fields: [
      { key: "nibd", label: "NIBD (inngående)", unit: "NOKm", decimals: 1, tooltip: "Netto rentebærende gjeld ved inngang" },
      { key: "enterprise_value", label: "Enterprise Value", unit: "NOKm", decimals: 1, tooltip: "EV ved inngang" },
      { key: "equity_value", label: "Equity Value", unit: "NOKm", decimals: 1, tooltip: "Egenkapitalverdi ved inngang" },
    ],
  },
];

export default function CompanyAssumptions({ companyId }: Props) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [hasModels, setHasModels] = useState(false);
  const [sourceModel, setSourceModel] = useState<{ id: number; name: string; model_type: string } | null>(null);
  const [modelCount, setModelCount] = useState(0);
  const [assumptions, setAssumptions] = useState<CompanyAssumptionsType>({});
  const [editValues, setEditValues] = useState<Record<string, string>>({});
  const [dirty, setDirty] = useState(false);
  const [collapsed, setCollapsed] = useState(false);

  const fetchAssumptions = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const data = await api.getAssumptions(companyId);
      setHasModels(data.has_models);
      setSourceModel(data.source_model);
      setModelCount(data.all_model_count);
      setAssumptions(data.assumptions);

      // Init edit values from assumptions
      const vals: Record<string, string> = {};
      for (const group of FIELD_GROUPS) {
        for (const f of group.fields) {
          const raw = data.assumptions[f.key];
          if (raw != null) {
            if (f.isPct) {
              vals[f.key] = (Number(raw) * 100).toFixed(2);
            } else {
              vals[f.key] = String(raw);
            }
          } else {
            vals[f.key] = "";
          }
        }
      }
      setEditValues(vals);
      setDirty(false);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [companyId]);

  useEffect(() => {
    fetchAssumptions();
  }, [fetchAssumptions]);

  const handleChange = (key: string, value: string) => {
    setEditValues((prev) => ({ ...prev, [key]: value }));
    setDirty(true);
    setSuccess("");
  };

  const handleSave = async () => {
    setSaving(true);
    setError("");
    setSuccess("");
    try {
      // Build the payload: convert pct fields back to decimals, parse numbers
      const payload: Record<string, number | null> = {};
      for (const group of FIELD_GROUPS) {
        for (const f of group.fields) {
          const raw = editValues[f.key];
          if (raw === "" || raw == null) {
            payload[f.key] = null;
          } else {
            // Handle Norwegian comma decimal separator
            const cleaned = raw.replace(/\s/g, "").replace(",", ".");
            const num = parseFloat(cleaned);
            if (isNaN(num)) {
              payload[f.key] = null;
            } else if (f.isPct) {
              payload[f.key] = num / 100; // convert from display % to decimal
            } else {
              payload[f.key] = num;
            }
          }
        }
      }

      const result = await api.updateAssumptions(companyId, payload as CompanyAssumptionsType);
      setSuccess(result.message);
      setDirty(false);

      // Refresh to get the canonical values back from server
      await fetchAssumptions();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleReset = () => {
    // Reset edit values to current assumptions
    const vals: Record<string, string> = {};
    for (const group of FIELD_GROUPS) {
      for (const f of group.fields) {
        const raw = assumptions[f.key];
        if (raw != null) {
          if (f.isPct) {
            vals[f.key] = (Number(raw) * 100).toFixed(2);
          } else {
            vals[f.key] = String(raw);
          }
        } else {
          vals[f.key] = "";
        }
      }
    }
    setEditValues(vals);
    setDirty(false);
    setSuccess("");
  };

  if (loading) {
    return (
      <div className="bg-white rounded-xl border border-gray-200 p-6 mb-8">
        <div className="flex items-center gap-2 text-gray-400 text-sm">
          <div className="w-4 h-4 border-2 border-gray-300 border-t-transparent rounded-full animate-spin" />
          Laster forutsetninger...
        </div>
      </div>
    );
  }

  if (!hasModels) {
    return null; // Don't show section if no models exist yet
  }

  return (
    <div className="bg-white rounded-xl border border-gray-200 mb-8 overflow-hidden">
      {/* Header — clickable to collapse/expand */}
      <button
        onClick={() => setCollapsed(!collapsed)}
        className="w-full flex items-center justify-between px-6 py-4 hover:bg-gray-50 transition-colors"
      >
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-amber-50">
            <Settings size={18} className="text-amber-700" />
          </div>
          <div className="text-left">
            <h2 className="text-base font-semibold text-gray-900">
              Forutsetninger
            </h2>
            <p className="text-xs text-gray-400 mt-0.5">
              Kilde: {sourceModel?.name} ({sourceModel?.model_type})
              {modelCount > 1 && ` — synkroniseres til alle ${modelCount} modeller`}
            </p>
          </div>
        </div>
        <svg
          className={`w-5 h-5 text-gray-400 transition-transform ${collapsed ? "" : "rotate-180"}`}
          fill="none" viewBox="0 0 24 24" stroke="currentColor"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {/* Body — collapsible */}
      {!collapsed && (
        <div className="px-6 pb-6 border-t border-gray-100">
          {/* Error/Success messages */}
          {error && (
            <div className="mt-4 flex items-center gap-2 bg-red-50 text-red-700 px-4 py-2.5 rounded-lg text-sm">
              <AlertTriangle size={14} />
              {error}
            </div>
          )}
          {success && (
            <div className="mt-4 flex items-center gap-2 bg-green-50 text-green-700 px-4 py-2.5 rounded-lg text-sm">
              <CheckCircle size={14} />
              {success}
            </div>
          )}

          {/* Field groups */}
          <div className="mt-4 space-y-6">
            {FIELD_GROUPS.map((group) => (
              <div key={group.title}>
                <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">
                  {group.title}
                </h3>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-x-6 gap-y-3">
                  {group.fields.map((f) => (
                    <div key={f.key}>
                      <label className="flex items-center gap-1 text-sm font-medium text-gray-700 mb-1">
                        {f.label}
                        {f.tooltip && (
                          <span className="relative group">
                            <Info size={12} className="text-gray-400 cursor-help" />
                            <span className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1 px-2 py-1 bg-gray-800 text-white text-xs rounded whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-50">
                              {f.tooltip}
                            </span>
                          </span>
                        )}
                      </label>
                      <div className="relative">
                        <input
                          type="text"
                          value={editValues[f.key] ?? ""}
                          onChange={(e) => handleChange(f.key, e.target.value)}
                          className="w-full px-3 py-1.5 pr-14 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-amber-500 focus:border-amber-500 outline-none tabular-nums text-right"
                          placeholder="—"
                        />
                        <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-gray-400 pointer-events-none">
                          {f.unit}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>

          {/* Action buttons */}
          <div className="flex items-center gap-3 mt-6 pt-4 border-t border-gray-100">
            <button
              onClick={handleSave}
              disabled={!dirty || saving}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                dirty
                  ? "bg-amber-600 text-white hover:bg-amber-700"
                  : "bg-gray-100 text-gray-400 cursor-not-allowed"
              }`}
            >
              {saving ? (
                <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
              ) : (
                <Save size={14} />
              )}
              {saving ? "Lagrer..." : "Lagre forutsetninger"}
            </button>

            {dirty && (
              <button
                onClick={handleReset}
                className="flex items-center gap-1.5 px-3 py-2 bg-gray-100 text-gray-600 rounded-lg text-sm font-medium hover:bg-gray-200 transition-colors"
              >
                <RefreshCw size={14} />
                Tilbakestill
              </button>
            )}

            {dirty && (
              <span className="text-xs text-amber-600 ml-2">
                Ulagrede endringer
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
