/**
 * Auto-generated OpenAPI 3.0 specification derived from Zod schemas.
 *
 * Serves interactive Swagger UI at GET /api/docs
 * and raw JSON spec at GET /api/docs/openapi.json
 */

import type { OpenAPIV3 } from "../types/openapi.js";

// ── Reusable parameter refs ────────────────────────────────────────

const idParam = (name: string, description: string): OpenAPIV3.ParameterObject => ({
  name,
  in: "path",
  required: true,
  schema: { type: "integer" },
  description,
});

const bearerAuth: OpenAPIV3.SecuritySchemeObject = {
  type: "http",
  scheme: "bearer",
  bearerFormat: "JWT",
};

const jsonBody = (ref: string): OpenAPIV3.RequestBodyObject => ({
  required: true,
  content: { "application/json": { schema: { $ref: `#/components/schemas/${ref}` } } },
});

const fileBody = (description: string): OpenAPIV3.RequestBodyObject => ({
  required: true,
  content: {
    "multipart/form-data": {
      schema: {
        type: "object",
        properties: { file: { type: "string", format: "binary", description } },
        required: ["file"],
      },
    },
  },
});

const ok = (desc: string) => ({ 200: { description: desc } });
const created = (desc: string) => ({ 201: { description: desc } });

// ── Schemas (derived from Zod definitions in schemas.ts) ───────────

