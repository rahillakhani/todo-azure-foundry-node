# Backend Documentation

## Overview

Express + WebSocket backend for an AI-powered Todo app. REST handles todo
creation and listing; WebSocket handles real-time summary and reminder
requests. Todos are stored in Postgres with a `pgvector` column for semantic
search, and parsing/embedding/summarization go through Azure OpenAI / Azure
AI Foundry via `mcpAgent`. A static frontend (`frontend/`) is served
separately and talks to this API over REST/WS.

```
Browser (frontend/) --REST POST/GET /todos--> server.js (transport)
Browser (frontend/) <--WS summary/reminders-- server.js (transport)
                                                   |
                                                   v
                                            todoService.js (orchestration)
                                             /                \
                                            v                  v
                                   mcpAgent.js          todoRepository.js
                                   (Azure OpenAI:              |
                                    chat + embeddings)          v
                                                              Postgres
```

### Layers

- **`server.js`** — HTTP/WebSocket transport only: parses requests,
  validates shape, calls `todoService`, and maps its errors to status
  codes. No SQL, no AI calls.
- **`services/todoService.js`** — orchestrates a request end to end
  (parse -> embed -> persist) and is the only place that decides how an
  agent failure differs from a database failure. Takes `agent` and
  `repository` as constructor arguments (dependency injection) rather than
  importing concrete implementations, so it can be unit-tested with plain
  fakes and swapped without touching `server.js`.
- **`repositories/todoRepository.js`** — the only module that knows the
  `todos` table's SQL. Takes a pg-compatible pool (duck-typed) the same way.
- **`mcpAgent.js` / `azureOpenAIClient.js`** — the only modules that know
  about Azure OpenAI.
- **`errors.js`** — `AgentError` / `RepositoryError`, so `server.js` can
  tell "the AI agent failed" (502) apart from "the database failed" (500)
  without string-matching error messages.

`server.js` wires the real `pool`/`mcpAgent` into `todoRepository`/
`todoService` once, at the top of the file (the composition root) — that's
the only place concrete implementations are chosen.

## Setup

1. `npm install`
2. Copy `.env.example` to `.env` and set `DATABASE_URL`, the four
   `AZURE_OPENAI_*` variables (endpoint, API key, chat deployment,
   embedding deployment — see Agent Logic below), and optionally `PORT`,
   `WS_PORT`, `EMBEDDING_DIM`, `FRONTEND_PORT`, `FRONTEND_ORIGIN`.
3. Ensure the target Postgres database has the `vector` extension available
   (`CREATE EXTENSION vector;` typically requires a superuser role), then
   apply the schema: `npm run db:migrate` (runs `scripts/db/schema.sql`).
4. `npm start` (or `npm run dev` to auto-restart on changes) for the API.
5. `npm run serve:frontend` to serve the static UI, then open
   `http://localhost:<FRONTEND_PORT>` (default `5500`).

## API Reference

### `POST /todos`

Request body: `{ "text": string, "userId": string, "due_date"?: string, "priority"?: boolean }`

`text` may describe more than one todo — `mcpAgent.parseTodos` sends it to
Azure OpenAI, which splits it into a list when it looks like one (one todo
per line, list entry, or clause; see Agent Logic below) and a row is
inserted per item. A plain sentence stays as a single todo. `due_date` and
`priority` are optional; when supplied by the client they're applied to
**every** item in the batch (there's one reminder/priority input per
submission, not one per item) and override whatever the model inferred.

- `400` if `text` or `userId` is missing/blank, `due_date` isn't a valid
  date string, or `priority` isn't a boolean.
- `200` with `{ "status": "ok", "todos": Todo[], "count": number }` on
  success — `todos` has one entry per item parsed from `text`.
- `502` if Azure OpenAI is unreachable/misconfigured or returns a response
  this backend can't parse (an `AgentError` — see Layers above).
- `500` if any database write fails (a `RepositoryError`). Inserts happen
  sequentially and are **not** wrapped in a transaction, so a failure
  partway through a batch can leave earlier items committed — see Known
  Gaps.

### `GET /todos?userId=<userId>`

- `400` if `userId` is missing/blank.
- `200` with `{ "status": "ok", "todos": Todo[] }`, newest first, on success.
  `status` is `"pending"` or `"done"`. The frontend splits these into three
  lanes: Active (`status="pending"`, no `due_date`), Snoozed
  (`status="pending"`, `due_date` set — yellow border), and Completed
  (`status="done"` — greyed out, struck through).
- `500` if the database read fails.

### `GET /todos/search?userId=<userId>&q=<text>&limit=<n>?`

Semantic search: embeds `q` the same way a todo's description is embedded
on creation, then orders this user's todos by pgvector cosine distance
(`<=>`) to that embedding — closest first. Matches on meaning, not just
shared words (e.g. a search for "groceries" can match "Buy milk and eggs").
`limit` is optional (default `10`, max `50`).

- `400` if `userId`/`q` is missing/blank, or `limit` isn't a positive
  integer up to 50.
