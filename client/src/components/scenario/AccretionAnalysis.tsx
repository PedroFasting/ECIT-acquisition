import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";
import type { AcquisitionScenario, FinancialPeriod, ProFormaPeriod } from "../../types";
import { toNum, formatNum, formatPct, formatPctDelta, formatTooltip, deltaColor } from "./helpers";
import SectionHeader from "./SectionHeader";

interface AccretionAnalysisProps {
  scenario: AcquisitionScenario;
  acquirerPeriods: FinancialPeriod[];
  targetPeriods: FinancialPeriod[];
  pfPeriods: ProFormaPeriod[];
  expanded: boolean;
  onToggle: (key: string) => void;
}

interface AccretionYear {
  label: string;
  year: number;
  acquirerOrgGrowth: number;
  targetOrgGrowth: number;
  acquirerMargin: number;
  targetMargin: number;
  pfMargin: number;
  acqRev: number;
  tgtRev: number;
  pfRev: number;
  acqEbitda: number;
  tgtEbitda: number;
  pfEbitda: number;
  pfOrgGrowth: number | null;
  acqFcf: number;
  pfFcf: number;
  acqCashConversion: number;
  pfCashConversion: number;
}

export default function AccretionAnalysis({
  scenario,
  acquirerPeriods,
  targetPeriods,
  pfPeriods,
  expanded,
  onToggle,
}: AccretionAnalysisProps) {
  const getAccretionData = (): AccretionYear[] | null => {
    if (acquirerPeriods.length === 0 || targetPeriods.length === 0) return null;

    const years = acquirerPeriods
      .filter((ap) => {
        const dateKey = ap.period_date.split("T")[0];
        return targetPeriods.some((tp) => tp.period_date.split("T")[0] === dateKey);
      })
      .map((ap) => {
        const dateKey = ap.period_date.split("T")[0];
        const tp = targetPeriods.find((t) => t.period_date.split("T")[0] === dateKey)!;
        const pf = pfPeriods.find((p) => p.period_date.split("T")[0] === dateKey);

        const acqRev = toNum(ap.revenue_total);
        const tgtRev = toNum(tp.revenue_total);
        const acqEbitda = toNum(ap.ebitda_total);
        const tgtEbitda = toNum(tp.ebitda_total);
        const pfRev = pf ? toNum(pf.total_revenue) : acqRev + tgtRev;
        const pfEbitda = pf ? toNum(pf.total_ebitda_incl_synergies) : acqEbitda + tgtEbitda;
        const acqFcf = toNum(ap.operating_fcf);
        const pfFcf = pf ? toNum(pf.operating_fcf) : 0;
        const acqCashConversion = acqEbitda > 0 ? acqFcf / acqEbitda : 0;
        const pfCashConversion = pfEbitda > 0 ? pfFcf / pfEbitda : 0;

        return {
          label: ap.period_label,
          year: new Date(ap.period_date).getFullYear(),
          acquirerOrgGrowth: toNum(ap.organic_growth) || toNum(ap.revenue_growth),
          targetOrgGrowth: toNum(tp.organic_growth) || toNum(tp.revenue_growth),
          acquirerMargin: acqRev > 0 ? acqEbitda / acqRev : 0,
          targetMargin: tgtRev > 0 ? tgtEbitda / tgtRev : 0,
          pfMargin: pfRev > 0 ? pfEbitda / pfRev : 0,
          acqRev,
          tgtRev,
          pfRev,
          acqEbitda,
          tgtEbitda,
          pfEbitda,
          pfOrgGrowth: pf ? toNum(pf.revenue_growth) : null,
          acqFcf,
          pfFcf,
          acqCashConversion,
          pfCashConversion,
        };
      });

    return years.length > 0 ? years : null;
  };

  const accretionData = getAccretionData();

  // Growth comparison bar chart data
  const growthChartData = accretionData
    ?.filter((d) => d.acquirerOrgGrowth || d.targetOrgGrowth)
    .map((d) => ({
      year: d.label,
      [scenario.acquirer_company_name || "Acquirer"]: d.acquirerOrgGrowth
        ? +(d.acquirerOrgGrowth * 100).toFixed(1)
        : null,
      [scenario.target_company_name || "Target"]: d.targetOrgGrowth
        ? +(d.targetOrgGrowth * 100).toFixed(1)
        : null,
    }));

  // Margin comparison bar chart data
  const marginChartData = accretionData?.map((d) => ({
    year: d.label,
    [scenario.acquirer_company_name || "Acquirer"]: +(d.acquirerMargin * 100).toFixed(1),
    [scenario.target_company_name || "Target"]: +(d.targetMargin * 100).toFixed(1),
    "Pro Forma": +(d.pfMargin * 100).toFixed(1),
  }));

  // Accretion table: standalone vs PF for the last year
  const accretionTableData = accretionData && accretionData.length > 0
    ? accretionData[accretionData.length - 1]
    : null;

  const acquirerName = scenario.acquirer_company_name || "Acquirer";
  const targetName = scenario.target_company_name || "Target";

  return (
    <div className="bg-white rounded-xl border border-gray-200 mb-8">
      <SectionHeader
        sectionKey="accretion"
        title="Kombinasjonsrasjonale: Verdiøkning i finansiell profil"
        expanded={expanded}
        onToggle={onToggle}
      />
      {expanded && accretionData && accretionData.length > 0 && (
        <div className="p-6 space-y-8">
          {/* Row 1: Growth & margin comparison tables */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
            {/* Organic growth comparison table */}
            <div>
              <h4 className="text-sm font-semibold text-gray-900 mb-3">
                {targetName} vs {acquirerName} nøkkeltall
              </h4>

              <div className="mb-4">
                <table className="ecit-table border border-gray-200 rounded-lg overflow-hidden">
                  <thead>
                    <tr>
                      <th className="text-left">
                        Organisk vekst
                      </th>
                      {accretionData.map((d) => (
                        <th key={d.label} className="num">
                          {d.label}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td className="text-gray-700">{targetName}</td>
                      {accretionData.map((d) => (
                        <td key={d.label} className="num">
                          {d.targetOrgGrowth ? formatPct(d.targetOrgGrowth) : "-"}
                        </td>
                      ))}
                    </tr>
                    <tr>
                      <td className="text-gray-700">{acquirerName}</td>
                      {accretionData.map((d) => (
                        <td key={d.label} className="num">
                          {d.acquirerOrgGrowth ? formatPct(d.acquirerOrgGrowth) : "-"}
                        </td>
                      ))}
                    </tr>
                    <tr className="!bg-[#F4EDDC]">
                      <td className="font-semibold text-gray-900 text-xs">delta (verdiøkning)</td>
                      {accretionData.map((d) => {
                        const delta = d.targetOrgGrowth - d.acquirerOrgGrowth;
                        return (
                          <td
                            key={d.label}
                            className={`num text-xs font-semibold ${deltaColor(delta)}`}
                          >
                            {d.targetOrgGrowth && d.acquirerOrgGrowth ? formatPctDelta(delta) : "-"}
                          </td>
                        );
                      })}
                    </tr>
                  </tbody>
                </table>
              </div>

              {/* EBITDA margin comparison table */}
              <div>
                <table className="ecit-table border border-gray-200 rounded-lg overflow-hidden">
                  <thead>
                    <tr>
                      <th className="text-left">EBITDA margin</th>
                      {accretionData.map((d) => (
                        <th key={d.label} className="num">{d.label}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td className="text-gray-700">{targetName}</td>
                      {accretionData.map((d) => (
                        <td key={d.label} className="num">{formatPct(d.targetMargin)}</td>
                      ))}
                    </tr>
                    <tr>
                      <td className="text-gray-700">{acquirerName}</td>
                      {accretionData.map((d) => (
                        <td key={d.label} className="num">{formatPct(d.acquirerMargin)}</td>
                      ))}
                    </tr>
                    <tr className="!bg-[#F4EDDC]">
                      <td className="font-semibold text-gray-900 text-xs">delta (verdiøkning)</td>
                      {accretionData.map((d) => {
                        const delta = d.targetMargin - d.acquirerMargin;
                        return (
                          <td
                            key={d.label}
                            className={`num text-xs font-semibold ${deltaColor(delta)}`}
                          >
                            {formatPctDelta(delta)}
                          </td>
                        );
                      })}
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>

            {/* Standalone vs PF bar charts */}
            <div>
              <h4 className="text-sm font-semibold text-gray-900 mb-3">Frittstående vs Pro Forma</h4>
              {(() => {
                const firstForecast = accretionData.find(
                  (d) =>
                    acquirerPeriods.find(
                      (ap) =>
                        ap.period_date.split("T")[0] === `${d.year}-12-31` &&
                        ap.period_type === "forecast"
                    ) !== undefined
                );
                const lastYear = accretionData[accretionData.length - 1];

                const comparePoints = [firstForecast, lastYear].filter(
                  (d): d is NonNullable<typeof d> => d !== undefined && d !== null
                );

                const unique = comparePoints.filter(
                  (d, i, arr) => arr.findIndex((x) => x.year === d.year) === i
                );

                const barData = unique.flatMap((d) => [
                  {
                    group: `${acquirerName} ${d.label}`,
                    Revenue: d.acqRev,
                    EBITDA: d.acqEbitda,
                    margin: d.acquirerMargin,
                  },
                  {
                    group: `PF group ${d.label}`,
                    Revenue: d.pfRev,
                    EBITDA: d.pfEbitda,
                    margin: d.pfMargin,
                  },
                ]);

                return (
                  <ResponsiveContainer width="100%" height={300}>
                    <BarChart data={barData} barGap={0} barCategoryGap="20%">
                      <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                      <XAxis dataKey="group" fontSize={10} interval={0} angle={0} />
                      <YAxis fontSize={12} />
                      <Tooltip
                        formatter={(value: any, name: string) => [
                          formatTooltip(value, "NOKm"),
                          name,
                        ]}
                      />
                      <Legend />
                      <Bar dataKey="Revenue" fill="#a8b5d6" name="Omsetning" />
                      <Bar dataKey="EBITDA" fill="#002C55" name="EBITDA" />
                    </BarChart>
                  </ResponsiveContainer>
                );
              })()}
            </div>
          </div>

          {/* Row 2: Growth & margin bar charts (tasks 8.1 + 8.2) */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
            {/* 8.1 Organic growth grouped bar chart */}
            {growthChartData && growthChartData.length > 0 && (
              <div>
                <h4 className="text-sm font-semibold text-gray-900 mb-3">
                  Organisk vekst-sammenligning (%)
                </h4>
                <ResponsiveContainer width="100%" height={280}>
                  <BarChart data={growthChartData} barGap={2} barCategoryGap="20%">
                    <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                    <XAxis dataKey="year" fontSize={12} />
                    <YAxis fontSize={12} tickFormatter={(v) => `${v}%`} />
                    <Tooltip formatter={(value: any) => [`${value}%`, undefined]} />
                    <Legend />
                    <Bar dataKey={acquirerName} fill="#002C55" />
                    <Bar dataKey={targetName} fill="#57A5E4" />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}

            {/* 8.2 EBITDA margin grouped bar chart */}
            {marginChartData && marginChartData.length > 0 && (
              <div>
                <h4 className="text-sm font-semibold text-gray-900 mb-3">
                  EBITDA-margin sammenligning (%)
                </h4>
                <ResponsiveContainer width="100%" height={280}>
                  <BarChart data={marginChartData} barGap={2} barCategoryGap="20%">
                    <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                    <XAxis dataKey="year" fontSize={12} />
                    <YAxis fontSize={12} tickFormatter={(v) => `${v}%`} />
                    <Tooltip formatter={(value: any) => [`${value}%`, undefined]} />
                    <Legend />
                    <Bar dataKey={acquirerName} fill="#002C55" />
                    <Bar dataKey={targetName} fill="#57A5E4" />
                    <Bar dataKey="Pro Forma" fill="#03223F" />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </div>

          {/* Row 3: Accretion table (task 8.3) */}
          {accretionTableData && pfPeriods.length > 0 && (
            <div>
              <h4 className="text-sm font-semibold text-gray-900 mb-3">
                Frittstående vs Pro Forma verdiøkning ({accretionTableData.label})
              </h4>
              <table className="ecit-table border border-gray-200 rounded-lg overflow-hidden">
                <thead>
                  <tr>
                     <th className="text-left">Nøkkeltall</th>
                    <th className="num">{acquirerName} frittstående</th>
                    <th className="num">Pro Forma</th>
                    <th className="num">Verdiøkning</th>
                    <th className="num">%</th>
                  </tr>
                </thead>
                <tbody>
                  {[
                    {
                      label: "Omsetning",
                      standalone: accretionTableData.acqRev,
                      pf: accretionTableData.pfRev,
                      format: "num",
                    },
                    {
                      label: "EBITDA",
                      standalone: accretionTableData.acqEbitda,
                      pf: accretionTableData.pfEbitda,
                      format: "num",
                    },
                    {
                      label: "EBITDA Margin",
                      standalone: accretionTableData.acquirerMargin,
                      pf: accretionTableData.pfMargin,
                      format: "pct",
                    },
                    {
                      label: "Operasjonell FCF",
                      standalone: accretionTableData.acqFcf,
                      pf: accretionTableData.pfFcf,
                      format: "num",
                    },
                    {
                      label: "Kontantkonvertering",
                      standalone: accretionTableData.acqCashConversion,
                      pf: accretionTableData.pfCashConversion,
                      format: "pct",
                    },
                  ].map((row) => {
                    const delta = row.pf - row.standalone;
                    const pctChange =
                      row.format === "pct"
                        ? delta // already a ratio
                        : row.standalone !== 0
                        ? delta / Math.abs(row.standalone)
                        : 0;

                    return (
                      <tr key={row.label}>
                        <td className="font-medium text-gray-900">{row.label}</td>
                        <td className="num">
                          {row.format === "pct" ? formatPct(row.standalone) : formatNum(row.standalone)}
                        </td>
                        <td className="num font-semibold">
                          {row.format === "pct" ? formatPct(row.pf) : formatNum(row.pf)}
                        </td>
                        <td className={`num font-semibold ${deltaColor(delta)}`}>
                          {row.format === "pct"
                            ? formatPctDelta(delta)
                            : delta >= 0
                            ? `+${formatNum(delta)}`
                            : formatNum(delta)}
                        </td>
                        <td className={`num text-xs ${deltaColor(pctChange)}`}>
                          {row.format === "pct" ? "-" : formatPctDelta(pctChange)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {expanded && (!accretionData || accretionData.length === 0) && (
        <div className="p-8 text-center text-gray-400">
          Importer data for begge selskaper for å se verdiøkningsanalyse.
        </div>
      )}
    </div>
  );
}
