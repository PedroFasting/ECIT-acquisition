/**
 * Scenario Service — business logic extracted from scenarios route.
 *
 * Each function encapsulates a discrete operation (DB queries + computation)
 * so that the route handlers remain thin request/response adapters.
 */

import pool from "../models/db.js";
import { calculateDealReturns, type DealParameters, type CaseReturn, type CalculatedReturns } from "./dealReturns.js";
import { generateExcelModel, type ExportData } from "./excelExport/index.js";
import {
  buildProFormaPeriods,
  applySynergies,
  buildProFormaPeriodData,
  computeNibdFcf,
  prepareFullDealParams,
  sensitivityParamSetters,
  deriveBaseCapitalFromPeriods,
  getEquityFromSources,
  getPreferredFromSources,
  getDebtFromSources,
} from "./proForma.js";
import {
  loadScenarioContext,
  buildComputationData,
  runFullCalculation,
} from "./scenarioContext.js";

/** Matches Express req.params value type (string at runtime, but typed broadly). */
type ParamId = string | number | string[];

// ── SQL fragments ─────────────────────────────────────────────────

const SCENARIO_WITH_NAMES_SQL = `
  SELECT s.*,
    ac.name as acquirer_company_name, am.name as acquirer_model_name,
    tc.name as target_company_name, tm.name as target_model_name
  FROM acquisition_scenarios s
  LEFT JOIN financial_models am ON s.acquirer_model_id = am.id
  LEFT JOIN companies ac ON am.company_id = ac.id
  LEFT JOIN financial_models tm ON s.target_model_id = tm.id
  LEFT JOIN companies tc ON tm.company_id = tc.id`;

// ── List all scenarios ────────────────────────────────────────────

export async function listScenarios() {
  const result = await pool.query(
    `${SCENARIO_WITH_NAMES_SQL} ORDER BY s.created_at DESC`
  );
  return result.rows;
}

// ── Compare two models on-the-fly ─────────────────────────────────

export interface CompareResult {
  acquirer_model: any;
  acquirer_periods: any[];
  target_model: any | null;
  target_periods: any[];
  pro_forma_periods: any[];
  scenario: any | null;
  deal_returns: any[];
  calculated_returns: CaseReturn[] | null;
  returns_level: 1 | 2;
  returns_level_label: string;
  share_summary: any;
}

