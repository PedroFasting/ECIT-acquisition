import { Router, Response } from "express";
import pool from "../models/db.js";
import { AuthRequest, authMiddleware } from "../middleware/auth.js";
import { validate } from "../middleware/validate.js";
import { CreateModelSchema, UpdateModelSchema, BulkPeriodsSchema } from "../schemas.js";
import { buildPeriodUpsertSQL, extractPeriodParams, COLUMNS_FULL } from "../services/periodUpsert.js";

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
router.post("/", validate(CreateModelSchema), async (req: AuthRequest, res: Response): Promise<void> => {
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
router.put("/:id", validate(UpdateModelSchema), async (req: AuthRequest, res: Response): Promise<void> => {
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
  validate(BulkPeriodsSchema),
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const { id } = req.params;
      const { periods } = req.body;

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
      const { sql } = buildPeriodUpsertSQL({ columns: COLUMNS_FULL, strategy: "overwrite", returning: true });
      try {
        await client.query("BEGIN");

        const inserted = [];
        for (const p of periods) {
          const params = extractPeriodParams(id, p.period_date, p, COLUMNS_FULL);
          const result = await client.query(sql, params);
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
