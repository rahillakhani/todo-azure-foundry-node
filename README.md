# todo-azure-foundry-node

An AI-agent Todo app. You type a todo in plain English — including pasting
a whole list at once — and Azure OpenAI figures out how many distinct
tasks that is, extracts a due date and priority for each, and stores them
with a semantic embedding so you can later search by meaning ("groceries")
instead of exact words ("buy milk and eggs"). A WebSocket connection
pushes reminders and a daily summary to the UI in real time.

## What it does

- **Add a todo in natural language.** `"Doctor appointment tomorrow at 3pm, it's urgent"`
  becomes one structured row with `due_date`/`priority` inferred. Paste a
  longer block — a list, one item per line, semicolon-separated — and the
  model splits it into multiple todos in one request.
- **Manage todos** with Complete / Undo / Snooze / Unsnooze actions. The UI
  groups them into **Active**, **Snoozed**, and **Completed** lanes.
- **Search by meaning**, not keywords — powered by vector similarity over
  each todo's embedding (see [How it talks to the model](#how-it-talks-to-the-model)).
- **Real-time reminders and a daily summary** over WebSocket, with the
  summary throttled to recompute at most once an hour per user.

## Architecture

```
                         ┌───────────────────────────┐
                         │   frontend/ (static UI)    │
                         │  index.html / style.css /  │
                         │        app.js              │
                         └─────────────┬───────────────┘
                                       │ REST (fetch) + WebSocket
                                       ▼
                         ┌───────────────────────────┐
                         │   backend/server.js        │   HTTP + WS transport only:
                         │   (Express + ws)           │   validates requests, maps
                         └─────────────┬───────────────┘   errors to status codes
                                       │
                                       ▼
                         ┌───────────────────────────┐
                         │  services/todoService.js   │   orchestrates a request
                         │  (business logic)          │   end to end; the only place
                         └──────┬───────────────┬──────┘   that knows agent vs. DB
                                │               │           failures differ
                     ┌──────────▼──────┐   ┌────▼─────────────────┐
                     │  mcpAgent.js /   │   │ repositories/         │
                     │  azureOpenAI     │   │ todoRepository.js     │
                     │  Client.js       │   │ (all SQL lives here)  │
                     └──────────┬──────┘   └────┬─────────────────┘
                                │               │
                                ▼               ▼
                      Azure OpenAI /       Postgres + pgvector
                      Azure AI Foundry     (todos table, embedding column)
                      (chat + embeddings)
```

The backend is layered by responsibility, wired together once at the top
of `server.js` (the *composition root*):

- **`server.js`** — Express routes + WebSocket handlers. Only concern:
  HTTP/WS I/O and turning `AgentError` / `RepositoryError` / `NotFoundError`
  into the right status code (502 / 500 / 404).
- **`services/todoService.js`** — the actual business logic: "parse this
  text into todos," "embed and persist each one," "search by similarity,"
  "cache the summary for an hour." Depends on an `agent` and a `repository`
  passed into it (dependency injection), not on concrete Azure/Postgres
  code — so it's unit-tested with plain fake objects, no mocking framework.
- **`repositories/todoRepository.js`** — the only module that writes SQL.
  Everything else goes through it.
- **`mcpAgent.js` / `azureOpenAIClient.js`** — the only modules that know
  about Azure OpenAI's API shape.
- **`errors.js`** — typed errors (`AgentError`, `RepositoryError`,
  `NotFoundError`) so failures are distinguishable without string-matching
  messages.

Full API reference, per-file breakdown, and the test strategy live in
**[backend/docs/README.md](backend/docs/README.md)**.

## How it talks to the model