export async function compareModels(
  acquirerModelId: number,
  targetModelId: number | null,
  userId: number | undefined,
): Promise<CompareResult | { error: string; _errorStatus: number }> {
  // Get acquirer model info + periods
  const acquirerModel = await pool.query(
    `SELECT m.*, c.name as company_name, c.company_type
     FROM financial_models m JOIN companies c ON m.company_id = c.id
     WHERE m.id = $1`,
    [acquirerModelId]
  );
  if (acquirerModel.rows.length === 0) {
    return { error: "Acquirer model not found", _errorStatus: 404 };
  }

  const acquirerPeriods = await pool.query(
    "SELECT * FROM financial_periods WHERE model_id = $1 ORDER BY period_date",
    [acquirerModelId]
  );

  let targetModel: any = null;
  let targetPeriods: any[] = [];
  let proFormaPeriods: any[] = [];
  let scenario: any = null;
  let dealReturns: any[] = [];

  if (targetModelId) {
    const tm = await pool.query(
      `SELECT m.*, c.name as company_name, c.company_type
       FROM financial_models m JOIN companies c ON m.company_id = c.id
       WHERE m.id = $1`,
      [targetModelId]
    );
    if (tm.rows.length === 0) {
      return { error: "Target model not found", _errorStatus: 404 };
    }
    targetModel = tm.rows[0];

    const tp = await pool.query(
      "SELECT * FROM financial_periods WHERE model_id = $1 ORDER BY period_date",
      [targetModelId]
    );
    targetPeriods = tp.rows;

    // Find or create a scenario record (needed for deal_parameters in pro forma)
    const existing = await pool.query(
      `${SCENARIO_WITH_NAMES_SQL}
       WHERE s.acquirer_model_id = $1 AND s.target_model_id = $2
       ORDER BY s.updated_at DESC LIMIT 1`,
      [acquirerModelId, targetModelId]
    );

    if (existing.rows.length > 0) {
      scenario = existing.rows[0];
    } else {
      // Auto-create scenario — inherit acquirer-level fields from sibling
      const acqName = acquirerModel.rows[0].company_name;
      const tgtName = targetModel.company_name;

      // Look for a sibling scenario with the same acquirer to inherit S&U,
      // deal parameters, capital structure, and synergies from.
      // These fields are acquirer-level and shouldn't need re-entry per target.
      const sibling = await pool.query(
        `SELECT sources, uses, deal_parameters, cost_synergies_timeline,
                ordinary_equity, preferred_equity, preferred_equity_rate,
                net_debt, rollover_shareholders
         FROM acquisition_scenarios
         WHERE acquirer_model_id = $1 AND id != 0
         ORDER BY updated_at DESC LIMIT 1`,
        [acquirerModelId]
      );
      const s = sibling.rows[0] || {};

      const created = await pool.query(
        `INSERT INTO acquisition_scenarios (
          name, acquirer_model_id, target_model_id, status, created_by,
          sources, uses, deal_parameters, cost_synergies_timeline,
          ordinary_equity, preferred_equity, preferred_equity_rate,
          net_debt, rollover_shareholders
        ) VALUES ($1, $2, $3, 'active', $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
        RETURNING *`,
        [
          `${acqName} + ${tgtName}`,
          acquirerModelId,
          targetModelId,
          userId,
          JSON.stringify(s.sources || []),
          JSON.stringify(s.uses || []),
          JSON.stringify(s.deal_parameters || {}),
          JSON.stringify(s.cost_synergies_timeline || {}),
          s.ordinary_equity ?? null,
          s.preferred_equity ?? null,
          s.preferred_equity_rate ?? null,
          s.net_debt ?? null,
          s.rollover_shareholders ?? null,
        ]
      );
      scenario = {
        ...created.rows[0],
        acquirer_company_name: acqName,
        acquirer_model_name: acquirerModel.rows[0].name,
        target_company_name: tgtName,
        target_model_name: targetModel.name,
      };
    }

    // Build pro forma by combining overlapping periods
    proFormaPeriods = buildProFormaPeriods(
      acquirerPeriods.rows,
      targetPeriods,
      scenario?.deal_parameters,
    );
  }

  if (scenario) {
    // Fetch saved deal returns for this scenario
    const dr = await pool.query(
      "SELECT * FROM deal_returns WHERE scenario_id = $1 ORDER BY return_case, exit_multiple",
      [scenario.id]
    );
    dealReturns = dr.rows;

    // Apply synergies from saved timeline to proFormaPeriods
    applySynergies(proFormaPeriods, scenario.cost_synergies_timeline || {});
  }

  // Auto-calculate returns if deal_parameters are set on the scenario
  let calculatedReturns: CaseReturn[] | null = null;
  let returnsLevel: 1 | 2 = 1;
  let returnsLevelLabel = "";
  let shareSummary: any = undefined;
  const dp: DealParameters | null = scenario?.deal_parameters &&
    Object.keys(scenario.deal_parameters).length > 0 &&
    scenario.deal_parameters.price_paid > 0
    ? scenario.deal_parameters
    : null;

  if (dp) {
    const synergiesTimeline = scenario.cost_synergies_timeline || {};
    const ctx = {
      scenario,
      acquirerPeriods: acquirerPeriods.rows,
      targetPeriods,
      acquirerModelParams: acquirerModel.rows[0].model_parameters ?? null,
      synergiesTimeline,
    };
    const { result } = runFullCalculation(ctx, dp, proFormaPeriods);
    calculatedReturns = result.cases;
    returnsLevel = result.level;
    returnsLevelLabel = result.level_label;
    shareSummary = result.share_summary;
  }

  return {
    acquirer_model: acquirerModel.rows[0],
    acquirer_periods: acquirerPeriods.rows,
    target_model: targetModel,
    target_periods: targetPeriods,
    pro_forma_periods: proFormaPeriods,
    scenario: scenario,
    deal_returns: dealReturns,
    calculated_returns: calculatedReturns,
    returns_level: returnsLevel,
    returns_level_label: returnsLevelLabel,
    share_summary: shareSummary,
  };
}