- `200` with `{ "status": "ok", "todos": Todo[] }`, closest match first.
  Each row includes a `distance` field (lower = more similar); it's not
  normalized to a 0-1 "percent match" — treat it as ordering only.
- `502` if Azure OpenAI is unreachable/misconfigured while embedding `q`.
- `500` if the database query fails.

### `POST /todos/:id/complete`

Request body: `{ "userId": string }`. Sets `status` to `"done"`, scoped to
`(id, userId)` — a user can't touch another user's todo, and the two
errors ("wrong id" and "wrong owner") aren't distinguished in the response.

- `400` if `id` isn't a positive integer, or `userId` is missing/blank.
- `200` with `{ "status": "ok", "todo": Todo }` on success.
- `404` if no todo with that id belongs to that user (`NotFoundError`).
- `500` if the database update fails.

### `POST /todos/:id/undo`

Same request/response shape as `complete`, but resets the todo fully back
to its pristine active state: `status` -> `"pending"` **and** `due_date` ->
`null`, in one update. This is deliberate — undoing a todo that happened to
have a due date before completion should land it back in the Active lane,
not the Snoozed lane (see Overview above).

### `POST /todos/:id/snooze`

Request body: `{ "userId": string, "minutes"?: number }`. Sets `due_date`
to `now + minutes` (default `60`) — always relative to *now*, not the
todo's previous due date (matching how snoozing an alarm/notification
usually works).

- `400` if `id` isn't a positive integer, `userId` is missing/blank, or
  `minutes` is provided and isn't a positive number.
- `200` with `{ "status": "ok", "todo": Todo }` on success.
- `404` if no todo with that id belongs to that user.
- `500` if the database update fails.

### `POST /todos/:id/unsnooze`

Request body: `{ "userId": string }`. Clears `due_date` back to `null`
without touching `status`, moving the todo back to the Active lane. Same
validation/response/error shape as `complete`/`undo`.

### WebSocket (port `WS_PORT`, default `8080`)

Send a JSON message; receive a JSON response.

- `{ "type": "getSummary", "userId": string }` -> `{ "type": "summary", "data": string }`.
  Throttled to once an hour per user — see `todoService.getSummary` below.
- `{ "type": "getReminders", "userId": string }` -> `{ "type": "reminders", "data": Todo[] }`
- Invalid JSON, missing `userId`, or an unknown `type` returns
  `{ "type": "error", "message": string }`.

### CORS

The API sends permissive CORS headers (`Access-Control-Allow-Origin`,
configurable via `FRONTEND_ORIGIN`, default `*`) so the frontend — served
from a different port — can call REST endpoints from the browser.
WebSocket connections are not subject to CORS.

## Agent Logic (`mcpAgent.js`, `azureOpenAIClient.js`)

`parseTodos` and `embed` call Azure OpenAI / Azure AI Foundry
through the standard `openai` npm package's `OpenAI` client, pointed at the
resource's GA `v1` endpoint (`<endpoint>/openai/v1/`) with API-key auth —
this is the current officially documented approach (no `@azure/openai` or
`@azure/identity` needed for key-based auth); see
[openai-node's Azure docs](https://github.com/openai/openai-node/blob/master/docs/azure.md).
`azureOpenAIClient.js` lazily constructs and caches this client from
`AZURE_OPENAI_ENDPOINT` / `AZURE_OPENAI_API_KEY`.

- `parseTodos` sends the input to the chat deployment
  (`AZURE_OPENAI_CHAT_DEPLOYMENT`) with a system prompt instructing it to
  extract every distinct todo (description, due_date, priority) as JSON
  (`response_format: { type: "json_object" }`, `temperature: 0`), grounded
  with the current date/time so relative dates ("tomorrow") resolve
  correctly. The response is validated — a missing/unparseable/malformed
  response throws rather than silently returning something wrong.
- `embed` calls the embedding deployment (`AZURE_OPENAI_EMBEDDING_DEPLOYMENT`)
  and returns the returned vector. If `EMBEDDING_DIM` is set, it's passed as
  the API's `dimensions` truncation param (only supported by
  `text-embedding-3-*` models) — use it if your model's default output size
  doesn't match the `todos.embedding` pgvector column. Every todo's
  embedding is stored at creation time and used by `GET /todos/search` (see
  API Reference above) — it's not just stored for later, something now
  actually queries it.
- **All required env vars are validated eagerly with actionable error
  messages** (e.g. "set AZURE_OPENAI_CHAT_DEPLOYMENT") rather than failing
  silently or falling back to fake data — see `mcpAgentUnconfigured.test.js`.
- `summarizeDay` is unchanged: a deterministic (non-AI) local computation
  over already-fetched rows, fully covered by tests.
- `todoService.getSummary` wraps `summarizeDay` in a per-user, **1-hour**
  in-memory cache (a `Map` in the service's closure — resets on process
  restart, not shared across multiple server instances). Repeated
  `getSummary` calls for the same user within that hour — WS reconnects,
  the frontend's manual Refresh button, its hourly auto-refresh timer —
  return the cached string instead of recomputing. The cache is
  **time-based only**: completing/snoozing/creating a todo does not
  invalidate it, so the summary can lag up to an hour behind actual todo
  state. That's the intended trade-off per the "summary should work once
  an hour" requirement, not a bug.

