import { Router, Response } from "express";
import pool from "../models/db.js";
import { AuthRequest, authMiddleware } from "../middleware/auth.js";
import { validate } from "../middleware/validate.js";
import {
  CreateScenarioSchema,
  UpdateScenarioSchema,
  CalculateReturnsSchema,
  SensitivitySchema,
  BulkReturnsSchema,
} from "../schemas.js";
import { calculateDealReturns, type DealParameters, type PeriodData, type CaseReturn, type CalculatedReturns } from "../services/dealReturns.js";
import { generateExcelModel, type ExportData } from "../services/excelExporter.js";
import {
  buildProFormaPeriods,
  applySynergies,
  buildAcquirerPeriodData,
  buildTargetPeriodData,
  buildProFormaPeriodData,
  buildProFormaPeriodDataFromStored,
  computeNibdFcf,
  prepareFullDealParams,
  extractPeriodLabels,
  sensitivityParamSetters,
} from "../services/proForma.js";

const router = Router();
router.use(authMiddleware);

// List all scenarios
router.get("/", async (_req: AuthRequest, res: Response): Promise<void> => {
  try {
    const result = await pool.query(
      `SELECT s.*,
        ac.name as acquirer_company_name, am.name as acquirer_model_name,
        tc.name as target_company_name, tm.name as target_model_name
       FROM acquisition_scenarios s
       LEFT JOIN financial_models am ON s.acquirer_model_id = am.id
       LEFT JOIN companies ac ON am.company_id = ac.id
       LEFT JOIN financial_models tm ON s.target_model_id = tm.id
       LEFT JOIN companies tc ON tm.company_id = tc.id
       ORDER BY s.created_at DESC`
    );
    res.json(result.rows);
  } catch (err) {
    console.error("Error fetching scenarios:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Compare two models on-the-fly (no saved scenario needed)
router.get(
  "/compare",
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const acquirerModelId = Number(req.query.acquirer_model_id);
      const targetModelId = req.query.target_model_id
        ? Number(req.query.target_model_id)
        : null;

      if (!acquirerModelId) {
        res.status(400).json({ error: "acquirer_model_id is required" });
        return;
      }

      // Get acquirer model info + periods
      const acquirerModel = await pool.query(
        `SELECT m.*, c.name as company_name, c.company_type
         FROM financial_models m JOIN companies c ON m.company_id = c.id
         WHERE m.id = $1`,
        [acquirerModelId]
      );
      if (acquirerModel.rows.length === 0) {
        res.status(404).json({ error: "Acquirer model not found" });
        return;
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
          res.status(404).json({ error: "Target model not found" });
          return;
        }
        targetModel = tm.rows[0];

        const tp = await pool.query(
          "SELECT * FROM financial_periods WHERE model_id = $1 ORDER BY period_date",
          [targetModelId]
        );
        targetPeriods = tp.rows;

        // Find or create a scenario record (needed for deal_parameters in pro forma)
        const existing = await pool.query(
          `SELECT s.*,
            ac.name as acquirer_company_name, am.name as acquirer_model_name,
            tc.name as target_company_name, tm.name as target_model_name
           FROM acquisition_scenarios s
           LEFT JOIN financial_models am ON s.acquirer_model_id = am.id
           LEFT JOIN companies ac ON am.company_id = ac.id
           LEFT JOIN financial_models tm ON s.target_model_id = tm.id
           LEFT JOIN companies tc ON tm.company_id = tc.id
           WHERE s.acquirer_model_id = $1 AND s.target_model_id = $2
           ORDER BY s.updated_at DESC LIMIT 1`,
          [acquirerModelId, targetModelId]
        );

        if (existing.rows.length > 0) {
          scenario = existing.rows[0];
        } else {
          // Auto-create scenario
          const acqName = acquirerModel.rows[0].company_name;
          const tgtName = targetModel.company_name;
          const created = await pool.query(
            `INSERT INTO acquisition_scenarios (
              name, acquirer_model_id, target_model_id, status, created_by
            ) VALUES ($1, $2, $3, 'active', $4)
            RETURNING *`,
            [
              `${acqName} + ${tgtName}`,
              acquirerModelId,
              targetModelId,
              req.userId,
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
        const mergedParams = prepareFullDealParams(
          dp, scenario, acquirerPeriods.rows,
          acquirerModel.rows[0].model_parameters, synergiesTimeline,
        );

        const acqData = buildAcquirerPeriodData(acquirerPeriods.rows);
        const tgtData = buildTargetPeriodData(targetPeriods);
        const pfData = buildProFormaPeriodDataFromStored(proFormaPeriods, synergiesTimeline);

        const result = calculateDealReturns(acqData, tgtData, pfData, mergedParams);
        calculatedReturns = result.cases;
        returnsLevel = result.level;
        returnsLevelLabel = result.level_label;
        shareSummary = result.share_summary;
      }

      res.json({
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
      });
    } catch (err) {
      console.error("Error comparing models:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  }
);

// Get scenario with all related data
router.get("/:id", async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;

    const scenarioResult = await pool.query(
      `SELECT s.*,
        ac.name as acquirer_company_name, am.name as acquirer_model_name,
        tc.name as target_company_name, tm.name as target_model_name
       FROM acquisition_scenarios s
       LEFT JOIN financial_models am ON s.acquirer_model_id = am.id
       LEFT JOIN companies ac ON am.company_id = ac.id
       LEFT JOIN financial_models tm ON s.target_model_id = tm.id
       LEFT JOIN companies tc ON tm.company_id = tc.id
       WHERE s.id = $1`,
      [id]
    );

    if (scenarioResult.rows.length === 0) {
      res.status(404).json({ error: "Scenario not found" });
      return;
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

    res.json({
      ...scenarioResult.rows[0],
      deal_returns: returnsResult.rows,
      pro_forma_periods: pfResult.rows,
      acquirer_periods: acquirerPeriods.rows,
      target_periods: targetPeriods.rows,
    });
  } catch (err) {
    console.error("Error fetching scenario:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Create scenario
router.post("/", validate(CreateScenarioSchema), async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const {
      name,
      description,
      acquirer_model_id,
      target_model_id,
      acquisition_date,
      share_price,
      enterprise_value,
      equity_value,
      ordinary_equity,
      preferred_equity,
      preferred_equity_rate,
      net_debt,
      rollover_shareholders,
      sources,
      uses,
      exit_date,
      cost_synergies_timeline,
    } = req.body;

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
        name,
        description,
        acquirer_model_id,
        target_model_id,
        acquisition_date,
        share_price,
        enterprise_value,
        equity_value,
        ordinary_equity,
        preferred_equity,
        preferred_equity_rate,
        net_debt,
        rollover_shareholders,
        JSON.stringify(sources || []),
        JSON.stringify(uses || []),
        exit_date,
        JSON.stringify(cost_synergies_timeline || {}),
        req.userId,
      ]
    );

    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error("Error creating scenario:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Update scenario
router.put("/:id", validate(UpdateScenarioSchema), async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const fields = req.body;
    
    const setParts: string[] = [];
    const values: any[] = [];
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
      res.status(400).json({ error: "No valid fields to update" });
      return;
    }

    setParts.push("updated_at = NOW()");
    values.push(id);

    const result = await pool.query(
      `UPDATE acquisition_scenarios SET ${setParts.join(", ")} WHERE id = $${paramIdx} RETURNING *`,
      values
    );

    if (result.rows.length === 0) {
      res.status(404).json({ error: "Scenario not found" });
      return;
    }
    res.json(result.rows[0]);
  } catch (err) {
    console.error("Error updating scenario:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Calculate returns from deal parameters + financial data
router.post(
  "/:id/calculate-returns",
  validate(CalculateReturnsSchema),
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const { id } = req.params;
      const dp = req.body.deal_parameters as DealParameters;

      // Save deal_parameters to scenario
      await pool.query(
        "UPDATE acquisition_scenarios SET deal_parameters = $1, updated_at = NOW() WHERE id = $2",
        [JSON.stringify(dp), id]
      );

      // Get scenario with model refs
      const scenarioResult = await pool.query(
        "SELECT * FROM acquisition_scenarios WHERE id = $1",
        [id]
      );
      if (scenarioResult.rows.length === 0) {
        res.status(404).json({ error: "Scenario not found" });
        return;
      }
      const scenario = scenarioResult.rows[0];

      // Get acquirer periods
      const acquirerPeriods = await pool.query(
        "SELECT * FROM financial_periods WHERE model_id = $1 ORDER BY period_date",
        [scenario.acquirer_model_id]
      );

      // Get acquirer model_parameters (for MIP/TSO/warrants dilution)
      const acquirerModelResult = await pool.query(
        "SELECT model_parameters FROM financial_models WHERE id = $1",
        [scenario.acquirer_model_id]
      );
      const acquirerModelParams = acquirerModelResult.rows[0]?.model_parameters ?? null;

      // Get target periods
      let targetPeriods: any[] = [];
      if (scenario.target_model_id) {
        const tp = await pool.query(
          "SELECT * FROM financial_periods WHERE model_id = $1 ORDER BY period_date",
          [scenario.target_model_id]
        );
        targetPeriods = tp.rows;
      }

      // Get synergies timeline from scenario
      const synergiesTimeline = scenario.cost_synergies_timeline || {};

      // Build period data arrays using extracted helpers
      const tgtNibdFcf = computeNibdFcf(targetPeriods);
      const acqData = buildAcquirerPeriodData(acquirerPeriods.rows);
      const tgtData = buildTargetPeriodData(targetPeriods, tgtNibdFcf);
      const pfData = buildProFormaPeriodData(acquirerPeriods.rows, targetPeriods, synergiesTimeline, dp, tgtNibdFcf);

      // Merge capital structure + share tracking + dilution + synergies
      const mergedDp = prepareFullDealParams(dp, scenario, acquirerPeriods.rows, acquirerModelParams, synergiesTimeline);

      // Extract period labels for debt schedule (e.g. ["2026E", "2027E", ...])
      const periodLabels = extractPeriodLabels(acquirerPeriods.rows);

      const result = calculateDealReturns(acqData, tgtData, pfData, mergedDp, periodLabels);

      res.json({
        calculated_returns: result.cases,
        standalone_by_multiple: result.standalone_by_multiple,
        deal_parameters: mergedDp,
        level: result.level,
        level_label: result.level_label,
        share_summary: result.share_summary,
        debt_schedule: result.debt_schedule,
      });
    } catch (err) {
      console.error("Error calculating returns:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  }
);

// ── Sensitivity analysis: run calculation grid over two variable axes ──
router.post(
  "/:id/sensitivity",
  validate(SensitivitySchema),
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const { id } = req.params;
      const {
        base_params,   // DealParameters (baseline deal params)
        row_axis,      // { param: string, values: number[] }
        col_axis,      // { param: string, values: number[] }
        metric,        // 'irr' | 'mom' | 'per_share_irr' | 'per_share_mom'
        return_case,   // 'Kombinert' | 'Standalone' (default: 'Kombinert')
      } = req.body;

      const metricKey = metric;
      const targetCase = return_case;

      // ── Fetch scenario & period data (same prep as calculate-returns) ──
      const scenarioResult = await pool.query("SELECT * FROM acquisition_scenarios WHERE id = $1", [id]);
      if (scenarioResult.rows.length === 0) { res.status(404).json({ error: "Scenario not found" }); return; }
      const scenario = scenarioResult.rows[0];

      const acquirerPeriods = await pool.query(
        "SELECT * FROM financial_periods WHERE model_id = $1 ORDER BY period_date",
        [scenario.acquirer_model_id]
      );

      // Get acquirer model_parameters (for MIP/TSO/warrants dilution)
      const acquirerModelResult = await pool.query(
        "SELECT model_parameters FROM financial_models WHERE id = $1",
        [scenario.acquirer_model_id]
      );
      const acquirerModelParams = acquirerModelResult.rows[0]?.model_parameters ?? null;

      let targetPeriods: any[] = [];
      if (scenario.target_model_id) {
        const tp = await pool.query(
          "SELECT * FROM financial_periods WHERE model_id = $1 ORDER BY period_date",
          [scenario.target_model_id]
        );
        targetPeriods = tp.rows;
      }

      const synergiesTimeline = scenario.cost_synergies_timeline || {};

      // Pre-compute shared period data (invariant across grid cells)
      const tgtNibdFcf = computeNibdFcf(targetPeriods);
      const acqData = buildAcquirerPeriodData(acquirerPeriods.rows);
      const tgtData = buildTargetPeriodData(targetPeriods, tgtNibdFcf);
      const periodLabels = extractPeriodLabels(acquirerPeriods.rows);

      const setRow = sensitivityParamSetters[row_axis.param];
      const setCol = sensitivityParamSetters[col_axis.param];
      if (!setRow || !setCol) {
        res.status(400).json({ error: `Invalid axis param: ${row_axis.param} or ${col_axis.param}` });
        return;
      }

      // ── Run the grid ──
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

          const mergedDp = prepareFullDealParams(dp, scenario, acquirerPeriods.rows, acquirerModelParams, synergiesTimeline);
          const pfData = buildProFormaPeriodData(acquirerPeriods.rows, targetPeriods, synergiesTimeline, mergedDp, tgtNibdFcf);

          const result = calculateDealReturns(acqData, tgtData, pfData, mergedDp, periodLabels);

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

      res.json({
        matrix,
        row_axis,
        col_axis,
        metric: metricKey,
        return_case: targetCase,
      });
    } catch (err) {
      console.error("Error computing sensitivity:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  }
);

// Bulk upsert deal returns
router.post(
  "/:id/returns",
  validate(BulkReturnsSchema),
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const { id } = req.params;
      const { returns } = req.body;

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
        res.status(201).json({ count: inserted.length, returns: inserted });
      } catch (err) {
        await client.query("ROLLBACK");
        throw err;
      } finally {
        client.release();
      }
    } catch (err) {
      console.error("Error upserting deal returns:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  }
);

// Generate pro forma combined periods
router.post(
  "/:id/generate-pro-forma",
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const { id } = req.params;

      // Get scenario
      const scenarioResult = await pool.query(
        "SELECT * FROM acquisition_scenarios WHERE id = $1",
        [id]
      );
      if (scenarioResult.rows.length === 0) {
        res.status(404).json({ error: "Scenario not found" });
        return;
      }
      const scenario = scenarioResult.rows[0];

      // Get acquirer periods
      const acquirerPeriods = await pool.query(
        "SELECT * FROM financial_periods WHERE model_id = $1 ORDER BY period_date",
        [scenario.acquirer_model_id]
      );

      // Get target periods
      const targetPeriods = await pool.query(
        "SELECT * FROM financial_periods WHERE model_id = $1 ORDER BY period_date",
        [scenario.target_model_id]
      );

      // Build pro forma periods using extracted helper
      const synergiesTimeline = scenario.cost_synergies_timeline || {};
      const proFormaRows = buildProFormaPeriods(
        acquirerPeriods.rows,
        targetPeriods.rows,
        scenario.deal_parameters,
      );
      applySynergies(proFormaRows, synergiesTimeline);

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
        res.status(201).json({ count: combined.length, periods: combined });
      } catch (err) {
        await client.query("ROLLBACK");
        throw err;
      } finally {
        client.release();
      }
    } catch (err) {
      console.error("Error generating pro forma:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  }
);

// ── Export scenario as Excel (.xlsx) with live formulas ──────────
router.get(
  "/:id/export-excel",
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const { id } = req.params;

      // 1. Fetch scenario with company/model names
      const scenarioResult = await pool.query(
        `SELECT s.*,
          ac.name as acquirer_company_name, am.name as acquirer_model_name,
          tc.name as target_company_name, tm.name as target_model_name
         FROM acquisition_scenarios s
         LEFT JOIN financial_models am ON s.acquirer_model_id = am.id
         LEFT JOIN companies ac ON am.company_id = ac.id
         LEFT JOIN financial_models tm ON s.target_model_id = tm.id
         LEFT JOIN companies tc ON tm.company_id = tc.id
         WHERE s.id = $1`,
        [id]
      );
      if (scenarioResult.rows.length === 0) {
        res.status(404).json({ error: "Scenario not found" });
        return;
      }
      const scenario = scenarioResult.rows[0];

      // 2. Fetch period data
      const acquirerPeriods = await pool.query(
        "SELECT * FROM financial_periods WHERE model_id = $1 ORDER BY period_date",
        [scenario.acquirer_model_id]
      );
      let targetPeriods: any[] = [];
      if (scenario.target_model_id) {
        const tp = await pool.query(
          "SELECT * FROM financial_periods WHERE model_id = $1 ORDER BY period_date",
          [scenario.target_model_id]
        );
        targetPeriods = tp.rows;
      }
      const pfResult = await pool.query(
        "SELECT * FROM pro_forma_periods WHERE scenario_id = $1 ORDER BY period_date",
        [id]
      );

      // 3. Build deal parameters using extracted helpers
      const baseDp: DealParameters = (scenario.deal_parameters &&
        Object.keys(scenario.deal_parameters).length > 0)
        ? scenario.deal_parameters
        : {
            price_paid: 0,
            exit_multiples: [10, 11, 12, 13, 14],
            acquirer_entry_ev: 0,
            exit_years: [3, 4, 5],
            tax_rate: 0.22,
            da_pct_revenue: 0.05,
          };

      // 4. Calculate returns for export
      const synergiesTimeline = scenario.cost_synergies_timeline || {};

      // Get acquirer model_parameters for dilution
      const acquirerModelResult = await pool.query(
        "SELECT model_parameters FROM financial_models WHERE id = $1",
        [scenario.acquirer_model_id]
      );
      const acquirerModelParams = acquirerModelResult.rows[0]?.model_parameters ?? null;

      const mergedDp = prepareFullDealParams(baseDp, scenario, acquirerPeriods.rows, acquirerModelParams, synergiesTimeline);

      // Build period data arrays
      const acqData = buildAcquirerPeriodData(acquirerPeriods.rows);
      const tgtData = buildTargetPeriodData(targetPeriods);

      // Pro forma: use pro_forma_periods if available, else combine acquirer+target
      const proFormaPeriods = pfResult.rows;
      let pfData: PeriodData[];
      if (proFormaPeriods.length > 0) {
        pfData = buildProFormaPeriodDataFromStored(proFormaPeriods, synergiesTimeline);
      } else {
        // Fallback: combine acquirer + target periods (no NIBD FCF for export)
        pfData = buildProFormaPeriodData(acquirerPeriods.rows, targetPeriods, synergiesTimeline, mergedDp);
      }

      const periodLabels = extractPeriodLabels(acquirerPeriods.rows);

      let calculatedReturns: CalculatedReturns;
      try {
        calculatedReturns = calculateDealReturns(acqData, tgtData, pfData, mergedDp, periodLabels);
      } catch (calcErr) {
        console.error("Deal returns calculation failed for export:", calcErr);
        // Provide empty returns structure
        calculatedReturns = { cases: [], standalone_by_multiple: {}, level: 1 as const, level_label: "Level 1" };
      }

      // 5. Build export data
      const exportData: ExportData = {
        scenarioName: scenario.name || `Scenario ${id}`,
        acquirerName: scenario.acquirer_company_name || "Acquirer",
        targetName: scenario.target_company_name || "Target",
        acquirerPeriods: acquirerPeriods.rows,
        targetPeriods: targetPeriods,
        proFormaPeriods: pfResult.rows,
        dealParams: mergedDp,
        sources: scenario.sources || [],
        uses: scenario.uses || [],
        ordinaryEquity: mergedDp.ordinary_equity ?? 0,
        preferredEquity: mergedDp.preferred_equity ?? 0,
        preferredEquityRate: mergedDp.preferred_equity_rate ?? 0.095,
        netDebt: mergedDp.net_debt ?? 0,
        calculatedReturns,
        synergiesTimeline,
      };

      // 6. Generate workbook
      const workbook = await generateExcelModel(exportData);

      // 7. Stream as download
      const fileName = `${(scenario.name || "scenario").replace(/[^a-zA-Z0-9\-_ ]/g, "")}_${id}.xlsx`;
      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      res.setHeader("Content-Disposition", `attachment; filename="${fileName}"`);

      await workbook.xlsx.write(res);
      res.end();
    } catch (err) {
      console.error("Error exporting Excel:", err);
      res.status(500).json({ error: "Failed to export Excel file" });
    }
  }
);

// Delete scenario
router.delete(
  "/:id",
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const { id } = req.params;
      const result = await pool.query(
        "DELETE FROM acquisition_scenarios WHERE id = $1 RETURNING id",
        [id]
      );
      if (result.rows.length === 0) {
        res.status(404).json({ error: "Scenario not found" });
        return;
      }
      res.json({ message: "Scenario deleted" });
    } catch (err) {
      console.error("Error deleting scenario:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  }
);

export default router;