// ── Get scenario with related data ────────────────────────────────

export async function getScenarioWithRelatedData(id: ParamId) {
  const scenarioResult = await pool.query(
    `${SCENARIO_WITH_NAMES_SQL} WHERE s.id = $1`,
    [id]
  );

  if (scenarioResult.rows.length === 0) {
    return null;
  }

  // Get deal returns
  const returnsResult = await pool.query(
    "SELECT * FROM deal_returns WHERE scenario_id = $1 ORDER BY return_case, exit_multiple",
    [id]
  );

  // Get pro forma periods
  const pfResult = await pool.query(
    "SELECT * FROM pro_forma_periods WHERE scenario_id = $1 ORDER BY period_date",
    [id]
  );

  // Get acquirer model periods
  const acquirerPeriods = await pool.query(
    "SELECT * FROM financial_periods WHERE model_id = $1 ORDER BY period_date",
    [scenarioResult.rows[0].acquirer_model_id]
  );

  // Get target model periods
  const targetPeriods = await pool.query(
    "SELECT * FROM financial_periods WHERE model_id = $1 ORDER BY period_date",
    [scenarioResult.rows[0].target_model_id]
  );

  return {
    ...scenarioResult.rows[0],
    deal_returns: returnsResult.rows,
    pro_forma_periods: pfResult.rows,
    acquirer_periods: acquirerPeriods.rows,
    target_periods: targetPeriods.rows,
  };
}

// ── Create scenario ───────────────────────────────────────────────

export interface CreateScenarioFields {
  name: string;
  description?: string;
  acquirer_model_id: number;
  target_model_id: number;
  acquisition_date?: string;
  share_price?: number;
  enterprise_value?: number;
  equity_value?: number;
  ordinary_equity?: number;
  preferred_equity?: number;
  preferred_equity_rate?: number;
  net_debt?: number;
  rollover_shareholders?: number;
  sources?: any[];
  uses?: any[];
  exit_date?: string;
  cost_synergies_timeline?: Record<string, number>;
}

export async function createScenario(fields: CreateScenarioFields, userId: number | undefined) {
  const result = await pool.query(
    `INSERT INTO acquisition_scenarios (
      name, description, acquirer_model_id, target_model_id,
      acquisition_date, share_price, enterprise_value, equity_value,
      ordinary_equity, preferred_equity, preferred_equity_rate, net_debt,
      rollover_shareholders, sources, uses, exit_date, cost_synergies_timeline,
      created_by
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
    RETURNING *`,
    [
      fields.name,
      fields.description,
      fields.acquirer_model_id,
      fields.target_model_id,
      fields.acquisition_date,
      fields.share_price,
      fields.enterprise_value,
      fields.equity_value,
      fields.ordinary_equity,
      fields.preferred_equity,
      fields.preferred_equity_rate,
      fields.net_debt,
      fields.rollover_shareholders,
      JSON.stringify(fields.sources || []),
      JSON.stringify(fields.uses || []),
      fields.exit_date,
      JSON.stringify(fields.cost_synergies_timeline || {}),
      userId,
    ]
  );
  return result.rows[0];
}

// ── Update scenario ───────────────────────────────────────────────

export async function updateScenario(id: ParamId, fields: Record<string, any>) {
  const setParts: string[] = [];
  const values: unknown[] = [];
  let paramIdx = 1;

  const allowedFields = [
    "name", "description", "acquirer_model_id", "target_model_id",
    "acquisition_date", "share_price", "enterprise_value", "equity_value",
    "ordinary_equity", "preferred_equity", "preferred_equity_rate", "net_debt",
    "rollover_shareholders", "exit_date", "status",
  ];

  for (const field of allowedFields) {
    if (fields[field] !== undefined) {
      setParts.push(`${field} = $${paramIdx}`);
      values.push(fields[field]);
      paramIdx++;
    }
  }

  // Handle JSON fields separately
  for (const jsonField of ["sources", "uses", "cost_synergies_timeline", "deal_parameters"]) {
    if (fields[jsonField] !== undefined) {
      setParts.push(`${jsonField} = $${paramIdx}`);
      values.push(JSON.stringify(fields[jsonField]));
      paramIdx++;
    }
  }

  if (setParts.length === 0) {
    return { error: "No valid fields to update", _errorStatus: 400 as const };
  }

  setParts.push("updated_at = NOW()");
  values.push(id);

  const result = await pool.query(
    `UPDATE acquisition_scenarios SET ${setParts.join(", ")} WHERE id = $${paramIdx} RETURNING *`,
    values
  );

  if (result.rows.length === 0) {
    return null;
  }
  return result.rows[0];
}

