/**
 * Scenario Context — shared data-fetching and computation helpers.
 *
 * Consolidates the duplicated pattern of "load scenario by ID → fetch
 * acquirer/target periods → fetch model params → build computation data"
 * that was repeated across 5 route handlers in scenarios.ts.
 */

import pool from "../models/db.js";
import type { DealParameters, PeriodData, CalculatedReturns, CaseReturn } from "./dealReturns.js";
import { calculateDealReturns } from "./dealReturns.js";
import {
  computeNibdFcf,
  buildAcquirerPeriodData,
  buildTargetPeriodData,
  buildProFormaPeriodData,
  buildProFormaPeriodDataFromStored,
  prepareFullDealParams,
  extractPeriodLabels,
} from "./proForma.js";

// ── Types ──────────────────────────────────────────────────────────

/** The SQL join query for scenario + company/model names. */
const SCENARIO_WITH_NAMES_SQL = `
  SELECT s.*,
    ac.name as acquirer_company_name, am.name as acquirer_model_name,
    tc.name as target_company_name, tm.name as target_model_name
  FROM acquisition_scenarios s
  LEFT JOIN financial_models am ON s.acquirer_model_id = am.id
  LEFT JOIN companies ac ON am.company_id = ac.id
  LEFT JOIN financial_models tm ON s.target_model_id = tm.id
  LEFT JOIN companies tc ON tm.company_id = tc.id`;

/**
 * Raw DB row for a scenario.
 *
 * Uses `any` for loosely-typed JSON columns to match the existing proForma.ts
 * function signatures (which accept `any` for scenario fields). We use a
 * narrowed interface rather than a bare Record so callers get autocompletion
 * on known fields while still being able to pass the object to proForma helpers.
 */
export interface ScenarioRow {
  id: number;
  acquirer_model_id: number;
  target_model_id: number | null;
  deal_parameters: DealParameters | null;
  cost_synergies_timeline: Record<string, number> | null;
  sources: any[] | null;
  uses: any[] | null;
  name: string | null;
  acquirer_company_name?: string;
  acquirer_model_name?: string;
  target_company_name?: string;
  target_model_name?: string;
  // Allow access to arbitrary DB columns
  [key: string]: any;
}

/** Everything needed to run deal returns calculations. */
export interface ScenarioContext {
  scenario: ScenarioRow;
  acquirerPeriods: any[];
  targetPeriods: any[];
  acquirerModelParams: Record<string, any> | null;
  synergiesTimeline: Record<string, number>;
}

/** Pre-computed period data arrays ready for the deal returns engine. */
export interface ComputationData {
  acqData: PeriodData[];
  tgtData: PeriodData[];
  pfData: PeriodData[];
  periodLabels: string[];
}

/** Full calculation result including merged deal parameters. */
export interface FullCalculationResult {
  mergedDp: DealParameters;
  result: CalculatedReturns;
}

// ── Data Fetching ──────────────────────────────────────────────────

export interface LoadOptions {
  /** Include company/model name JOINs (default: false). */
  withNames?: boolean;
  /** Also fetch stored pro_forma_periods (for export). */
  withStoredProForma?: boolean;
}

/**
 * Load a scenario by ID with all related data needed for computation.
 *
 * Fetches: scenario row, acquirer periods, target periods, acquirer model params.
 * Returns null if scenario not found.
 */
