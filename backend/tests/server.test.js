import { jest } from "@jest/globals";

const queryMock = jest.fn();
// Default: behaves like a single-item split, mirroring the real
// non-list-detection path. Tests that care about actual splitting stub
// parseTodosMock directly — the splitting heuristic itself is covered by
// mcpAgent.test.js, not re-tested here.
const parseTodosMock = jest.fn(async (text) => [
  { description: text.trim(), due_date: null, priority: false },
]);
const embedMock = jest.fn(async () => [0, 0, 0]);

jest.unstable_mockModule("../db.js", () => ({
  default: { query: queryMock },
}));

jest.unstable_mockModule("../mcpAgent.js", () => ({
  mcpAgent: {
    parseTodos: parseTodosMock,
    embed: embedMock,
    summarizeDay: jest.fn(async () => "summary text"),
  },
}));

const { app } = await import("../server.js");
const { default: request } = await import("supertest");

beforeEach(() => {
  queryMock.mockReset();
  parseTodosMock.mockClear();
  embedMock.mockClear();
});

describe("POST /todos", () => {
  test("creates a todo for valid input", async () => {
    queryMock.mockResolvedValueOnce({ rows: [] });

    const res = await request(app)
      .post("/todos")
      .send({ text: "Meeting tomorrow", userId: "rahil" });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      status: "ok",
      todos: [{ description: "Meeting tomorrow", due_date: null, priority: false }],
      count: 1,
    });
    expect(queryMock).toHaveBeenCalledTimes(1);
    expect(queryMock.mock.calls[0][1]).toEqual([
      "rahil",
      "Meeting tomorrow",
      null,
      false,
      JSON.stringify([0, 0, 0]),
    ]);
  });

  test("rejects a missing text field", async () => {
    const res = await request(app).post("/todos").send({ userId: "rahil" });
    expect(res.status).toBe(400);
    expect(queryMock).not.toHaveBeenCalled();
  });

  test("rejects a missing userId field", async () => {
    const res = await request(app).post("/todos").send({ text: "Meeting" });
    expect(res.status).toBe(400);
    expect(queryMock).not.toHaveBeenCalled();
  });

  test("rejects blank text", async () => {
    const res = await request(app).post("/todos").send({ text: "   ", userId: "rahil" });
    expect(res.status).toBe(400);
  });

  test("returns 500 when the database query fails", async () => {
    queryMock.mockRejectedValueOnce(new Error("connection refused"));

    const res = await request(app)
      .post("/todos")
      .send({ text: "Meeting tomorrow", userId: "rahil" });

    expect(res.status).toBe(500);
    expect(res.body.status).toBe("error");
  });

  test("accepts an optional client-supplied due_date and priority", async () => {
    queryMock.mockResolvedValueOnce({ rows: [] });
    const dueDate = "2026-10-01T18:00:00.000Z";

    const res = await request(app)
      .post("/todos")
      .send({ text: "Doctor appointment", userId: "rahil", due_date: dueDate, priority: true });

    expect(res.status).toBe(200);
    expect(res.body.todos).toEqual([
      { description: "Doctor appointment", due_date: dueDate, priority: true },
    ]);
    expect(res.body.count).toBe(1);
    expect(queryMock.mock.calls[0][1]).toEqual([
      "rahil",
      "Doctor appointment",
      dueDate,
      true,
      JSON.stringify([0, 0, 0]),
    ]);
  });

  test("rejects an invalid due_date", async () => {
    const res = await request(app)
      .post("/todos")
      .send({ text: "Meeting", userId: "rahil", due_date: "not-a-date" });

    expect(res.status).toBe(400);
    expect(queryMock).not.toHaveBeenCalled();
  });

  test("rejects a non-boolean priority", async () => {
    const res = await request(app)
      .post("/todos")
      .send({ text: "Meeting", userId: "rahil", priority: "yes" });

    expect(res.status).toBe(400);
    expect(queryMock).not.toHaveBeenCalled();
  });

  test("creates one row per todo when the agent splits a multi-item input", async () => {
    parseTodosMock.mockResolvedValueOnce([
      { description: "Buy milk", due_date: null, priority: false },
      { description: "Call mom", due_date: null, priority: false },
    ]);
    queryMock.mockResolvedValue({ rows: [] });

    const res = await request(app)
      .post("/todos")
      .send({ text: "Buy milk\nCall mom", userId: "rahil" });

    expect(res.status).toBe(200);
    expect(res.body.count).toBe(2);
    expect(res.body.todos).toHaveLength(2);
    expect(queryMock).toHaveBeenCalledTimes(2);
    expect(embedMock).toHaveBeenCalledTimes(2);
  });

  test("applies a due_date/priority override to every split todo", async () => {
    parseTodosMock.mockResolvedValueOnce([
      { description: "Buy milk", due_date: null, priority: false },
      { description: "Call mom", due_date: null, priority: false },
    ]);
    queryMock.mockResolvedValue({ rows: [] });
    const dueDate = "2026-10-01T18:00:00.000Z";

    const res = await request(app)
      .post("/todos")
      .send({ text: "Buy milk\nCall mom", userId: "rahil", due_date: dueDate, priority: true });

    expect(res.body.todos).toEqual([
      { description: "Buy milk", due_date: dueDate, priority: true },
      { description: "Call mom", due_date: dueDate, priority: true },
    ]);
  });

  test("returns 500 and stops inserting if a later item in the batch fails", async () => {
    parseTodosMock.mockResolvedValueOnce([
      { description: "Buy milk", due_date: null, priority: false },
      { description: "Call mom", due_date: null, priority: false },
    ]);
    queryMock.mockResolvedValueOnce({ rows: [] }).mockRejectedValueOnce(new Error("connection refused"));

    const res = await request(app)
      .post("/todos")
      .send({ text: "Buy milk\nCall mom", userId: "rahil" });

    expect(res.status).toBe(500);
    expect(queryMock).toHaveBeenCalledTimes(2);
  });

  test("returns 502 (not 500) when the AI agent fails to parse the input", async () => {
    parseTodosMock.mockRejectedValueOnce(new Error("Azure OpenAI unreachable"));

    const res = await request(app)
      .post("/todos")
      .send({ text: "Buy milk", userId: "rahil" });

    expect(res.status).toBe(502);
    expect(res.body.status).toBe("error");
    expect(queryMock).not.toHaveBeenCalled();
  });

  test("returns 502 (not 500) when the AI agent fails to generate an embedding", async () => {
    embedMock.mockRejectedValueOnce(new Error("Azure OpenAI unreachable"));

    const res = await request(app)
      .post("/todos")
      .send({ text: "Buy milk", userId: "rahil" });

    expect(res.status).toBe(502);
    expect(res.body.status).toBe("error");
    expect(queryMock).not.toHaveBeenCalled();
  });
});

