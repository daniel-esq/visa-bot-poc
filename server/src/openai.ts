// @ts-ignore
import OpenAI from "openai";

// @ts-ignore
export const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY
});

// Pick a current recommended model for API usage.
// Check docs for latest (often GPT-5 or GPT-4o). :contentReference[oaicite:2]{index=2}
// @ts-ignore
export const DEFAULT_MODEL = "gpt-5"; // keep in one place so you can swap easily
