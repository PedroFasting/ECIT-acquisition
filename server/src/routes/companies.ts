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