describe("GET /todos", () => {
  test("returns todos for a valid userId", async () => {
    const rows = [{ id: 1, user_id: "rahil", description: "Meeting tomorrow" }];
    queryMock.mockResolvedValueOnce({ rows });

    const res = await request(app).get("/todos").query({ userId: "rahil" });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: "ok", todos: rows });
    expect(queryMock).toHaveBeenCalledTimes(1);
    expect(queryMock.mock.calls[0][1]).toEqual(["rahil"]);
  });

  test("rejects a missing userId", async () => {
    const res = await request(app).get("/todos");
    expect(res.status).toBe(400);
    expect(queryMock).not.toHaveBeenCalled();
  });

  test("rejects a blank userId", async () => {
    const res = await request(app).get("/todos").query({ userId: "   " });
    expect(res.status).toBe(400);
    expect(queryMock).not.toHaveBeenCalled();
  });

  test("returns 500 when the database query fails", async () => {
    queryMock.mockRejectedValueOnce(new Error("connection refused"));

    const res = await request(app).get("/todos").query({ userId: "rahil" });

    expect(res.status).toBe(500);
    expect(res.body.status).toBe("error");
  });
});

describe("POST /todos/:id/complete", () => {
  test("marks the todo completed and returns it", async () => {
    const row = { id: 5, status: "done" };
    queryMock.mockResolvedValueOnce({ rows: [row] });

    const res = await request(app).post("/todos/5/complete").send({ userId: "rahil" });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: "ok", todo: row });
    expect(queryMock.mock.calls[0][1]).toEqual(["done", 5, "rahil"]);
  });

  test("rejects a non-integer id", async () => {
    const res = await request(app).post("/todos/not-a-number/complete").send({ userId: "rahil" });
    expect(res.status).toBe(400);
    expect(queryMock).not.toHaveBeenCalled();
  });

  test("rejects a missing userId", async () => {
    const res = await request(app).post("/todos/5/complete").send({});
    expect(res.status).toBe(400);
    expect(queryMock).not.toHaveBeenCalled();
  });

  test("returns 404 when the todo doesn't exist or isn't owned by this user", async () => {
    queryMock.mockResolvedValueOnce({ rows: [] });

    const res = await request(app).post("/todos/999/complete").send({ userId: "rahil" });

    expect(res.status).toBe(404);
  });

  test("returns 500 when the database update fails", async () => {
    queryMock.mockRejectedValueOnce(new Error("connection refused"));

    const res = await request(app).post("/todos/5/complete").send({ userId: "rahil" });

    expect(res.status).toBe(500);
  });
});

