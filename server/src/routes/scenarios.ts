import { Router, Response } from "express";
import pool from "../models/db.js";
import { AuthRequest, authMiddleware } from "../middleware/auth.js";
import { calculateDealReturns, type DealParameters, type PeriodData, type CaseReturn, type CalculatedReturns } from "../services/dealReturns.js";
import { generateExcelModel, type ExportData } from "../services/excelExporter.js";

const router = Router();
router.use(authMiddleware);

/**
 * Source type classification: "debt" | "equity" | "preferred"
 * Prefers explicit `type` field on source items; falls back to keyword heuristics.
 */
type SourceType = "debt" | "equity" | "preferred";

function autoClassifySource(name: string): SourceType {
  const n = (name || "").toLowerCase().trim();
  // Preferred equity keywords (check first — "preferred equity" shouldn't match "equity")
  if (n.includes("prefer") || n.includes("preferanse") || n.includes("pref equity") || n.includes("pref ek")) {
    return "preferred";
  }
  // Debt keywords
  if (n.includes("debt") || n.includes("gjeld") || n.includes("lån") || n.includes("loan") || n.includes("credit") || n.includes("kreditt") || n.includes("obligasjon") || n.includes("bond")) {
    return "debt";
  }
  // Ordinary equity keywords
  if (n.includes("equity") || n.includes("egenkapital") || n.includes("ordinær") || n.includes("ordinary") || n.includes("share issue") || n.includes("aksjeemisjon") || n.includes("emisjon") || n.includes("kapitalforhøyelse") || n.includes("ny kapital") || n.includes("new capital") || n === "ek" || n === "oe") {
    return "equity";
  }
  // Default: treat unclassified as debt (conservative — doesn't inflate equity)
  return "debt";
}

function getSourceType(s: { name: string; amount?: any; type?: string }): SourceType {
  if (s.type === "debt" || s.type === "equity" || s.type === "preferred") return s.type;
  return autoClassifySource(s.name);
}

/**
 * Extract ordinary equity amount from Sources & Uses.
 * Prefers explicit `type` field; falls back to keyword heuristics.
 */
function getEquityFromSources(sources: Array<{ name: string; amount: any; type?: string }> | null | undefined): number {
  if (!sources || sources.length === 0) return 0;
  return sources
    .filter((s: any) => getSourceType(s) === "equity")
    .reduce((sum: number, s: any) => sum + (parseFloat(s.amount) || 0), 0);
}

/**
 * Extract preferred equity amount from Sources & Uses.
 */
function getPreferredFromSources(sources: Array<{ name: string; amount: any; type?: string }> | null | undefined): number {
  if (!sources || sources.length === 0) return 0;
  return sources
    .filter((s: any) => getSourceType(s) === "preferred")
    .reduce((sum: number, s: any) => sum + (parseFloat(s.amount) || 0), 0);
}

/**
 * Extract debt amount from Sources & Uses.
 */
function getDebtFromSources(sources: Array<{ name: string; amount: any; type?: string }> | null | undefined): number {
  if (!sources || sources.length === 0) return 0;
  return sources
    .filter((s: any) => getSourceType(s) === "debt")
    .reduce((sum: number, s: any) => sum + (parseFloat(s.amount) || 0), 0);
}

/**
 * Extract dilution parameters from model_parameters JSONB.
 * These are used by the deal returns engine to compute MIP/TSO/warrant
 * deductions from exit equity before calculating per-share returns.
 */
