import { describe, it, expect, vi } from "vitest";
import jwt from "jsonwebtoken";
import { authMiddleware, generateToken } from "../auth.js";
import type { Response, NextFunction } from "express";
import type { AuthRequest } from "../auth.js";

const JWT_SECRET = process.env.JWT_SECRET!;

// Helper to create mock req/res/next
function createMocks(headers: Record<string, string> = {}) {
  const req = { headers } as unknown as AuthRequest;
  const res = {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
  } as unknown as Response;
  const next = vi.fn() as NextFunction;
  return { req, res, next };
}

// ─── generateToken ─────────────────────────────────────────────────────────

describe("generateToken", () => {
  it("generates a valid JWT with userId and role", () => {
    const token = generateToken(42, "admin");
    const decoded = jwt.verify(token, JWT_SECRET) as { userId: number; role: string };
    expect(decoded.userId).toBe(42);
    expect(decoded.role).toBe("admin");
  });

  it("generates a token that expires in 7 days", () => {
    const token = generateToken(1, "analyst");
    const decoded = jwt.decode(token) as { exp: number; iat: number };
    const diff = decoded.exp - decoded.iat;
    expect(diff).toBe(7 * 24 * 60 * 60); // 7 days in seconds
  });

  it("generates different tokens for different users", () => {
    const token1 = generateToken(1, "admin");
    const token2 = generateToken(2, "analyst");
    expect(token1).not.toBe(token2);
  });
});

// ─── authMiddleware ────────────────────────────────────────────────────────

describe("authMiddleware", () => {
  it("rejects request with no authorization header", () => {
    const { req, res, next } = createMocks();
    authMiddleware(req, res, next);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ error: "No token provided" });
    expect(next).not.toHaveBeenCalled();
  });

  it("rejects request with invalid token", () => {
    const { req, res, next } = createMocks({
      authorization: "Bearer invalid.token.here",
    });
    authMiddleware(req, res, next);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ error: "Invalid token" });
    expect(next).not.toHaveBeenCalled();
  });

  it("rejects expired token", () => {
    const token = jwt.sign({ userId: 1, role: "admin" }, JWT_SECRET, {
      expiresIn: "-1s",
    });
    const { req, res, next } = createMocks({
      authorization: `Bearer ${token}`,
    });
    authMiddleware(req, res, next);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it("accepts valid token and sets userId/userRole", () => {
    const token = generateToken(99, "analyst");
    const { req, res, next } = createMocks({
      authorization: `Bearer ${token}`,
    });
    authMiddleware(req, res, next);
    expect(next).toHaveBeenCalled();
    expect(req.userId).toBe(99);
    expect(req.userRole).toBe("analyst");
  });

  it("strips 'Bearer ' prefix correctly", () => {
    const token = generateToken(5, "viewer");
    const { req, res, next } = createMocks({
      authorization: `Bearer ${token}`,
    });
    authMiddleware(req, res, next);
    expect(next).toHaveBeenCalled();
    expect(req.userId).toBe(5);
  });

  it("rejects token signed with wrong secret", () => {
    const token = jwt.sign({ userId: 1, role: "admin" }, "wrong-secret", {
      expiresIn: "1h",
    });
    const { req, res, next } = createMocks({
      authorization: `Bearer ${token}`,
    });
    authMiddleware(req, res, next);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });
});
