import { Router, Response } from "express";
import pool from "../models/db.js";
import { AuthRequest, authMiddleware } from "../middleware/auth.js";

const router = Router();
router.use(authMiddleware);

// List models for a company
router.get(
  "/company/:companyId",
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const { companyId } = req.params;
      const result = await pool.query(
        `SELECT m.*, 
          (SELECT COUNT(*) FROM financial_periods WHERE model_id = m.id) as period_count,
          (SELECT MIN(period_date) FROM financial_periods WHERE model_id = m.id) as first_period,
          (SELECT MAX(period_date) FROM financial_periods WHERE model_id = m.id) as last_period
         FROM financial_models m WHERE m.company_id = $1 ORDER BY m.name`,
        [companyId]
      );
      res.json(result.rows);
    } catch (err) {
      console.error("Error fetching models:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  }
);

// Get model with all periods
router.get("/:id", async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const modelResult = await pool.query(
      "SELECT m.*, c.name as company_name, c.company_type FROM financial_models m JOIN companies c ON m.company_id = c.id WHERE m.id = $1",
      [id]
    );
    if (modelResult.rows.length === 0) {
      res.status(404).json({ error: "Model not found" });
      return;
    }

    const periodsResult = await pool.query(
      "SELECT * FROM financial_periods WHERE model_id = $1 ORDER BY period_date",
      [id]
    );

    const geoResult = await pool.query(
      "SELECT * FROM revenue_geography WHERE model_id = $1 ORDER BY period_date, country",
      [id]
    );

    const serviceResult = await pool.query(
      "SELECT * FROM revenue_service WHERE model_id = $1 ORDER BY period_date, service_name",
      [id]
    );

    res.json({
      ...modelResult.rows[0],
      periods: periodsResult.rows,
      geography: geoResult.rows,
      services: serviceResult.rows,
    });
  } catch (err) {
    console.error("Error fetching model:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Create model
router.post("/", async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { company_id, name, description, model_type, model_parameters } = req.body;

    const result = await pool.query(
      `INSERT INTO financial_models (company_id, name, description, model_type, model_parameters, created_by)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [company_id, name, description, model_type || "base", model_parameters ? JSON.stringify(model_parameters) : null, req.userId]
    );
    res.status(201).json(result.rows[0]);
  } catch (err: any) {
    if (err.code === "23505") {
      res
        .status(409)
        .json({ error: "Model with this name already exists for this company" });
      return;
    }
    console.error("Error creating model:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Update model
router.put("/:id", async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const { name, description, model_type, is_active, model_parameters } = req.body;

    const result = await pool.query(
      `UPDATE financial_models 
       SET name = COALESCE($1, name), description = COALESCE($2, description),
           model_type = COALESCE($3, model_type), is_active = COALESCE($4, is_active),
           model_parameters = COALESCE($5, model_parameters),
           updated_at = NOW()
       WHERE id = $6 RETURNING *`,
      [name, description, model_type, is_active, model_parameters ? JSON.stringify(model_parameters) : null, id]
    );
    if (result.rows.length === 0) {
      res.status(404).json({ error: "Model not found" });
      return;
    }
    res.json(result.rows[0]);
  } catch (err) {
    console.error("Error updating model:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Delete model
router.delete(
  "/:id",
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const { id } = req.params;
      const result = await pool.query(
        "DELETE FROM financial_models WHERE id = $1 RETURNING id",
        [id]
      );
      if (result.rows.length === 0) {
        res.status(404).json({ error: "Model not found" });
        return;
      }
      res.json({ message: "Model deleted" });
    } catch (err) {
      console.error("Error deleting model:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  }
);

// Bulk upsert financial periods for a model
router.post(
  "/:id/periods",
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const { id } = req.params;
      const { periods } = req.body;

      if (!Array.isArray(periods) || periods.length === 0) {
        res.status(400).json({ error: "periods array is required" });
        return;
      }

      // Verify model exists
      const modelCheck = await pool.query(
        "SELECT id FROM financial_models WHERE id = $1",
        [id]
      );
      if (modelCheck.rows.length === 0) {
        res.status(404).json({ error: "Model not found" });
        return;
      }

      const client = await pool.connect();
      try {
        await client.query("BEGIN");

        const inserted = [];
        for (const p of periods) {
          const result = await client.query(
            `INSERT INTO financial_periods (
              model_id, period_date, period_label, period_type,
              revenue_managed_services, revenue_professional_services, revenue_other,
              revenue_total, revenue_organic, revenue_ma,
              revenue_growth, organic_growth, managed_services_growth, professional_services_growth,
              ebitda_managed_services, ebitda_professional_services, ebitda_central_costs,
              ebitda_organic, ebitda_ma, ebitda_total, ebitda_incl_synergies, cost_synergies,
              margin_managed_services, margin_professional_services, margin_central_costs, ebitda_margin,
              capex, capex_pct_revenue, change_nwc, other_cash_flow_items,
              operating_fcf, minority_interest, operating_fcf_excl_minorities, cash_conversion,
              share_count, nibd, option_debt, adjustments, enterprise_value, equity_value,
              preferred_equity, per_share_pre, mip_amount, tso_amount, warrants_amount,
              eqv_post_dilution, per_share_post, acquired_revenue,
              extra_data
            ) VALUES (
              $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14,
              $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26,
              $27, $28, $29, $30, $31, $32, $33, $34,
              $35, $36, $37, $38, $39, $40,
              $41, $42, $43, $44, $45,
              $46, $47, $48,
              $49
            )
            ON CONFLICT (model_id, period_date) DO UPDATE SET
              period_label = EXCLUDED.period_label,
              period_type = EXCLUDED.period_type,
              revenue_managed_services = EXCLUDED.revenue_managed_services,
              revenue_professional_services = EXCLUDED.revenue_professional_services,
              revenue_other = EXCLUDED.revenue_other,
              revenue_total = EXCLUDED.revenue_total,
              revenue_organic = EXCLUDED.revenue_organic,
              revenue_ma = EXCLUDED.revenue_ma,
              revenue_growth = EXCLUDED.revenue_growth,
              organic_growth = EXCLUDED.organic_growth,
              managed_services_growth = EXCLUDED.managed_services_growth,
              professional_services_growth = EXCLUDED.professional_services_growth,
              ebitda_managed_services = EXCLUDED.ebitda_managed_services,
              ebitda_professional_services = EXCLUDED.ebitda_professional_services,
              ebitda_central_costs = EXCLUDED.ebitda_central_costs,
              ebitda_organic = EXCLUDED.ebitda_organic,
              ebitda_ma = EXCLUDED.ebitda_ma,
              ebitda_total = EXCLUDED.ebitda_total,
              ebitda_incl_synergies = EXCLUDED.ebitda_incl_synergies,
              cost_synergies = EXCLUDED.cost_synergies,
              margin_managed_services = EXCLUDED.margin_managed_services,
              margin_professional_services = EXCLUDED.margin_professional_services,
              margin_central_costs = EXCLUDED.margin_central_costs,
              ebitda_margin = EXCLUDED.ebitda_margin,
              capex = EXCLUDED.capex,
              capex_pct_revenue = EXCLUDED.capex_pct_revenue,
              change_nwc = EXCLUDED.change_nwc,
              other_cash_flow_items = EXCLUDED.other_cash_flow_items,
              operating_fcf = EXCLUDED.operating_fcf,
              minority_interest = EXCLUDED.minority_interest,
              operating_fcf_excl_minorities = EXCLUDED.operating_fcf_excl_minorities,
              cash_conversion = EXCLUDED.cash_conversion,
              share_count = EXCLUDED.share_count,
              nibd = EXCLUDED.nibd,
              option_debt = EXCLUDED.option_debt,
              adjustments = EXCLUDED.adjustments,
              enterprise_value = EXCLUDED.enterprise_value,
              equity_value = EXCLUDED.equity_value,
              preferred_equity = EXCLUDED.preferred_equity,
              per_share_pre = EXCLUDED.per_share_pre,
              mip_amount = EXCLUDED.mip_amount,
              tso_amount = EXCLUDED.tso_amount,
              warrants_amount = EXCLUDED.warrants_amount,
              eqv_post_dilution = EXCLUDED.eqv_post_dilution,
              per_share_post = EXCLUDED.per_share_post,
              acquired_revenue = EXCLUDED.acquired_revenue,
              extra_data = EXCLUDED.extra_data,
              updated_at = NOW()
            RETURNING *`,
            [
              id,
              p.period_date,
              p.period_label,
              p.period_type,
              p.revenue_managed_services,
              p.revenue_professional_services,
              p.revenue_other,
              p.revenue_total,
              p.revenue_organic,
              p.revenue_ma,
              p.revenue_growth,
              p.organic_growth,
              p.managed_services_growth,
              p.professional_services_growth,
              p.ebitda_managed_services,
              p.ebitda_professional_services,
              p.ebitda_central_costs,
              p.ebitda_organic,
              p.ebitda_ma,
              p.ebitda_total,
              p.ebitda_incl_synergies,
              p.cost_synergies,
              p.margin_managed_services,
              p.margin_professional_services,
              p.margin_central_costs,
              p.ebitda_margin,
              p.capex,
              p.capex_pct_revenue,
              p.change_nwc,
              p.other_cash_flow_items,
              p.operating_fcf,
              p.minority_interest,
              p.operating_fcf_excl_minorities,
              p.cash_conversion,
              p.share_count ?? null,
              p.nibd ?? null,
              p.option_debt ?? null,
              p.adjustments ?? null,
              p.enterprise_value ?? null,
              p.equity_value ?? null,
              p.preferred_equity ?? null,
              p.per_share_pre ?? null,
              p.mip_amount ?? null,
              p.tso_amount ?? null,
              p.warrants_amount ?? null,
              p.eqv_post_dilution ?? null,
              p.per_share_post ?? null,
              p.acquired_revenue ?? null,
              p.extra_data ? JSON.stringify(p.extra_data) : "{}",
            ]
          );
          inserted.push(result.rows[0]);
        }

        await client.query("COMMIT");
        res.status(201).json({ count: inserted.length, periods: inserted });
      } catch (err) {
        await client.query("ROLLBACK");
        throw err;
      } finally {
        client.release();
      }
    } catch (err) {
      console.error("Error upserting periods:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  }
);

export default router;
