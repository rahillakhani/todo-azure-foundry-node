import "dotenv/config";
import OpenAI from "openai";

// Azure OpenAI's GA v1 API is reached through the plain `OpenAI` client
// pointed at the resource's /openai/v1/ base URL with the resource API key —
// no separate @azure/openai or @azure/identity package needed for key-based
// auth. See https://github.com/openai/openai-node/blob/master/docs/azure.md
let client;

export function getAzureOpenAIClient() {
  if (client) return client;

  const endpoint = process.env.AZURE_OPENAI_ENDPOINT;
  const apiKey = process.env.AZURE_OPENAI_API_KEY;

  if (!endpoint || !apiKey) {
    throw new Error(
      "Azure OpenAI is not configured: set AZURE_OPENAI_ENDPOINT and AZURE_OPENAI_API_KEY (see .env.example)."
    );
  }

  client = new OpenAI({
    baseURL: `${endpoint.replace(/\/+$/, "")}/openai/v1/`,
    apiKey,
  });

  return client;
}
