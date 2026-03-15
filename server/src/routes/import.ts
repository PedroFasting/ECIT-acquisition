import { Router, Response } from "express";
import multer from "multer";
import { parse } from "csv-parse/sync";
import pool from "../models/db.js";
import { AuthRequest, authMiddleware } from "../middleware/auth.js";
import { parseExcelBuffer } from "../services/excelParser.js";
import {
  buildPeriodUpsertSQL,
  extractPeriodParams,
  COLUMNS_JSON,
  COLUMNS_CSV,
  COLUMNS_EXCEL,
  type PeriodColumn,
} from "../services/periodUpsert.js";

const router = Router();
router.use(authMiddleware);

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

// Import JSON data for a model
router.post(
  "/json/:modelId",
  upload.single("file"),
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const { modelId } = req.params;

      let data: any;
      if (req.file) {
        data = JSON.parse(req.file.buffer.toString("utf-8"));
      } else if (req.body.data) {
        data = typeof req.body.data === "string" ? JSON.parse(req.body.data) : req.body.data;
      } else {
        res.status(400).json({ error: "No data provided. Send a JSON file or data in body." });
        return;
      }

      // Verify model exists
      const modelCheck = await pool.query(
        "SELECT id FROM financial_models WHERE id = $1",
        [modelId]
      );
      if (modelCheck.rows.length === 0) {
        res.status(404).json({ error: "Model not found" });
        return;
      }

      // Expect { periods: [...] } format
      const periods = data.periods || data;
      if (!Array.isArray(periods)) {
        res.status(400).json({ error: "Expected an array of periods or { periods: [...] }" });
        return;
      }

      // Forward to the periods upsert endpoint logic
      const client = await pool.connect();
      const { sql } = buildPeriodUpsertSQL({ columns: COLUMNS_JSON, strategy: "overwrite" });
      try {
        await client.query("BEGIN");
        let count = 0;

        for (const p of periods) {
          const params = extractPeriodParams(modelId, p.period_date, p, COLUMNS_JSON, (col, row) => {
            if (col === "period_type") return row.period_type || "estimate";
            if (col === "extra_data") return JSON.stringify(row.extra_data || {});
            return row[col] ?? null;
          });
          await client.query(sql, params);
          count++;
        }

        // Also import geography data if present
        if (data.geography && Array.isArray(data.geography)) {
          for (const g of data.geography) {
            await client.query(
              `INSERT INTO revenue_geography (model_id, period_date, country, revenue_amount, revenue_pct)
               VALUES ($1, $2, $3, $4, $5)
               ON CONFLICT (model_id, period_date, country) DO UPDATE SET
                 revenue_amount = EXCLUDED.revenue_amount, revenue_pct = EXCLUDED.revenue_pct`,
              [modelId, g.period_date, g.country, g.revenue_amount, g.revenue_pct]
            );
          }
        }

        // Also import service data if present
        if (data.services && Array.isArray(data.services)) {
          for (const s of data.services) {
            await client.query(
              `INSERT INTO revenue_service (model_id, period_date, service_name, revenue_amount, revenue_pct)
               VALUES ($1, $2, $3, $4, $5)
               ON CONFLICT (model_id, period_date, service_name) DO UPDATE SET
                 revenue_amount = EXCLUDED.revenue_amount, revenue_pct = EXCLUDED.revenue_pct`,
              [modelId, s.period_date, s.service_name, s.revenue_amount, s.revenue_pct]
            );
          }
        }

        await client.query("COMMIT");
        res.status(201).json({ message: `Imported ${count} periods`, count });
      } catch (err) {
        await client.query("ROLLBACK");
        throw err;
      } finally {
        client.release();
      }
    } catch (err) {
      console.error("Import error:", err);
      res.status(500).json({ error: "Import failed" });
    }
  }
);

// Import CSV for a model (simple row-per-year format)
router.post(
  "/csv/:modelId",
  upload.single("file"),
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const { modelId } = req.params;

      if (!req.file) {
        res.status(400).json({ error: "No CSV file uploaded" });
        return;
      }

      const csvContent = req.file.buffer.toString("utf-8");
      const records = parse(csvContent, {
        columns: true,
        skip_empty_lines: true,
        trim: true,
        cast: (value, context) => {
          if (context.header) return value;
          if (value === "" || value === "-" || value === "N/A") return null;
          // Remove parentheses for negative numbers
          const cleaned = value.replace(/[()]/g, "").replace(/,/g, "");
          const num = Number(cleaned);
          if (!isNaN(num)) {
            return value.includes("(") ? -num : num;
          }
          return value;
        },
      });

      // Map CSV columns to our schema
      const client = await pool.connect();
      const { sql: csvSql } = buildPeriodUpsertSQL({ columns: COLUMNS_CSV, strategy: "coalesce" });
      try {
        await client.query("BEGIN");
        let count = 0;

        for (const row of records) {
          const periodLabel = row.period || row.year || row.Period || row.Year;
          if (!periodLabel) continue;

          // Derive period_date from label (e.g. "2024A" -> "2024-12-31")
          const yearMatch = periodLabel.match(/(\d{4})/);
          if (!yearMatch) continue;
          const year = yearMatch[1];
          const periodDate = `${year}-12-31`;

          // Derive period_type from suffix
          let periodType = "estimate";
          if (periodLabel.includes("A")) periodType = "actual";
          else if (periodLabel.includes("B")) periodType = "budget";
          else if (periodLabel.includes("E") || periodLabel.includes("F"))
            periodType = "forecast";

          // Parse percentage values (convert from "15.8%" to 0.158)
          const parsePct = (val: any) => {
            if (val === null || val === undefined) return null;
            if (typeof val === "number") return val > 1 ? val / 100 : val;
            const str = String(val).replace("%", "").trim();
            const n = parseFloat(str);
            return isNaN(n) ? null : n / 100;
          };

          const csvValueMapper = (col: PeriodColumn, row: Record<string, any>): any => {
            const aliases: Record<string, string[]> = {
              revenue_managed_services: ["Managed services"],
              revenue_professional_services: ["Professional services"],
              revenue_total: ["Total revenue", "Revenue"],
              revenue_organic: ["Organic revenue"],
              revenue_growth: ["% growth", "Revenue growth"],
              organic_growth: ["Organic growth"],
              ebitda_central_costs: ["Central costs"],
              ebitda_organic: ["Organic EBITDA (pre-IFRS)"],
              ebitda_total: ["Total EBITDA (pre-IFRS)", "EBITDA"],
              ebitda_margin: ["% margin", "EBITDA margin"],
            };
            const pctCols = new Set(["revenue_growth", "organic_growth", "ebitda_margin"]);
            const keys = aliases[col] || [];
            let val = row[col];
            for (const k of keys) {
              if (val == null) val = row[k];
            }
            if (val == null || val === undefined) return null;
            if (pctCols.has(col)) return parsePct(val);
            return val;
          };

          await client.query(
            csvSql,
            extractPeriodParams(modelId, periodDate, { ...row, period_label: periodLabel, period_type: periodType }, COLUMNS_CSV, csvValueMapper),
          );
          count++;
        }

        await client.query("COMMIT");
        res.status(201).json({ message: `Imported ${count} periods from CSV`, count });
      } catch (err) {
        await client.query("ROLLBACK");
        throw err;
      } finally {
        client.release();
      }
    } catch (err) {
      console.error("CSV import error:", err);
      res.status(500).json({ error: "CSV import failed" });
    }
  }
);

