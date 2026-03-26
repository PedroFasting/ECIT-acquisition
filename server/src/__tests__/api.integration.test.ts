/**
 * API integration tests — validates routes, middleware, and Zod validation
 * through the full Express stack using supertest with a mocked database.
 *
 * These tests ensure:
 * 1. Authentication middleware rejects unauthenticated requests
 * 2. Zod validation returns 400 with structured errors on bad input
 * 3. Routes return correct status codes and response shapes
 * 4. The health endpoint works without auth
 * 5. The full create → read → update → delete company flow works
 * 6. Scenario creation and returns calculation validation works
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import jwt from "jsonwebtoken";

// Mock the database pool BEFORE importing app
vi.mock("../models/db.js", () => {
  const mockPool = {
    query: vi.fn(),
    connect: vi.fn(),
    on: vi.fn(),
  };
  return { default: mockPool };
});

// Now import app and mocked pool
import app from "../app.js";
import pool from "../models/db.js";

const JWT_SECRET = process.env.JWT_SECRET || "test-secret-for-vitest";

function authToken(userId = 1, role = "admin"): string {
  return jwt.sign({ userId, role }, JWT_SECRET, { expiresIn: "1h" });
}

function bearer(token: string) {
  return `Bearer ${token}`;
}

// ══════════════════════════════════════════════════════════════════
// Health
// ══════════════════════════════════════════════════════════════════

describe("GET /api/health", () => {
  it("returns ok when database is reachable", async () => {
    (pool.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ rows: [{ "?column?": 1 }] });

    const res = await request(app).get("/api/health");
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("ok");
    expect(res.body).toHaveProperty("timestamp");
  });

  it("returns 503 when database is unreachable", async () => {
    (pool.query as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error("ECONNREFUSED"));

    const res = await request(app).get("/api/health");
    expect(res.status).toBe(503);
    expect(res.body.status).toBe("unhealthy");
  });
});

// ══════════════════════════════════════════════════════════════════
// Auth middleware
// ══════════════════════════════════════════════════════════════════

describe("Auth middleware", () => {
  it("rejects requests without token", async () => {
    const res = await request(app).get("/api/companies");
    expect(res.status).toBe(401);
    expect(res.body.error).toBe("No token provided");
  });

  it("rejects requests with invalid token", async () => {
    const res = await request(app)
      .get("/api/companies")
      .set("Authorization", "Bearer invalid-token");
    expect(res.status).toBe(401);
    expect(res.body.error).toBe("Invalid token");
  });

  it("accepts requests with valid token", async () => {
    (pool.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ rows: [] });

    const res = await request(app)
      .get("/api/companies")
      .set("Authorization", bearer(authToken()));
    expect(res.status).toBe(200);
  });
});

// ══════════════════════════════════════════════════════════════════
// Zod validation
// ══════════════════════════════════════════════════════════════════

describe("Zod validation middleware", () => {
  const token = authToken();

  it("rejects company creation with missing required fields", async () => {
    const res = await request(app)
      .post("/api/companies")
      .set("Authorization", bearer(token))
      .send({});

    expect(res.status).toBe(400);
    expect(res.body.error).toBe("Validation failed");
    expect(res.body.details).toBeInstanceOf(Array);
    expect(res.body.details.length).toBeGreaterThan(0);
  });

  it("rejects company with invalid company_type", async () => {
    const res = await request(app)
      .post("/api/companies")
      .set("Authorization", bearer(token))
      .send({ name: "Test Co", company_type: "invalid" });

    expect(res.status).toBe(400);
    expect(res.body.details.some((d: { path: string }) => d.path === "company_type")).toBe(true);
  });

  it("accepts valid company creation", async () => {
    (pool.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      rows: [{ id: 1, name: "ECIT AS", company_type: "acquirer", slug: "ecit-as" }],
    });

    const res = await request(app)
      .post("/api/companies")
      .set("Authorization", bearer(token))
      .send({ name: "ECIT AS", company_type: "acquirer" });

    expect(res.status).toBe(201);
    expect(res.body.name).toBe("ECIT AS");
  });

  it("rejects scenario with invalid deal parameters", async () => {
    // Mock scenario lookup (needed before calculate-returns processes)
    const res = await request(app)
      .post("/api/scenarios/1/calculate-returns")
      .set("Authorization", bearer(token))
      .send({
        deal_parameters: {
          tax_rate: 1.5, // invalid: > 1
          exit_multiples: [],
        },
      });

    expect(res.status).toBe(400);
  });

  it("rejects sensitivity with too many axis values", async () => {
    const res = await request(app)
      .post("/api/scenarios/1/sensitivity")
      .set("Authorization", bearer(token))
      .send({
        base_params: { tax_rate: 0.22, exit_multiples: [8] },
        row_axis: { param: "tax_rate", values: Array.from({ length: 31 }, (_, i) => i * 0.01) },
        col_axis: { param: "exit_multiples", values: [6, 8, 10] },
      });

    expect(res.status).toBe(400);
    expect(res.body.details.some((d: { path: string }) => d.path.includes("row_axis"))).toBe(true);
  });
});

// ══════════════════════════════════════════════════════════════════
// Companies CRUD flow
// ══════════════════════════════════════════════════════════════════

describe("Companies CRUD", () => {
  const token = authToken();

  beforeEach(() => {
    vi.mocked(pool.query).mockReset();
  });

  it("lists companies", async () => {
    vi.mocked(pool.query).mockResolvedValueOnce({
      rows: [
        { id: 1, name: "ECIT AS", company_type: "acquirer", model_count: "2" },
        { id: 2, name: "Target Co", company_type: "target", model_count: "1" },
      ],
    } as never);

    const res = await request(app)
      .get("/api/companies")
      .set("Authorization", bearer(token));

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(2);
    expect(res.body[0].name).toBe("ECIT AS");
  });

  it("gets company with models", async () => {
    vi.mocked(pool.query)
      .mockResolvedValueOnce({ rows: [{ id: 1, name: "ECIT AS" }] } as never)
      .mockResolvedValueOnce({ rows: [{ id: 10, name: "Base Case" }] } as never);

    const res = await request(app)
      .get("/api/companies/1")
      .set("Authorization", bearer(token));

    expect(res.status).toBe(200);
    expect(res.body.name).toBe("ECIT AS");
    expect(res.body.models).toHaveLength(1);
  });

  it("returns 404 for non-existent company", async () => {
    vi.mocked(pool.query).mockResolvedValueOnce({ rows: [] } as never);

    const res = await request(app)
      .get("/api/companies/999")
      .set("Authorization", bearer(token));

    expect(res.status).toBe(404);
  });

  it("updates a company", async () => {
    vi.mocked(pool.query).mockResolvedValueOnce({
      rows: [{ id: 1, name: "Updated Name", description: "Updated" }],
    } as never);

    const res = await request(app)
      .put("/api/companies/1")
      .set("Authorization", bearer(token))
      .send({ name: "Updated Name" });

    expect(res.status).toBe(200);
    expect(res.body.name).toBe("Updated Name");
  });

  it("deletes a company", async () => {
    vi.mocked(pool.query).mockResolvedValueOnce({ rows: [{ id: 1 }] } as never);

    const res = await request(app)
      .delete("/api/companies/1")
      .set("Authorization", bearer(token));

    expect(res.status).toBe(200);
    expect(res.body.message).toBe("Company deleted");
  });
});

// ══════════════════════════════════════════════════════════════════
// Models
// ══════════════════════════════════════════════════════════════════

describe("Models", () => {
  const token = authToken();

  beforeEach(() => {
    vi.mocked(pool.query).mockReset();
  });

  it("creates a model with valid data", async () => {
    vi.mocked(pool.query).mockResolvedValueOnce({
      rows: [{ id: 10, company_id: 1, name: "Base Case", model_type: "base" }],
    } as never);

    const res = await request(app)
      .post("/api/models")
      .set("Authorization", bearer(token))
      .send({ company_id: 1, name: "Base Case" });

    expect(res.status).toBe(201);
    expect(res.body.name).toBe("Base Case");
  });

  it("rejects model without company_id", async () => {
    const res = await request(app)
      .post("/api/models")
      .set("Authorization", bearer(token))
      .send({ name: "Test" });

    expect(res.status).toBe(400);
  });

  it("bulk upserts periods", async () => {
    // Mock model existence check
    vi.mocked(pool.query).mockResolvedValueOnce({ rows: [{ id: 10 }] } as never);

    // Mock pool.connect() for transaction
    const mockClient = {
      query: vi.fn().mockResolvedValue({ rows: [{ id: 1 }], rowCount: 1 }),
      release: vi.fn(),
    };
    vi.mocked(pool.connect).mockResolvedValueOnce(mockClient as never);

    const res = await request(app)
      .post("/api/models/10/periods")
      .set("Authorization", bearer(token))
      .send({
        periods: [
          { period_date: "2024-12-31", revenue_total: 100, ebitda_total: 20 },
          { period_date: "2025-12-31", revenue_total: 120, ebitda_total: 25 },
        ],
      });

    expect(res.status).toBe(201);
    expect(mockClient.release).toHaveBeenCalled();
  });

  it("rejects empty periods array", async () => {
    const res = await request(app)
      .post("/api/models/10/periods")
      .set("Authorization", bearer(token))
      .send({ periods: [] });

    expect(res.status).toBe(400);
  });
});

// ══════════════════════════════════════════════════════════════════
// Scenarios
// ══════════════════════════════════════════════════════════════════

describe("Scenarios", () => {
  const token = authToken();

  beforeEach(() => {
    vi.mocked(pool.query).mockReset();
  });

  it("creates a scenario", async () => {
    vi.mocked(pool.query).mockResolvedValueOnce({
      rows: [{
        id: 1,
        name: "Test Acquisition",
        acquirer_model_id: 10,
        status: "draft",
      }],
    } as never);

    const res = await request(app)
      .post("/api/scenarios")
      .set("Authorization", bearer(token))
      .send({ name: "Test Acquisition", acquirer_model_id: 10 });

    expect(res.status).toBe(201);
    expect(res.body.name).toBe("Test Acquisition");
  });

  it("rejects scenario without name", async () => {
    const res = await request(app)
      .post("/api/scenarios")
      .set("Authorization", bearer(token))
      .send({ acquirer_model_id: 10 });

    expect(res.status).toBe(400);
  });

  it("validates calculate-returns requires tax_rate and exit_multiples", async () => {
    const res = await request(app)
      .post("/api/scenarios/1/calculate-returns")
      .set("Authorization", bearer(token))
      .send({ deal_parameters: {} });

    expect(res.status).toBe(400);
    expect(res.body.details.some((d: { path: string }) => d.path.includes("tax_rate"))).toBe(true);
  });
});

// ══════════════════════════════════════════════════════════════════
// API docs
// ══════════════════════════════════════════════════════════════════

describe("API Documentation", () => {
  it("serves OpenAPI JSON spec", async () => {
    const res = await request(app).get("/api/docs/openapi.json");
    expect(res.status).toBe(200);
    expect(res.body.openapi).toBe("3.0.3");
    expect(res.body.info.title).toBe("ECIT Acquisition Analysis API");
    expect(res.body.paths).toHaveProperty("/api/health");
    expect(res.body.paths).toHaveProperty("/api/companies");
    expect(res.body.paths).toHaveProperty("/api/scenarios/{id}/calculate-returns");
  });

  it("serves Swagger UI HTML", async () => {
    const res = await request(app).get("/api/docs/").redirects(1);
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("text/html");
  });
});
