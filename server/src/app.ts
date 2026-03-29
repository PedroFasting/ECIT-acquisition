import express, { Request, Response, NextFunction } from "express";
import cors from "cors";
import swaggerUi from "swagger-ui-express";
import pool from "./models/db.js";
import authRoutes from "./routes/auth.js";
import companyRoutes from "./routes/companies.js";
import modelRoutes from "./routes/models.js";
import scenarioRoutes from "./routes/scenarios.js";
import importRoutes from "./routes/import.js";
import dashboardRoutes from "./routes/dashboard.js";
import { openApiSpec } from "./docs/openapi.js";

const app = express();

// Middleware
app.use(
  cors({
    origin: process.env.CORS_ORIGIN || "http://localhost:5173",
    credentials: true,
  })
);
app.use(express.json({ limit: "10mb" }));

// Simple request logging
app.use((req: Request, _res: Response, next: NextFunction) => {
  const start = Date.now();
  _res.on("finish", () => {
    const ms = Date.now() - start;
    if (req.path !== "/api/health") {
      console.log(`${req.method} ${req.path} ${_res.statusCode} ${ms}ms`);
    }
  });
  next();
});

// Health check — verifies database connectivity
app.get("/api/health", async (_req, res) => {
  try {
    await pool.query("SELECT 1");
    res.json({ status: "ok", timestamp: new Date().toISOString() });
  } catch {
    res.status(503).json({ status: "unhealthy", timestamp: new Date().toISOString() });
  }
});

// Routes
app.use("/api/auth", authRoutes);
app.use("/api/companies", companyRoutes);
app.use("/api/models", modelRoutes);
app.use("/api/scenarios", scenarioRoutes);
app.use("/api/import", importRoutes);
app.use("/api/dashboard", dashboardRoutes);

// API documentation
app.get("/api/docs/openapi.json", (_req, res) => res.json(openApiSpec));
app.use("/api/docs", swaggerUi.serve, swaggerUi.setup(openApiSpec, {
  customSiteTitle: "ECIT Acquisition API",
}));

// Global error handler — catches unhandled errors in route handlers
app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  console.error("Unhandled error:", err);
  res.status(500).json({ error: "Internal server error" });
});

export default app;
