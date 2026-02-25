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
import type { FinancialPeriod, ProFormaPeriod } from "../../types";
import { toNum, formatTooltip } from "./helpers";

interface RevenueChartProps {
  acquirerPeriods: FinancialPeriod[];
  targetPeriods: FinancialPeriod[];
  pfPeriods: ProFormaPeriod[];
  acquirerName: string;
  targetName: string;
}

export default function RevenueChart({
  acquirerPeriods,
  targetPeriods,
  pfPeriods,
  acquirerName,
  targetName,
}: RevenueChartProps) {
  const hasPf = pfPeriods.length > 0;

  const chartData = acquirerPeriods.map((ap) => {
    const dateKey = ap.period_date.split("T")[0];
    const tp = targetPeriods.find((t) => t.period_date.split("T")[0] === dateKey);
    const pf = pfPeriods.find((p) => p.period_date.split("T")[0] === dateKey);

    return {
      year: ap.period_label,
      // When PF exists, show stacked composition; otherwise show side-by-side
      acquirer: hasPf && pf ? toNum(pf.acquirer_revenue) : toNum(ap.revenue_total),
      target: hasPf && pf
        ? toNum(pf.target_revenue)
        : tp
        ? toNum(tp.revenue_total)
        : 0,
    };
  });

  return (
    <div>
      <h4 className="text-sm font-semibold text-gray-900 mb-4">
        {hasPf ? "Revenue-sammensetning PF (NOKm)" : "Revenue-sammenligning (NOKm)"}
      </h4>
      <ResponsiveContainer width="100%" height={300}>
        <BarChart data={chartData}>
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
          {hasPf ? (
            <>
              <Bar dataKey="acquirer" stackId="revenue" fill="#002C55" name={acquirerName} />
              <Bar dataKey="target" stackId="revenue" fill="#57A5E4" name={targetName} />
            </>
          ) : (
            <>
              <Bar dataKey="acquirer" fill="#002C55" name={acquirerName} />
              <Bar dataKey="target" fill="#57A5E4" name={targetName} />
            </>
          )}
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