describe("POST /todos/:id/undo", () => {
  test("marks the todo pending, clears due_date, and returns it", async () => {
    const row = { id: 5, status: "pending", due_date: null };
    queryMock.mockResolvedValueOnce({ rows: [row] });

    const res = await request(app).post("/todos/5/undo").send({ userId: "rahil" });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: "ok", todo: row });
    expect(queryMock.mock.calls[0][1]).toEqual(["pending", null, 5, "rahil"]);
  });

  test("returns 404 when the todo doesn't exist or isn't owned by this user", async () => {
    queryMock.mockResolvedValueOnce({ rows: [] });

    const res = await request(app).post("/todos/999/undo").send({ userId: "rahil" });

    expect(res.status).toBe(404);
  });
});

describe("POST /todos/:id/snooze", () => {
  test("pushes the due date out and returns the updated todo", async () => {
    const row = { id: 5, due_date: "2026-10-01T18:00:00.000Z" };
    queryMock.mockResolvedValueOnce({ rows: [row] });

    const res = await request(app).post("/todos/5/snooze").send({ userId: "rahil" });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: "ok", todo: row });
    const [sql, params] = queryMock.mock.calls[0];
    expect(sql).toMatch(/UPDATE todos SET due_date=\$1/);
    expect(params[1]).toBe(5);
    expect(params[2]).toBe("rahil");
  });

  test("accepts a custom minutes value", async () => {
    queryMock.mockResolvedValueOnce({ rows: [{ id: 5 }] });

    const res = await request(app).post("/todos/5/snooze").send({ userId: "rahil", minutes: 15 });

    expect(res.status).toBe(200);
  });

  test("rejects a non-positive minutes value", async () => {
    const res = await request(app).post("/todos/5/snooze").send({ userId: "rahil", minutes: -5 });
    expect(res.status).toBe(400);
    expect(queryMock).not.toHaveBeenCalled();
  });

  test("returns 404 when the todo doesn't exist or isn't owned by this user", async () => {
    queryMock.mockResolvedValueOnce({ rows: [] });

    const res = await request(app).post("/todos/999/snooze").send({ userId: "rahil" });

    expect(res.status).toBe(404);
  });
});