const schemas: Record<string, OpenAPIV3.SchemaObject> = {
  Login: {
    type: "object",
    required: ["email", "password"],
    properties: {
      email: { type: "string", format: "email" },
      password: { type: "string", minLength: 1 },
    },
  },
  Register: {
    type: "object",
    required: ["email", "password", "name"],
    properties: {
      email: { type: "string", format: "email" },
      password: { type: "string", minLength: 8 },
      name: { type: "string", minLength: 1 },
      role: { type: "string", enum: ["admin", "analyst", "viewer"], default: "analyst" },
    },
  },
  CreateCompany: {
    type: "object",
    required: ["name", "company_type"],
    properties: {
      name: { type: "string", minLength: 1, maxLength: 200 },
      company_type: { type: "string", enum: ["acquirer", "target"] },
      description: { type: "string", maxLength: 2000 },
      currency: { type: "string", maxLength: 20, default: "NOKm" },
      country: { type: "string", maxLength: 100 },
      sector: { type: "string", maxLength: 200 },
    },
  },
  UpdateCompany: {
    type: "object",
    properties: {
      name: { type: "string", minLength: 1, maxLength: 200 },
      description: { type: "string", maxLength: 2000 },
      currency: { type: "string", maxLength: 20 },
      country: { type: "string", maxLength: 100 },
      sector: { type: "string", maxLength: 200 },
    },
  },
  UpdateAssumptions: {
    type: "object",
    properties: {
      shares_at_completion: { type: "number" },
      shares_at_year_end: { type: "number" },
      preferred_equity: { type: "number" },
      preferred_equity_rate: { type: "number" },
      mip_share_pct: { type: "number" },
      tso_warrants_count: { type: "number" },
      tso_warrants_strike: { type: "number" },
      existing_warrants_count: { type: "number" },
      existing_warrants_strike: { type: "number" },
      nibd: { type: "number" },
      enterprise_value: { type: "number" },
      equity_value: { type: "number" },
    },
  },
  CreateModel: {
    type: "object",
    required: ["company_id", "name"],
    properties: {
      company_id: { type: "integer" },
      name: { type: "string", minLength: 1, maxLength: 200 },
      description: { type: "string", maxLength: 2000 },
      model_type: { type: "string", enum: ["base", "budget", "scenario", "forecast"], default: "base" },
      model_parameters: { type: "object", additionalProperties: true },
    },
  },
  UpdateModel: {
    type: "object",
    properties: {
      name: { type: "string", minLength: 1, maxLength: 200 },
      description: { type: "string", maxLength: 2000 },
      model_type: { type: "string", enum: ["base", "budget", "scenario", "forecast"] },
      is_active: { type: "boolean" },
      model_parameters: { type: "object", additionalProperties: true },
    },
  },
  FinancialPeriod: {
    type: "object",
    required: ["period_date"],
    properties: {
      period_date: { type: "string" },
      period_label: { type: "string" },
      period_type: { type: "string" },
      revenue_managed_services: { type: "number" },
      revenue_professional_services: { type: "number" },
      revenue_other: { type: "number" },
      revenue_total: { type: "number" },
      ebitda_total: { type: "number" },
      ebitda_margin: { type: "number" },
      capex: { type: "number" },
      operating_fcf: { type: "number" },
      nibd: { type: "number" },
      enterprise_value: { type: "number" },
      equity_value: { type: "number" },
    },
    additionalProperties: true,
    description: "Financial period with ~44 optional numeric fields. See schemas.ts for complete list.",
  },
  BulkPeriods: {
    type: "object",
    required: ["periods"],
    properties: {
      periods: { type: "array", items: { $ref: "#/components/schemas/FinancialPeriod" }, minItems: 1, maxItems: 200 },
    },
  },
  SourceUseItem: {
    type: "object",
    required: ["name", "amount"],
    properties: {
      name: { type: "string" },
      amount: { type: "number" },
      type: { type: "string", description: "debt | equity | preferred" },
    },
  },
  CreateScenario: {
    type: "object",
    required: ["name", "acquirer_model_id"],
    properties: {
      name: { type: "string", minLength: 1, maxLength: 200 },
      description: { type: "string", maxLength: 2000 },
      acquirer_model_id: { type: "integer" },
      target_model_id: { type: "integer" },
      acquisition_date: { type: "string" },
      share_price: { type: "number" },
      enterprise_value: { type: "number" },
      equity_value: { type: "number" },
      ordinary_equity: { type: "number" },
      preferred_equity: { type: "number" },
      preferred_equity_rate: { type: "number" },
      net_debt: { type: "number" },
      rollover_shareholders: {},
      sources: { type: "array", items: { $ref: "#/components/schemas/SourceUseItem" }, default: [] },
      uses: { type: "array", items: { $ref: "#/components/schemas/SourceUseItem" }, default: [] },
      exit_date: { type: "string" },
      cost_synergies_timeline: { type: "object", additionalProperties: { type: "number" } },
    },
  },
  UpdateScenario: {
    type: "object",
    properties: {
      name: { type: "string", minLength: 1, maxLength: 200 },
      description: { type: "string", maxLength: 2000 },
      acquirer_model_id: { type: "integer" },
      target_model_id: { type: "integer" },
      sources: { type: "array", items: { $ref: "#/components/schemas/SourceUseItem" } },
      uses: { type: "array", items: { $ref: "#/components/schemas/SourceUseItem" } },
      deal_parameters: { type: "object", additionalProperties: true },
      status: { type: "string" },
    },
    additionalProperties: true,
  },
  DealParameters: {
    type: "object",
    required: ["tax_rate", "exit_multiples"],
    properties: {
      price_paid: { type: "number", description: "Auto-derived from Uses total when S&U exists" },
      tax_rate: { type: "number", minimum: 0, maximum: 1, description: "Decimal percentage (0-1)" },
      exit_multiples: { type: "array", items: { type: "number" }, minItems: 1, maxItems: 20 },
      acquirer_entry_ev: { type: "number", minimum: 0 },
      nwc_investment: { type: "number" },
      nwc_pct_revenue: { type: "number", minimum: 0, maximum: 1 },
      capex_pct_revenue: { type: "number", minimum: 0, maximum: 1 },
      da_pct_revenue: { type: "number", minimum: 0, maximum: 1 },
      target_capex_pct_revenue: { type: "number", minimum: 0, maximum: 1 },
      target_nwc_pct_revenue: { type: "number", minimum: 0, maximum: 1 },
      minority_pct: { type: "number", minimum: 0, maximum: 1 },
      ordinary_equity: { type: "number" },
      preferred_equity: { type: "number", minimum: 0 },
      preferred_equity_rate: { type: "number", minimum: 0, maximum: 1 },
      net_debt: { type: "number" },
      debt_amortisation: { type: "number", minimum: 0 },
      interest_rate: { type: "number", minimum: 0, maximum: 1 },
      rollover_equity: { type: "number", minimum: 0 },
      cash_sweep_pct: { type: "number", minimum: 0, maximum: 1 },
      entry_shares: { type: "number" },
      exit_shares: { type: "number" },
      entry_price_per_share: { type: "number" },
      rollover_shares: { type: "number" },
      equity_from_sources: { type: "number" },
      mip_share_pct: { type: "number", minimum: 0, maximum: 1 },
      tso_warrants_count: { type: "number" },
      tso_warrants_price: { type: "number" },
      existing_warrants_count: { type: "number" },
      existing_warrants_price: { type: "number" },
      dilution_base_shares: { type: "number" },
    },
    additionalProperties: true,
    description: "Core financial engine input for deal returns calculation.",
  },
  CalculateReturns: {
    type: "object",
    required: ["deal_parameters"],
    properties: {
      deal_parameters: { $ref: "#/components/schemas/DealParameters" },
    },
  },
  SensitivityAxis: {
    type: "object",
    required: ["param", "values"],
    properties: {
      param: { type: "string", minLength: 1 },
      values: { type: "array", items: { type: "number" }, minItems: 1, maxItems: 30 },
    },
  },
  Sensitivity: {
    type: "object",
    required: ["base_params", "row_axis", "col_axis"],
    properties: {
      base_params: { $ref: "#/components/schemas/DealParameters" },
      row_axis: { $ref: "#/components/schemas/SensitivityAxis" },
      col_axis: { $ref: "#/components/schemas/SensitivityAxis" },
      metric: { type: "string", enum: ["irr", "mom", "per_share_irr", "per_share_mom"], default: "irr" },
      return_case: { type: "string", default: "Kombinert" },
    },
  },
  DealReturnRow: {
    type: "object",
    required: ["return_case", "exit_multiple", "irr", "mom"],
    properties: {
      return_case: { type: "string" },
      exit_multiple: { type: "number" },
      irr: { type: "number", nullable: true },
      mom: { type: "number", nullable: true },
      irr_delta: { type: "number", nullable: true },
      mom_delta: { type: "number", nullable: true },
    },
  },
  BulkReturns: {
    type: "object",
    required: ["returns"],
    properties: {
      returns: { type: "array", items: { $ref: "#/components/schemas/DealReturnRow" }, minItems: 1, maxItems: 500 },
    },
  },
};