export async function loadScenarioContext(
  scenarioId: number | string | string[],
  opts: LoadOptions = {},
): Promise<{ ctx: ScenarioContext; storedProFormaPeriods?: any[] } | null> {
  const { withNames = false, withStoredProForma = false } = opts;

  // 1. Fetch scenario
  const scenarioSQL = withNames
    ? `${SCENARIO_WITH_NAMES_SQL} WHERE s.id = $1`
    : "SELECT * FROM acquisition_scenarios WHERE id = $1";

  const scenarioResult = await pool.query(scenarioSQL, [scenarioId]);
  if (scenarioResult.rows.length === 0) return null;
  const scenario: ScenarioRow = scenarioResult.rows[0];

  // 2. Fetch acquirer periods
  const acquirerPeriodsResult = await pool.query(
    "SELECT * FROM financial_periods WHERE model_id = $1 ORDER BY period_date",
    [scenario.acquirer_model_id],
  );

  // 3. Fetch acquirer model_parameters (for MIP/TSO/warrants dilution)
  const acquirerModelResult = await pool.query(
    "SELECT model_parameters FROM financial_models WHERE id = $1",
    [scenario.acquirer_model_id],
  );
  const acquirerModelParams = acquirerModelResult.rows[0]?.model_parameters ?? null;

  // 4. Fetch target periods (if target exists)
  let targetPeriods: any[] = [];
  if (scenario.target_model_id) {
    const tp = await pool.query(
      "SELECT * FROM financial_periods WHERE model_id = $1 ORDER BY period_date",
      [scenario.target_model_id],
    );
    targetPeriods = tp.rows;
  }

  // 5. Synergies timeline
  const synergiesTimeline = (scenario.cost_synergies_timeline || {}) as Record<string, number>;

  const ctx: ScenarioContext = {
    scenario,
    acquirerPeriods: acquirerPeriodsResult.rows,
    targetPeriods,
    acquirerModelParams,
    synergiesTimeline,
  };

  // 6. Optionally fetch stored pro forma periods
  let storedProFormaPeriods: any[] | undefined;
  if (withStoredProForma) {
    const pfResult = await pool.query(
      "SELECT * FROM pro_forma_periods WHERE scenario_id = $1 ORDER BY period_date",
      [scenarioId],
    );
    storedProFormaPeriods = pfResult.rows;
  }

  return { ctx, storedProFormaPeriods };
}

// ── Computation Helpers ────────────────────────────────────────────

/**
 * Build period data arrays from a loaded scenario context.
 *
 * @param ctx       — loaded scenario context
 * @param dp        — deal parameters (used for target-specific rate fallbacks)
 * @param nibdFcf   — optional pre-computed NIBD FCF array (computed if not provided)
 * @param storedPf  — if provided, use stored pro forma periods instead of computing fresh
 */
export function buildComputationData(
  ctx: ScenarioContext,
  dp: DealParameters,
  nibdFcf?: (number | undefined)[],
  storedPf?: any[],
): ComputationData {
  const computedNibdFcf = nibdFcf ?? computeNibdFcf(ctx.targetPeriods);

  const acqData = buildAcquirerPeriodData(ctx.acquirerPeriods);
  const tgtData = buildTargetPeriodData(ctx.targetPeriods, computedNibdFcf);

  let pfData: PeriodData[];
  if (storedPf && storedPf.length > 0) {
    pfData = buildProFormaPeriodDataFromStored(storedPf, ctx.synergiesTimeline);
  } else {
    pfData = buildProFormaPeriodData(
      ctx.acquirerPeriods, ctx.targetPeriods,
      ctx.synergiesTimeline, dp, computedNibdFcf,
    );
  }

  const periodLabels = extractPeriodLabels(ctx.acquirerPeriods);

  return { acqData, tgtData, pfData, periodLabels };
}

/**
 * Full calculation pipeline: merge deal params → build period data → run engine.
 *
 * This is the one-liner that replaces ~15 lines duplicated across handlers.
 */
export function runFullCalculation(
  ctx: ScenarioContext,
  baseDp: DealParameters,
  storedPf?: any[],
): FullCalculationResult {
  const mergedDp = prepareFullDealParams(
    baseDp, ctx.scenario,
    ctx.acquirerPeriods, ctx.acquirerModelParams,
    ctx.synergiesTimeline,
  );

  const { acqData, pfData, periodLabels } = buildComputationData(ctx, mergedDp, undefined, storedPf);
  const result = calculateDealReturns(acqData, pfData, mergedDp, periodLabels);

  return { mergedDp, result };
}
