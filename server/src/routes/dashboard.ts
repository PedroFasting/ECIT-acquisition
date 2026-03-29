/**
 * Dashboard route — aggregated KPIs and enriched data for the overview page.
 */

import { Router, Response } from "express";
import pool from "../models/db.js";
import { AuthRequest, authMiddleware } from "../middleware/auth.js";

const router = Router();
router.use(authMiddleware);

/**
 * GET /api/dashboard/summary
 *
 * Returns aggregated statistics for the dashboard:
 * - counts by entity type
 * - scenario pipeline with financial highlights
 * - company cards with latest-period financials
 * - recent activity
 */
router.get("/summary", async (_req: AuthRequest, res: Response): Promise<void> => {
  try {
    // Run all queries in parallel
    const [countsResult, scenariosResult, companiesResult, activityResult] = await Promise.all([
      // 1. Aggregate counts
      pool.query(`
        SELECT
          (SELECT COUNT(*) FROM companies WHERE company_type = 'acquirer') as acquirer_count,
          (SELECT COUNT(*) FROM companies WHERE company_type = 'target') as target_count,
          (SELECT COUNT(*) FROM financial_models) as model_count,
          (SELECT COUNT(*) FROM acquisition_scenarios) as scenario_count,
          (SELECT COUNT(*) FROM acquisition_scenarios WHERE status = 'active') as active_scenario_count,
          (SELECT COUNT(*) FROM acquisition_scenarios WHERE status = 'draft') as draft_scenario_count
      `),

      // 2. Scenarios with financial highlights (entry multiple, EV from deal_params, latest PF EBITDA)
      pool.query(`
        SELECT
          s.id, s.name, s.status, s.enterprise_value, s.exit_date,
          s.created_at, s.updated_at,
          s.deal_parameters,
          ac.name as acquirer_company_name,
          am.name as acquirer_model_name,
          tc.name as target_company_name,
          tm.name as target_model_name,
          -- Latest pro forma EBITDA (if generated)
          pf.total_revenue as pf_revenue,
          pf.total_ebitda_incl_synergies as pf_ebitda,
          pf.ebitda_margin_incl_synergies as pf_margin,
          -- Latest target financials (most recent period from target model)
          tfp.revenue_total as target_revenue,
          tfp.ebitda_total as target_ebitda,
          tfp.ebitda_margin as target_margin,
          -- Latest acquirer financials
          afp.revenue_total as acquirer_revenue,
          afp.ebitda_total as acquirer_ebitda
        FROM acquisition_scenarios s
        LEFT JOIN financial_models am ON s.acquirer_model_id = am.id
        LEFT JOIN companies ac ON am.company_id = ac.id
        LEFT JOIN financial_models tm ON s.target_model_id = tm.id
        LEFT JOIN companies tc ON tm.company_id = tc.id
        -- Latest pro forma period (by date)
        LEFT JOIN LATERAL (
          SELECT total_revenue, total_ebitda_incl_synergies, ebitda_margin_incl_synergies
          FROM pro_forma_periods WHERE scenario_id = s.id
          ORDER BY period_date DESC LIMIT 1
        ) pf ON true
        -- Latest target financial period
        LEFT JOIN LATERAL (
          SELECT revenue_total, ebitda_total, ebitda_margin
          FROM financial_periods WHERE model_id = s.target_model_id
          ORDER BY period_date DESC LIMIT 1
        ) tfp ON true
        -- Latest acquirer financial period
        LEFT JOIN LATERAL (
          SELECT revenue_total, ebitda_total
          FROM financial_periods WHERE model_id = s.acquirer_model_id
          ORDER BY period_date DESC LIMIT 1
        ) afp ON true
        ORDER BY s.updated_at DESC
      `),

      // 3. Companies with latest financial metrics
      pool.query(`
        SELECT
          c.id, c.name, c.company_type, c.country, c.sector,
          c.created_at, c.updated_at,
          (SELECT COUNT(*) FROM financial_models WHERE company_id = c.id) as model_count,
          -- Latest financials from active/newest model
          latest.revenue_total,
          latest.ebitda_total,
          latest.ebitda_margin,
          latest.revenue_growth,
          latest.model_name,
          latest.period_label
        FROM companies c
        LEFT JOIN LATERAL (
          SELECT
            fp.revenue_total, fp.ebitda_total, fp.ebitda_margin, fp.revenue_growth,
            fm.name as model_name, fp.period_label
          FROM financial_models fm
          JOIN financial_periods fp ON fp.model_id = fm.id
          WHERE fm.company_id = c.id AND fm.is_active = true
          ORDER BY fp.period_date DESC
          LIMIT 1
        ) latest ON true
        ORDER BY c.company_type, c.name
      `),

      // 4. Recent activity (latest 10 updated entities)
      pool.query(`
        (
          SELECT 'scenario' as entity_type, id, name, updated_at, status
          FROM acquisition_scenarios
          ORDER BY updated_at DESC LIMIT 5
        )
        UNION ALL
        (
          SELECT 'company' as entity_type, id, name, updated_at, NULL as status
          FROM companies
          ORDER BY updated_at DESC LIMIT 5
        )
        ORDER BY updated_at DESC LIMIT 10
      `),
    ]);

    const counts = countsResult.rows[0];
    const scenarios = scenariosResult.rows.map((s: any) => ({
      ...s,
      // Extract useful fields from deal_parameters JSONB for the dashboard
      entry_multiple: s.deal_parameters?.price_paid ?? null,
      exit_multiples: s.deal_parameters?.exit_multiples ?? [],
      interest_rate: s.deal_parameters?.interest_rate ?? null,
    }));

    res.json({
      counts: {
        acquirers: Number(counts.acquirer_count),
        targets: Number(counts.target_count),
        models: Number(counts.model_count),
        scenarios: Number(counts.scenario_count),
        active_scenarios: Number(counts.active_scenario_count),
        draft_scenarios: Number(counts.draft_scenario_count),
      },
      scenarios,
      companies: companiesResult.rows,
      activity: activityResult.rows,
    });
  } catch (err) {
    console.error("Error fetching dashboard summary:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
