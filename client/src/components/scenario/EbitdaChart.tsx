import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";
import type { FinancialPeriod, ProFormaPeriod } from "../../types";
import { toNum, formatTooltip } from "./helpers";

interface EbitdaChartProps {
  acquirerPeriods: FinancialPeriod[];
  targetPeriods: FinancialPeriod[];
  pfPeriods: ProFormaPeriod[];
  acquirerName: string;
  targetName: string;
}

export default function EbitdaChart({
  acquirerPeriods,
  targetPeriods,
  pfPeriods,
  acquirerName,
  targetName,
}: EbitdaChartProps) {
  const chartData = acquirerPeriods.map((ap) => {
    const dateKey = ap.period_date.split("T")[0];
    const tp = targetPeriods.find((t) => t.period_date.split("T")[0] === dateKey);
    const pf = pfPeriods.find((p) => p.period_date.split("T")[0] === dateKey);
    return {
      year: ap.period_label,
      acquirer: toNum(ap.ebitda_total),
      target: tp ? toNum(tp.ebitda_total) : 0,
      combinedExcl: pf ? toNum(pf.total_ebitda_excl_synergies) : 0,
      combinedIncl: pf ? toNum(pf.total_ebitda_incl_synergies) : 0,
    };
  });

  const hasPf = pfPeriods.length > 0;
  const hasSynergies = hasPf && chartData.some(
    (d) => d.combinedExcl !== d.combinedIncl
  );

  return (
    <div>
      <h4 className="text-sm font-semibold text-gray-900 mb-4">
        EBITDA-utvikling (NOKm)
      </h4>
      <ResponsiveContainer width="100%" height={300}>
        <LineChart data={chartData}>
          <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
          <XAxis dataKey="year" fontSize={12} />
          <YAxis fontSize={12} />
          <Tooltip
            formatter={(value: any, name: string) => [
              formatTooltip(value, "NOKm"),
              name,
            ]}
          />
          <Legend />
          <Line type="monotone" dataKey="acquirer" stroke="#002C55" strokeWidth={2} name={acquirerName} />
          <Line type="monotone" dataKey="target" stroke="#57A5E4" strokeWidth={2} name={targetName} strokeDasharray="5 5" />
          {hasPf && hasSynergies && (
            <Line
              type="monotone"
              dataKey="combinedExcl"
              stroke="#a8b5d6"
              strokeWidth={2}
              name="Kombinert (ekskl. synergier)"
              strokeDasharray="3 3"
            />
          )}
          {hasPf && (
            <Line type="monotone" dataKey="combinedIncl" stroke="#03223F" strokeWidth={3} name="Kombinert PF" />
          )}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