// ── Paths ──────────────────────────────────────────────────────────

const secured = [{ BearerAuth: [] }];

const paths: Record<string, OpenAPIV3.PathItemObject> = {
  "/api/health": {
    get: {
      tags: ["Health"],
      summary: "Health check",
      description: "Verifies database connectivity",
      responses: ok("Service healthy"),
    },
  },

  // ── Auth ──
  "/api/auth/login": {
    post: {
      tags: ["Auth"],
      summary: "Login",
      description: "Authenticate with email/password. First login sets the password.",
      requestBody: jsonBody("Login"),
      responses: ok("JWT token + user object"),
    },
  },
  "/api/auth/register": {
    post: {
      tags: ["Auth"],
      summary: "Register user (admin only)",
      security: secured,
      requestBody: jsonBody("Register"),
      responses: created("New user created"),
    },
  },

  // ── Companies ──
  "/api/companies": {
    get: {
      tags: ["Companies"],
      summary: "List all companies",
      security: secured,
      responses: ok("Array of companies with model counts"),
    },
    post: {
      tags: ["Companies"],
      summary: "Create company",
      security: secured,
      requestBody: jsonBody("CreateCompany"),
      responses: created("Company created"),
    },
  },
  "/api/companies/{id}": {
    get: {
      tags: ["Companies"],
      summary: "Get company details",
      security: secured,
      parameters: [idParam("id", "Company ID")],
      responses: ok("Company with models"),
    },
    put: {
      tags: ["Companies"],
      summary: "Update company",
      security: secured,
      parameters: [idParam("id", "Company ID")],
      requestBody: jsonBody("UpdateCompany"),
      responses: ok("Updated company"),
    },
    delete: {
      tags: ["Companies"],
      summary: "Delete company",
      security: secured,
      parameters: [idParam("id", "Company ID")],
      responses: ok("Company deleted"),
    },
  },
  "/api/companies/{id}/assumptions": {
    get: {
      tags: ["Companies"],
      summary: "Get company assumptions",
      description: "Returns equity bridge assumptions (shares, NIBD, warrants, etc.)",
      security: secured,
      parameters: [idParam("id", "Company ID")],
      responses: ok("Assumptions object"),
    },
    put: {
      tags: ["Companies"],
      summary: "Update company assumptions",
      description: "Updates assumptions across all models for the company",
      security: secured,
      parameters: [idParam("id", "Company ID")],
      requestBody: jsonBody("UpdateAssumptions"),
      responses: ok("Models updated count"),
    },
  },

  // ── Models ──
  "/api/models/company/{companyId}": {
    get: {
      tags: ["Models"],
      summary: "List models for company",
      security: secured,
      parameters: [idParam("companyId", "Company ID")],
      responses: ok("Array of models with period metadata"),
    },
  },
  "/api/models": {
    post: {
      tags: ["Models"],
      summary: "Create financial model",
      security: secured,
      requestBody: jsonBody("CreateModel"),
      responses: created("Model created"),
    },
  },
  "/api/models/{id}": {
    get: {
      tags: ["Models"],
      summary: "Get model details",
      description: "Returns model with periods, geography, and service breakdown",
      security: secured,
      parameters: [idParam("id", "Model ID")],
      responses: ok("Model with all related data"),
    },
    put: {
      tags: ["Models"],
      summary: "Update model",
      security: secured,
      parameters: [idParam("id", "Model ID")],
      requestBody: jsonBody("UpdateModel"),
      responses: ok("Updated model"),
    },
    delete: {
      tags: ["Models"],
      summary: "Delete model",
      security: secured,
      parameters: [idParam("id", "Model ID")],
      responses: ok("Model deleted"),
    },
  },
  "/api/models/{id}/periods": {
    post: {
      tags: ["Models"],
      summary: "Bulk upsert financial periods",
      description: "Creates or updates up to 200 financial periods in one request",
      security: secured,
      parameters: [idParam("id", "Model ID")],
      requestBody: jsonBody("BulkPeriods"),
      responses: created("Upserted periods"),
    },
  },

  // ── Scenarios ──
  "/api/scenarios": {
    get: {
      tags: ["Scenarios"],
      summary: "List all scenarios",
      security: secured,
      responses: ok("Array of scenarios"),
    },
    post: {
      tags: ["Scenarios"],
      summary: "Create acquisition scenario",
      security: secured,
      requestBody: jsonBody("CreateScenario"),
      responses: created("Scenario created"),
    },
  },
  "/api/scenarios/compare": {
    get: {
      tags: ["Scenarios"],
      summary: "Compare models",
      description: "Compare acquirer and target models side by side with pro forma and returns",
      security: secured,
      parameters: [
        { name: "acquirer_model_id", in: "query", required: true, schema: { type: "integer" } },
        { name: "target_model_id", in: "query", schema: { type: "integer" } },
      ],
      responses: ok("Comparison result with pro forma and returns"),
    },
  },
  "/api/scenarios/{id}": {
    get: {
      tags: ["Scenarios"],
      summary: "Get scenario details",
      security: secured,
      parameters: [idParam("id", "Scenario ID")],
      responses: ok("Scenario with all related data"),
    },
    put: {
      tags: ["Scenarios"],
      summary: "Update scenario",
      security: secured,
      parameters: [idParam("id", "Scenario ID")],
      requestBody: jsonBody("UpdateScenario"),
      responses: ok("Updated scenario"),
    },
    delete: {
      tags: ["Scenarios"],
      summary: "Delete scenario",
      security: secured,
      parameters: [idParam("id", "Scenario ID")],
      responses: ok("Scenario deleted"),
    },
  },
  "/api/scenarios/{id}/calculate-returns": {
    post: {
      tags: ["Scenarios"],
      summary: "Calculate deal returns (IRR/MoM)",
      description: "Runs the two-level deal returns engine. Level 1: unlevered EV-based. Level 2: full leveraged equity with debt schedule.",
      security: secured,
      parameters: [idParam("id", "Scenario ID")],
      requestBody: jsonBody("CalculateReturns"),
      responses: ok("Calculated returns with IRR/MoM per exit multiple"),
    },
  },
  "/api/scenarios/{id}/sensitivity": {
    post: {
      tags: ["Scenarios"],
      summary: "Sensitivity analysis",
      description: "2D grid sensitivity across two parameters (up to 900 cells)",
      security: secured,
      parameters: [idParam("id", "Scenario ID")],
      requestBody: jsonBody("Sensitivity"),
      responses: ok("Sensitivity matrix"),
    },
  },
  "/api/scenarios/{id}/returns": {
    post: {
      tags: ["Scenarios"],
      summary: "Bulk upsert deal returns",
      security: secured,
      parameters: [idParam("id", "Scenario ID")],
      requestBody: jsonBody("BulkReturns"),
      responses: created("Upserted returns"),
    },
  },
  "/api/scenarios/{id}/generate-pro-forma": {
    post: {
      tags: ["Scenarios"],
      summary: "Generate pro forma periods",
      description: "Combines acquirer + target financials with synergies into pro forma periods",
      security: secured,
      parameters: [idParam("id", "Scenario ID")],
      responses: created("Generated pro forma periods"),
    },
  },
  "/api/scenarios/{id}/export-excel": {
    get: {
      tags: ["Scenarios"],
      summary: "Export scenario as Excel",
      description: "Downloads a multi-sheet .xlsx workbook with all scenario data",
      security: secured,
      parameters: [idParam("id", "Scenario ID")],
      responses: { 200: { description: "Excel file download", content: { "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": {} } } },
    },
  },

  // ── Import ──
  "/api/import/json/{modelId}": {
    post: {
      tags: ["Import"],
      summary: "Import JSON data",
      description: "Import financial periods from JSON file or request body",
      security: secured,
      parameters: [idParam("modelId", "Model ID")],
      requestBody: fileBody("JSON file with period data"),
      responses: created("Imported periods count"),
    },
  },
  "/api/import/csv/{modelId}": {
    post: {
      tags: ["Import"],
      summary: "Import CSV data",
      security: secured,
      parameters: [idParam("modelId", "Model ID")],
      requestBody: fileBody("CSV file with period data"),
      responses: created("Imported periods count"),
    },
  },
  "/api/import/excel/{companyId}": {
    post: {
      tags: ["Import"],
      summary: "Import Excel model",
      description: "Parses .xlsx file and auto-creates models + periods. Returns model details and any warnings.",
      security: secured,
      parameters: [idParam("companyId", "Company ID")],
      requestBody: fileBody("Excel .xlsx file"),
      responses: created("Import result with model details and warnings"),
    },
  },
};

// ── Assemble spec ──────────────────────────────────────────────────

export const openApiSpec: OpenAPIV3.Document = {
  openapi: "3.0.3",
  info: {
    title: "ECIT Acquisition Analysis API",
    version: "1.0.0",
    description: "API for M&A acquisition modeling — financial scenarios, pro forma analysis, deal returns (IRR/MoM), and sensitivity analysis.",
  },
  servers: [{ url: "http://localhost:3001", description: "Local development" }],
  tags: [
    { name: "Health", description: "Service health" },
    { name: "Auth", description: "Authentication" },
    { name: "Companies", description: "Company management" },
    { name: "Models", description: "Financial models and periods" },
    { name: "Scenarios", description: "Acquisition scenarios, returns, and pro forma" },
    { name: "Import", description: "Data import (Excel, JSON, CSV)" },
  ],
  paths,
  components: {
    securitySchemes: { BearerAuth: bearerAuth },
    schemas,
  },
};