function extractDilutionParams(modelParams: Record<string, any> | null | undefined): {
  mip_share_pct?: number;
  tso_warrants_count?: number;
  tso_warrants_price?: number;
  existing_warrants_count?: number;
  existing_warrants_price?: number;
  dilution_base_shares?: number;
} {
  if (!modelParams) return {};
  return {
    mip_share_pct: modelParams.mip_share_pct != null ? parseFloat(modelParams.mip_share_pct) : undefined,
    tso_warrants_count: modelParams.tso_warrants_count != null ? parseFloat(modelParams.tso_warrants_count) : undefined,
    tso_warrants_price: modelParams.tso_warrants_price != null ? parseFloat(modelParams.tso_warrants_price) : undefined,
    existing_warrants_count: modelParams.existing_warrants_count != null ? parseFloat(modelParams.existing_warrants_count) : undefined,
    existing_warrants_price: modelParams.existing_warrants_price != null ? parseFloat(modelParams.existing_warrants_price) : undefined,
    // Base shares for PPS_pre calculation: use shares_completion (pre year-end adjustments)
    // or shares_year_end. These are the "ordinary" shares before M&A dilution.
    dilution_base_shares: modelParams.shares_completion != null
      ? parseFloat(modelParams.shares_completion)
      : (modelParams.shares_year_end != null ? parseFloat(modelParams.shares_year_end) : undefined),
  };
}

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

        // Apply synergies from saved timeline to proFormaPeriods so client gets real values
        const savedSynergiesTimeline = scenario.cost_synergies_timeline || {};
        for (const pf of proFormaPeriods) {
          const year = new Date(pf.period_date).getFullYear().toString();
          const synergy = savedSynergiesTimeline[year] || 0;
          pf.cost_synergies = synergy;
          pf.total_ebitda_incl_synergies = pf.total_ebitda_excl_synergies + synergy;
          const rev = pf.total_revenue || 0;
          pf.ebitda_margin_incl_synergies = rev > 0 ? pf.total_ebitda_incl_synergies / rev : 0;
        }
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
        // Merge capital structure: scenario-level fields > source-derived > deal_parameters JSON (can be stale)
        const srcOE = getEquityFromSources(scenario.sources);
        const srcPE = getPreferredFromSources(scenario.sources);
        const srcND = getDebtFromSources(scenario.sources);
        const mergedParams: DealParameters = {
          ...dp,
          ordinary_equity: (scenario.ordinary_equity != null ? parseFloat(scenario.ordinary_equity) : undefined) ?? (srcOE > 0 ? srcOE : undefined) ?? dp.ordinary_equity,
          preferred_equity: (scenario.preferred_equity != null ? parseFloat(scenario.preferred_equity) : undefined) ?? (srcPE > 0 ? srcPE : undefined) ?? dp.preferred_equity,
          preferred_equity_rate: (scenario.preferred_equity_rate != null ? parseFloat(scenario.preferred_equity_rate) : undefined) ?? dp.preferred_equity_rate,
          net_debt: (scenario.net_debt != null ? parseFloat(scenario.net_debt) : undefined) ?? (srcND > 0 ? srcND : undefined) ?? dp.net_debt,
          rollover_equity: (scenario.rollover_shareholders != null ? parseFloat(scenario.rollover_shareholders) : undefined) ?? dp.rollover_equity,
          equity_from_sources: srcOE,
        };

        // ── Share tracking: extract entry/exit shares from acquirer periods ──
        // Entry shares = first period share_count, exit shares = last period share_count
        // entry_price_per_share = first period eqv_post_dilution (fully diluted FMV per share)
        if (!mergedParams.entry_shares && acquirerPeriods.rows.length > 0) {
          const firstPeriod = acquirerPeriods.rows[0];
          const lastPeriod = acquirerPeriods.rows[acquirerPeriods.rows.length - 1];
          const entryShares = firstPeriod.share_count != null ? parseFloat(firstPeriod.share_count) : 0;
          const exitShares = lastPeriod.share_count != null ? parseFloat(lastPeriod.share_count) : 0;
          // Use fully diluted value (after MIP/TSO/warrants), fall back to per_share_pre if unavailable
          const entryPricePerShare = firstPeriod.eqv_post_dilution != null
            ? parseFloat(firstPeriod.eqv_post_dilution)
            : (firstPeriod.per_share_pre != null ? parseFloat(firstPeriod.per_share_pre) : 0);

          if (entryShares > 0) {
            mergedParams.entry_shares = entryShares;
            mergedParams.exit_shares = exitShares > 0 ? exitShares : entryShares;
            mergedParams.entry_price_per_share = entryPricePerShare;
          }
        }

        // ── Dilution params: MIP/TSO/warrants from acquirer model_parameters ──
        const dilutionParams = extractDilutionParams(acquirerModel.rows[0].model_parameters);
        Object.assign(mergedParams, dilutionParams);

        // Build period data with actual capex/NWC
        const acqData: PeriodData[] = acquirerPeriods.rows.map((p: any) => ({
          ebitda: parseFloat(p.ebitda_total) || 0,
          revenue: parseFloat(p.revenue_total) || 0,
          capex: p.capex != null ? parseFloat(p.capex) : undefined,
          change_nwc: p.change_nwc != null ? parseFloat(p.change_nwc) : undefined,
        }));
        const tgtData: PeriodData[] = targetPeriods.map((p: any) => ({
          ebitda: parseFloat(p.ebitda_total) || 0,
          revenue: parseFloat(p.revenue_total) || 0,
          capex: p.capex != null ? parseFloat(p.capex) : undefined,
          change_nwc: p.change_nwc != null ? parseFloat(p.change_nwc) : undefined,
        }));

        // Pro forma: include synergies from cost_synergies_timeline
        const synergiesTimeline = scenario.cost_synergies_timeline || {};
        const pfData: PeriodData[] = proFormaPeriods.map((p: any) => {
          const year = new Date(p.period_date).getFullYear().toString();
          const synergy = synergiesTimeline[year] || 0;
          return {
            ebitda: (p.total_ebitda_excl_synergies || 0) + synergy,
            revenue: p.total_revenue || 0,
            capex: p.total_capex != null ? p.total_capex : undefined,
            change_nwc: p.total_change_nwc != null ? p.total_change_nwc : undefined,
          };
        });

        // Pass synergies array for Level 2 if needed
        const synergiesArray = proFormaPeriods.map((p: any) => {
          const year = new Date(p.period_date).getFullYear().toString();
          return synergiesTimeline[year] || 0;
        });
        mergedParams.cost_synergies = synergiesArray;

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

      // Build pro forma
      const targetByDate = new Map<string, any>();
      for (const t of targetPeriods) {
        targetByDate.set(t.period_date.toISOString().split("T")[0], t);
      }

      // Get synergies timeline from scenario
      const synergiesTimeline = scenario.cost_synergies_timeline || {};

      // ── Helper: compute NIBD-derived FCF for an ordered array of periods ──
      // FCF(t) = -(NIBD(t) - NIBD(t-1)) = NIBD decrease = cash generated
      // Only suitable for targets (pure operating cash); NOT for acquirers (NIBD includes M&A)
      function computeNibdFcf(periods: any[]): (number | undefined)[] {
        const result: (number | undefined)[] = [];
        for (let i = 0; i < periods.length; i++) {
          const currNibd = periods[i].nibd != null ? parseFloat(periods[i].nibd) : null;
          const prevNibd = i > 0
            ? (periods[i - 1].nibd != null ? parseFloat(periods[i - 1].nibd) : null)
            : null;

          if (currNibd != null && prevNibd != null) {
            // Both current and prior NIBD available: FCF = decrease in NIBD
            result.push(-(currNibd - prevNibd));
          } else if (currNibd != null && prevNibd == null) {
            // First period where NIBD appears (no prior data):
            // If NIBD is negative (net cash), use absolute value as FCF (assumes starting from zero)
            result.push(currNibd < 0 ? -currNibd : undefined);
          } else {
            result.push(undefined);
          }
        }
        return result;
      }

      // Only compute NIBD-derived FCF for the target (not acquirer — acquirer NIBD includes M&A effects)
      const tgtNibdFcf = computeNibdFcf(targetPeriods);

      const pfData: PeriodData[] = [];
      for (let idx = 0; idx < acquirerPeriods.rows.length; idx++) {
        const ap = acquirerPeriods.rows[idx];
        const dateKey = ap.period_date.toISOString().split("T")[0];
        const tp = targetByDate.get(dateKey);
        const year = ap.period_date.getFullYear().toString();
        const synergy = synergiesTimeline[year] || 0;

        const acqEbitda = parseFloat(ap.ebitda_total) || 0;
        const tgtEbitda = tp ? parseFloat(tp.ebitda_total) || 0 : 0;

        // Find the target index matching this date for NIBD FCF lookup
        const tgtIdx = targetPeriods.findIndex((t: any) =>
          t.period_date.toISOString().split("T")[0] === dateKey
        );
        const tgtFcf = tgtIdx >= 0 ? tgtNibdFcf[tgtIdx] : undefined;

        // If target has NIBD-derived FCF, build a combined pro forma FCF:
        //   acquirer FCF (computed from EBITDA-tax) + target NIBD FCF + synergies
        // This gives the engine a complete override that includes both sources.
        let pfNibdFcf: number | undefined;
        if (tgtFcf != null) {
          // Compute acquirer's FCF inline (same formula the engine uses)
          const taxRate = dp.tax_rate ?? 0.22;
          const daPctRevenue = dp.da_pct_revenue ?? 0.05;
          const acqRevenue = parseFloat(ap.revenue_total) || 0;
          const acqCapex = ap.capex != null ? parseFloat(ap.capex) : 0;
          const acqNwc = ap.change_nwc != null ? parseFloat(ap.change_nwc) : 0;
          const daProxy = acqRevenue > 0 ? acqRevenue * daPctRevenue : Math.abs(acqEbitda) * daPctRevenue;
          const ebtProxy = acqEbitda - daProxy;
          const tax = ebtProxy > 0 ? -ebtProxy * taxRate : 0;
          const acqFcf = acqEbitda + tax + acqCapex + acqNwc;
          pfNibdFcf = acqFcf + tgtFcf + synergy;
        }

        pfData.push({
          ebitda: acqEbitda + tgtEbitda + synergy,
          revenue: (parseFloat(ap.revenue_total) || 0) + (tp ? parseFloat(tp.revenue_total) || 0 : 0),
          capex: (ap.capex != null ? parseFloat(ap.capex) : 0) + (tp?.capex != null ? parseFloat(tp.capex) : 0) || undefined,
          change_nwc: (ap.change_nwc != null ? parseFloat(ap.change_nwc) : 0) + (tp?.change_nwc != null ? parseFloat(tp.change_nwc) : 0) || undefined,
          nibd_fcf: pfNibdFcf,
        });
      }

      // Acquirer standalone: no NIBD-derived FCF (acquirer NIBD includes M&A effects)
      const acqData: PeriodData[] = acquirerPeriods.rows.map((p: any) => ({
        ebitda: parseFloat(p.ebitda_total) || 0,
        revenue: parseFloat(p.revenue_total) || 0,
        capex: p.capex != null ? parseFloat(p.capex) : undefined,
        change_nwc: p.change_nwc != null ? parseFloat(p.change_nwc) : undefined,
      }));
      const tgtData: PeriodData[] = targetPeriods.map((p: any, i: number) => ({
        ebitda: parseFloat(p.ebitda_total) || 0,
        revenue: parseFloat(p.revenue_total) || 0,
        capex: p.capex != null ? parseFloat(p.capex) : undefined,
        change_nwc: p.change_nwc != null ? parseFloat(p.change_nwc) : undefined,
        nibd_fcf: tgtNibdFcf[i],
      }));

      // Merge capital structure: scenario-level fields > source-derived > deal_parameters JSON (can be stale)
      const srcOE = getEquityFromSources(scenario.sources);
      const srcPE = getPreferredFromSources(scenario.sources);
      const srcND = getDebtFromSources(scenario.sources);
      const mergedDp: DealParameters = {
        ...dp,
        ordinary_equity: (scenario.ordinary_equity != null ? parseFloat(scenario.ordinary_equity) : undefined) ?? (srcOE > 0 ? srcOE : undefined) ?? dp.ordinary_equity,
        preferred_equity: (scenario.preferred_equity != null ? parseFloat(scenario.preferred_equity) : undefined) ?? (srcPE > 0 ? srcPE : undefined) ?? dp.preferred_equity,
        preferred_equity_rate: (scenario.preferred_equity_rate != null ? parseFloat(scenario.preferred_equity_rate) : undefined) ?? dp.preferred_equity_rate,
        net_debt: (scenario.net_debt != null ? parseFloat(scenario.net_debt) : undefined) ?? (srcND > 0 ? srcND : undefined) ?? dp.net_debt,
        rollover_equity: (scenario.rollover_shareholders != null ? parseFloat(scenario.rollover_shareholders) : undefined) ?? dp.rollover_equity,
        equity_from_sources: srcOE,
      };

      // ── Share tracking: extract entry/exit shares from acquirer periods ──
      // entry_price_per_share = first period eqv_post_dilution (fully diluted FMV per share)
      if (!mergedDp.entry_shares && acquirerPeriods.rows.length > 0) {
        const firstPeriod = acquirerPeriods.rows[0];
        const lastPeriod = acquirerPeriods.rows[acquirerPeriods.rows.length - 1];
        const entryShares = firstPeriod.share_count != null ? parseFloat(firstPeriod.share_count) : 0;
        const exitShares = lastPeriod.share_count != null ? parseFloat(lastPeriod.share_count) : 0;
        // Use fully diluted value (after MIP/TSO/warrants), fall back to per_share_pre if unavailable
        const entryPricePerShare = firstPeriod.eqv_post_dilution != null
          ? parseFloat(firstPeriod.eqv_post_dilution)
          : (firstPeriod.per_share_pre != null ? parseFloat(firstPeriod.per_share_pre) : 0);

        if (entryShares > 0) {
          mergedDp.entry_shares = entryShares;
          mergedDp.exit_shares = exitShares > 0 ? exitShares : entryShares;
          mergedDp.entry_price_per_share = entryPricePerShare;
        }
      }

      // ── Dilution params: MIP/TSO/warrants from acquirer model_parameters ──
      const dilutionParams = extractDilutionParams(acquirerModelParams);
      Object.assign(mergedDp, dilutionParams);

      // Pass synergies array
      const synergiesArray = acquirerPeriods.rows.map((ap: any) => {
        const year = ap.period_date.getFullYear().toString();
        return synergiesTimeline[year] || 0;
      });
      mergedDp.cost_synergies = synergiesArray;

      // Extract period labels for debt schedule (e.g. ["2026E", "2027E", ...])
      const periodLabels = acquirerPeriods.rows.map((ap: any) =>
        ap.period_label || ap.period_date.getFullYear().toString()
      );

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

      if (!base_params || !row_axis?.param || !row_axis?.values?.length || !col_axis?.param || !col_axis?.values?.length) {
        res.status(400).json({ error: "base_params, row_axis, and col_axis are required" });
        return;
      }

      const metricKey = metric || "irr";
      const targetCase = return_case || "Kombinert";

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

      const targetByDate = new Map<string, any>();
      for (const t of targetPeriods) {
        targetByDate.set(t.period_date.toISOString().split("T")[0], t);
      }
      const synergiesTimeline = scenario.cost_synergies_timeline || {};

      // Compute NIBD-derived FCF for the target
      function computeNibdFcfLocal(periods: any[]): (number | undefined)[] {
        const result: (number | undefined)[] = [];
        for (let i = 0; i < periods.length; i++) {
          const currNibd = periods[i].nibd != null ? parseFloat(periods[i].nibd) : null;
          const prevNibd = i > 0 ? (periods[i - 1].nibd != null ? parseFloat(periods[i - 1].nibd) : null) : null;
          if (currNibd != null && prevNibd != null) {
            result.push(-(currNibd - prevNibd));
          } else if (currNibd != null && prevNibd == null) {
            result.push(currNibd < 0 ? -currNibd : undefined);
          } else {
            result.push(undefined);
          }
        }
        return result;
      }
      const tgtNibdFcf = computeNibdFcfLocal(targetPeriods);

      // Build period data arrays (reuse the same logic as calculate-returns)
      const acqData: import("../services/dealReturns.js").PeriodData[] = acquirerPeriods.rows.map((p: any) => ({
        ebitda: parseFloat(p.ebitda_total) || 0,
        revenue: parseFloat(p.revenue_total) || 0,
        capex: p.capex != null ? parseFloat(p.capex) : undefined,
        change_nwc: p.change_nwc != null ? parseFloat(p.change_nwc) : undefined,
      }));

      // Build pro forma period data
      function buildPfData(dp: DealParameters): import("../services/dealReturns.js").PeriodData[] {
        const pfData: import("../services/dealReturns.js").PeriodData[] = [];
        for (let idx = 0; idx < acquirerPeriods.rows.length; idx++) {
          const ap = acquirerPeriods.rows[idx];
          const dateKey = ap.period_date.toISOString().split("T")[0];
          const tp = targetByDate.get(dateKey);
          const year = ap.period_date.getFullYear().toString();
          const synergy = synergiesTimeline[year] || 0;

          const acqEbitda = parseFloat(ap.ebitda_total) || 0;
          const tgtEbitda = tp ? parseFloat(tp.ebitda_total) || 0 : 0;
          const tgtIdx = targetPeriods.findIndex((t: any) => t.period_date.toISOString().split("T")[0] === dateKey);
          const tgtFcf = tgtIdx >= 0 ? tgtNibdFcf[tgtIdx] : undefined;

          let pfNibdFcf: number | undefined;
          if (tgtFcf != null) {
            const taxRate = dp.tax_rate ?? 0.22;
            const daPctRevenue = dp.da_pct_revenue ?? 0.05;
            const acqRevenue = parseFloat(ap.revenue_total) || 0;
            const acqCapex = ap.capex != null ? parseFloat(ap.capex) : 0;
            const acqNwc = ap.change_nwc != null ? parseFloat(ap.change_nwc) : 0;
            const daProxy = acqRevenue > 0 ? acqRevenue * daPctRevenue : Math.abs(acqEbitda) * daPctRevenue;
            const ebtProxy = acqEbitda - daProxy;
            const tax = ebtProxy > 0 ? -ebtProxy * taxRate : 0;
            const acqFcf = acqEbitda + tax + acqCapex + acqNwc;
            pfNibdFcf = acqFcf + tgtFcf + synergy;
          }

          pfData.push({
            ebitda: acqEbitda + tgtEbitda + synergy,
            revenue: (parseFloat(ap.revenue_total) || 0) + (tp ? parseFloat(tp.revenue_total) || 0 : 0),
            capex: (ap.capex != null ? parseFloat(ap.capex) : 0) + (tp?.capex != null ? parseFloat(tp.capex) : 0) || undefined,
            change_nwc: (ap.change_nwc != null ? parseFloat(ap.change_nwc) : 0) + (tp?.change_nwc != null ? parseFloat(tp.change_nwc) : 0) || undefined,
            nibd_fcf: pfNibdFcf,
          });
        }
        return pfData;
      }

      // Merge capital structure: scenario-level fields > source-derived > deal_parameters JSON (can be stale)
      function mergeScenarioParams(dp: DealParameters): DealParameters {
        const srcOE = getEquityFromSources(scenario.sources);
        const srcPE = getPreferredFromSources(scenario.sources);
        const srcND = getDebtFromSources(scenario.sources);
        const merged: DealParameters = {
          ...dp,
          ordinary_equity: (scenario.ordinary_equity != null ? parseFloat(scenario.ordinary_equity) : undefined) ?? (srcOE > 0 ? srcOE : undefined) ?? dp.ordinary_equity,
          preferred_equity: (scenario.preferred_equity != null ? parseFloat(scenario.preferred_equity) : undefined) ?? (srcPE > 0 ? srcPE : undefined) ?? dp.preferred_equity,
          preferred_equity_rate: (scenario.preferred_equity_rate != null ? parseFloat(scenario.preferred_equity_rate) : undefined) ?? dp.preferred_equity_rate,
          net_debt: (scenario.net_debt != null ? parseFloat(scenario.net_debt) : undefined) ?? (srcND > 0 ? srcND : undefined) ?? dp.net_debt,
          rollover_equity: (scenario.rollover_shareholders != null ? parseFloat(scenario.rollover_shareholders) : undefined) ?? dp.rollover_equity,
          equity_from_sources: srcOE,
        };

        // Share tracking
        if (!merged.entry_shares && acquirerPeriods.rows.length > 0) {
          const firstPeriod = acquirerPeriods.rows[0];
          const lastPeriod = acquirerPeriods.rows[acquirerPeriods.rows.length - 1];
          const entryShares = firstPeriod.share_count != null ? parseFloat(firstPeriod.share_count) : 0;
          const exitShares = lastPeriod.share_count != null ? parseFloat(lastPeriod.share_count) : 0;
          const entryPricePerShare = firstPeriod.eqv_post_dilution != null
            ? parseFloat(firstPeriod.eqv_post_dilution)
            : (firstPeriod.per_share_pre != null ? parseFloat(firstPeriod.per_share_pre) : 0);
          if (entryShares > 0) {
            merged.entry_shares = entryShares;
            merged.exit_shares = exitShares > 0 ? exitShares : entryShares;
            merged.entry_price_per_share = entryPricePerShare;
          }
        }

        // ── Dilution params: MIP/TSO/warrants from acquirer model_parameters ──
        const dilutionParams = extractDilutionParams(acquirerModelParams);
        Object.assign(merged, dilutionParams);

        // Synergies array
        merged.cost_synergies = acquirerPeriods.rows.map((ap: any) => {
          const year = ap.period_date.getFullYear().toString();
          return synergiesTimeline[year] || 0;
        });

        return merged;
      }

      // Sensitivity parameter setters (maps param name → how to inject into DealParameters)
      const paramSetters: Record<string, (dp: DealParameters, val: number) => DealParameters> = {
        exit_multiple: (dp, val) => ({ ...dp, exit_multiples: [val] }),
        price_paid: (dp, val) => ({ ...dp, price_paid: val }),
        interest_rate: (dp, val) => ({ ...dp, interest_rate: val }),
        ordinary_equity: (dp, val) => ({ ...dp, ordinary_equity: val }),
        net_debt: (dp, val) => ({ ...dp, net_debt: val }),
        debt_amortisation: (dp, val) => ({ ...dp, debt_amortisation: val }),
        cash_sweep_pct: (dp, val) => ({ ...dp, cash_sweep_pct: val }),
        preferred_equity_rate: (dp, val) => ({ ...dp, preferred_equity_rate: val }),
        tax_rate: (dp, val) => ({ ...dp, tax_rate: val }),
        preferred_equity: (dp, val) => ({ ...dp, preferred_equity: val }),
        da_pct_revenue: (dp, val) => ({ ...dp, da_pct_revenue: val }),
        acquirer_entry_ev: (dp, val) => ({ ...dp, acquirer_entry_ev: val }),
      };

      const setRow = paramSetters[row_axis.param];
      const setCol = paramSetters[col_axis.param];
      if (!setRow || !setCol) {
        res.status(400).json({ error: `Invalid axis param: ${row_axis.param} or ${col_axis.param}` });
        return;
      }

      // ── Run the grid ──
      const matrix: (number | null)[][] = [];
      const periodLabels = acquirerPeriods.rows.map((ap: any) => ap.period_label || ap.period_date.getFullYear().toString());

      for (const rowVal of row_axis.values) {
        const row: (number | null)[] = [];
        for (const colVal of col_axis.values) {
          // Start from base, apply row axis, then col axis
          let dp = { ...base_params };
          dp = setRow(dp, rowVal);
          dp = setCol(dp, colVal);

          // When axis is exit_multiple, force a single-element array
          // but for the actual exit mult used in calculation, we need to handle it
          const isExitMultRow = row_axis.param === "exit_multiple";
          const isExitMultCol = col_axis.param === "exit_multiple";
          const exitMult = isExitMultRow ? rowVal : isExitMultCol ? colVal : (dp.exit_multiples?.[Math.floor((dp.exit_multiples?.length || 1) / 2)] ?? 12);

          // Force a single exit multiple to speed up calculation
          dp.exit_multiples = [exitMult];

          const mergedDp = mergeScenarioParams(dp);
          const pfData = buildPfData(mergedDp);

          const tgtData: import("../services/dealReturns.js").PeriodData[] = targetPeriods.map((p: any, i: number) => ({
            ebitda: parseFloat(p.ebitda_total) || 0,
            revenue: parseFloat(p.revenue_total) || 0,
            capex: p.capex != null ? parseFloat(p.capex) : undefined,
            change_nwc: p.change_nwc != null ? parseFloat(p.change_nwc) : undefined,
            nibd_fcf: tgtNibdFcf[i],
          }));

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

      // 3. Build deal parameters (merge scenario-level > source-derived > dp JSON)
      const dp: DealParameters | null = scenario.deal_parameters &&
        Object.keys(scenario.deal_parameters).length > 0
        ? scenario.deal_parameters
        : null;

      const srcOE = getEquityFromSources(scenario.sources);
      const srcPE = getPreferredFromSources(scenario.sources);
      const srcND = getDebtFromSources(scenario.sources);

      const mergedDp: DealParameters = {
        ...(dp || {
          price_paid: 0,
          exit_multiples: [10, 11, 12, 13, 14],
          acquirer_entry_ev: 0,
          exit_years: [3, 4, 5],
          tax_rate: 0.22,
          da_pct_revenue: 0.05,
        }),
        ordinary_equity: (scenario.ordinary_equity != null ? parseFloat(scenario.ordinary_equity) : undefined) ?? (srcOE > 0 ? srcOE : undefined) ?? dp?.ordinary_equity,
        preferred_equity: (scenario.preferred_equity != null ? parseFloat(scenario.preferred_equity) : undefined) ?? (srcPE > 0 ? srcPE : undefined) ?? dp?.preferred_equity,
        preferred_equity_rate: (scenario.preferred_equity_rate != null ? parseFloat(scenario.preferred_equity_rate) : undefined) ?? dp?.preferred_equity_rate,
        net_debt: (scenario.net_debt != null ? parseFloat(scenario.net_debt) : undefined) ?? (srcND > 0 ? srcND : undefined) ?? dp?.net_debt,
        rollover_equity: (scenario.rollover_shareholders != null ? parseFloat(scenario.rollover_shareholders) : undefined) ?? dp?.rollover_equity,
        equity_from_sources: srcOE,
      } as DealParameters;

      // 4. Calculate returns for export
      const synergiesTimeline = scenario.cost_synergies_timeline || {};

      // ── Share tracking: extract entry/exit shares from acquirer periods ──
      if (!mergedDp.entry_shares && acquirerPeriods.rows.length > 0) {
        const firstPeriod = acquirerPeriods.rows[0];
        const lastPeriod = acquirerPeriods.rows[acquirerPeriods.rows.length - 1];
        const entryShares = firstPeriod.share_count != null ? parseFloat(firstPeriod.share_count) : 0;
        const exitShares = lastPeriod.share_count != null ? parseFloat(lastPeriod.share_count) : 0;
        const entryPricePerShare = firstPeriod.eqv_post_dilution != null
          ? parseFloat(firstPeriod.eqv_post_dilution)
          : (firstPeriod.per_share_pre != null ? parseFloat(firstPeriod.per_share_pre) : 0);

        if (entryShares > 0) {
          mergedDp.entry_shares = entryShares;
          mergedDp.exit_shares = exitShares > 0 ? exitShares : entryShares;
          mergedDp.entry_price_per_share = entryPricePerShare;
        }
      }

      // ── Dilution params: MIP/TSO/warrants from acquirer model_parameters ──
      const acquirerModelResult = await pool.query(
        "SELECT model_parameters FROM financial_models WHERE id = $1",
        [scenario.acquirer_model_id]
      );
      if (acquirerModelResult.rows.length > 0) {
        const dilutionParams = extractDilutionParams(acquirerModelResult.rows[0].model_parameters);
        Object.assign(mergedDp, dilutionParams);
      }

      // Build separate acquirer, target, and pro forma period data arrays
      const acqData: PeriodData[] = acquirerPeriods.rows.map((p: any) => ({
        ebitda: parseFloat(p.ebitda_total) || 0,
        revenue: parseFloat(p.revenue_total) || 0,
        capex: p.capex != null ? parseFloat(p.capex) : undefined,
        change_nwc: p.change_nwc != null ? parseFloat(p.change_nwc) : undefined,
      }));
      const tgtData: PeriodData[] = targetPeriods.map((p: any) => ({
        ebitda: parseFloat(p.ebitda_total) || 0,
        revenue: parseFloat(p.revenue_total) || 0,
        capex: p.capex != null ? parseFloat(p.capex) : undefined,
        change_nwc: p.change_nwc != null ? parseFloat(p.change_nwc) : undefined,
      }));

      // Pro forma: use pro_forma_periods if available, else combine acquirer+target
      const proFormaPeriods = pfResult.rows;
      let pfData: PeriodData[];
      if (proFormaPeriods.length > 0) {
        pfData = proFormaPeriods.map((p: any) => {
          const year = new Date(p.period_date).getFullYear().toString();
          const synergy = synergiesTimeline[year] || 0;
          return {
            ebitda: (p.total_ebitda_excl_synergies || 0) + synergy,
            revenue: p.total_revenue || 0,
            capex: p.total_capex != null ? p.total_capex : undefined,
            change_nwc: p.total_change_nwc != null ? p.total_change_nwc : undefined,
          };
        });
      } else {
        // Fallback: combine acquirer + target periods
        const targetByDate = new Map<string, any>();
        for (const t of targetPeriods) {
          targetByDate.set(t.period_date.toISOString().split("T")[0], t);
        }
        pfData = acquirerPeriods.rows.map((ap: any) => {
          const dateKey = ap.period_date.toISOString().split("T")[0];
          const tp = targetByDate.get(dateKey);
          const year = ap.period_date.getFullYear().toString();
          const synergy = synergiesTimeline[year] || 0;
          return {
            ebitda: (parseFloat(ap.ebitda_total) || 0) + (tp ? parseFloat(tp.ebitda_total) || 0 : 0) + synergy,
            revenue: (parseFloat(ap.revenue_total) || 0) + (tp ? parseFloat(tp.revenue_total) || 0 : 0),
            capex: (ap.capex != null ? parseFloat(ap.capex) : 0) + (tp?.capex != null ? parseFloat(tp.capex) : 0) || undefined,
            change_nwc: (ap.change_nwc != null ? parseFloat(ap.change_nwc) : 0) + (tp?.change_nwc != null ? parseFloat(tp.change_nwc) : 0) || undefined,
          };
        });
      }

      // Pass synergies array for Level 2 if needed
      const synergiesArray = acquirerPeriods.rows.map((p: any) => {
        const year = p.period_date.getFullYear().toString();
        return synergiesTimeline[year] || 0;
      });
      mergedDp.cost_synergies = synergiesArray;

      const periodLabels = acquirerPeriods.rows.map((p: any) =>
        p.period_label || new Date(p.period_date).getFullYear().toString()
      );

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
