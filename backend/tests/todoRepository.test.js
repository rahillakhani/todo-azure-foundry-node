import { jest } from "@jest/globals";
import { createTodoRepository } from "../repositories/todoRepository.js";
import { RepositoryError } from "../errors.js";

function fakePool(queryImpl) {
  return { query: jest.fn(queryImpl) };
}

describe("todoRepository.insertTodo", () => {
  test("inserts with the expected SQL and params", async () => {
    const pool = fakePool(async () => ({ rows: [] }));
    const repository = createTodoRepository(pool);

    await repository.insertTodo({
      userId: "rahil",
      description: "Buy milk",
      due_date: null,
      priority: false,
      embedding: [0.1, 0.2],
    });

    expect(pool.query).toHaveBeenCalledTimes(1);
    const [sql, params] = pool.query.mock.calls[0];
    expect(sql).toMatch(/INSERT INTO todos/);
    expect(params).toEqual(["rahil", "Buy milk", null, false, JSON.stringify([0.1, 0.2])]);
  });

  test("wraps a pool failure in RepositoryError", async () => {
    const pool = fakePool(async () => {
      throw new Error("connection refused");
    });
    const repository = createTodoRepository(pool);

    await expect(
      repository.insertTodo({ userId: "rahil", description: "Buy milk", due_date: null, priority: false, embedding: [] })
    ).rejects.toThrow(RepositoryError);
  });
});

describe("todoRepository.listByUser", () => {
  test("returns rows for the user", async () => {
    const rows = [{ id: 1, description: "Buy milk" }];
    const pool = fakePool(async () => ({ rows }));
    const repository = createTodoRepository(pool);

    const result = await repository.listByUser("rahil");

    expect(result).toBe(rows);
    expect(pool.query.mock.calls[0][1]).toEqual(["rahil"]);
  });

  test("wraps a pool failure in RepositoryError", async () => {
    const pool = fakePool(async () => {
      throw new Error("connection refused");
    });
    const repository = createTodoRepository(pool);

    await expect(repository.listByUser("rahil")).rejects.toThrow(RepositoryError);
  });
});

describe("todoRepository.listRemindersByUser", () => {
  test("filters on due_date in the query", async () => {
    const rows = [{ id: 1, description: "Pay rent" }];
    const pool = fakePool(async () => ({ rows }));
    const repository = createTodoRepository(pool);

    const result = await repository.listRemindersByUser("rahil");

    expect(result).toBe(rows);
    expect(pool.query.mock.calls[0][0]).toMatch(/due_date > NOW\(\)/);
  });

  test("wraps a pool failure in RepositoryError", async () => {
    const pool = fakePool(async () => {
      throw new Error("connection refused");
    });
    const repository = createTodoRepository(pool);

    await expect(repository.listRemindersByUser("rahil")).rejects.toThrow(RepositoryError);
  });
});

describe("todoRepository.markCompleted", () => {
  test("scopes the update to (id, userId) and returns the updated row", async () => {
    const row = { id: 5, status: "done" };
    const pool = fakePool(async () => ({ rows: [row] }));
    const repository = createTodoRepository(pool);

    const result = await repository.markCompleted(5, "rahil");

    expect(result).toBe(row);
    const [sql, params] = pool.query.mock.calls[0];
    expect(sql).toMatch(/UPDATE todos SET status=\$1 WHERE id=\$2 AND user_id=\$3/);
    expect(params).toEqual(["done", 5, "rahil"]);
  });

  test("returns null when no row matches (wrong id or wrong owner)", async () => {
    const pool = fakePool(async () => ({ rows: [] }));
    const repository = createTodoRepository(pool);

    await expect(repository.markCompleted(999, "rahil")).resolves.toBeNull();
  });

  test("wraps a pool failure in RepositoryError", async () => {
    const pool = fakePool(async () => {
      throw new Error("connection refused");
    });
    const repository = createTodoRepository(pool);

    await expect(repository.markCompleted(5, "rahil")).rejects.toThrow(RepositoryError);
  });
});

describe("todoRepository.markPending", () => {
  test("sets status back to pending and clears due_date in one update", async () => {
    const row = { id: 5, status: "pending", due_date: null };
    const pool = fakePool(async () => ({ rows: [row] }));
    const repository = createTodoRepository(pool);

    const result = await repository.markPending(5, "rahil");

    expect(result).toBe(row);
    const [sql, params] = pool.query.mock.calls[0];
    expect(sql).toMatch(/UPDATE todos SET status=\$1, due_date=\$2 WHERE id=\$3 AND user_id=\$4/);
    expect(params).toEqual(["pending", null, 5, "rahil"]);
  });

  test("returns null when no row matches", async () => {
    const pool = fakePool(async () => ({ rows: [] }));
    const repository = createTodoRepository(pool);

    await expect(repository.markPending(999, "rahil")).resolves.toBeNull();
  });
});

