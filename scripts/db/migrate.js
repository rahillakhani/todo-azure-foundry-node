import "dotenv/config";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pool from "../../backend/db.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function migrate() {
  const schemaPath = path.join(__dirname, "schema.sql");
  const schema = await readFile(schemaPath, "utf8");

  await pool.query(schema);
  console.log("Schema applied successfully.");
  await pool.end();
}

migrate().catch((err) => {
  console.error("Migration failed:", err);
  process.exitCode = 1;
});
