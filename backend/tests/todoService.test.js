import { jest } from "@jest/globals";
import { createTodoService } from "../services/todoService.js";
import { AgentError, NotFoundError } from "../errors.js";

function fakeAgent(overrides = {}) {
  return {
    parseTodos: jest.fn(async (text) => [{ description: text.trim(), due_date: null, priority: false }]),
    embed: jest.fn(async () => [0, 0, 0]),
    summarizeDay: jest.fn(async () => "summary text"),
    ...overrides,
  };
}

function fakeRepository(overrides = {}) {
  return {
    insertTodo: jest.fn(async () => {}),
    listByUser: jest.fn(async () => []),
    listRemindersByUser: jest.fn(async () => []),
    markCompleted: jest.fn(async (id) => ({ id, status: "done" })),
    markPending: jest.fn(async (id) => ({ id, status: "pending", due_date: null })),
    snoozeDueDate: jest.fn(async (id, userId, dueDate) => ({ id, due_date: dueDate })),
    clearDueDate: jest.fn(async (id) => ({ id, due_date: null })),
    searchByUser: jest.fn(async () => []),
    ...overrides,
  };
}

describe("todoService.createTodos", () => {
  test("persists one todo per item the agent returns", async () => {
    const agent = fakeAgent({
      parseTodos: jest.fn(async () => [
        { description: "Buy milk", due_date: null, priority: false },
        { description: "Call mom", due_date: null, priority: false },
      ]),
    });
    const repository = fakeRepository();
    const service = createTodoService({ agent, repository });

    const todos = await service.createTodos({ text: "Buy milk\nCall mom", userId: "rahil" });

    expect(todos).toEqual([
      { description: "Buy milk", due_date: null, priority: false },
      { description: "Call mom", due_date: null, priority: false },
    ]);
    expect(repository.insertTodo).toHaveBeenCalledTimes(2);
    expect(agent.embed).toHaveBeenCalledTimes(2);
    expect(repository.insertTodo.mock.calls[0][0]).toMatchObject({ userId: "rahil", description: "Buy milk" });
  });

  test("applies due_date/priority overrides to every item", async () => {
    const agent = fakeAgent({
      parseTodos: jest.fn(async () => [
        { description: "Buy milk", due_date: null, priority: false },
        { description: "Call mom", due_date: null, priority: false },
      ]),
    });
    const repository = fakeRepository();
    const service = createTodoService({ agent, repository });

    const dueDate = "2026-10-01T18:00:00.000Z";
    const todos = await service.createTodos({
      text: "Buy milk\nCall mom",
      userId: "rahil",
      dueDateOverride: dueDate,
      priorityOverride: true,
    });

    expect(todos).toEqual([
      { description: "Buy milk", due_date: dueDate, priority: true },
      { description: "Call mom", due_date: dueDate, priority: true },
    ]);
  });

  test("wraps a parseTodos failure in AgentError and never touches the repository", async () => {
    const agent = fakeAgent({
      parseTodos: jest.fn(async () => {
        throw new Error("azure unreachable");
      }),
    });
    const repository = fakeRepository();
    const service = createTodoService({ agent, repository });

    await expect(service.createTodos({ text: "Buy milk", userId: "rahil" })).rejects.toThrow(AgentError);
    expect(repository.insertTodo).not.toHaveBeenCalled();
  });

  test("wraps an embed failure in AgentError", async () => {
    const agent = fakeAgent({
      embed: jest.fn(async () => {
        throw new Error("azure unreachable");
      }),
    });
    const repository = fakeRepository();
    const service = createTodoService({ agent, repository });

    await expect(service.createTodos({ text: "Buy milk", userId: "rahil" })).rejects.toThrow(AgentError);
    expect(repository.insertTodo).not.toHaveBeenCalled();
  });

  test("propagates a repository failure as-is (not wrapped as AgentError)", async () => {
    class FakeRepoError extends Error {}
    const agent = fakeAgent();
    const repository = fakeRepository({
      insertTodo: jest.fn(async () => {
        throw new FakeRepoError("db down");
      }),
    });
    const service = createTodoService({ agent, repository });

    await expect(service.createTodos({ text: "Buy milk", userId: "rahil" })).rejects.toThrow(FakeRepoError);
  });

  test("stops after the first failing item in a multi-item batch", async () => {
    const agent = fakeAgent({
      parseTodos: jest.fn(async () => [
        { description: "Buy milk", due_date: null, priority: false },
        { description: "Call mom", due_date: null, priority: false },
      ]),
    });
    const repository = fakeRepository({
      insertTodo: jest
        .fn()
        .mockResolvedValueOnce(undefined)
        .mockRejectedValueOnce(new Error("db down")),
    });
    const service = createTodoService({ agent, repository });

    await expect(service.createTodos({ text: "Buy milk\nCall mom", userId: "rahil" })).rejects.toThrow();
    expect(repository.insertTodo).toHaveBeenCalledTimes(2);
  });
});