// ── Calculate returns ─────────────────────────────────────────────

export async function calculateReturnsForScenario(id: ParamId, dp: DealParameters) {
  // Save deal_parameters to scenario
  await pool.query(
    "UPDATE acquisition_scenarios SET deal_parameters = $1, updated_at = NOW() WHERE id = $2",
    [JSON.stringify(dp), id]
  );

  // Load all scenario data
  const loaded = await loadScenarioContext(id, { withNames: false });
  if (!loaded) {
    return null;
  }

  const { mergedDp, result } = runFullCalculation(loaded.ctx, dp);

  return {
    calculated_returns: result.cases,
    standalone_by_multiple: result.standalone_by_multiple,
    deal_parameters: mergedDp,
    level: result.level,
    level_label: result.level_label,
    share_summary: result.share_summary,
    debt_schedule: result.debt_schedule,
  };
}

// ── Sensitivity grid ──────────────────────────────────────────────

export interface SensitivityParams {
  base_params: DealParameters;
  row_axis: { param: string; values: number[] };
  col_axis: { param: string; values: number[] };
  metric: string;
  return_case: string;
}

export async function runSensitivityGrid(id: ParamId, params: SensitivityParams) {
  const { base_params, row_axis, col_axis, metric: metricKey, return_case: targetCase } = params;

  // Load scenario context (same data for all grid cells)
  const loaded = await loadScenarioContext(id, { withNames: false });
  if (!loaded) {
    return null;
  }
  const { ctx } = loaded;

  const setRow = sensitivityParamSetters[row_axis.param];
  const setCol = sensitivityParamSetters[col_axis.param];
  if (!setRow || !setCol) {
    return { error: `Invalid axis param: ${row_axis.param} or ${col_axis.param}`, _errorStatus: 400 as const };
  }

  // Pre-compute shared period data (invariant across grid cells)
  const tgtNibdFcf = computeNibdFcf(ctx.targetPeriods);
  const { acqData, periodLabels } = buildComputationData(ctx, base_params, tgtNibdFcf);

  // Run the grid
  const matrix: (number | null)[][] = [];

  for (const rowVal of row_axis.values) {
    const row: (number | null)[] = [];
    for (const colVal of col_axis.values) {
      // Start from base, apply row axis, then col axis
      let dp: DealParameters = { ...base_params };
      dp = setRow(dp, rowVal);
      dp = setCol(dp, colVal);

      // When axis is exit_multiple, force a single-element array
      const isExitMultRow = row_axis.param === "exit_multiple";
      const isExitMultCol = col_axis.param === "exit_multiple";
      const exitMult = isExitMultRow ? rowVal : isExitMultCol ? colVal : (dp.exit_multiples?.[Math.floor((dp.exit_multiples?.length || 1) / 2)] ?? 12);

      // Force a single exit multiple to speed up calculation
      dp.exit_multiples = [exitMult];

      const mergedDp = prepareFullDealParams(dp, ctx.scenario, ctx.acquirerPeriods, ctx.acquirerModelParams, ctx.synergiesTimeline);
      const pfData = buildProFormaPeriodData(ctx.acquirerPeriods, ctx.targetPeriods, ctx.synergiesTimeline, mergedDp, tgtNibdFcf);

      const result = calculateDealReturns(acqData, pfData, mergedDp, periodLabels);

      // Extract the requested metric from the target case
      const caseResult = result.cases.find(c => c.return_case === targetCase);
      let value: number | null = null;
      if (caseResult) {
        if (metricKey === "irr") value = caseResult.irr;
        else if (metricKey === "mom") value = caseResult.mom;
        else if (metricKey === "per_share_irr") value = caseResult.per_share_irr ?? null;
        else if (metricKey === "per_share_mom") value = caseResult.per_share_mom ?? null;
      }
      row.push(value);
    }
    matrix.push(row);
  }

  return {
    matrix,
    row_axis,
    col_axis,
    metric: metricKey,
    return_case: targetCase,
  };
}

