# 🚀 AI‑Agent Todo App Backend Scaffold

## 📌 Overview
Build a backend service for an AI‑powered Todo app using:
- Node.js + Express
- WebSocket for real‑time reminders
- Postgres + pgvector for semantic todo storage
- MCP Agent for parsing, summarization, and embeddings
- MS Foundry for orchestration

---

## 🛠️ Setup Instructions
1. Clone repo scaffold
   ```bash
   git clone <your-repo>
   cd todo-backend
   npm init -y
   npm install express ws pg dotenv
Enable pgvector in Postgres:

sql
CREATE EXTENSION IF NOT EXISTS vector;
Environment variables (.env)

env
DATABASE_URL=postgres://user:password@localhost:5432/todo
PORT=3000
📂 Project Structure
Code
todo-backend/
├── server.js          # Express + WebSocket server
├── mcpAgent.js        # MCP integration (parse, embed, summarize)
├── db.js              # Postgres connection
├── tests/             # Jest tests
├── docs/              # Documentation
└── .env
⚙️ Backend Code
server.js
js
import express from "express";
import { WebSocketServer } from "ws";
import pool from "./db.js";
import { mcpAgent } from "./mcpAgent.js";

const app = express();
app.use(express.json());

// REST endpoint: add todo
app.post("/todos", async (req, res) => {
  const { text, userId } = req.body;
  const todo = await mcpAgent.parseTodo(text);
  const embedding = await mcpAgent.embed(todo.description);

  await pool.query(
    "INSERT INTO todos (user_id, description, due_date, priority, embedding) VALUES ($1,$2,$3,$4,$5)",
    [userId, todo.description, todo.due_date, todo.priority, embedding]
  );

  res.json({ status: "ok", todo });
});

// WebSocket server
const wss = new WebSocketServer({ port: 8080 });
wss.on("connection", (ws) => {
  ws.on("message", async (message) => {
    const { type, userId } = JSON.parse(message);

    if (type === "getSummary") {
      const todos = await pool.query("SELECT * FROM todos WHERE user_id=$1", [userId]);
      const summary = await mcpAgent.summarizeDay(todos.rows);
      ws.send(JSON.stringify({ type: "summary", data: summary }));
    }

    if (type === "getReminders") {
      const reminders = await pool.query(
        "SELECT * FROM todos WHERE user_id=$1 AND due_date > NOW()",
        [userId]
      );
      ws.send(JSON.stringify({ type: "reminders", data: reminders.rows }));
    }
  });
});

app.listen(process.env.PORT, () => console.log(`Server running on ${process.env.PORT}`));
mcpAgent.js
js
export const mcpAgent = {
  async parseTodo(text) {
    // Call Foundry MCP agent to parse natural language
    return {
      description: "Doctor appointment",
      due_date: "2026-09-23T18:00:00",
      priority: false
    };
  },

  async embed(text) {
    // Call embedding model
    return Array(1536).fill(0.01); // placeholder vector
  },

  async summarizeDay(todos) {
    const completed = todos.filter(t => t.status === "done").length;
    const pending = todos.filter(t => t.status === "pending");
    return `You completed ${completed} tasks. Pending: ${pending.map(p => p.description).join(", ")}`;
  }
};
🧪 Testing (Jest)
bash
npm install --save-dev jest supertest
Example test:

js
import request from "supertest";
import app from "../server.js";

test("Add todo", async () => {
  const res = await request(app).post("/todos").send({ text: "Meeting tomorrow", userId: "rahil" });
  expect(res.body.status).toBe("ok");
  expect(res.body.todo.description).toBeDefined();
});
📘 Best Practices
Validation: Ensure todos have valid dates before storing.

Security: Use parameterized queries to prevent SQL injection.

Scalability: Use connection pooling.

Observability: Add logging + monitoring.

📄 Documentation Outline
Overview: Architecture diagram + flow.

Setup: Installation, DB config, environment variables.

API Reference: REST endpoints + WebSocket events.

Agent Logic: MCP handlers explained.

Testing Guide: Unit, integration, E2E.

Deployment: Docker + hosting instructions.