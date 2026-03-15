import app from "./app.js";
import pool from "./models/db.js";

const PORT = process.env.PORT || 3001;

const server = app.listen(PORT, () => {
  console.log(`ECIT Acquisition API running on port ${PORT}`);
});

// Graceful shutdown
function shutdown(signal: string) {
  console.log(`\n${signal} received. Shutting down gracefully...`);
  server.close(() => {
    console.log("HTTP server closed.");
    pool.end().then(() => {
      console.log("Database pool closed.");
      process.exit(0);
    });
  });

  // Force exit after 10s if graceful shutdown hangs
  setTimeout(() => {
    console.error("Forced shutdown after timeout.");
    process.exit(1);
  }, 10_000);
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

export default app;
