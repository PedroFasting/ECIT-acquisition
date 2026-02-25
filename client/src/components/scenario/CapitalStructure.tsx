import { useState } from "react";
import { Plus, Save, Trash2 } from "lucide-react";
import type { AcquisitionScenario, SourceUseItem } from "../../types";
import { toNum, formatNum, formatPct } from "./helpers";
import SectionHeader from "./SectionHeader";

interface CapitalStructureProps {
  scenario: AcquisitionScenario;
  expanded: boolean;
  onToggle: (key: string) => void;
  onSaveSU: (sources: SourceUseItem[], uses: SourceUseItem[]) => Promise<void>;
}

export default function CapitalStructure({
  scenario,
  expanded,
  onToggle,
  onSaveSU,
}: CapitalStructureProps) {
  const [editing, setEditing] = useState(false);
  const [sources, setSources] = useState<SourceUseItem[]>(scenario.sources || []);
  const [uses, setUses] = useState<SourceUseItem[]>(scenario.uses || []);

  const effectiveSources = scenario.sources || [];
  const effectiveUses = scenario.uses || [];

  const capData = (() => {
    const oe = toNum(scenario.ordinary_equity);
    const pe = toNum(scenario.preferred_equity);
    const nd = toNum(scenario.net_debt);
    const ev = toNum(scenario.enterprise_value);
    if (oe === 0 && pe === 0 && nd === 0) return null;
    return { oe, pe, nd, ev, total: oe + pe + nd };
  })();

  const handleSave = async () => {
    await onSaveSU(
      sources.filter((s) => s.name),
      uses.filter((u) => u.name)
    );
    setEditing(false);
  };

  const startEditing = () => {
    setSources(scenario.sources || []);
    setUses(scenario.uses || []);
    setEditing(true);
  };

  return (
    <div className="bg-white rounded-xl border border-gray-200 mb-8">
      <SectionHeader
        sectionKey="capital"
        title="PF kapitalstruktur"
        subtitle="Kilder og anvendelser"
        dark
        expanded={expanded}
        onToggle={onToggle}
        actions={
          !editing ? (
            <button
              onClick={startEditing}
              className="px-3 py-1 text-xs bg-white/10 hover:bg-white/20 text-white rounded-lg font-medium"
            >
              Rediger
            </button>
          ) : (
            <div className="flex gap-2">
              <button
                onClick={handleSave}
                className="flex items-center gap-1 px-3 py-1 text-xs bg-green-600 hover:bg-green-700 text-white rounded-lg font-medium"
              >
                <Save size={12} /> Lagre
              </button>
              <button
                onClick={() => {
                  setEditing(false);
                  setSources(scenario.sources || []);
                  setUses(scenario.uses || []);
                }}
                className="px-3 py-1 text-xs bg-white/10 hover:bg-white/20 text-white rounded-lg font-medium"
              >
                Avbryt
              </button>
            </div>
          )
        }
      />
      {expanded && (
        <div className="p-6">
          {editing ? (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
              {/* Sources */}
              <div>
                <h4 className="text-sm font-semibold text-gray-900 mb-3">Kilder (NOKm)</h4>
                <div className="space-y-2">
                  {sources.map((s, i) => (
                    <div key={i} className="flex gap-2">
                      <input
                        type="text"
                        value={s.name}
                        onChange={(e) => {
                          const newSources = [...sources];
                          newSources[i] = { ...newSources[i], name: e.target.value };
                          setSources(newSources);
                        }}
                        className="flex-1 px-3 py-1.5 border border-gray-300 rounded-lg text-sm"
                        placeholder="Navn"
                      />
                      <input
                        type="number"
                        value={s.amount || ""}
                        onChange={(e) => {
                          const newSources = [...sources];
                          newSources[i] = { ...newSources[i], amount: Number(e.target.value) };
                          setSources(newSources);
                        }}
                        className="w-28 px-3 py-1.5 border border-gray-300 rounded-lg text-sm text-right"
                        placeholder="NOKm"
                      />
                      <button
                        onClick={() => setSources(sources.filter((_, j) => j !== i))}
                        className="p-1.5 text-gray-400 hover:text-red-600"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  ))}
                  <button
                    onClick={() => setSources([...sources, { name: "", amount: 0 }])}
                    className="flex items-center gap-1 text-xs text-[#002C55] hover:underline font-medium"
                  >
                    <Plus size={12} /> Legg til kilde
                  </button>
                </div>
              </div>

              {/* Uses */}
              <div>
                <h4 className="text-sm font-semibold text-gray-900 mb-3">Anvendelser (NOKm)</h4>
                <div className="space-y-2">
                  {uses.map((u, i) => (
                    <div key={i} className="flex gap-2">
                      <input
                        type="text"
                        value={u.name}
                        onChange={(e) => {
                          const newUses = [...uses];
                          newUses[i] = { ...newUses[i], name: e.target.value };
                          setUses(newUses);
                        }}
                        className="flex-1 px-3 py-1.5 border border-gray-300 rounded-lg text-sm"
                        placeholder="Navn"
                      />
                      <input
                        type="number"
                        value={u.amount || ""}
                        onChange={(e) => {
                          const newUses = [...uses];
                          newUses[i] = { ...newUses[i], amount: Number(e.target.value) };
                          setUses(newUses);
                        }}
                        className="w-28 px-3 py-1.5 border border-gray-300 rounded-lg text-sm text-right"
                        placeholder="NOKm"
                      />
                      <button
                        onClick={() => setUses(uses.filter((_, j) => j !== i))}
                        className="p-1.5 text-gray-400 hover:text-red-600"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  ))}
                  <button
                    onClick={() => setUses([...uses, { name: "", amount: 0 }])}
                    className="flex items-center gap-1 text-xs text-[#002C55] hover:underline font-medium"
                  >
                    <Plus size={12} /> Legg til anvendelse
                  </button>
                </div>
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
              {/* Capital structure stacked bar */}
              {capData && (
                <div>
                  <h4 className="text-sm font-semibold text-gray-900 mb-4">PF kapitalstruktur</h4>
                  <div className="flex items-end gap-4">
                    <div className="w-24 flex flex-col-reverse" style={{ height: 220 }}>
                      {[
                        { val: capData.nd, color: "#1e3a5f", label: "Netto gjeld" },
                        { val: capData.pe, color: "#57A5E4", label: "Preferanseaksjer" },
                        { val: capData.oe, color: "#7a8b6e", label: "Ordinær egenkapital" },
                      ]
                        .filter((s) => s.val > 0)
                        .map((s, i) => (
                          <div
                            key={i}
                            className="w-full flex items-center justify-center text-white text-xs font-bold rounded-sm"
                            style={{
                              height: `${(s.val / capData.total) * 100}%`,
                              backgroundColor: s.color,
                              minHeight: 20,
                            }}
                          >
                            {formatNum(s.val)}
                          </div>
                        ))}
                    </div>
                    <div className="flex-1 text-xs space-y-2">
                      {capData.oe > 0 && (
                        <div className="flex items-center gap-2">
                          <div className="w-3 h-3 rounded-sm" style={{ backgroundColor: "#7a8b6e" }} />
                          <span>Ordinær egenkapital: {formatNum(capData.oe)}</span>
                        </div>
                      )}
                      {capData.pe > 0 && (
                        <div className="flex items-center gap-2">
                          <div className="w-3 h-3 rounded-sm" style={{ backgroundColor: "#57A5E4" }} />
                          <span>
                            Preferanseaksjer: {formatNum(capData.pe)}
                            {scenario.preferred_equity_rate &&
                              ` (${formatPct(scenario.preferred_equity_rate)} PIK)`}
                          </span>
                        </div>
                      )}
                      {capData.nd > 0 && (
                        <div className="flex items-center gap-2">
                          <div className="w-3 h-3 rounded-sm" style={{ backgroundColor: "#1e3a5f" }} />
                          <span>Netto gjeld: {formatNum(capData.nd)}</span>
                        </div>
                      )}
                      {capData.ev > 0 && (
                        <div className="mt-3 pt-2 border-t border-gray-200 font-semibold">
                          EV: {formatNum(capData.ev)} NOKm
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {/* Sources table */}
              <div>
                <h4 className="text-sm font-semibold text-gray-900 mb-3">Kilder</h4>
                {effectiveSources.length > 0 ? (
                  <table className="ecit-table">
                    <thead>
                      <tr>
                        <th className="text-left">{scenario.target_company_name} kilder</th>
                        <th className="num">NOKm</th>
                      </tr>
                    </thead>
                    <tbody>
                      {effectiveSources.map((s, i) => (
                        <tr key={i}>
                          <td className="text-gray-700">{s.name}</td>
                          <td className="num font-medium">{formatNum(s.amount)}</td>
                        </tr>
                      ))}
                      <tr className="!bg-[#F4EDDC] font-semibold">
                        <td>Total</td>
                        <td className="num">
                          {formatNum(effectiveSources.reduce((sum, s) => sum + toNum(s.amount), 0))}
                        </td>
                      </tr>
                    </tbody>
                  </table>
                ) : (
                  <p className="text-gray-400 text-sm">Ingen kilder registrert</p>
                )}
              </div>

              {/* Uses table */}
              <div>
                <h4 className="text-sm font-semibold text-gray-900 mb-3">Anvendelser</h4>
                {effectiveUses.length > 0 ? (
                  <table className="ecit-table">
                    <thead>
                      <tr>
                        <th className="text-left">{scenario.target_company_name} anvendelser</th>
                        <th className="num">NOKm</th>
                      </tr>
                    </thead>
                    <tbody>
                      {effectiveUses.map((u, i) => {
                        const isBold =
                          u.name.toLowerCase().includes("enterprise") ||
                          u.name.toLowerCase().includes("total");
                        return (
                          <tr key={i} className={isBold ? "!bg-[#F4EDDC] font-semibold" : ""}>
                            <td className="text-gray-700">{u.name}</td>
                            <td className="num font-medium">{formatNum(u.amount)}</td>
                          </tr>
                        );
                      })}
                      <tr className="!bg-[#F4EDDC] font-semibold">
                        <td>Total</td>
                        <td className="num">
                          {formatNum(effectiveUses.reduce((sum, u) => sum + toNum(u.amount), 0))}
                        </td>
                      </tr>
                    </tbody>
                  </table>
                ) : (
                  <p className="text-gray-400 text-sm">Ingen anvendelser registrert</p>
                )}
              </div>
            </div>
          )}

          {!editing && effectiveSources.length === 0 && effectiveUses.length === 0 && !capData && (
            <div className="text-center text-gray-400 py-4">
              <p className="mb-2">Ingen kapitalstruktur registrert</p>
              <button
                onClick={startEditing}
                className="text-[#002C55] hover:underline text-sm font-medium"
              >
                Legg til sources & uses
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
