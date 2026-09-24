import { RepositoryError } from "../errors.js";

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
        `UPDATE todos SET ${setClause} WHERE id=$${values.length + 1} AND user_id=$${values.length + 2} RETURNING *`,
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
          "SELECT * FROM todos WHERE user_id=$1 ORDER BY created_at DESC",
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
          "SELECT * FROM todos WHERE user_id=$1 AND due_date > NOW()",
          [userId]
        );
        return result.rows;
      } catch (err) {
        throw new RepositoryError("Failed to fetch reminders", { cause: err });
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
