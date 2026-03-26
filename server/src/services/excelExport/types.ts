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

/**
 * Row map returned by sheet builders so downstream sheets can cross-reference.
 * Values are 1-based Excel row numbers.
 */
export interface ProFormaRowMap {
  totalRevenue: number;
  acqRevenue: number;
  tgtRevenue: number;
  ebitdaExcl: number;
  ebitdaIncl: number;
  operatingFcf: number;
  capex: number;
  changeNwc: number;
  otherCashFlow: number;
  costSynergies: number;
  acqEbitda: number;
  tgtEbitda: number;
  minority: number;
  fcfExclMinorities: number;
}

export interface EquityBridgeRowMap {
  ebitda: number;
  ev: number;
  nibd: number;
  optionDebt: number;
  eqv: number;
  preferredEquity: number;
  shareCount: number;
  perSharePre: number;
  mipAmount: number;
  tsoAmount: number;
  warrantsAmount: number;
  eqvPostDilution: number;
  perSharePost: number;
}

export interface DebtScheduleRowMap {
  ebitda: number;
  ufcf: number;
  openingDebt: number;
  interest: number;
  mandatoryAmort: number;
  cashSweep: number;
  totalDebtService: number;
  closingDebt: number;
  leverage: number;
  openingPref: number;
  pikAccrual: number;
  closingPref: number;
  fcfToEquity: number;
}

export interface DealReturnsRowMap {
  /** Map from exit multiple => row number of combined IRR */
  combinedIrrByMult: Record<number, number>;
  combinedMomByMult: Record<number, number>;
  perShareIrrByMult: Record<number, number>;
  perShareMomByMult: Record<number, number>;
}