// Import Excel file for a company (creates models + periods automatically)
router.post(
  "/excel/:companyId",
  upload.single("file"),
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const { companyId } = req.params;

      // Verify company exists
      const companyCheck = await pool.query(
        "SELECT id, name FROM companies WHERE id = $1",
        [companyId]
      );
      if (companyCheck.rows.length === 0) {
        res.status(404).json({ error: "Company not found" });
        return;
      }
      const companyName = companyCheck.rows[0].name;

      if (!req.file) {
        res.status(400).json({ error: "No file uploaded. Send an .xlsx file." });
        return;
      }

      // Validate file type
      const ext = req.file.originalname?.split(".").pop()?.toLowerCase();
      if (ext !== "xlsx" && ext !== "xls") {
        res.status(400).json({
          error: "Invalid file type. Only .xlsx files are supported.",
        });
        return;
      }

      // Parse Excel
      const parseResult = await parseExcelBuffer(req.file.buffer, req.file.originalname);

      if (parseResult.models.length === 0) {
        res.status(400).json({
          error: "No model blocks found in the Excel file.",
          warnings: parseResult.warnings,
        });
        return;
      }

      const client = await pool.connect();
      const { sql: excelSql } = buildPeriodUpsertSQL({ columns: COLUMNS_EXCEL, strategy: "coalesce" });
      const summary: {
        models_created: number;
        models_updated: number;
        total_periods: number;
        model_details: { name: string; periods: number; action: string }[];
        warnings: string[];
        input_parameters: Record<string, any>;
      } = {
        models_created: 0,
        models_updated: 0,
        total_periods: 0,
        model_details: [],
        warnings: parseResult.warnings,
        input_parameters: parseResult.inputParameters,
      };

      try {
        await client.query("BEGIN");

        for (const modelBlock of parseResult.models) {
          // Check if a model with this name already exists for this company
          const existing = await client.query(
            "SELECT id FROM financial_models WHERE company_id = $1 AND name = $2",
            [companyId, modelBlock.name]
          );

          let modelId: number;
          let action: string;

          if (existing.rows.length > 0) {
            modelId = existing.rows[0].id;
            action = "updated";
            // Update model_parameters if we have input params
            if (Object.keys(parseResult.inputParameters).length > 0) {
              await client.query(
                "UPDATE financial_models SET model_parameters = $1, updated_at = NOW() WHERE id = $2",
                [JSON.stringify(parseResult.inputParameters), modelId]
              );
            }
            summary.models_updated++;
          } else {
            // Create new model
            const insertResult = await client.query(
              `INSERT INTO financial_models (company_id, name, model_type, description, model_parameters)
               VALUES ($1, $2, $3, $4, $5) RETURNING id`,
              [
                companyId,
                modelBlock.name,
                "management", // default type
                `Imported from Excel`,
                Object.keys(parseResult.inputParameters).length > 0
                  ? JSON.stringify(parseResult.inputParameters)
                  : null,
              ]
            );
            modelId = insertResult.rows[0].id;
            action = "created";
            summary.models_created++;
          }

          // Upsert periods — includes all fields the parser can output
          let periodCount = 0;
          for (const p of modelBlock.periods) {
            const params = extractPeriodParams(modelId, p.period_date, p, COLUMNS_EXCEL);
            await client.query(excelSql, params);
            periodCount++;
          }

          summary.total_periods += periodCount;
          summary.model_details.push({
            name: modelBlock.name,
            periods: periodCount,
            action,
          });
        }

        await client.query("COMMIT");
        res.status(201).json({
          message: `Imported ${summary.models_created + summary.models_updated} model(s) with ${summary.total_periods} periods from Excel`,
          ...summary,
        });
      } catch (err) {
        await client.query("ROLLBACK");
        throw err;
      } finally {
        client.release();
      }
    } catch (err) {
      console.error("Excel import error:", err);
      res
        .status(500)
        .json({ error: "Excel import failed" });
    }
  }
);

export default router;
