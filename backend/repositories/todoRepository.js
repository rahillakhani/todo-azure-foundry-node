import { RepositoryError } from "../errors.js";

// Columns returned to callers. Deliberately excludes `embedding` — it's a
// 1536-number array that's write-only outside of searchByUser's own query,
// and would otherwise get shipped to the browser in full on every GET
// /todos response for no reason.
const PUBLIC_COLUMNS = "id, user_id, description, due_date, priority, status, created_at";

// Sole owner of the `todos` table's SQL. Takes a pg-compatible pool (duck
// typed: anything with a `.query(sql, params)` method) so it's testable
// with a plain fake, and swappable without touching callers.
export function createTodoRepository(pool) {
  // Shared by markCompleted/markPending/snoozeDueDate/clearDueDate: updates
  // one or more columns, scoped to (id, userId) so a user can never mutate
  // another user's todo. Returns the updated row, or null if no row
  // matched (wrong id, or id belongs to a different user) — callers decide
  // how to surface that (e.g. 404).
  async function updateFields(fields, { id, userId }) {
    const columns = Object.keys(fields);
    const setClause = columns.map((col, i) => `${col}=$${i + 1}`).join(", ");
    const values = Object.values(fields);

    try {
      const result = await pool.query(
        `UPDATE todos SET ${setClause} WHERE id=$${values.length + 1} AND user_id=$${values.length + 2} RETURNING ${PUBLIC_COLUMNS}`,
        [...values, id, userId]
      );
      return result.rows[0] ?? null;
    } catch (err) {
      throw new RepositoryError(`Failed to update todo (${columns.join(", ")})`, { cause: err });
    }
  }

  return {
    async insertTodo({ userId, description, due_date: dueDate, priority, embedding }) {
      try {
        await pool.query(
          "INSERT INTO todos (user_id, description, due_date, priority, embedding) VALUES ($1,$2,$3,$4,$5)",
          [userId, description, dueDate, priority, JSON.stringify(embedding)]
        );
      } catch (err) {
        throw new RepositoryError("Failed to save todo", { cause: err });
      }
    },

    async listByUser(userId) {
      try {
        const result = await pool.query(
          `SELECT ${PUBLIC_COLUMNS} FROM todos WHERE user_id=$1 ORDER BY created_at DESC`,
          [userId]
        );
        return result.rows;
      } catch (err) {
        throw new RepositoryError("Failed to fetch todos", { cause: err });
      }
    },

    async listRemindersByUser(userId) {
      try {
        const result = await pool.query(
          `SELECT ${PUBLIC_COLUMNS} FROM todos WHERE user_id=$1 AND due_date > NOW()`,
          [userId]
        );
        return result.rows;
      } catch (err) {
        throw new RepositoryError("Failed to fetch reminders", { cause: err });
      }
    },

    // Semantic search: orders by cosine distance (pgvector's `<=>` operator)
    // between each todo's stored embedding and the query's embedding —
    // lower `distance` means more similar. The query vector is sent as the
    // same '[0.1,0.2,...]' text format used on insert, explicitly cast to
    // `vector` since operator resolution (unlike an INSERT's assignment
    // cast) won't infer that cast on its own. `maxDistance` excludes rows
    // that aren't actually relevant — without it, this always returns up
    // to `limit` rows even when the closest "match" is nothing alike
    // (callers must supply both; see todoService's defaults).
    async searchByUser(userId, queryEmbedding, { limit, maxDistance }) {
      try {
        const result = await pool.query(
          `SELECT ${PUBLIC_COLUMNS}, embedding <=> $1::vector AS distance
           FROM todos
           WHERE user_id=$2 AND embedding <=> $1::vector < $3
           ORDER BY distance ASC
           LIMIT $4`,
          [JSON.stringify(queryEmbedding), userId, maxDistance, limit]
        );
        return result.rows;
      } catch (err) {
        throw new RepositoryError("Failed to search todos", { cause: err });
      }
    },

    async markCompleted(id, userId) {
      return updateFields({ status: "done" }, { id, userId });
    },

    // Undo fully resets the todo back to its pristine active state — status
    // and due_date both cleared — so it reappears in the Active lane, not
    // wherever it happened to have a due_date pointing before completion.
    async markPending(id, userId) {
      return updateFields({ status: "pending", due_date: null }, { id, userId });
    },

    async snoozeDueDate(id, userId, dueDate) {
      return updateFields({ due_date: dueDate }, { id, userId });
    },

    async clearDueDate(id, userId) {
      return updateFields({ due_date: null }, { id, userId });
    },
  };
}
