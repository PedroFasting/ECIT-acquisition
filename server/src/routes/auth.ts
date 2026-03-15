import { Router, Request, Response } from "express";
import bcrypt from "bcryptjs";
import pool from "../models/db.js";
import { generateToken, authMiddleware, AuthRequest } from "../middleware/auth.js";
import { validate } from "../middleware/validate.js";
import { LoginSchema, RegisterSchema } from "../schemas.js";

const router = Router();

// Login
router.post("/login", validate(LoginSchema), async (req: Request, res: Response): Promise<void> => {
  try {
    const { email, password } = req.body;

    const result = await pool.query(
      "SELECT id, email, name, role, password_hash FROM users WHERE email = $1",
      [email]
    );
    if (result.rows.length === 0) {
      res.status(401).json({ error: "Invalid credentials" });
      return;
    }

    const user = result.rows[0];

    // First-login: placeholder hash must be replaced with a real password.
    // The user must supply a password of at least 8 characters to set it.
    if (user.password_hash.includes("placeholder")) {
      if (password.length < 8) {
        res.status(400).json({ error: "Password must be at least 8 characters on first login" });
        return;
      }
      const hash = await bcrypt.hash(password, 10);
      await pool.query("UPDATE users SET password_hash = $1 WHERE id = $2", [
        hash,
        user.id,
      ]);
      const token = generateToken(user.id, user.role);
      res.json({ token, user: { id: user.id, email: user.email, name: user.name, role: user.role } });
      return;
    }

    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) {
      res.status(401).json({ error: "Invalid credentials" });
      return;
    }

    const token = generateToken(user.id, user.role);
    res.json({ token, user: { id: user.id, email: user.email, name: user.name, role: user.role } });
  } catch (err) {
    console.error("Login error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Register — admin only
router.post("/register", authMiddleware, validate(RegisterSchema), async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    if (req.userRole !== "admin") {
      res.status(403).json({ error: "Only admins can register new users" });
      return;
    }

    const { email, password, name, role } = req.body;
    const userRole = role;

    const hash = await bcrypt.hash(password, 10);

    const result = await pool.query(
      "INSERT INTO users (email, password_hash, name, role) VALUES ($1, $2, $3, $4) RETURNING id, email, name, role",
      [email, hash, name, userRole]
    );

    const user = result.rows[0];
    res.status(201).json({ user });
  } catch (err: unknown) {
    const pgErr = err as { code?: string };
    if (pgErr.code === "23505") {
      res.status(409).json({ error: "Email already registered" });
      return;
    }
    console.error("Register error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
