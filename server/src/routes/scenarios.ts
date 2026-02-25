import { Router, Response } from "express";
import pool from "../models/db.js";
import { AuthRequest, authMiddleware } from "../middleware/auth.js";
import { calculateDealReturns, type DealParameters, type CaseReturn } from "../services/dealReturns.js";

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

        // Build pro forma by combining overlapping periods
        const targetByDate = new Map<string, any>();
        for (const t of targetPeriods) {
          targetByDate.set(
            t.period_date.toISOString().split("T")[0],
            t
          );
        }

        for (const ap of acquirerPeriods.rows) {
          const dateKey = ap.period_date.toISOString().split("T")[0];
          const tp = targetByDate.get(dateKey);

          const acquirerRevenue = parseFloat(ap.revenue_total) || 0;
          const targetRevenue = tp ? parseFloat(tp.revenue_total) || 0 : 0;
          const totalRevenue = acquirerRevenue + targetRevenue;

          const acquirerEbitda = parseFloat(ap.ebitda_total) || 0;
          const targetEbitda = tp ? parseFloat(tp.ebitda_total) || 0 : 0;
          const totalEbitda = acquirerEbitda + targetEbitda;

          const totalCapex =
            (parseFloat(ap.capex) || 0) + (tp ? parseFloat(tp.capex) || 0 : 0);
          const totalNwc =
            (parseFloat(ap.change_nwc) || 0) +
            (tp ? parseFloat(tp.change_nwc) || 0 : 0);
          const totalOther =
            (parseFloat(ap.other_cash_flow_items) || 0) +
            (tp ? parseFloat(tp.other_cash_flow_items) || 0 : 0);
          const opFcf = totalEbitda + totalCapex + totalNwc + totalOther;

          proFormaPeriods.push({
            period_date: ap.period_date,
            period_label: ap.period_label,
            acquirer_revenue: acquirerRevenue,
            target_revenue: targetRevenue,
            total_revenue: totalRevenue,
            acquirer_ebitda: acquirerEbitda,
            target_ebitda: targetEbitda,
            total_ebitda_excl_synergies: totalEbitda,
            ebitda_margin_excl_synergies:
              totalRevenue > 0 ? totalEbitda / totalRevenue : 0,
            cost_synergies: 0,
            total_ebitda_incl_synergies: totalEbitda,
            ebitda_margin_incl_synergies:
              totalRevenue > 0 ? totalEbitda / totalRevenue : 0,
            total_capex: totalCapex,
            total_change_nwc: totalNwc,
            total_other_cash_flow: totalOther,
            operating_fcf: opFcf,
          });
        }
      }

      // Find or create a scenario record when target is selected (for persisting deal params)
      let scenario: any = null;
      let dealReturns: any[] = [];

      if (targetModelId) {
        // Look for existing scenario with this model pair
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

        // Fetch saved deal returns for this scenario
        const dr = await pool.query(
          "SELECT * FROM deal_returns WHERE scenario_id = $1 ORDER BY return_case, exit_multiple",
          [scenario.id]
        );
        dealReturns = dr.rows;
      }

      // Auto-calculate returns if deal_parameters are set on the scenario
      let calculatedReturns: CaseReturn[] | null = null;
      const dp: DealParameters | null = scenario?.deal_parameters &&
        Object.keys(scenario.deal_parameters).length > 0 &&
        scenario.deal_parameters.price_paid > 0
        ? scenario.deal_parameters
        : null;

      if (dp) {
        const acqData = acquirerPeriods.rows.map((p: any) => ({
          ebitda: parseFloat(p.ebitda_total) || 0,
          revenue: parseFloat(p.revenue_total) || 0,
        }));
        const tgtData = targetPeriods.map((p: any) => ({
          ebitda: parseFloat(p.ebitda_total) || 0,
          revenue: parseFloat(p.revenue_total) || 0,
        }));
        const pfData = proFormaPeriods.map((p: any) => ({
          ebitda: p.total_ebitda_excl_synergies || 0,
          revenue: p.total_revenue || 0,
        }));
        const result = calculateDealReturns(acqData, tgtData, pfData, dp);
        calculatedReturns = result.cases;
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
router.post("/", async (req: AuthRequest, res: Response): Promise<void> => {
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
router.put("/:id", async (req: AuthRequest, res: Response): Promise<void> => {
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
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const { id } = req.params;
      const { deal_parameters: dp } = req.body as { deal_parameters: DealParameters };

      if (!dp || !dp.price_paid) {
        res.status(400).json({ error: "deal_parameters with price_paid is required" });
        return;
      }

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

      // Get target periods
      let targetPeriods: any[] = [];
      if (scenario.target_model_id) {
        const tp = await pool.query(
          "SELECT * FROM financial_periods WHERE model_id = $1 ORDER BY period_date",
          [scenario.target_model_id]
        );
        targetPeriods = tp.rows;
      }

      // Build pro forma
      const targetByDate = new Map<string, any>();
      for (const t of targetPeriods) {
        targetByDate.set(t.period_date.toISOString().split("T")[0], t);
      }

      const pfData: { ebitda: number; revenue: number }[] = [];
      for (const ap of acquirerPeriods.rows) {
        const dateKey = ap.period_date.toISOString().split("T")[0];
        const tp = targetByDate.get(dateKey);
        pfData.push({
          ebitda: (parseFloat(ap.ebitda_total) || 0) + (tp ? parseFloat(tp.ebitda_total) || 0 : 0),
          revenue: (parseFloat(ap.revenue_total) || 0) + (tp ? parseFloat(tp.revenue_total) || 0 : 0),
        });
      }

      const acqData = acquirerPeriods.rows.map((p: any) => ({
        ebitda: parseFloat(p.ebitda_total) || 0,
        revenue: parseFloat(p.revenue_total) || 0,
      }));
      const tgtData = targetPeriods.map((p: any) => ({
        ebitda: parseFloat(p.ebitda_total) || 0,
        revenue: parseFloat(p.revenue_total) || 0,
      }));

      const result = calculateDealReturns(acqData, tgtData, pfData, dp);

      res.json({
        calculated_returns: result.cases,
        standalone_by_multiple: result.standalone_by_multiple,
        deal_parameters: dp,
      });
    } catch (err) {
      console.error("Error calculating returns:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  }
);

// Bulk upsert deal returns
router.post(
  "/:id/returns",
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const { id } = req.params;
      const { returns } = req.body;

      if (!Array.isArray(returns)) {
        res.status(400).json({ error: "returns array is required" });
        return;
      }

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

      // Build lookup by period_date for target
      const targetByDate = new Map<string, any>();
      for (const tp of targetPeriods.rows) {
        targetByDate.set(tp.period_date.toISOString().split("T")[0], tp);
      }

      const client = await pool.connect();
      try {
        await client.query("BEGIN");

        // Clear existing pro forma periods
        await client.query(
          "DELETE FROM pro_forma_periods WHERE scenario_id = $1",
          [id]
        );

        const combined = [];
        for (const ap of acquirerPeriods.rows) {
          const dateKey = ap.period_date.toISOString().split("T")[0];
          const tp = targetByDate.get(dateKey);

          const acquirerRevenue = parseFloat(ap.revenue_total) || 0;
          const targetRevenue = tp ? parseFloat(tp.revenue_total) || 0 : 0;
          const totalRevenue = acquirerRevenue + targetRevenue;

          const acquirerEbitda = parseFloat(ap.ebitda_total) || 0;
          const targetEbitda = tp ? parseFloat(tp.ebitda_total) || 0 : 0;
          const totalEbitdaExcl = acquirerEbitda + targetEbitda;

          // Apply cost synergies from timeline
          const year = ap.period_date.getFullYear().toString();
          const synergies =
            scenario.cost_synergies_timeline?.[year] || 0;

          const totalCapex =
            (parseFloat(ap.capex) || 0) + (tp ? parseFloat(tp.capex) || 0 : 0);
          const totalNwc =
            (parseFloat(ap.change_nwc) || 0) +
            (tp ? parseFloat(tp.change_nwc) || 0 : 0);
          const totalOther =
            (parseFloat(ap.other_cash_flow_items) || 0) +
            (tp ? parseFloat(tp.other_cash_flow_items) || 0 : 0);
          const opFcf =
            totalEbitdaExcl + synergies + totalCapex + totalNwc + totalOther;

          const result = await client.query(
            `INSERT INTO pro_forma_periods (
              scenario_id, period_date, period_label,
              acquirer_revenue, target_revenue, total_revenue,
              acquirer_ebitda, target_ebitda,
              total_ebitda_excl_synergies, ebitda_margin_excl_synergies,
              cost_synergies, total_ebitda_incl_synergies, ebitda_margin_incl_synergies,
              total_capex, total_change_nwc, total_other_cash_flow,
              operating_fcf
            ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
            RETURNING *`,
            [
              id,
              ap.period_date,
              ap.period_label,
              acquirerRevenue,
              targetRevenue,
              totalRevenue,
              acquirerEbitda,
              targetEbitda,
              totalEbitdaExcl,
              totalRevenue > 0 ? totalEbitdaExcl / totalRevenue : 0,
              synergies,
              totalEbitdaExcl + synergies,
              totalRevenue > 0
                ? (totalEbitdaExcl + synergies) / totalRevenue
                : 0,
              totalCapex,
              totalNwc,
              totalOther,
              opFcf,
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
