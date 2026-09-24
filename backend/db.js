import "dotenv/config";
import pg from "pg";

const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  console.warn(
    "DATABASE_URL is not set; database queries will fail until it is configured (see .env.example)."
  );
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

pool.on("error", (err) => {
  console.error("Unexpected Postgres pool error", err);
});

export default pool;
