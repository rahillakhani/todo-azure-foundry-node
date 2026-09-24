import express from "express";
import { WebSocketServer } from "ws";
import pool from "./db.js";
import { mcpAgent } from "./mcpAgent.js";
import { createTodoRepository } from "./repositories/todoRepository.js";
import { createTodoService } from "./services/todoService.js";
import { AgentError, RepositoryError, NotFoundError } from "./errors.js";

// Composition root: the only place concrete db/agent implementations are
// wired together. Everything below depends on `todoService`, not on
// `pool`/`mcpAgent` directly.
const todoRepository = createTodoRepository(pool);
const todoService = createTodoService({ agent: mcpAgent, repository: todoRepository });

export const app = express();
app.use(express.json());

// Allows the static frontend (served from a different port) to call this API.
app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", process.env.FRONTEND_ORIGIN || "*");
  res.header("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.header("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") {
    return res.sendStatus(204);
  }
  next();
});

// Shared by every route that calls into todoService: maps the typed
// service-layer errors to the appropriate status code, and falls back to a
// generic 500 for anything unexpected.
function handleServiceError(
  err,
  res,
  fallbackMessage,
  agentMessage = "Could not understand the todo input right now. Please try again."
) {
  if (err instanceof AgentError) {
    console.error("Agent failure", err);
    return res.status(502).json({ status: "error", message: agentMessage });
  }
  if (err instanceof NotFoundError) {
    return res.status(404).json({ status: "error", message: "Todo not found" });
  }
  if (err instanceof RepositoryError) {
    console.error("Repository failure", err);
    return res.status(500).json({ status: "error", message: fallbackMessage });
  }
  console.error("Unexpected error", err);
  res.status(500).json({ status: "error", message: fallbackMessage });
}

// Shared by the /todos/:id/* action routes: validates the id path param,
// sending a 400 itself and returning null if it's not a positive integer.
function parseTodoId(req, res) {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ status: "error", message: "id must be a positive integer" });
    return null;
  }
  return id;
}

app.post("/todos", async (req, res) => {
  const { text, userId, due_date: dueDateInput, priority: priorityInput } = req.body ?? {};

  if (typeof text !== "string" || !text.trim()) {
    return res.status(400).json({ status: "error", message: "text is required" });
  }
  if (typeof userId !== "string" || !userId.trim()) {
    return res.status(400).json({ status: "error", message: "userId is required" });
  }
  if (dueDateInput !== undefined && dueDateInput !== null && Number.isNaN(Date.parse(dueDateInput))) {
    return res.status(400).json({ status: "error", message: "due_date must be a valid date" });
  }
  if (priorityInput !== undefined && typeof priorityInput !== "boolean") {
    return res.status(400).json({ status: "error", message: "priority must be a boolean" });
  }

  try {
    const todos = await todoService.createTodos({
      text,
      userId,
      dueDateOverride: dueDateInput,
      priorityOverride: priorityInput,
    });

    res.json({ status: "ok", todos, count: todos.length });
  } catch (err) {
    handleServiceError(err, res, "Failed to save the todo. Please try again.");
  }
});

app.post("/todos/:id/complete", async (req, res) => {
  const id = parseTodoId(req, res);
  if (id === null) return;

  const { userId } = req.body ?? {};
  if (typeof userId !== "string" || !userId.trim()) {
    return res.status(400).json({ status: "error", message: "userId is required" });
  }

  try {
    const todo = await todoService.completeTodo(id, userId);
    res.json({ status: "ok", todo });
  } catch (err) {
    handleServiceError(err, res, "Failed to complete todo");
  }
});

app.post("/todos/:id/undo", async (req, res) => {
  const id = parseTodoId(req, res);
  if (id === null) return;

  const { userId } = req.body ?? {};
  if (typeof userId !== "string" || !userId.trim()) {
    return res.status(400).json({ status: "error", message: "userId is required" });
  }

  try {
    const todo = await todoService.undoTodo(id, userId);
    res.json({ status: "ok", todo });
  } catch (err) {
    handleServiceError(err, res, "Failed to undo todo");
  }
});

app.post("/todos/:id/snooze", async (req, res) => {
  const id = parseTodoId(req, res);
  if (id === null) return;

  const { userId, minutes } = req.body ?? {};
  if (typeof userId !== "string" || !userId.trim()) {
    return res.status(400).json({ status: "error", message: "userId is required" });
  }
  if (minutes !== undefined && (typeof minutes !== "number" || !Number.isFinite(minutes) || minutes <= 0)) {
    return res.status(400).json({ status: "error", message: "minutes must be a positive number" });
  }

  try {
    const todo = await todoService.snoozeTodo(id, userId, minutes);
    res.json({ status: "ok", todo });
  } catch (err) {
    handleServiceError(err, res, "Failed to snooze todo");
  }
});

