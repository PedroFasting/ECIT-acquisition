import { Router, Response } from "express";
import multer from "multer";
import { parse } from "csv-parse/sync";
import pool from "../models/db.js";
import { AuthRequest, authMiddleware } from "../middleware/auth.js";
import { parseExcelBuffer } from "../services/excelParser.js";

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
      try {
        await client.query("BEGIN");
        let count = 0;

        for (const p of periods) {
          await client.query(
            `INSERT INTO financial_periods (
              model_id, period_date, period_label, period_type,
              revenue_managed_services, revenue_professional_services, revenue_other,
              revenue_total, revenue_organic, revenue_ma,
              revenue_growth, organic_growth,
              ebitda_managed_services, ebitda_professional_services, ebitda_central_costs,
              ebitda_organic, ebitda_ma, ebitda_total,
              margin_managed_services, margin_professional_services, margin_central_costs, ebitda_margin,
              capex, capex_pct_revenue, change_nwc, other_cash_flow_items,
              operating_fcf, minority_interest, operating_fcf_excl_minorities, cash_conversion,
              share_count, nibd, option_debt, adjustments, enterprise_value, equity_value,
              preferred_equity, per_share_pre, mip_amount, tso_amount, warrants_amount,
              eqv_post_dilution, per_share_post, acquired_revenue,
              extra_data
            ) VALUES (
              $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12,
              $13, $14, $15, $16, $17, $18,
              $19, $20, $21, $22,
              $23, $24, $25, $26, $27, $28, $29, $30,
              $31, $32, $33, $34, $35, $36,
              $37, $38, $39, $40, $41,
              $42, $43, $44,
              $45
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
              ebitda_managed_services = EXCLUDED.ebitda_managed_services,
              ebitda_professional_services = EXCLUDED.ebitda_professional_services,
              ebitda_central_costs = EXCLUDED.ebitda_central_costs,
              ebitda_organic = EXCLUDED.ebitda_organic,
              ebitda_ma = EXCLUDED.ebitda_ma,
              ebitda_total = EXCLUDED.ebitda_total,
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
              updated_at = NOW()`,
            [
              modelId, p.period_date, p.period_label, p.period_type || "estimate",
              p.revenue_managed_services, p.revenue_professional_services, p.revenue_other,
              p.revenue_total, p.revenue_organic, p.revenue_ma,
              p.revenue_growth, p.organic_growth,
              p.ebitda_managed_services, p.ebitda_professional_services, p.ebitda_central_costs,
              p.ebitda_organic, p.ebitda_ma, p.ebitda_total,
              p.margin_managed_services, p.margin_professional_services, p.margin_central_costs, p.ebitda_margin,
              p.capex, p.capex_pct_revenue, p.change_nwc, p.other_cash_flow_items,
              p.operating_fcf, p.minority_interest, p.operating_fcf_excl_minorities, p.cash_conversion,
              p.share_count ?? null, p.nibd ?? null, p.option_debt ?? null,
              p.adjustments ?? null, p.enterprise_value ?? null, p.equity_value ?? null,
              p.preferred_equity ?? null, p.per_share_pre ?? null,
              p.mip_amount ?? null, p.tso_amount ?? null, p.warrants_amount ?? null,
              p.eqv_post_dilution ?? null, p.per_share_post ?? null, p.acquired_revenue ?? null,
              JSON.stringify(p.extra_data || {}),
            ]
          );
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
      res.status(500).json({ error: "Import failed", details: String(err) });
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

          await client.query(
            `INSERT INTO financial_periods (
              model_id, period_date, period_label, period_type,
              revenue_managed_services, revenue_professional_services,
              revenue_total, revenue_organic,
              revenue_growth, organic_growth,
              ebitda_managed_services, ebitda_professional_services, ebitda_central_costs,
              ebitda_organic, ebitda_total, ebitda_margin
            ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
            ON CONFLICT (model_id, period_date) DO UPDATE SET
              period_label = EXCLUDED.period_label,
              period_type = EXCLUDED.period_type,
              revenue_managed_services = COALESCE(EXCLUDED.revenue_managed_services, financial_periods.revenue_managed_services),
              revenue_professional_services = COALESCE(EXCLUDED.revenue_professional_services, financial_periods.revenue_professional_services),
              revenue_total = COALESCE(EXCLUDED.revenue_total, financial_periods.revenue_total),
              revenue_organic = COALESCE(EXCLUDED.revenue_organic, financial_periods.revenue_organic),
              revenue_growth = COALESCE(EXCLUDED.revenue_growth, financial_periods.revenue_growth),
              organic_growth = COALESCE(EXCLUDED.organic_growth, financial_periods.organic_growth),
              ebitda_managed_services = COALESCE(EXCLUDED.ebitda_managed_services, financial_periods.ebitda_managed_services),
              ebitda_professional_services = COALESCE(EXCLUDED.ebitda_professional_services, financial_periods.ebitda_professional_services),
              ebitda_central_costs = COALESCE(EXCLUDED.ebitda_central_costs, financial_periods.ebitda_central_costs),
              ebitda_organic = COALESCE(EXCLUDED.ebitda_organic, financial_periods.ebitda_organic),
              ebitda_total = COALESCE(EXCLUDED.ebitda_total, financial_periods.ebitda_total),
              ebitda_margin = COALESCE(EXCLUDED.ebitda_margin, financial_periods.ebitda_margin),
              updated_at = NOW()`,
            [
              modelId,
              periodDate,
              periodLabel,
              periodType,
              row.revenue_managed_services || row["Managed services"] || null,
              row.revenue_professional_services || row["Professional services"] || null,
              row.revenue_total || row["Total revenue"] || row.Revenue || null,
              row.revenue_organic || row["Organic revenue"] || null,
              parsePct(row.revenue_growth || row["% growth"] || row["Revenue growth"]),
              parsePct(row.organic_growth || row["Organic growth"]),
              row.ebitda_managed_services || null,
              row.ebitda_professional_services || null,
              row.ebitda_central_costs || row["Central costs"] || null,
              row.ebitda_organic || row["Organic EBITDA (pre-IFRS)"] || null,
              row.ebitda_total || row["Total EBITDA (pre-IFRS)"] || row.EBITDA || null,
              parsePct(row.ebitda_margin || row["% margin"] || row["EBITDA margin"]),
            ]
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
      res.status(500).json({ error: "CSV import failed", details: String(err) });
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
            await client.query(
              `INSERT INTO financial_periods (
                model_id, period_date, period_label, period_type,
                revenue_managed_services, revenue_professional_services, revenue_other,
                revenue_total, revenue_organic, revenue_ma,
                revenue_growth, organic_growth,
                ebitda_managed_services, ebitda_professional_services, ebitda_central_costs,
                ebitda_organic, ebitda_ma, ebitda_total,
                margin_managed_services, margin_professional_services, margin_central_costs, ebitda_margin,
                capex, capex_pct_revenue, change_nwc, other_cash_flow_items,
                operating_fcf, minority_interest, operating_fcf_excl_minorities, cash_conversion,
                acquired_revenue,
                share_count, nibd, option_debt, adjustments,
                enterprise_value, equity_value, preferred_equity, per_share_pre,
                mip_amount, tso_amount, warrants_amount,
                eqv_post_dilution, per_share_post
              ) VALUES (
                $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12,
                $13, $14, $15, $16, $17, $18,
                $19, $20, $21, $22,
                $23, $24, $25, $26, $27, $28, $29, $30,
                $31, $32, $33, $34, $35,
                $36, $37, $38, $39,
                $40, $41, $42,
                $43, $44
              )
              ON CONFLICT (model_id, period_date) DO UPDATE SET
                period_label = EXCLUDED.period_label,
                period_type = EXCLUDED.period_type,
                revenue_managed_services = COALESCE(EXCLUDED.revenue_managed_services, financial_periods.revenue_managed_services),
                revenue_professional_services = COALESCE(EXCLUDED.revenue_professional_services, financial_periods.revenue_professional_services),
                revenue_other = COALESCE(EXCLUDED.revenue_other, financial_periods.revenue_other),
                revenue_total = COALESCE(EXCLUDED.revenue_total, financial_periods.revenue_total),
                revenue_organic = COALESCE(EXCLUDED.revenue_organic, financial_periods.revenue_organic),
                revenue_ma = COALESCE(EXCLUDED.revenue_ma, financial_periods.revenue_ma),
                revenue_growth = COALESCE(EXCLUDED.revenue_growth, financial_periods.revenue_growth),
                organic_growth = COALESCE(EXCLUDED.organic_growth, financial_periods.organic_growth),
                ebitda_managed_services = COALESCE(EXCLUDED.ebitda_managed_services, financial_periods.ebitda_managed_services),
                ebitda_professional_services = COALESCE(EXCLUDED.ebitda_professional_services, financial_periods.ebitda_professional_services),
                ebitda_central_costs = COALESCE(EXCLUDED.ebitda_central_costs, financial_periods.ebitda_central_costs),
                ebitda_organic = COALESCE(EXCLUDED.ebitda_organic, financial_periods.ebitda_organic),
                ebitda_ma = COALESCE(EXCLUDED.ebitda_ma, financial_periods.ebitda_ma),
                ebitda_total = COALESCE(EXCLUDED.ebitda_total, financial_periods.ebitda_total),
                margin_managed_services = COALESCE(EXCLUDED.margin_managed_services, financial_periods.margin_managed_services),
                margin_professional_services = COALESCE(EXCLUDED.margin_professional_services, financial_periods.margin_professional_services),
                margin_central_costs = COALESCE(EXCLUDED.margin_central_costs, financial_periods.margin_central_costs),
                ebitda_margin = COALESCE(EXCLUDED.ebitda_margin, financial_periods.ebitda_margin),
                capex = COALESCE(EXCLUDED.capex, financial_periods.capex),
                capex_pct_revenue = COALESCE(EXCLUDED.capex_pct_revenue, financial_periods.capex_pct_revenue),
                change_nwc = COALESCE(EXCLUDED.change_nwc, financial_periods.change_nwc),
                other_cash_flow_items = COALESCE(EXCLUDED.other_cash_flow_items, financial_periods.other_cash_flow_items),
                operating_fcf = COALESCE(EXCLUDED.operating_fcf, financial_periods.operating_fcf),
                minority_interest = COALESCE(EXCLUDED.minority_interest, financial_periods.minority_interest),
                operating_fcf_excl_minorities = COALESCE(EXCLUDED.operating_fcf_excl_minorities, financial_periods.operating_fcf_excl_minorities),
                cash_conversion = COALESCE(EXCLUDED.cash_conversion, financial_periods.cash_conversion),
                acquired_revenue = COALESCE(EXCLUDED.acquired_revenue, financial_periods.acquired_revenue),
                share_count = COALESCE(EXCLUDED.share_count, financial_periods.share_count),
                nibd = COALESCE(EXCLUDED.nibd, financial_periods.nibd),
                option_debt = COALESCE(EXCLUDED.option_debt, financial_periods.option_debt),
                adjustments = COALESCE(EXCLUDED.adjustments, financial_periods.adjustments),
                enterprise_value = COALESCE(EXCLUDED.enterprise_value, financial_periods.enterprise_value),
                equity_value = COALESCE(EXCLUDED.equity_value, financial_periods.equity_value),
                preferred_equity = COALESCE(EXCLUDED.preferred_equity, financial_periods.preferred_equity),
                per_share_pre = COALESCE(EXCLUDED.per_share_pre, financial_periods.per_share_pre),
                mip_amount = COALESCE(EXCLUDED.mip_amount, financial_periods.mip_amount),
                tso_amount = COALESCE(EXCLUDED.tso_amount, financial_periods.tso_amount),
                warrants_amount = COALESCE(EXCLUDED.warrants_amount, financial_periods.warrants_amount),
                eqv_post_dilution = COALESCE(EXCLUDED.eqv_post_dilution, financial_periods.eqv_post_dilution),
                per_share_post = COALESCE(EXCLUDED.per_share_post, financial_periods.per_share_post),
                updated_at = NOW()`,
              [
                modelId,
                p.period_date,
                p.period_label,
                p.period_type,
                p.revenue_managed_services ?? null,
                p.revenue_professional_services ?? null,
                p.revenue_other ?? null,
                p.revenue_total ?? null,
                p.revenue_organic ?? null,
                p.revenue_ma ?? null,
                p.revenue_growth ?? null,
                p.organic_growth ?? null,
                p.ebitda_managed_services ?? null,
                p.ebitda_professional_services ?? null,
                p.ebitda_central_costs ?? null,
                p.ebitda_organic ?? null,
                p.ebitda_ma ?? null,
                p.ebitda_total ?? null,
                p.margin_managed_services ?? null,
                p.margin_professional_services ?? null,
                p.margin_central_costs ?? null,
                p.ebitda_margin ?? null,
                p.capex ?? null,
                p.capex_pct_revenue ?? null,
                p.change_nwc ?? null,
                p.other_cash_flow_items ?? null,
                p.operating_fcf ?? null,
                p.minority_interest ?? null,
                p.operating_fcf_excl_minorities ?? null,
                p.cash_conversion ?? null,
                p.acquired_revenue ?? null,
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
              ]
            );
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
        .json({ error: "Excel import failed", details: String(err) });
    }
  }
);

export default router;
