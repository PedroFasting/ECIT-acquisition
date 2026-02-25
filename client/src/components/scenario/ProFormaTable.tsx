import type { ProFormaPeriod, FinancialPeriod } from "../../types";
import { formatNum, formatPct, toNum } from "./helpers";
import SectionHeader from "./SectionHeader";

interface ProFormaTableProps {
  pfPeriods: ProFormaPeriod[];
  acquirerPeriods?: FinancialPeriod[];
  targetPeriods?: FinancialPeriod[];
  acquirerName: string;
  targetName: string;
  expanded: boolean;
  onToggle: (key: string) => void;
}

export default function ProFormaTable({
  pfPeriods,
  acquirerPeriods,
  targetPeriods,
  acquirerName,
  targetName,
  expanded,
  onToggle,
}: ProFormaTableProps) {
  if (pfPeriods.length === 0) return null;

  // Build organic growth lookup by period label
  const acqOrgGrowthByLabel = new Map<string, number | null>();
  const tgtOrgGrowthByLabel = new Map<string, number | null>();
  if (acquirerPeriods) {
    for (const p of acquirerPeriods) {
      acqOrgGrowthByLabel.set(p.period_label, toNum(p.organic_growth) || null);
    }
  }
  if (targetPeriods) {
    for (const p of targetPeriods) {
      tgtOrgGrowthByLabel.set(p.period_label, toNum(p.organic_growth) || null);
    }
  }

  const hasAcqOrgGrowth = acquirerPeriods?.some((p) => toNum(p.organic_growth) > 0) ?? false;
  const hasTgtOrgGrowth = targetPeriods?.some((p) => toNum(p.organic_growth) > 0) ?? false;

  const lineItems: { key: string; label: string; bold?: boolean; pct?: boolean; indent?: boolean; custom?: boolean }[] = [
    { key: "acquirer_revenue", label: `${acquirerName} omsetning` },
    ...(hasAcqOrgGrowth ? [{ key: "acquirer_org_growth", label: "Organisk vekst", pct: true, indent: true, custom: true }] : []),
    { key: "target_revenue", label: `${targetName} omsetning` },
    ...(hasTgtOrgGrowth ? [{ key: "target_org_growth", label: "Organisk vekst", pct: true, indent: true, custom: true }] : []),
    { key: "total_revenue", label: "Omsetning", bold: true },
    { key: "acquirer_ebitda", label: `${acquirerName} EBITDA` },
    { key: "target_ebitda", label: `${targetName} EBITDA` },
    { key: "total_ebitda_excl_synergies", label: "Total EBITDA (ekskl. synergier)", bold: true },
    { key: "ebitda_margin_excl_synergies", label: "% margin", pct: true, indent: true },
    { key: "cost_synergies", label: "Kostnadssynergier" },
    { key: "total_ebitda_incl_synergies", label: "Total EBITDA (inkl. synergier)", bold: true },
    { key: "ebitda_margin_incl_synergies", label: "% margin", pct: true, indent: true },
    { key: "total_capex", label: "Totale investeringer" },
    { key: "total_change_nwc", label: "Total endring i arbeidskapital" },
    { key: "total_other_cash_flow", label: "Andre kontantstrømposter" },
    { key: "operating_fcf", label: "Operasjonell FCF", bold: true },
  ];

  function getCellValue(item: typeof lineItems[0], p: ProFormaPeriod): string {
    if (item.custom) {
      if (item.key === "acquirer_org_growth") {
        const v = acqOrgGrowthByLabel.get(p.period_label);
        return v != null ? formatPct(v) : "-";
      }
      if (item.key === "target_org_growth") {
        const v = tgtOrgGrowthByLabel.get(p.period_label);
        return v != null ? formatPct(v) : "-";
      }
      return "-";
    }
    if (item.pct) return formatPct((p as any)[item.key]);
    return formatNum((p as any)[item.key]);
  }

  return (
    <div className="bg-white rounded-xl border border-gray-200 overflow-x-auto mb-8">
      <SectionHeader
        sectionKey="proforma"
        title="Kombinert Pro Forma finansiell profil"
        subtitle="NOKm"
        expanded={expanded}
        onToggle={onToggle}
      />
      {expanded && (
        <table className="ecit-table">
          <thead>
            <tr>
              <th className="text-left min-w-[200px]">
                NOKm
              </th>
              {pfPeriods.map((p) => (
                <th key={p.id} className="num min-w-[90px]">
                  {p.period_label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {lineItems.map((item, idx) => (
              <tr
                key={item.key}
                className={item.bold ? "!bg-[#F4EDDC]" : ""}
              >
                <td className={`${item.indent ? "pl-8 text-gray-500 italic" : item.bold ? "font-semibold text-gray-900" : "text-gray-700"}`}>
                  {item.label}
                </td>
                {pfPeriods.map((p) => (
                  <td key={p.id} className={`num ${item.bold ? "font-semibold" : ""} ${item.pct ? "text-gray-500 italic" : ""}`}>
                    {getCellValue(item, p)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