describe("todoService.listTodos", () => {
  test("delegates to repository.listByUser", async () => {
    const rows = [{ id: 1 }];
    const repository = fakeRepository({ listByUser: jest.fn(async () => rows) });
    const service = createTodoService({ agent: fakeAgent(), repository });

    await expect(service.listTodos("rahil")).resolves.toBe(rows);
    expect(repository.listByUser).toHaveBeenCalledWith("rahil");
  });
});

describe("todoService.getReminders", () => {
  test("delegates to repository.listRemindersByUser", async () => {
    const rows = [{ id: 1 }];
    const repository = fakeRepository({ listRemindersByUser: jest.fn(async () => rows) });
    const service = createTodoService({ agent: fakeAgent(), repository });

    await expect(service.getReminders("rahil")).resolves.toBe(rows);
    expect(repository.listRemindersByUser).toHaveBeenCalledWith("rahil");
  });
});

describe("todoService.getSummary", () => {
  test("fetches todos then summarizes them via the agent", async () => {
    const rows = [{ status: "pending", description: "Buy milk" }];
    const agent = fakeAgent({ summarizeDay: jest.fn(async () => "1 pending task") });
    const repository = fakeRepository({ listByUser: jest.fn(async () => rows) });
    const service = createTodoService({ agent, repository });

    const summary = await service.getSummary("rahil");

    expect(summary).toBe("1 pending task");
    expect(agent.summarizeDay).toHaveBeenCalledWith(rows);
  });

  test("wraps a summarizeDay failure in AgentError", async () => {
    const agent = fakeAgent({
      summarizeDay: jest.fn(async () => {
        throw new Error("boom");
      }),
    });
    const repository = fakeRepository();
    const service = createTodoService({ agent, repository });

    await expect(service.getSummary("rahil")).rejects.toThrow(AgentError);
  });

  test("caches the summary for an hour instead of recomputing on every call", async () => {
    jest.useFakeTimers().setSystemTime(new Date("2026-09-24T12:00:00.000Z"));
    try {
      const agent = fakeAgent({ summarizeDay: jest.fn(async () => "1 pending task") });
      const repository = fakeRepository();
      const service = createTodoService({ agent, repository });

      await service.getSummary("rahil");
      await service.getSummary("rahil");
      jest.setSystemTime(new Date("2026-09-24T12:59:00.000Z")); // 59 min later
      await service.getSummary("rahil");

      expect(agent.summarizeDay).toHaveBeenCalledTimes(1);
      expect(repository.listByUser).toHaveBeenCalledTimes(1);
    } finally {
      jest.useRealTimers();
    }
  });

  test("recomputes once the 1-hour cache expires", async () => {
    jest.useFakeTimers().setSystemTime(new Date("2026-09-24T12:00:00.000Z"));
    try {
      const agent = fakeAgent({ summarizeDay: jest.fn(async () => "1 pending task") });
      const repository = fakeRepository();
      const service = createTodoService({ agent, repository });

      await service.getSummary("rahil");
      jest.setSystemTime(new Date("2026-09-24T13:00:01.000Z")); // just past 1 hour
      await service.getSummary("rahil");

      expect(agent.summarizeDay).toHaveBeenCalledTimes(2);
    } finally {
      jest.useRealTimers();
    }
  });

  test("caches per user, not globally", async () => {
    jest.useFakeTimers().setSystemTime(new Date("2026-09-24T12:00:00.000Z"));
    try {
      const agent = fakeAgent({ summarizeDay: jest.fn(async () => "summary") });
      const repository = fakeRepository();
      const service = createTodoService({ agent, repository });

      await service.getSummary("rahil");
      await service.getSummary("someone-else");

      expect(agent.summarizeDay).toHaveBeenCalledTimes(2);
    } finally {
      jest.useRealTimers();
    }
  });
});

describe("todoService.completeTodo", () => {
  test("marks the todo completed via the repository", async () => {
    const repository = fakeRepository({ markCompleted: jest.fn(async () => ({ id: 5, status: "done" })) });
    const service = createTodoService({ agent: fakeAgent(), repository });

    await expect(service.completeTodo(5, "rahil")).resolves.toEqual({ id: 5, status: "done" });
    expect(repository.markCompleted).toHaveBeenCalledWith(5, "rahil");
  });

  test("throws NotFoundError when the repository finds no matching row", async () => {
    const repository = fakeRepository({ markCompleted: jest.fn(async () => null) });
    const service = createTodoService({ agent: fakeAgent(), repository });

    await expect(service.completeTodo(999, "rahil")).rejects.toThrow(NotFoundError);
  });
});

