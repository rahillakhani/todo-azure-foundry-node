import "dotenv/config";
import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const app = express();
app.use(express.static(__dirname));

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  const port = process.env.FRONTEND_PORT || 5500;
  app.listen(port, () => console.log(`Frontend static server listening on ${port}`));
}