describe("POST /todos/:id/unsnooze", () => {
  test("clears due_date and returns the updated todo", async () => {
    const row = { id: 5, due_date: null };
    queryMock.mockResolvedValueOnce({ rows: [row] });

    const res = await request(app).post("/todos/5/unsnooze").send({ userId: "rahil" });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: "ok", todo: row });
    expect(queryMock.mock.calls[0][1]).toEqual([null, 5, "rahil"]);
  });

  test("rejects a non-integer id", async () => {
    const res = await request(app).post("/todos/not-a-number/unsnooze").send({ userId: "rahil" });
    expect(res.status).toBe(400);
    expect(queryMock).not.toHaveBeenCalled();
  });

  test("rejects a missing userId", async () => {
    const res = await request(app).post("/todos/5/unsnooze").send({});
    expect(res.status).toBe(400);
    expect(queryMock).not.toHaveBeenCalled();
  });

  test("returns 404 when the todo doesn't exist or isn't owned by this user", async () => {
    queryMock.mockResolvedValueOnce({ rows: [] });

    const res = await request(app).post("/todos/999/unsnooze").send({ userId: "rahil" });

    expect(res.status).toBe(404);
  });

  test("returns 500 when the database update fails", async () => {
    queryMock.mockRejectedValueOnce(new Error("connection refused"));

    const res = await request(app).post("/todos/5/unsnooze").send({ userId: "rahil" });

    expect(res.status).toBe(500);
  });
});

describe("GET /todos/search", () => {
  test("embeds the query and returns todos ordered by the database", async () => {
    const rows = [{ id: 1, description: "Buy milk", distance: 0.05 }];
    queryMock.mockResolvedValueOnce({ rows });

    const res = await request(app).get("/todos/search").query({ userId: "rahil", q: "groceries" });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: "ok", todos: rows });
    expect(embedMock).toHaveBeenCalledWith("groceries");
    expect(queryMock.mock.calls[0][1]).toEqual([JSON.stringify([0, 0, 0]), "rahil", 10]);
  });

  test("accepts a custom limit", async () => {
    queryMock.mockResolvedValueOnce({ rows: [] });

    const res = await request(app).get("/todos/search").query({ userId: "rahil", q: "groceries", limit: "3" });

    expect(res.status).toBe(200);
    expect(queryMock.mock.calls[0][1][2]).toBe(3);
  });

  test("rejects a missing userId", async () => {
    const res = await request(app).get("/todos/search").query({ q: "groceries" });
    expect(res.status).toBe(400);
    expect(queryMock).not.toHaveBeenCalled();
  });

  test("rejects a missing q", async () => {
    const res = await request(app).get("/todos/search").query({ userId: "rahil" });
    expect(res.status).toBe(400);
    expect(queryMock).not.toHaveBeenCalled();
  });

  test("rejects a non-positive limit", async () => {
    const res = await request(app).get("/todos/search").query({ userId: "rahil", q: "groceries", limit: "0" });
    expect(res.status).toBe(400);
    expect(queryMock).not.toHaveBeenCalled();
  });

  test("rejects a limit over the max", async () => {
    const res = await request(app).get("/todos/search").query({ userId: "rahil", q: "groceries", limit: "51" });
    expect(res.status).toBe(400);
    expect(queryMock).not.toHaveBeenCalled();
  });

  test("returns 502 when the AI agent fails to embed the query", async () => {
    embedMock.mockRejectedValueOnce(new Error("Azure OpenAI unreachable"));

    const res = await request(app).get("/todos/search").query({ userId: "rahil", q: "groceries" });

    expect(res.status).toBe(502);
    expect(queryMock).not.toHaveBeenCalled();
  });

  test("returns 500 when the database query fails", async () => {
    queryMock.mockRejectedValueOnce(new Error("connection refused"));

    const res = await request(app).get("/todos/search").query({ userId: "rahil", q: "groceries" });

    expect(res.status).toBe(500);
  });
});
