import { getAzureOpenAIClient } from "./azureOpenAIClient.js";

const CHAT_DEPLOYMENT = process.env.AZURE_OPENAI_CHAT_DEPLOYMENT;
const EMBEDDING_DEPLOYMENT = process.env.AZURE_OPENAI_EMBEDDING_DEPLOYMENT;
const EMBEDDING_DIM = process.env.EMBEDDING_DIM ? Number(process.env.EMBEDDING_DIM) : undefined;

const PARSE_SYSTEM_PROMPT = `You are a todo-parsing assistant for a task manager. Given free-form user input, extract every distinct todo item it describes.

For each item return:
- "description": a concise imperative description of the task
- "due_date": an ISO 8601 date-time string if a date/time is stated or clearly implied, otherwise null
- "priority": true if the task is described as urgent, important, or high priority, otherwise false

Rules:
- If the input describes multiple distinct tasks (separate lines, a numbered/bulleted list, or clauses joined by "and"/"then"/semicolons), return one entry per task.
- If it describes a single task, return exactly one entry.
- Never invent a due date that isn't stated or clearly implied by the text.
- Respond with ONLY a JSON object of the form {"todos": [{"description": "...", "due_date": "..."|null, "priority": true|false}, ...]}. No other text.`;

function buildUserPrompt(text) {
  return `Current date/time (for resolving relative dates like "tomorrow"): ${new Date().toISOString()}\n\nInput:\n${text}`;
}

async function requestParsedTodos(text) {
  if (!CHAT_DEPLOYMENT) {
    throw new Error(
      "Azure OpenAI chat deployment is not configured: set AZURE_OPENAI_CHAT_DEPLOYMENT (see .env.example)."
    );
  }

  const client = getAzureOpenAIClient();
  const response = await client.chat.completions.create({
    model: CHAT_DEPLOYMENT,
    response_format: { type: "json_object" },
    temperature: 0,
    messages: [
      { role: "system", content: PARSE_SYSTEM_PROMPT },
      { role: "user", content: buildUserPrompt(text) },
    ],
  });

  const raw = response.choices?.[0]?.message?.content;
  if (!raw) {
    throw new Error("Azure OpenAI returned no content while parsing todos");
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(`Azure OpenAI returned invalid JSON while parsing todos: ${err.message}`);
  }

  if (!Array.isArray(parsed?.todos) || parsed.todos.length === 0) {
    throw new Error('Azure OpenAI response did not include a non-empty "todos" array');
  }

  return parsed.todos.map((item, index) => {
    if (typeof item?.description !== "string" || !item.description.trim()) {
      throw new Error(`Azure OpenAI returned a todo at index ${index} with an invalid description`);
    }
    if (item.due_date != null && Number.isNaN(Date.parse(item.due_date))) {
      throw new Error(`Azure OpenAI returned a todo at index ${index} with an invalid due_date`);
    }

    return {
      description: item.description.trim(),
      due_date: item.due_date ?? null,
      priority: Boolean(item.priority),
    };
  });
}

export const mcpAgent = {
  async parseTodo(text) {
    if (typeof text !== "string" || !text.trim()) {
      throw new Error("parseTodo requires non-empty text");
    }

    const [todo] = await requestParsedTodos(text.trim());
    return todo;
  },

  // Splits a longer input into multiple todos when the model determines it
  // describes more than one task (see PARSE_SYSTEM_PROMPT above); a single
  // unstructured sentence comes back as a one-item array.
  async parseTodos(text) {
    if (typeof text !== "string" || !text.trim()) {
      throw new Error("parseTodos requires non-empty text");
    }

    return requestParsedTodos(text.trim());
  },

  async embed(text) {
    if (typeof text !== "string" || !text.trim()) {
      throw new Error("embed requires non-empty text");
    }
    if (!EMBEDDING_DEPLOYMENT) {
      throw new Error(
        "Azure OpenAI embedding deployment is not configured: set AZURE_OPENAI_EMBEDDING_DEPLOYMENT (see .env.example)."
      );
    }

    const client = getAzureOpenAIClient();
    const response = await client.embeddings.create({
      model: EMBEDDING_DEPLOYMENT,
      input: text,
      ...(EMBEDDING_DIM ? { dimensions: EMBEDDING_DIM } : {}),
    });

    const embedding = response.data?.[0]?.embedding;
    if (!Array.isArray(embedding)) {
      throw new Error("Azure OpenAI returned no embedding vector");
    }

    return embedding;
  },

  async summarizeDay(todos) {
    if (!Array.isArray(todos)) {
      throw new Error("summarizeDay requires an array of todos");
    }

    const completed = todos.filter((t) => t.status === "done").length;
    const pending = todos.filter((t) => t.status === "pending");
    const pendingList = pending.map((p) => p.description).join(", ") || "none";

    return `You completed ${completed} task${completed === 1 ? "" : "s"}. Pending: ${pendingList}`;
  },
};
