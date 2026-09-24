# todo-azure-foundry-node

AI-agent Todo app: an Express + WebSocket backend backed by Postgres/pgvector
and Azure OpenAI / Azure AI Foundry (natural-language parsing + embeddings),
plus a static HTML/CSS/JS frontend.

```
frontend/ (static UI)  <-- REST + WebSocket -->  backend/ (Express + WS + Postgres)
```

## Quick start

1. `npm install`
2. Copy `.env.example` to `.env` and set `DATABASE_URL` plus the four
   `AZURE_OPENAI_*` variables (see
   [backend/docs/README.md](backend/docs/README.md) for full setup,
   including the Postgres `vector` extension and schema migration).
3. `npm start` — backend API on `PORT` (default `3000`) and WebSocket on
   `WS_PORT` (default `8080`).
4. `npm run serve:frontend` — static UI on `FRONTEND_PORT` (default
   `5500`). Open `http://localhost:5500`.
5. `npm test` — Jest unit, integration, and protocol-level E2E tests
   (no live database required).

## Project layout

- `backend/` — Express + WebSocket server, Postgres access, MCP agent,
  tests. See [backend/docs/README.md](backend/docs/README.md) for the full
  API reference, agent logic, testing guide, and known gaps.
- `frontend/` — static `index.html` / `style.css` / `app.js`, served by
  `frontend/server.js`.
- `scripts/db/` — `schema.sql` and `migrate.js` for provisioning the
  `todos` table.