describe("todoRepository.snoozeDueDate", () => {
  test("updates due_date to the given value", async () => {
    const row = { id: 5, due_date: "2026-10-01T18:00:00.000Z" };
    const pool = fakePool(async () => ({ rows: [row] }));
    const repository = createTodoRepository(pool);

    const result = await repository.snoozeDueDate(5, "rahil", "2026-10-01T18:00:00.000Z");

    expect(result).toBe(row);
    const [sql, params] = pool.query.mock.calls[0];
    expect(sql).toMatch(/UPDATE todos SET due_date=\$1/);
    expect(params).toEqual(["2026-10-01T18:00:00.000Z", 5, "rahil"]);
  });

  test("returns null when no row matches", async () => {
    const pool = fakePool(async () => ({ rows: [] }));
    const repository = createTodoRepository(pool);

    await expect(repository.snoozeDueDate(999, "rahil", "2026-10-01T18:00:00.000Z")).resolves.toBeNull();
  });

  test("wraps a pool failure in RepositoryError", async () => {
    const pool = fakePool(async () => {
      throw new Error("connection refused");
    });
    const repository = createTodoRepository(pool);

    await expect(repository.snoozeDueDate(5, "rahil", "2026-10-01T18:00:00.000Z")).rejects.toThrow(RepositoryError);
  });
});

describe("todoRepository.clearDueDate", () => {
  test("sets due_date to null", async () => {
    const row = { id: 5, due_date: null };
    const pool = fakePool(async () => ({ rows: [row] }));
    const repository = createTodoRepository(pool);

    const result = await repository.clearDueDate(5, "rahil");

    expect(result).toBe(row);
    const [sql, params] = pool.query.mock.calls[0];
    expect(sql).toMatch(/UPDATE todos SET due_date=\$1/);
    expect(params).toEqual([null, 5, "rahil"]);
  });

  test("returns null when no row matches", async () => {
    const pool = fakePool(async () => ({ rows: [] }));
    const repository = createTodoRepository(pool);

    await expect(repository.clearDueDate(999, "rahil")).resolves.toBeNull();
  });

  test("wraps a pool failure in RepositoryError", async () => {
    const pool = fakePool(async () => {
      throw new Error("connection refused");
    });
    const repository = createTodoRepository(pool);

    await expect(repository.clearDueDate(5, "rahil")).rejects.toThrow(RepositoryError);
  });
});

describe("todoRepository.searchByUser", () => {
  test("orders by cosine distance, casts the query vector, and scopes to the user", async () => {
    const rows = [{ id: 1, description: "Buy milk", distance: 0.1 }];
    const pool = fakePool(async () => ({ rows }));
    const repository = createTodoRepository(pool);

    const result = await repository.searchByUser("rahil", [0.1, 0.2], 5);

    expect(result).toBe(rows);
    const [sql, params] = pool.query.mock.calls[0];
    expect(sql).toMatch(/embedding <=> \$1::vector AS distance/);
    expect(sql).toMatch(/ORDER BY distance ASC/);
    expect(sql).not.toMatch(/SELECT \*/);
    expect(params).toEqual([JSON.stringify([0.1, 0.2]), "rahil", 5]);
  });

  test("defaults to a limit of 10 when not given one", async () => {
    const pool = fakePool(async () => ({ rows: [] }));
    const repository = createTodoRepository(pool);

    await repository.searchByUser("rahil", [0.1]);

    expect(pool.query.mock.calls[0][1]).toEqual([JSON.stringify([0.1]), "rahil", 10]);
  });

  test("wraps a pool failure in RepositoryError", async () => {
    const pool = fakePool(async () => {
      throw new Error("connection refused");
    });
    const repository = createTodoRepository(pool);

    await expect(repository.searchByUser("rahil", [0.1], 5)).rejects.toThrow(RepositoryError);
  });
});

describe("PUBLIC_COLUMNS (embedding is never shipped back)", () => {
  test("listByUser's query excludes the embedding column", async () => {
    const pool = fakePool(async () => ({ rows: [] }));
    const repository = createTodoRepository(pool);

    await repository.listByUser("rahil");

    expect(pool.query.mock.calls[0][0]).not.toMatch(/SELECT \*/);
    expect(pool.query.mock.calls[0][0]).not.toContain("embedding");
  });

  test("markCompleted's RETURNING clause excludes the embedding column", async () => {
    const pool = fakePool(async () => ({ rows: [{ id: 5 }] }));
    const repository = createTodoRepository(pool);

    await repository.markCompleted(5, "rahil");

    expect(pool.query.mock.calls[0][0]).not.toMatch(/RETURNING \*/);
    expect(pool.query.mock.calls[0][0]).not.toContain("embedding");
  });
});