## Testing

`npm test` runs Jest against `backend/tests/`. Each layer is tested at its
own boundary: `todoRepository`/`todoService` take plain fake objects
(constructor injection needs no mocking framework), while `server.test.js`/
`e2e.test.js` mock the lowest-level modules (`db.js`, `mcpAgent.js`) via
`jest.unstable_mockModule` and exercise the real repository/service code
above them. No live database, Azure OpenAI resource, or network access is
required to run the suite.

- `todoRepository.test.js` — unit tests against a fake pool: correct SQL/
  params for insert/list/reminders/complete/undo/snooze/unsnooze/search,
  that `searchByUser`'s query casts the query vector (`::vector`) and
  orders by distance, that pool failures are wrapped as `RepositoryError`,
  that an update matching no row returns `null` (not an error), and that
  every read/RETURNING query excludes the `embedding` column.
- `todoService.test.js` — unit tests against fake `agent`/`repository`
  objects: multi-item persistence, due_date/priority override application,
  that `parseTodos`/`embed` failures become `AgentError` (and never reach
  the repository), that repository failures pass through unwrapped,
  partial-batch-failure stops after the failing item, complete/undo/snooze/unsnooze
  raising `NotFoundError` on a `null` repository result, snooze's default-
  vs-custom minutes math, the summary cache's 1-hour throttle/expiry/
  per-user isolation (via `jest.useFakeTimers()`), and `searchTodos`
  embedding the query before delegating to the repository.
- `mcpAgent.test.js` — unit tests for parsing (single and multi-item),
  embedding, and summarization against a mocked Azure OpenAI client,
  including malformed-model-response and invalid-input rejection.
- `mcpAgentUnconfigured.test.js` — confirms `parseTodos`/`embed` throw a
  clear, actionable error (naming the missing env var) when
  `AZURE_OPENAI_CHAT_DEPLOYMENT`/`AZURE_OPENAI_EMBEDDING_DEPLOYMENT` aren't
  set, instead of silently doing nothing.
- `server.test.js` — REST endpoint behavior: success paths, validation
  (400s), agent failure (502) vs. database failure (500) vs. not-found
  (404), the optional `due_date`/`priority` fields, multi-item batches,
  the complete/undo/snooze/unsnooze routes, and search (default/custom
  `limit`, its bounds, embed failure -> 502). Mocks `mcpAgent.parseTodos`/
  `embed` directly, so it doesn't re-test Azure OpenAI wiring or the
  repository/service internals — those are
  `mcpAgent.test.js`/`todoService.test.js`/`todoRepository.test.js`'s job.
- `e2e.test.js` — protocol-level end-to-end tests: adds a todo over REST,
  lists it back, then requests reminders and a summary over a real
  WebSocket connection; a second test drives complete -> undo -> snooze ->
  404 over real HTTP (Postgres and `mcpAgent` are mocked, but the HTTP/WS
  wire is real).

## Known Gaps

- No DELETE endpoint (removing a todo entirely).
- `parseTodos`' list-splitting relies entirely on the model's judgment —
  it can't be unit-tested end-to-end without live Azure credentials
  (`mcpAgent.test.js` verifies the request/response wiring against a
  mocked client, not the model's actual splitting behavior).
- No retry/backoff around Azure OpenAI calls — a transient network error
  or rate limit surfaces immediately as a `502`.
- Multi-item `POST /todos` inserts are sequential, not transactional — a
  failure partway through a batch leaves earlier items committed rather
  than rolling back the whole request.
- No cap on how many todos a single request can create from one input, or
  on `text` length before it's sent to the model.
- The summary cache is a plain in-memory `Map` inside one process: it's
  lost on restart and isn't shared if the backend ever runs as more than
  one instance (e.g. behind a load balancer) — each instance would cache
  (and could serve) a different hourly summary.
- The Snoozed lane is inferred client-side purely from "`due_date` is set
  and `status` isn't done" — there's no dedicated `snoozed` flag. A todo
  created with a due date up front lands in Snoozed too, identically to
  one that got there via the Snooze button; the two aren't distinguished.
- `searchByUser` does a plain sequential scan with exact cosine distance —
  no `ivfflat`/`hnsw` index on `embedding`. Fine at this app's scale (a
  personal todo list per user); would need an index (and accepting
  approximate-nearest-neighbor results) if a user's todo count ever got
  large enough for that to matter.
- Search's `distance` is pgvector's raw cosine distance, not normalized —
  there's no "percent match" score, and the frontend doesn't attempt to
  show one.
- `e2e.test.js` is protocol-level (mocked Postgres/mcpAgent) rather than a
  real browser test — no browser automation tooling (e.g. Playwright) is
  set up in this project yet.
- The frontend has no automated tests.

## Deployment

Not yet defined; add Docker/hosting instructions here when a target
environment is chosen.
