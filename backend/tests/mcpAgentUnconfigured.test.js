import { jest } from "@jest/globals";

// Verifies mcpAgent fails closed with an actionable error when Azure OpenAI
// deployment env vars aren't set, rather than silently doing nothing or
// falling back to fake data.

const createChatCompletion = jest.fn();
const createEmbedding = jest.fn();

jest.unstable_mockModule("../azureOpenAIClient.js", () => ({
  getAzureOpenAIClient: jest.fn(() => ({
    chat: { completions: { create: createChatCompletion } },
    embeddings: { create: createEmbedding },
  })),
}));

delete process.env.AZURE_OPENAI_CHAT_DEPLOYMENT;
delete process.env.AZURE_OPENAI_EMBEDDING_DEPLOYMENT;

const { mcpAgent } = await import("../mcpAgent.js");

test("parseTodos throws a clear config error when AZURE_OPENAI_CHAT_DEPLOYMENT is unset", async () => {
  await expect(mcpAgent.parseTodos("Buy milk")).rejects.toThrow(/AZURE_OPENAI_CHAT_DEPLOYMENT/);
  expect(createChatCompletion).not.toHaveBeenCalled();
});

test("embed throws a clear config error when AZURE_OPENAI_EMBEDDING_DEPLOYMENT is unset", async () => {
  await expect(mcpAgent.embed("Buy milk")).rejects.toThrow(/AZURE_OPENAI_EMBEDDING_DEPLOYMENT/);
  expect(createEmbedding).not.toHaveBeenCalled();
});
