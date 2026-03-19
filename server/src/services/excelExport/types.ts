import type { DealParameters, CalculatedReturns } from "../dealReturns.js";

export interface ExportData {
  scenarioName: string;
  acquirerName: string;
  targetName: string;

  // Raw period data from DB
  acquirerPeriods: any[];   // FinancialPeriod rows
  targetPeriods: any[];

  // Pro forma (server-computed)
  proFormaPeriods: any[];   // ProFormaPeriod rows

  // Deal params
  dealParams: DealParameters;

  // Sources & Uses
  sources: Array<{ name: string; amount: number }>;
  uses: Array<{ name: string; amount: number }>;

  // Capital structure from scenario
  ordinaryEquity: number;
  preferredEquity: number;
  preferredEquityRate: number;
  netDebt: number;

  // Calculated returns (pre-computed)
  calculatedReturns: CalculatedReturns;

  // Synergies timeline
  synergiesTimeline: Record<string, number>;
}
