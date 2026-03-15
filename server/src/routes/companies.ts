import { Router, Response } from "express";
import pool from "../models/db.js";
import { AuthRequest, authMiddleware } from "../middleware/auth.js";

const router = Router();
router.use(authMiddleware);

// List all companies
router.get("/", async (_req: AuthRequest, res: Response): Promise<void> => {
  try {
    const result = await pool.query(
      `SELECT c.*, 
        (SELECT COUNT(*) FROM financial_models WHERE company_id = c.id) as model_count
       FROM companies c 
       ORDER BY c.company_type, c.name`
    );
    res.json(result.rows);
  } catch (err) {
    console.error("Error fetching companies:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Get single company with models
router.get("/:id", async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const companyResult = await pool.query(
      "SELECT * FROM companies WHERE id = $1",
      [id]
    );
    if (companyResult.rows.length === 0) {
      res.status(404).json({ error: "Company not found" });
      return;
    }

    const modelsResult = await pool.query(
      "SELECT * FROM financial_models WHERE company_id = $1 ORDER BY name",
      [id]
    );

    res.json({
      ...companyResult.rows[0],
      models: modelsResult.rows,
    });
  } catch (err) {
    console.error("Error fetching company:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Create company
router.post("/", async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { name, company_type, description, currency, country, sector } =
      req.body;
    const slug = name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "");

    const result = await pool.query(
      `INSERT INTO companies (name, slug, company_type, description, currency, country, sector, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
      [
        name,
        slug,
        company_type,
        description,
        currency || "NOKm",
        country,
        sector,
        req.userId,
      ]
    );
    res.status(201).json(result.rows[0]);
  } catch (err: any) {
    if (err.code === "23505") {
      res.status(409).json({ error: "Company with this name already exists" });
      return;
    }
    console.error("Error creating company:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Update company
router.put("/:id", async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const { name, description, currency, country, sector } = req.body;

    const result = await pool.query(
      `UPDATE companies SET name = COALESCE($1, name), description = COALESCE($2, description),
       currency = COALESCE($3, currency), country = COALESCE($4, country), 
       sector = COALESCE($5, sector), updated_at = NOW()
       WHERE id = $6 RETURNING *`,
      [name, description, currency, country, sector, id]
    );

    if (result.rows.length === 0) {
      res.status(404).json({ error: "Company not found" });
      return;
    }
    res.json(result.rows[0]);
  } catch (err) {
    console.error("Error updating company:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ──────────────────────────────────────────
// Company Assumptions (reads base model's model_parameters, writes to ALL models)
// ──────────────────────────────────────────

// GET /companies/:id/assumptions
router.get("/:id/assumptions", async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;

    // Find the base model (prefer model_type='base', fall back to first active model)
    const modelResult = await pool.query(
      `SELECT id, name, model_type, model_parameters
       FROM financial_models
       WHERE company_id = $1 AND is_active = true
       ORDER BY CASE WHEN model_type = 'base' THEN 0 ELSE 1 END, id ASC
       LIMIT 1`,
      [id]
    );

    if (modelResult.rows.length === 0) {
      res.json({
        has_models: false,
        source_model: null,
        assumptions: {},
        all_model_count: 0,
      });
      return;
    }

    const sourceModel = modelResult.rows[0];
    const params = sourceModel.model_parameters || {};

    // Also get the first period's equity bridge values for context (NIBD, EV, etc.)
    const periodResult = await pool.query(
      `SELECT share_count, nibd, enterprise_value, equity_value, preferred_equity,
              per_share_pre, per_share_post, eqv_post_dilution, mip_amount, tso_amount, warrants_amount
       FROM financial_periods
       WHERE model_id = $1
       ORDER BY period_date ASC
       LIMIT 1`,
      [sourceModel.id]
    );

    const entryPeriod = periodResult.rows[0] || {};

    // Get the last period for exit share count
    const exitPeriodResult = await pool.query(
      `SELECT share_count, nibd, enterprise_value, equity_value, preferred_equity,
              eqv_post_dilution, per_share_post
       FROM financial_periods
       WHERE model_id = $1
       ORDER BY period_date DESC
       LIMIT 1`,
      [sourceModel.id]
    );
    const exitPeriod = exitPeriodResult.rows[0] || {};

    // Count how many models this company has
    const countResult = await pool.query(
      `SELECT COUNT(*) as cnt FROM financial_models WHERE company_id = $1`,
      [id]
    );

    // Build the unified assumptions response
    // NOTE: model_parameters JSONB uses flat keys from Excel import:
    //   shares_completion, shares_year_end, pref_growth_rate,
    //   tso_warrants_count, tso_warrants_price,
    //   existing_warrants_count, existing_warrants_price
    // Also check the canonical TypeScript names as fallback.
    const assumptions = {
      // Share counts
      shares_at_completion:
        params.shares_at_completion ?? params.shares_completion ?? entryPeriod.share_count ?? null,
      shares_at_year_end:
        params.shares_at_year_end ?? params.shares_year_end ?? exitPeriod.share_count ?? null,

      // Preferred Equity
      preferred_equity: entryPeriod.preferred_equity ?? null,
      preferred_equity_rate:
        params.preferred_equity_rate ?? params.pref_growth_rate ?? null,

      // MIP
      mip_share_pct: params.mip_share_pct ?? null,

      // TSO-warrants (flat keys from import OR nested from TypeScript interface)
      tso_warrants_count:
        params.tso_warrants_count ?? params.tso_warrants?.count ?? null,
      tso_warrants_strike:
        params.tso_warrants_price ?? params.tso_warrants?.strike ?? null,

      // Existing warrants (flat keys from import OR nested)
      existing_warrants_count:
        params.existing_warrants_count ?? params.existing_warrants?.count ?? null,
      existing_warrants_strike:
        params.existing_warrants_price ?? params.existing_warrants?.strike ?? null,

      // NIBD & EV (from first period)
      nibd: entryPeriod.nibd ?? null,
      enterprise_value: entryPeriod.enterprise_value ?? null,
      equity_value: entryPeriod.equity_value ?? null,
    };

    res.json({
      has_models: true,
      source_model: {
        id: sourceModel.id,
        name: sourceModel.name,
        model_type: sourceModel.model_type,
      },
      assumptions,
      all_model_count: parseInt(countResult.rows[0].cnt, 10),
    });
  } catch (err) {
    console.error("Error fetching assumptions:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// PUT /companies/:id/assumptions — saves to ALL models for the company
router.put("/:id/assumptions", async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const {
      shares_at_completion,
      shares_at_year_end,
      preferred_equity,
      preferred_equity_rate,
      mip_share_pct,
      tso_warrants_count,
      tso_warrants_strike,
      existing_warrants_count,
      existing_warrants_strike,
      nibd,
      enterprise_value,
      equity_value,
    } = req.body;

    // Get all models for this company
    const modelsResult = await pool.query(
      `SELECT id, model_parameters FROM financial_models WHERE company_id = $1`,
      [id]
    );

    if (modelsResult.rows.length === 0) {
      res.status(404).json({ error: "No models found for this company" });
      return;
    }

    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      let updatedCount = 0;

      for (const model of modelsResult.rows) {
        const existing = model.model_parameters || {};

        // Merge: only update the assumptions fields, preserve everything else
        // Write BOTH flat keys (used by import/scenario engine) and canonical keys
        const updated = {
          ...existing,
          // Canonical keys
          shares_at_completion: shares_at_completion ?? existing.shares_at_completion ?? existing.shares_completion,
          shares_at_year_end: shares_at_year_end ?? existing.shares_at_year_end ?? existing.shares_year_end,
          preferred_equity_rate: preferred_equity_rate ?? existing.preferred_equity_rate ?? existing.pref_growth_rate,
          mip_share_pct: mip_share_pct ?? existing.mip_share_pct,
          // Flat keys (for backward compat with import/scenario engine)
          shares_completion: shares_at_completion ?? existing.shares_completion ?? existing.shares_at_completion,
          shares_year_end: shares_at_year_end ?? existing.shares_year_end ?? existing.shares_at_year_end,
          pref_growth_rate: preferred_equity_rate ?? existing.pref_growth_rate ?? existing.preferred_equity_rate,
          tso_warrants_count: tso_warrants_count ?? existing.tso_warrants_count,
          tso_warrants_price: tso_warrants_strike ?? existing.tso_warrants_price,
          existing_warrants_count: existing_warrants_count ?? existing.existing_warrants_count,
          existing_warrants_price: existing_warrants_strike ?? existing.existing_warrants_price,
          // Also write nested format for TypeScript interface compat
          tso_warrants: {
            count: tso_warrants_count ?? existing.tso_warrants_count ?? existing.tso_warrants?.count,
            strike: tso_warrants_strike ?? existing.tso_warrants_price ?? existing.tso_warrants?.strike,
          },
          existing_warrants: {
            count: existing_warrants_count ?? existing.existing_warrants_count ?? existing.existing_warrants?.count,
            strike: existing_warrants_strike ?? existing.existing_warrants_price ?? existing.existing_warrants?.strike,
          },
        };

        await client.query(
          `UPDATE financial_models
           SET model_parameters = $1, updated_at = NOW()
           WHERE id = $2`,
          [JSON.stringify(updated), model.id]
        );

        // Also update the first period's equity bridge values (NIBD, EV, PE, share_count)
        if (preferred_equity !== undefined || nibd !== undefined || enterprise_value !== undefined || equity_value !== undefined || shares_at_completion !== undefined) {
          // Get the first period for this model
          const firstPeriod = await client.query(
            `SELECT id FROM financial_periods WHERE model_id = $1 ORDER BY period_date ASC LIMIT 1`,
            [model.id]
          );
          if (firstPeriod.rows.length > 0) {
            const sets: string[] = [];
            const vals: any[] = [];
            let paramIdx = 1;

            if (preferred_equity !== undefined) {
              sets.push(`preferred_equity = $${paramIdx++}`);
              vals.push(preferred_equity);
            }
            if (nibd !== undefined) {
              sets.push(`nibd = $${paramIdx++}`);
              vals.push(nibd);
            }
            if (enterprise_value !== undefined) {
              sets.push(`enterprise_value = $${paramIdx++}`);
              vals.push(enterprise_value);
            }
            if (equity_value !== undefined) {
              sets.push(`equity_value = $${paramIdx++}`);
              vals.push(equity_value);
            }
            if (shares_at_completion !== undefined) {
              sets.push(`share_count = $${paramIdx++}`);
              vals.push(shares_at_completion);
            }

            if (sets.length > 0) {
              sets.push(`updated_at = NOW()`);
              vals.push(firstPeriod.rows[0].id);
              await client.query(
                `UPDATE financial_periods SET ${sets.join(", ")} WHERE id = $${paramIdx}`,
                vals
              );
            }
          }
        }

        // Update exit period share_count if shares_at_year_end changed
        if (shares_at_year_end !== undefined) {
          const lastPeriod = await client.query(
            `SELECT id FROM financial_periods WHERE model_id = $1 ORDER BY period_date DESC LIMIT 1`,
            [model.id]
          );
          if (lastPeriod.rows.length > 0) {
            await client.query(
              `UPDATE financial_periods SET share_count = $1, updated_at = NOW() WHERE id = $2`,
              [shares_at_year_end, lastPeriod.rows[0].id]
            );
          }
        }

        updatedCount++;
      }

      await client.query("COMMIT");

      res.json({
        message: `Forutsetninger oppdatert for ${updatedCount} modell(er)`,
        models_updated: updatedCount,
      });
    } catch (innerErr) {
      await client.query("ROLLBACK");
      throw innerErr;
    } finally {
      client.release();
    }
  } catch (err) {
    console.error("Error updating assumptions:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Delete company
router.delete("/:id", async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const result = await pool.query(
      "DELETE FROM companies WHERE id = $1 RETURNING id",
      [id]
    );
    if (result.rows.length === 0) {
      res.status(404).json({ error: "Company not found" });
      return;
    }
    res.json({ message: "Company deleted" });
  } catch (err) {
    console.error("Error deleting company:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
