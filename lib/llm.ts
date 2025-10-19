import OpenAI from "openai";
import type { ChatMessage } from "./prompts";

const apiKey = process.env.OPENAI_API_KEY;
if (!apiKey) {
  console.warn("OPENAI_API_KEY is not set. API routes that depend on it will throw at runtime.");
}

const client = apiKey
  ? new OpenAI({
      apiKey
    })
  : null;

const CHAT_MODEL = process.env.OPENAI_CHAT_MODEL || "gpt-4o-mini";
const EMBED_MODEL = process.env.OPENAI_EMBED_MODEL || "text-embedding-3-small";

const embedCache = new Map<string, number[]>();

export async function chat(messages: ChatMessage[]): Promise<string> {
  if (!client) {
    throw new Error("OPENAI_API_KEY is not configured.");
  }

  const completion = await client.chat.completions.create({
    model: CHAT_MODEL,
    messages,
    temperature: 0.2,
    response_format: { type: "json_object" }
  });

  const content = completion.choices[0]?.message?.content;
  if (!content) {
    throw new Error("LLM応答が空でした。");
  }
  return content;
}

export async function embed(text: string): Promise<number[]> {
  if (!client) {
    throw new Error("OPENAI_API_KEY is not configured.");
  }

  if (embedCache.has(text)) {
    return embedCache.get(text)!;
  }

  const res = await client.embeddings.create({
    input: text,
    model: EMBED_MODEL
  });

  const vector = res.data[0]?.embedding;
  if (!vector) {
    throw new Error("埋め込みベクトルの取得に失敗しました。");
  }

  embedCache.set(text, vector);
  return vector;
}