app.post("/todos/:id/unsnooze", async (req, res) => {
  const id = parseTodoId(req, res);
  if (id === null) return;

  const { userId } = req.body ?? {};
  if (typeof userId !== "string" || !userId.trim()) {
    return res.status(400).json({ status: "error", message: "userId is required" });
  }

  try {
    const todo = await todoService.unsnoozeTodo(id, userId);
    res.json({ status: "ok", todo });
  } catch (err) {
    handleServiceError(err, res, "Failed to unsnooze todo");
  }
});

app.get("/todos", async (req, res) => {
  const { userId } = req.query;

  if (typeof userId !== "string" || !userId.trim()) {
    return res.status(400).json({ status: "error", message: "userId is required" });
  }

  try {
    const todos = await todoService.listTodos(userId);
    console.log(`Fetched ${todos.length} todos for userId=${userId}`);
    res.json({ status: "ok", todos });
  } catch (err) {
    console.error("Failed to fetch todos", err);
    res.status(500).json({ status: "error", message: "Failed to fetch todos" });
  }
});

const MAX_SEARCH_LIMIT = 50;
// pgvector cosine distance ranges 0 (identical) to 2 (opposite) — this is
// just a sanity bound on client input, not a claim about what's relevant.
const MAX_SEARCH_DISTANCE = 2;

app.get("/todos/search", async (req, res) => {
  const { userId, q, limit, maxDistance } = req.query;

  if (typeof userId !== "string" || !userId.trim()) {
    return res.status(400).json({ status: "error", message: "userId is required" });
  }
  if (typeof q !== "string" || !q.trim()) {
    return res.status(400).json({ status: "error", message: "q is required" });
  }

  let parsedLimit;
  if (limit !== undefined) {
    parsedLimit = Number(limit);
    if (!Number.isInteger(parsedLimit) || parsedLimit <= 0 || parsedLimit > MAX_SEARCH_LIMIT) {
      return res
        .status(400)
        .json({ status: "error", message: `limit must be a positive integer up to ${MAX_SEARCH_LIMIT}` });
    }
  }

  let parsedMaxDistance;
  if (maxDistance !== undefined) {
    parsedMaxDistance = Number(maxDistance);
    if (!Number.isFinite(parsedMaxDistance) || parsedMaxDistance <= 0 || parsedMaxDistance > MAX_SEARCH_DISTANCE) {
      return res
        .status(400)
        .json({ status: "error", message: `maxDistance must be a positive number up to ${MAX_SEARCH_DISTANCE}` });
    }
  }

  try {
    const todos = await todoService.searchTodos(userId, q, { limit: parsedLimit, maxDistance: parsedMaxDistance });
    res.json({ status: "ok", todos });
  } catch (err) {
    handleServiceError(err, res, "Failed to search todos", "Could not process the search query right now. Please try again.");
  }
});

export function attachWebSocketHandlers(wss) {
  wss.on("connection", (ws) => {
    ws.on("message", async (raw) => {
      let payload;
      try {
        payload = JSON.parse(raw.toString());
      } catch {
        ws.send(JSON.stringify({ type: "error", message: "Invalid JSON" }));
        return;
      }

      const { type, userId } = payload ?? {};
      if (typeof userId !== "string" || !userId.trim()) {
        ws.send(JSON.stringify({ type: "error", message: "userId is required" }));
        return;
      }

      try {
        if (type === "getSummary") {
          const summary = await todoService.getSummary(userId);
          ws.send(JSON.stringify({ type: "summary", data: summary }));
        } else if (type === "getReminders") {
          const reminders = await todoService.getReminders(userId);
          ws.send(JSON.stringify({ type: "reminders", data: reminders }));
        } else {
          ws.send(JSON.stringify({ type: "error", message: `Unknown type: ${type}` }));
        }
      } catch (err) {
        console.error("WebSocket handler error", err);
        ws.send(JSON.stringify({ type: "error", message: "Internal error" }));
      }
    });
  });

  return wss;
}

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  const port = process.env.PORT || 3000;
  const wsPort = process.env.WS_PORT || 8080;

  app.listen(port, () => console.log(`HTTP server listening on ${port}`));

  const wss = new WebSocketServer({ port: wsPort });
  attachWebSocketHandlers(wss);
  console.log(`WebSocket server listening on ${wsPort}`);
}