The app calls Azure OpenAI (via the `openai` npm package, pointed at your
Azure resource's OpenAI-compatible endpoint) in exactly two places,
both inside `backend/mcpAgent.js`:

1. **Parsing (`parseTodos`)** — a chat-completions call with a system
   prompt that asks the model to extract every distinct todo from the
   input as JSON (`response_format: { type: "json_object" }`), grounded
   with the current date/time so relative phrases like "tomorrow" resolve
   correctly. The response is validated — a malformed or empty result
   throws rather than silently storing garbage.
2. **Embeddings (`embed`)** — every todo's description is embedded once at
   creation time and stored in the `embedding` column (`pgvector`). A
   search query is embedded the same way, and Postgres orders results by
   cosine distance (`<=>`) between the two vectors — that's what makes
   "groceries" match "buy milk and eggs" with zero words in common.

Both calls fail closed: if `AZURE_OPENAI_CHAT_DEPLOYMENT` or
`AZURE_OPENAI_EMBEDDING_DEPLOYMENT` isn't configured, the relevant call
throws a clear, actionable error immediately instead of pretending to
work with fake data.

## Tech stack

| Layer | Choice |
|---|---|
| Backend runtime | Node.js (ESM), Express 5 |
| Real-time | `ws` (raw WebSocket server) |
| Database | Postgres + [pgvector](https://github.com/pgvector/pgvector) extension |
| AI | Azure OpenAI / Azure AI Foundry, via the `openai` npm SDK |
| Frontend | Static HTML/CSS/vanilla JS — no framework, no build step |
| Tests | Jest (`node --experimental-vm-modules`) + Supertest |

## Getting started

1. **Install dependencies**
   ```bash
   npm install
   ```
2. **Configure environment** — copy `.env.example` to `.env` and fill in:
   - `DATABASE_URL` — your Postgres connection string.
   - `AZURE_OPENAI_ENDPOINT`, `AZURE_OPENAI_API_KEY`,
     `AZURE_OPENAI_CHAT_DEPLOYMENT`, `AZURE_OPENAI_EMBEDDING_DEPLOYMENT` —
     from your Azure OpenAI / Azure AI Foundry resource. The chat and
     embedding deployments are two separate model deployments (e.g.
     `gpt-4.1-mini` and `text-embedding-3-small`) — not the same one twice.
   - Everything else (`PORT`, `WS_PORT`, `FRONTEND_PORT`, `FRONTEND_ORIGIN`,
     `EMBEDDING_DIM`) has a sensible default; only change it if you need to.
3. **Provision the database** — your Postgres instance needs the `vector`
   extension available (`CREATE EXTENSION vector;`, typically requires a
   superuser role once per database), then:
   ```bash
   npm run db:migrate
   ```
4. **Run the backend**
   ```bash
   npm start          # or: npm run dev (auto-restarts on backend/server.js changes)
   ```
   REST API on `PORT` (default `3000`), WebSocket on `WS_PORT` (default `8080`).
5. **Run the frontend**
   ```bash
   npm run serve:frontend
   ```
   Open `http://localhost:5500` (default `FRONTEND_PORT`).
6. **Run the tests**
   ```bash
   npm test
   ```
   No live database or Azure credentials needed — Postgres and Azure
   OpenAI are mocked at the lowest layer (`db.js`, `mcpAgent.js`); the real
   repository/service/route code runs against those mocks.

## Project layout

```
backend/
  server.js                    Express + WebSocket routes (transport layer)
  services/todoService.js      business logic (parse, embed, persist, search, cache)
  repositories/todoRepository.js   all SQL
  mcpAgent.js                  Azure OpenAI calls (chat parsing + embeddings)
  azureOpenAIClient.js         Azure OpenAI client construction
  db.js                        Postgres connection pool
  errors.js                    AgentError / RepositoryError / NotFoundError
  tests/                       Jest unit + protocol-level E2E tests
  docs/README.md               full API reference, testing guide, known gaps
frontend/
  index.html / style.css / app.js   static UI, no build step
  server.js                    static file server
scripts/db/
  schema.sql                   todos table + pgvector extension
  migrate.js                   applies schema.sql to DATABASE_URL
```

For the full API reference (every endpoint, request/response shapes,
status codes), the testing strategy, and known gaps/trade-offs, see
**[backend/docs/README.md](backend/docs/README.md)**.
