import { jest } from "@jest/globals";

const createChatCompletion = jest.fn();
const createEmbedding = jest.fn();

jest.unstable_mockModule("../azureOpenAIClient.js", () => ({
  getAzureOpenAIClient: jest.fn(() => ({
    chat: { completions: { create: createChatCompletion } },
    embeddings: { create: createEmbedding },
  })),
}));

// mcpAgent.js reads its deployment names from env at import time, so these
// must be set before the dynamic import below.
process.env.AZURE_OPENAI_CHAT_DEPLOYMENT = "test-chat-deployment";
process.env.AZURE_OPENAI_EMBEDDING_DEPLOYMENT = "test-embedding-deployment";

const { mcpAgent } = await import("../mcpAgent.js");

beforeEach(() => {
  createChatCompletion.mockReset();
  createEmbedding.mockReset();
});

function chatResponse(content) {
  return { choices: [{ message: { content: JSON.stringify(content) } }] };
}

describe("mcpAgent.parseTodos", () => {
  test("returns multiple todos when the model splits the input", async () => {
    createChatCompletion.mockResolvedValueOnce(
      chatResponse({
        todos: [
          { description: "Buy milk", due_date: null, priority: false },
          { description: "Call mom", due_date: "2026-09-23T18:00:00.000Z", priority: true },
        ],
      })
    );

    const todos = await mcpAgent.parseTodos("Buy milk\nCall mom tomorrow at 6pm, it's important");

    expect(todos).toEqual([
      { description: "Buy milk", due_date: null, priority: false },
      { description: "Call mom", due_date: "2026-09-23T18:00:00.000Z", priority: true },
    ]);
    expect(createChatCompletion.mock.calls[0][0]).toMatchObject({
      model: "test-chat-deployment",
      response_format: { type: "json_object" },
    });
  });

  test.each([null, undefined, "", "   ", 42])("rejects invalid text %p", async (text) => {
    await expect(mcpAgent.parseTodos(text)).rejects.toThrow();
    expect(createChatCompletion).not.toHaveBeenCalled();
  });

  test("throws when the model response has no content", async () => {
    createChatCompletion.mockResolvedValueOnce({ choices: [{ message: {} }] });
    await expect(mcpAgent.parseTodos("Buy milk")).rejects.toThrow(/no content/);
  });

  test("throws when the model returns invalid JSON", async () => {
    createChatCompletion.mockResolvedValueOnce({ choices: [{ message: { content: "not json" } }] });
    await expect(mcpAgent.parseTodos("Buy milk")).rejects.toThrow(/invalid JSON/);
  });

  test("throws when the model returns an empty todos array", async () => {
    createChatCompletion.mockResolvedValueOnce(chatResponse({ todos: [] }));
    await expect(mcpAgent.parseTodos("Buy milk")).rejects.toThrow(/non-empty/);
  });

  test("throws when a returned todo has an invalid description", async () => {
    createChatCompletion.mockResolvedValueOnce(
      chatResponse({ todos: [{ description: "", due_date: null, priority: false }] })
    );
    await expect(mcpAgent.parseTodos("Buy milk")).rejects.toThrow(/invalid description/);
  });

  test("throws when a returned todo has an invalid due_date", async () => {
    createChatCompletion.mockResolvedValueOnce(
      chatResponse({ todos: [{ description: "Buy milk", due_date: "not-a-date", priority: false }] })
    );
    await expect(mcpAgent.parseTodos("Buy milk")).rejects.toThrow(/invalid due_date/);
  });
});

describe("mcpAgent.embed", () => {
  test("returns the embedding vector from the API response", async () => {
    createEmbedding.mockResolvedValueOnce({ data: [{ embedding: [0.1, 0.2, 0.3] }] });

    const vec = await mcpAgent.embed("hello");

    expect(vec).toEqual([0.1, 0.2, 0.3]);
    expect(createEmbedding.mock.calls[0][0]).toMatchObject({
      model: "test-embedding-deployment",
      input: "hello",
    });
  });

  test("rejects invalid text", async () => {
    await expect(mcpAgent.embed("")).rejects.toThrow();
    expect(createEmbedding).not.toHaveBeenCalled();
  });

  test("throws when the API response has no embedding", async () => {
    createEmbedding.mockResolvedValueOnce({ data: [] });
    await expect(mcpAgent.embed("hello")).rejects.toThrow(/no embedding/);
  });
});

describe("mcpAgent.summarizeDay", () => {
  test("counts completed and lists pending todos", async () => {
    const summary = await mcpAgent.summarizeDay([
      { status: "done", description: "A" },
      { status: "pending", description: "B" },
      { status: "pending", description: "C" },
    ]);
    expect(summary).toContain("1 task");
    expect(summary).toContain("B, C");
  });

  test("handles no pending todos", async () => {
    const summary = await mcpAgent.summarizeDay([{ status: "done", description: "A" }]);
    expect(summary).toContain("Pending: none");
  });

  test("rejects non-array input", async () => {
    await expect(mcpAgent.summarizeDay(null)).rejects.toThrow();
  });
});
