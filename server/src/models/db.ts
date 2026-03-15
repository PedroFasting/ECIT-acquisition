import pg from "pg";

const isProduction = process.env.NODE_ENV === "production";

if (isProduction && !process.env.DATABASE_URL) {
  console.error("FATAL: DATABASE_URL environment variable is not set in production. Exiting.");
  process.exit(1);
}

const pool = new pg.Pool({
  connectionString:
    process.env.DATABASE_URL ||
    "postgresql://ecit:ecit_dev_2026@localhost:5433/ecit_acquisition",
  max: parseInt(process.env.DB_POOL_MAX || "20", 10),
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
  ...(isProduction && {
    ssl: { rejectUnauthorized: process.env.DB_SSL_REJECT_UNAUTHORIZED !== "false" },
  }),
});

pool.on("error", (err) => {
  console.error("Unexpected error on idle client", err);
  // Don't crash the process — let the request that triggered it fail gracefully.
  // The pool will automatically replace the dead connection.
});

export default pool;
