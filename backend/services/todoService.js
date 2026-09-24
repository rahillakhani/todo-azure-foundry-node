import { AgentError, NotFoundError } from "../errors.js";

const SUMMARY_CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour
const DEFAULT_SNOOZE_MINUTES = 60;

// Orchestrates the AI agent + repository to turn raw input into stored
// todos. Depends only on the `agent`/`repository` shapes it's given
// (constructor injection), not on concrete Azure OpenAI or pg modules —
// callers wire the real implementations together once, at the composition
// root (server.js).
export function createTodoService({ agent, repository }) {
  // Per-user cache so the (potentially AI-generated) daily summary is only
  // recomputed once an hour, no matter how often a client asks for it (WS
  // reconnects, manual refresh, multiple tabs). Time-based only — creating/
  // completing/snoozing a todo does not invalidate it, so the summary can
  // lag up to an hour behind the actual todo state; that's the intended
  // trade-off, not a bug.
  const summaryCache = new Map();

  async function parseTodos(text) {
    try {
      return await agent.parseTodos(text);
    } catch (err) {
      throw new AgentError("Failed to understand the todo input", { cause: err });
    }
  }

  async function embed(description) {
    try {
      return await agent.embed(description);
    } catch (err) {
      throw new AgentError("Failed to generate an embedding for the todo", { cause: err });
    }
  }

  return {
    // A longer/multi-line input can describe more than one todo. The agent
    // decides whether it's a single simple todo or several — inferring due
    // dates/priority along the way — and one row is persisted per item it
    // returns. An explicit due_date/priority from the caller overrides
    // every item in the batch (there's one reminder/priority input per
    // submission, not one per item).
    async createTodos({ text, userId, dueDateOverride, priorityOverride }) {
      const parsedTodos = await parseTodos(text);
      const createdTodos = [];

      for (const parsed of parsedTodos) {
        const todo = { ...parsed };
        if (dueDateOverride !== undefined) todo.due_date = dueDateOverride;
        if (priorityOverride !== undefined) todo.priority = priorityOverride;

        const embedding = await embed(todo.description);

        await repository.insertTodo({
          userId,
          description: todo.description,
          due_date: todo.due_date,
          priority: todo.priority,
          embedding,
        });

        createdTodos.push(todo);
      }

      return createdTodos;
    },

    async listTodos(userId) {
      return repository.listByUser(userId);
    },

    async getReminders(userId) {
      return repository.listRemindersByUser(userId);
    },

    async getSummary(userId) {
      const cached = summaryCache.get(userId);
      if (cached && Date.now() - cached.generatedAt < SUMMARY_CACHE_TTL_MS) {
        return cached.summary;
      }

      const todos = await repository.listByUser(userId);
      let summary;
      try {
        summary = await agent.summarizeDay(todos);
      } catch (err) {
        throw new AgentError("Failed to summarize today's todos", { cause: err });
      }

      summaryCache.set(userId, { summary, generatedAt: Date.now() });
      return summary;
    },

    async completeTodo(id, userId) {
      const todo = await repository.markCompleted(id, userId);
      if (!todo) throw new NotFoundError("Todo not found");
      return todo;
    },

    async undoTodo(id, userId) {
      const todo = await repository.markPending(id, userId);
      if (!todo) throw new NotFoundError("Todo not found");
      return todo;
    },

    async snoozeTodo(id, userId, minutes = DEFAULT_SNOOZE_MINUTES) {
      const dueDate = new Date(Date.now() + minutes * 60_000).toISOString();
      const todo = await repository.snoozeDueDate(id, userId, dueDate);
      if (!todo) throw new NotFoundError("Todo not found");
      return todo;
    },

    async unsnoozeTodo(id, userId) {
      const todo = await repository.clearDueDate(id, userId);
      if (!todo) throw new NotFoundError("Todo not found");
      return todo;
    },
  };
}
