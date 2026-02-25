import express from "express";
import cors from "cors";
import authRoutes from "./routes/auth.js";
import companyRoutes from "./routes/companies.js";
import modelRoutes from "./routes/models.js";
import scenarioRoutes from "./routes/scenarios.js";
import importRoutes from "./routes/import.js";

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(
  cors({
    origin: process.env.CORS_ORIGIN || "http://localhost:5173",
    credentials: true,
  })
);
app.use(express.json({ limit: "10mb" }));

// Health check
app.get("/api/health", (_req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

// Routes
app.use("/api/auth", authRoutes);
app.use("/api/companies", companyRoutes);
app.use("/api/models", modelRoutes);
app.use("/api/scenarios", scenarioRoutes);
app.use("/api/import", importRoutes);

app.listen(PORT, () => {
  console.log(`ECIT Acquisition API running on port ${PORT}`);
});

export default app;
