import { jest } from "@jest/globals";

// Protocol-level E2E test: real HTTP wire, mocked Postgres (no live database
// required in CI). Exercises the full add-todo -> list-todos -> reminders ->
// summary flow a browser client would drive against this server.

const queryMock = jest.fn();

jest.unstable_mockModule("../db.js", () => ({
  default: { query: queryMock },
}));

jest.unstable_mockModule("../mcpAgent.js", () => ({
  mcpAgent: {
    parseTodos: jest.fn(async (text) => [
      { description: text.trim(), due_date: null, priority: false },
    ]),
    embed: jest.fn(async () => [0, 0, 0]),
    summarizeDay: jest.fn(async (todos) => {
      const pending = todos.filter((t) => t.status === "pending");
      return `You have ${pending.length} pending task(s).`;
    }),
  },
}));

const { app } = await import("../server.js");
const { default: request } = await import("supertest");

beforeEach(() => {
  queryMock.mockReset();
});

test("user adds a todo, sees it listed, and receives it as a reminder", async () => {
  const userId = "e2e-user";
  const dueDate = new Date(Date.now() + 3600_000).toISOString();

  queryMock.mockResolvedValueOnce({ rows: [] }); // INSERT
  const addRes = await request(app)
    .post("/todos")
    .send({ text: "Pay rent", userId, due_date: dueDate, priority: true });

  expect(addRes.status).toBe(200);
  expect(addRes.body.count).toBe(1);
  expect(addRes.body.todos[0].description).toBe("Pay rent");

  const storedRow = {
    id: 1,
    user_id: userId,
    description: "Pay rent",
    due_date: dueDate,
    priority: true,
    status: "pending",
  };

  queryMock.mockResolvedValueOnce({ rows: [storedRow] }); // GET /todos
  const listRes = await request(app).get("/todos").query({ userId });
  expect(listRes.status).toBe(200);
  expect(listRes.body.todos).toEqual([storedRow]);

  queryMock.mockResolvedValueOnce({ rows: [storedRow] }); // GET /todos/reminders
  const remindersRes = await request(app).get("/todos/reminders").query({ userId });
  expect(remindersRes.status).toBe(200);
  expect(remindersRes.body.reminders).toEqual([storedRow]);

  queryMock.mockResolvedValueOnce({ rows: [storedRow] }); // GET /todos/summary
  const summaryRes = await request(app).get("/todos/summary").query({ userId });
  expect(summaryRes.status).toBe(200);
  expect(summaryRes.body.summary).toBe("You have 1 pending task(s).");
});

test("user completes a todo, undoes it, then snoozes it", async () => {
  // Distinct userId from the test above — todoService caches summaries
  // per user for real in this file (the app/service are constructed once
  // at import time), so reusing "e2e-user" could pick up cached state.
  const userId = "e2e-user-2";

  const completedRow = { id: 7, user_id: userId, description: "Pay rent", status: "done" };
  queryMock.mockResolvedValueOnce({ rows: [completedRow] });
  const completeRes = await request(app).post(`/todos/7/complete`).send({ userId });
  expect(completeRes.status).toBe(200);
  expect(completeRes.body.todo.status).toBe("done");

  const pendingRow = { ...completedRow, status: "pending" };
  queryMock.mockResolvedValueOnce({ rows: [pendingRow] });
  const undoRes = await request(app).post(`/todos/7/undo`).send({ userId });
  expect(undoRes.status).toBe(200);
  expect(undoRes.body.todo.status).toBe("pending");

  const snoozedRow = { ...pendingRow, due_date: "2026-10-01T18:00:00.000Z" };
  queryMock.mockResolvedValueOnce({ rows: [snoozedRow] });
  const snoozeRes = await request(app).post(`/todos/7/snooze`).send({ userId, minutes: 30 });
  expect(snoozeRes.status).toBe(200);
  expect(snoozeRes.body.todo.due_date).toBe("2026-10-01T18:00:00.000Z");

  queryMock.mockResolvedValueOnce({ rows: [] });
  const notFoundRes = await request(app).post(`/todos/404/complete`).send({ userId });
  expect(notFoundRes.status).toBe(404);
});

test("summary and reminders reject a request missing userId", async () => {
  const summaryRes = await request(app).get("/todos/summary");
  expect(summaryRes.status).toBe(400);

  const remindersRes = await request(app).get("/todos/reminders");
  expect(remindersRes.status).toBe(400);

  expect(queryMock).not.toHaveBeenCalled();
});