describe("todoService.undoTodo", () => {
  test("marks the todo pending via the repository", async () => {
    const repository = fakeRepository({ markPending: jest.fn(async () => ({ id: 5, status: "pending" })) });
    const service = createTodoService({ agent: fakeAgent(), repository });

    await expect(service.undoTodo(5, "rahil")).resolves.toEqual({ id: 5, status: "pending" });
    expect(repository.markPending).toHaveBeenCalledWith(5, "rahil");
  });

  test("throws NotFoundError when the repository finds no matching row", async () => {
    const repository = fakeRepository({ markPending: jest.fn(async () => null) });
    const service = createTodoService({ agent: fakeAgent(), repository });

    await expect(service.undoTodo(999, "rahil")).rejects.toThrow(NotFoundError);
  });
});

describe("todoService.snoozeTodo", () => {
  test("defaults to pushing due_date 60 minutes from now", async () => {
    jest.useFakeTimers().setSystemTime(new Date("2026-09-24T12:00:00.000Z"));
    try {
      const repository = fakeRepository();
      const service = createTodoService({ agent: fakeAgent(), repository });

      await service.snoozeTodo(5, "rahil");

      expect(repository.snoozeDueDate).toHaveBeenCalledWith(5, "rahil", "2026-09-24T13:00:00.000Z");
    } finally {
      jest.useRealTimers();
    }
  });

  test("honors a custom minutes value", async () => {
    jest.useFakeTimers().setSystemTime(new Date("2026-09-24T12:00:00.000Z"));
    try {
      const repository = fakeRepository();
      const service = createTodoService({ agent: fakeAgent(), repository });

      await service.snoozeTodo(5, "rahil", 15);

      expect(repository.snoozeDueDate).toHaveBeenCalledWith(5, "rahil", "2026-09-24T12:15:00.000Z");
    } finally {
      jest.useRealTimers();
    }
  });

  test("throws NotFoundError when the repository finds no matching row", async () => {
    const repository = fakeRepository({ snoozeDueDate: jest.fn(async () => null) });
    const service = createTodoService({ agent: fakeAgent(), repository });

    await expect(service.snoozeTodo(999, "rahil")).rejects.toThrow(NotFoundError);
  });
});

describe("todoService.unsnoozeTodo", () => {
  test("clears due_date via the repository", async () => {
    const repository = fakeRepository({ clearDueDate: jest.fn(async () => ({ id: 5, due_date: null })) });
    const service = createTodoService({ agent: fakeAgent(), repository });

    await expect(service.unsnoozeTodo(5, "rahil")).resolves.toEqual({ id: 5, due_date: null });
    expect(repository.clearDueDate).toHaveBeenCalledWith(5, "rahil");
  });

  test("throws NotFoundError when the repository finds no matching row", async () => {
    const repository = fakeRepository({ clearDueDate: jest.fn(async () => null) });
    const service = createTodoService({ agent: fakeAgent(), repository });

    await expect(service.unsnoozeTodo(999, "rahil")).rejects.toThrow(NotFoundError);
  });
});

describe("todoService.searchTodos", () => {
  test("embeds the query, then delegates to repository.searchByUser", async () => {
    const rows = [{ id: 1, description: "Buy milk", distance: 0.05 }];
    const agent = fakeAgent({ embed: jest.fn(async () => [0.9, 0.1]) });
    const repository = fakeRepository({ searchByUser: jest.fn(async () => rows) });
    const service = createTodoService({ agent, repository });

    const result = await service.searchTodos("rahil", "groceries", 5);

    expect(result).toBe(rows);
    expect(agent.embed).toHaveBeenCalledWith("groceries");
    expect(repository.searchByUser).toHaveBeenCalledWith("rahil", [0.9, 0.1], 5);
  });

  test("wraps an embed failure in AgentError and never touches the repository", async () => {
    const agent = fakeAgent({
      embed: jest.fn(async () => {
        throw new Error("azure unreachable");
      }),
    });
    const repository = fakeRepository();
    const service = createTodoService({ agent, repository });

    await expect(service.searchTodos("rahil", "groceries")).rejects.toThrow(AgentError);
    expect(repository.searchByUser).not.toHaveBeenCalled();
  });

  test("propagates a repository failure as-is", async () => {
    class FakeRepoError extends Error {}
    const repository = fakeRepository({
      searchByUser: jest.fn(async () => {
        throw new FakeRepoError("db down");
      }),
    });
    const service = createTodoService({ agent: fakeAgent(), repository });

    await expect(service.searchTodos("rahil", "groceries")).rejects.toThrow(FakeRepoError);
  });
});