// ── Bulk upsert deal returns ──────────────────────────────────────

export interface ReturnRow {
  return_case: string;
  exit_multiple: number;
  irr: number | null;
  mom: number | null;
  irr_delta?: number | null;
  mom_delta?: number | null;
}

export async function bulkUpsertReturns(id: ParamId, returns: ReturnRow[]) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const inserted = [];
    for (const r of returns) {
      const result = await client.query(
        `INSERT INTO deal_returns (scenario_id, return_case, exit_multiple, irr, mom, irr_delta, mom_delta)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (scenario_id, return_case, exit_multiple) DO UPDATE SET
           irr = EXCLUDED.irr, mom = EXCLUDED.mom,
           irr_delta = EXCLUDED.irr_delta, mom_delta = EXCLUDED.mom_delta
         RETURNING *`,
        [id, r.return_case, r.exit_multiple, r.irr, r.mom, r.irr_delta, r.mom_delta]
      );
      inserted.push(result.rows[0]);
    }

    await client.query("COMMIT");
    return { count: inserted.length, returns: inserted };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

// ── Generate and persist pro forma periods ────────────────────────

export async function generateAndPersistProForma(id: ParamId) {
  // Load scenario context
  const loaded = await loadScenarioContext(id, { withNames: false });
  if (!loaded) {
    return null;
  }
  const { ctx } = loaded;

  // Build pro forma periods using extracted helper
  const proFormaRows = buildProFormaPeriods(
    ctx.acquirerPeriods,
    ctx.targetPeriods,
    ctx.scenario.deal_parameters ?? undefined,
  );
  applySynergies(proFormaRows, ctx.synergiesTimeline);

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // Clear existing pro forma periods
    await client.query(
      "DELETE FROM pro_forma_periods WHERE scenario_id = $1",
      [id]
    );

    const combined = [];
    for (const pf of proFormaRows) {
      const result = await client.query(
        `INSERT INTO pro_forma_periods (
          scenario_id, period_date, period_label,
          acquirer_revenue, target_revenue, total_revenue,
          acquirer_ebitda, target_ebitda,
          total_ebitda_excl_synergies, ebitda_margin_excl_synergies,
          cost_synergies, total_ebitda_incl_synergies, ebitda_margin_incl_synergies,
          total_capex, total_change_nwc, total_other_cash_flow,
          operating_fcf, minority_interest, operating_fcf_excl_minorities,
          cash_conversion
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)
        RETURNING *`,
        [
          id,
          pf.period_date,
          pf.period_label,
          pf.acquirer_revenue,
          pf.target_revenue,
          pf.total_revenue,
          pf.acquirer_ebitda,
          pf.target_ebitda,
          pf.total_ebitda_excl_synergies,
          pf.ebitda_margin_excl_synergies,
          pf.cost_synergies,
          pf.total_ebitda_incl_synergies,
          pf.ebitda_margin_incl_synergies,
          pf.total_capex,
          pf.total_change_nwc,
          pf.total_other_cash_flow,
          pf.operating_fcf,
          pf.minority_interest,
          pf.operating_fcf_excl_minorities,
          pf.cash_conversion,
        ]
      );
      combined.push(result.rows[0]);
    }

    await client.query("COMMIT");
    return { count: combined.length, periods: combined };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

// ── Build Excel export data ───────────────────────────────────────

export async function buildExcelExportData(id: ParamId) {
  // Load scenario context with names (for Excel headers) and stored pro forma
  const loaded = await loadScenarioContext(id, { withNames: true, withStoredProForma: true });
  if (!loaded) {
    return null;
  }
  const { ctx, storedProFormaPeriods } = loaded;
  const scenario = ctx.scenario;

  // Build deal parameters
  const baseDp: DealParameters = (scenario.deal_parameters &&
    Object.keys(scenario.deal_parameters).length > 0)
    ? scenario.deal_parameters
    : {
        price_paid: 0,
        exit_multiples: [10, 11, 12, 13, 14],
        acquirer_entry_ev: 0,
        tax_rate: 0.22,
        da_pct_revenue: 0.01,
      };

  // Run full calculation
  let calculatedReturns: CalculatedReturns;
  let mergedDp: DealParameters;
  try {
    const calc = runFullCalculation(ctx, baseDp, storedProFormaPeriods);
    calculatedReturns = calc.result;
    mergedDp = calc.mergedDp;
  } catch (calcErr) {
    console.error("Deal returns calculation failed for export:", calcErr);
    calculatedReturns = { cases: [], standalone_by_multiple: {}, level: 1 as const, level_label: "Level 1" };
    mergedDp = baseDp;
  }

  // Ensure pro forma periods are available — compute on-the-fly if not stored
  let proFormaPeriods: any[] = storedProFormaPeriods || [];
  if (proFormaPeriods.length === 0 && ctx.acquirerPeriods.length > 0) {
    // No stored pro forma — compute from acquirer + target periods
    const pfRows = buildProFormaPeriods(
      ctx.acquirerPeriods,
      ctx.targetPeriods,
      mergedDp,
    );
    applySynergies(pfRows, ctx.synergiesTimeline);
    proFormaPeriods = pfRows;
  }

   // Build export data
   //
   // Capital structure: scenario-level DB columns store BASE capital
   // (existing acquirer equity/debt before acquisition financing).
   // The frontend persists base values on save; they may also be NULL
   // if never saved, in which case we derive from acquirer periods.
   //
   // PF Capital = Base (scenario column || period-derived) + S&U financing
  const baseCapital = deriveBaseCapitalFromPeriods(ctx.acquirerPeriods);
  const srcOE = getEquityFromSources(scenario.sources);
  const srcPE = getPreferredFromSources(scenario.sources);
  const srcND = getDebtFromSources(scenario.sources);

  // Scenario-level columns override period-derived values when set
  const safeParse = (v: any): number => {
    if (v == null) return 0;
    const n = parseFloat(v);
    return Number.isNaN(n) ? 0 : n;
  };
  const scenarioOE = safeParse(scenario.ordinary_equity);
  const scenarioPE = safeParse(scenario.preferred_equity);
  const scenarioND = safeParse(scenario.net_debt);

  // Priority: scenario column (if non-zero) > period-derived base; then add S&U on top
  const finalOE = (scenarioOE || baseCapital.ordinary_equity) + srcOE;
  const finalPE = (scenarioPE || baseCapital.preferred_equity) + srcPE;
  const finalND = (scenarioND || baseCapital.net_debt) + srcND;

  const exportData: ExportData = {
    scenarioName: scenario.name || `Scenario ${id}`,
    acquirerName: scenario.acquirer_company_name || "Acquirer",
    targetName: scenario.target_company_name || "Target",
    acquirerPeriods: ctx.acquirerPeriods,
    targetPeriods: ctx.targetPeriods,
    proFormaPeriods,
    dealParams: mergedDp,
    sources: scenario.sources || [],
    uses: scenario.uses || [],
    ordinaryEquity: finalOE,
    preferredEquity: finalPE,
    preferredEquityRate: mergedDp.preferred_equity_rate ?? 0.095,
    netDebt: finalND,
    calculatedReturns,
    synergiesTimeline: ctx.synergiesTimeline,
  };

  // Generate workbook
  const workbook = await generateExcelModel(exportData);

  const fileName = `${(scenario.name || "scenario").replace(/[^a-zA-Z0-9\-_ ]/g, "")}_${id}.xlsx`;

  return { workbook, fileName };
}

// ── Delete scenario ───────────────────────────────────────────────

export async function deleteScenario(id: ParamId) {
  const result = await pool.query(
    "DELETE FROM acquisition_scenarios WHERE id = $1 RETURNING id",
    [id]
  );
  return result.rows.length > 0;
}
