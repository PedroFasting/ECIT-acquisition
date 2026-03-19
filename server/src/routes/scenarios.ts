import { Router, Response } from "express";
import { AuthRequest, authMiddleware } from "../middleware/auth.js";
import { validate } from "../middleware/validate.js";
import {
  CreateScenarioSchema,
  UpdateScenarioSchema,
  CalculateReturnsSchema,
  SensitivitySchema,
  BulkReturnsSchema,
} from "../schemas.js";
import type { DealParameters } from "../services/dealReturns.js";
import {
  listScenarios,
  compareModels,
  getScenarioWithRelatedData,
  createScenario,
  updateScenario,
  calculateReturnsForScenario,
  runSensitivityGrid,
  bulkUpsertReturns,
  generateAndPersistProForma,
  buildExcelExportData,
  deleteScenario,
} from "../services/scenarioService.js";

const router = Router();
router.use(authMiddleware);

// List all scenarios
router.get("/", async (_req: AuthRequest, res: Response): Promise<void> => {
  try {
    const rows = await listScenarios();
    res.json(rows);
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

      const result = await compareModels(acquirerModelId, targetModelId, req.userId);
      if ("_errorStatus" in result) {
        res.status(result._errorStatus).json({ error: result.error });
        return;
      }
      res.json(result);
    } catch (err) {
      console.error("Error comparing models:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  }
);

// Get scenario with all related data
router.get("/:id", async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const data = await getScenarioWithRelatedData(req.params.id);
    if (!data) {
      res.status(404).json({ error: "Scenario not found" });
      return;
    }
    res.json(data);
  } catch (err) {
    console.error("Error fetching scenario:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Create scenario
router.post("/", validate(CreateScenarioSchema), async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const row = await createScenario(req.body, req.userId);
    res.status(201).json(row);
  } catch (err) {
    console.error("Error creating scenario:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Update scenario
router.put("/:id", validate(UpdateScenarioSchema), async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const result = await updateScenario(req.params.id, req.body);
    if (result && "_errorStatus" in result) {
      res.status(result._errorStatus).json({ error: result.error });
      return;
    }
    if (!result) {
      res.status(404).json({ error: "Scenario not found" });
      return;
    }
    res.json(result);
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
      const dp = req.body.deal_parameters as DealParameters;
      const result = await calculateReturnsForScenario(req.params.id, dp);
      if (!result) {
        res.status(404).json({ error: "Scenario not found" });
        return;
      }
      res.json(result);
    } catch (err) {
      console.error("Error calculating returns:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  }
);

// Sensitivity analysis: run calculation grid over two variable axes
router.post(
  "/:id/sensitivity",
  validate(SensitivitySchema),
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const result = await runSensitivityGrid(req.params.id, req.body);
      if (!result) {
        res.status(404).json({ error: "Scenario not found" });
        return;
      }
      if ("_errorStatus" in result) {
        res.status(result._errorStatus as number).json({ error: result.error });
        return;
      }
      res.json(result);
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
      const result = await bulkUpsertReturns(req.params.id, req.body.returns);
      res.status(201).json(result);
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
      const result = await generateAndPersistProForma(req.params.id);
      if (!result) {
        res.status(404).json({ error: "Scenario not found" });
        return;
      }
      res.status(201).json(result);
    } catch (err) {
      console.error("Error generating pro forma:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  }
);

// Export scenario as Excel (.xlsx) with live formulas
router.get(
  "/:id/export-excel",
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const result = await buildExcelExportData(req.params.id);
      if (!result) {
        res.status(404).json({ error: "Scenario not found" });
        return;
      }
      const { workbook, fileName } = result;
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
      const deleted = await deleteScenario(req.params.id);
      if (!deleted) {
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
