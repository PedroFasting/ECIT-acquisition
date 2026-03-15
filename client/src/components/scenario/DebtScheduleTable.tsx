import { Landmark, Info } from "lucide-react";
import type { DebtScheduleRow, DealParameters } from "../../types";
import { formatNum, formatMultiple } from "./helpers";
import SectionHeader from "./SectionHeader";

// ── Types ──────────────────────────────────────────────────────────

interface DebtScheduleTableProps {
  debtSchedule: DebtScheduleRow[];
  dealParameters?: DealParameters | null;
  expanded: boolean;
  onToggle: (key: string) => void;
}

// ── Component ─────────────────────────────────────────────────────

export default function DebtScheduleTable({
  debtSchedule,
  dealParameters,
  expanded,
  onToggle,
}: DebtScheduleTableProps) {
  if (!debtSchedule || debtSchedule.length === 0) return null;

  const interestRate = dealParameters?.interest_rate ?? 0.05;
  const amortPerYear = dealParameters?.debt_amortisation ?? 0;
  const sweepPct = dealParameters?.cash_sweep_pct ?? 0;
  const pikRate = dealParameters?.preferred_equity_rate ?? 0;

  // Entry values (first row opening)
  const entryDebt = debtSchedule[0].opening_debt;
  const exitDebt = debtSchedule[debtSchedule.length - 1].closing_debt;
  const entryPref = debtSchedule[0].opening_pref;
  const exitPref = debtSchedule[debtSchedule.length - 1].closing_pref;
  const totalDebtRepaid = entryDebt - exitDebt;
  const totalInterestPaid = debtSchedule.reduce((s, r) => s + r.interest, 0);

  // Row definitions: each row maps to a field in DebtScheduleRow
  type RowDef = {
    label: string;
    key: keyof DebtScheduleRow | "separator" | "entry_header";
    bold?: boolean;
    separator?: boolean;
    header?: boolean;
    format?: "num" | "pct" | "multiple";
    indent?: boolean;
    negative?: boolean; // display as negative (outflow)
    highlight?: string; // bg color class
  };

  const rows: RowDef[] = [
    // ── Gjeld (Debt) section ──
    { label: "Gjeld", key: "entry_header", header: true },
    { label: "EBITDA (PF)", key: "ebitda", bold: true },
    { label: "Ubelant FCF", key: "unlevered_fcf", bold: true },
    { label: "", key: "separator", separator: true },
    { label: "Gjeldsbalanse (apning)", key: "opening_debt", bold: true, highlight: "bg-blue-50" },
    { label: "Rentekostnad", key: "interest", indent: true, negative: true },
    { label: "Obligatorisk nedbetaling", key: "mandatory_amort", indent: true, negative: true },
    { label: "Cash sweep", key: "sweep", indent: true, negative: true },
    { label: "Total gjeldsbetjening", key: "total_debt_service", bold: true, negative: true, highlight: "bg-red-50" },
    { label: "Gjeldsbalanse (slutt)", key: "closing_debt", bold: true, highlight: "bg-blue-50" },
    { label: "Gjeld / EBITDA", key: "leverage", format: "multiple" },
    { label: "", key: "separator", separator: true },
    // ── Preferert egenkapital section ──
    { label: "Preferert egenkapital (apning)", key: "opening_pref", bold: true, highlight: "bg-amber-50" },
    { label: "PIK-rente", key: "pik_accrual", indent: true },
    { label: "Preferert egenkapital (slutt)", key: "closing_pref", bold: true, highlight: "bg-amber-50" },
    { label: "", key: "separator", separator: true },
    // ── FCF til egenkapital ──
    { label: "FCF til egenkapital", key: "fcf_to_equity", bold: true, highlight: "bg-green-50" },
  ];

  return (
    <div className="bg-white rounded-xl border border-gray-200 mb-8">
      <SectionHeader
        sectionKey="debtSchedule"
        title="Gjeldsplan"
        subtitle={`Ars gjeld, renter og nedbetaling — Rente ${(interestRate * 100).toFixed(1)}% | PIK ${(pikRate * 100).toFixed(1)}%`}
        expanded={expanded}
        onToggle={onToggle}
      />

      {expanded && (
        <div className="p-6">
          {/* Summary cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
            <SummaryCard
              label="Inngangsgjeld"
              value={`${formatNum(entryDebt)} NOKm`}
            />
            <SummaryCard
              label="Utgangsgjeld"
              value={`${formatNum(exitDebt)} NOKm`}
              delta={totalDebtRepaid > 0 ? `-${formatNum(totalDebtRepaid)}` : undefined}
              deltaPositive={totalDebtRepaid > 0}
            />
            <SummaryCard
              label="Total rente betalt"
              value={`${formatNum(totalInterestPaid)} NOKm`}
            />
            <SummaryCard
              label="Pref. EK ved exit"
              value={`${formatNum(exitPref)} NOKm`}
              delta={entryPref > 0 ? `+${formatNum(exitPref - entryPref)} PIK` : undefined}
              deltaPositive={false}
            />
          </div>

          {/* Assumptions bar */}
          <div className="flex items-center gap-4 px-4 py-2.5 bg-gray-50 rounded-lg mb-4 text-xs text-gray-500">
            <Info size={14} className="text-gray-400 flex-shrink-0" />
            <span>Rente: <b className="text-gray-700">{(interestRate * 100).toFixed(1)}%</b></span>
            <span>Nedbetaling/ar: <b className="text-gray-700">{formatNum(amortPerYear)} NOKm</b></span>
            <span>Cash sweep: <b className="text-gray-700">{(sweepPct * 100).toFixed(0)}%</b></span>
            <span>PIK-rente: <b className="text-gray-700">{(pikRate * 100).toFixed(1)}%</b></span>
          </div>

          {/* Main table */}
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b-2 border-gray-300">
                  <th className="text-left py-2 pr-4 text-xs font-semibold text-gray-500 uppercase tracking-wide w-[240px]">
                    NOKm
                  </th>
                  {debtSchedule.map((row) => (
                    <th
                      key={row.period_label}
                      className="text-right py-2 px-3 text-xs font-semibold text-gray-500 uppercase tracking-wide min-w-[100px]"
                    >
                      {row.period_label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((rowDef, idx) => {
                  if (rowDef.separator) {
                    return (
                      <tr key={`sep-${idx}`}>
                        <td colSpan={debtSchedule.length + 1} className="py-1">
                          <div className="border-b border-gray-100" />
                        </td>
                      </tr>
                    );
                  }
                  if (rowDef.header) {
                    return (
                      <tr key={`hdr-${idx}`}>
                        <td
                          colSpan={debtSchedule.length + 1}
                          className="pt-3 pb-1 text-xs font-bold text-[#03223F] uppercase tracking-wider"
                        >
                          <div className="flex items-center gap-2">
                            <Landmark size={14} />
                            {rowDef.label}
                          </div>
                        </td>
                      </tr>
                    );
                  }

                  return (
                    <tr
                      key={rowDef.key}
                      className={`border-b border-gray-50 hover:bg-gray-50/50 ${rowDef.highlight ?? ""}`}
                    >
                      <td
                        className={`py-1.5 pr-4 text-gray-700 ${rowDef.bold ? "font-semibold" : ""} ${rowDef.indent ? "pl-4" : ""}`}
                      >
                        {rowDef.label}
                      </td>
                      {debtSchedule.map((row) => {
                        const rawVal = row[rowDef.key as keyof DebtScheduleRow] as number | null;
                        let displayVal: string;

                        if (rowDef.format === "multiple") {
                          displayVal = rawVal !== null ? formatMultiple(rawVal) : "-";
                        } else if (rawVal === null || rawVal === undefined) {
                          displayVal = "-";
                        } else {
                          const val = rowDef.negative ? -rawVal : rawVal;
                          displayVal = formatNum(val);
                        }

                        // Color coding for specific rows
                        let cellColor = "";
                        if (rowDef.key === "fcf_to_equity") {
                          cellColor = (rawVal ?? 0) >= 0 ? "text-green-700" : "text-red-600";
                        } else if (rowDef.key === "leverage") {
                          if (rawVal !== null) {
                            cellColor = rawVal < 3 ? "text-green-700" : rawVal < 5 ? "text-amber-600" : "text-red-600";
                          }
                        } else if (rowDef.negative && rawVal !== null && rawVal > 0) {
                          cellColor = "text-red-600";
                        }

                        return (
                          <td
                            key={row.period_label}
                            className={`py-1.5 px-3 text-right tabular-nums ${rowDef.bold ? "font-semibold" : ""} ${cellColor}`}
                          >
                            {displayVal}
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Debt paydown progress bar */}
          <div className="mt-6 px-2">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
                Gjeldsnedbetaling
              </span>
              <span className="text-xs text-gray-500">
                {entryDebt > 0 ? `${((totalDebtRepaid / entryDebt) * 100).toFixed(0)}% nedbetalt` : "-"}
              </span>
            </div>
            <div className="w-full bg-gray-100 rounded-full h-3 overflow-hidden">
              {entryDebt > 0 && (
                <>
                  {/* Mandatory amort portion */}
                  <div
                    className="h-full bg-[#03223F] float-left transition-all"
                    style={{
                      width: `${Math.min(100, (debtSchedule.reduce((s, r) => s + r.mandatory_amort, 0) / entryDebt) * 100)}%`,
                    }}
                    title={`Obligatorisk: ${formatNum(debtSchedule.reduce((s, r) => s + r.mandatory_amort, 0))} NOKm`}
                  />
                  {/* Sweep portion */}
                  <div
                    className="h-full bg-[#3D8B8B] float-left transition-all"
                    style={{
                      width: `${Math.min(100 - (debtSchedule.reduce((s, r) => s + r.mandatory_amort, 0) / entryDebt) * 100, (debtSchedule.reduce((s, r) => s + r.sweep, 0) / entryDebt) * 100)}%`,
                    }}
                    title={`Cash sweep: ${formatNum(debtSchedule.reduce((s, r) => s + r.sweep, 0))} NOKm`}
                  />
                </>
              )}
            </div>
            <div className="flex items-center gap-4 mt-1.5 text-xs text-gray-400">
              <span className="flex items-center gap-1">
                <span className="w-2.5 h-2.5 rounded-sm bg-[#03223F] inline-block" />
                Obligatorisk
              </span>
              <span className="flex items-center gap-1">
                <span className="w-2.5 h-2.5 rounded-sm bg-[#3D8B8B] inline-block" />
                Cash sweep
              </span>
              <span className="flex items-center gap-1">
                <span className="w-2.5 h-2.5 rounded-sm bg-gray-100 inline-block" />
                Gjenstaende
              </span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Summary Card sub-component ────────────────────────────────────

function SummaryCard({
  label,
  value,
  delta,
  deltaPositive,
}: {
  label: string;
  value: string;
  delta?: string;
  deltaPositive?: boolean;
}) {
  return (
    <div className="bg-gray-50 rounded-lg px-4 py-3">
      <div className="text-xs text-gray-500 mb-1">{label}</div>
      <div className="text-sm font-semibold text-gray-900">{value}</div>
      {delta && (
        <div
          className={`text-xs mt-0.5 ${deltaPositive ? "text-green-600" : "text-amber-600"}`}
        >
          {delta}
        </div>
      )}
    </div>
  );
}
