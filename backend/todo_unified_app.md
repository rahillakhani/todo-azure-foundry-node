# 🚀 AI‑Agent Todo App (Backend + Frontend)

## 📌 Overview
Build a full stack Todo app powered by an AI agent. The app should allow users to enter todos in natural language, optionally add date/time reminders, mark tasks as high priority, and view summaries and reminders. The backend will parse and store todos using MCP + Postgres vector DB. The frontend will be a static UI that interacts with the backend via REST and WebSocket.

---

## 🛠️ Backend Requirements
- Node.js + Express server.
- REST API for adding todos.
- WebSocket server for real‑time summaries and reminders.
- Postgres with pgvector extension for semantic storage.
- MCP agent integration for parsing natural language, embeddings, and summarization.
- API endpoints:
  - POST /todos → add todo.
  - GET /todos → list todos.
  - WebSocket events: `getSummary`, `getReminders`.

### Backend Code Files
- server.js → Express + WebSocket server.
- mcpAgent.js → MCP integration (parseTodo, embed, summarizeDay).
- db.js → Postgres connection.
- tests/ → Jest + Supertest tests.

---

## 🎨 Frontend Requirements
- Static HTML + CSS + JS served via simple static server.
- Input box for todo text.
- Date/time picker for reminders.
- Checkbox for high priority.
- Button to submit todo.
- Section to display todos.
- Section to display daily summary.
- Section to display reminders.
- REST call to backend for adding todos.
- WebSocket connection for summaries and reminders.

### Frontend Code Files
- index.html → UI layout.
- style.css → styling.
- app.js → REST + WebSocket client logic.

---

## 🧪 Testing Strategy
- Unit tests for MCP parsing and summarization.
- Integration tests for API endpoints.
- End‑to‑end tests simulating user adding todos and receiving reminders.

---

## 📘 Best Practices
- Validate input before storing.
- Use parameterized queries for DB security.
- Add reconnect logic for WebSocket.
- Logging and monitoring for observability.
- Keep UI minimal and responsive.

---

## 📄 Documentation Outline
- Overview: Architecture diagram + flow.
- Setup: Installation, DB config, environment variables.
- API Reference: REST endpoints + WebSocket events.
- Agent Logic: MCP handlers explained.
- Testing Guide: Unit, integration, E2E.
- Deployment: Docker + hosting instructions.
