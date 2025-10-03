import "dotenv/config";
// @ts-ignore
import express, {
    type Request,
    type Response,
    type NextFunction
} from "express";
// @ts-ignore
import OpenAI from "openai";

/**
 * server.ts — Single-file POC server using OpenAI Responses API with JSON Schema
 * Matches tsconfig (NodeNext ESM, target ES2022). Place this file at src/server.ts
 * Endpoints:
 *  - GET  /healthz                 -> "ok" (quick liveness)
 *  - POST /api/chat                -> Structured JSON (schema-validated)
 *  - POST /api/chat/stream         -> SSE stream of messages/final JSON
 */

// ---- OpenAI client & model selection ----
const openai = new OpenAI({apiKey: process.env.OPENAI_API_KEY});
const DEFAULT_MODEL = process.env.OPENAI_MODEL ?? "gpt-5"; // keep swappable

// ---- Schema (v1 slice) ----
const VisaIntakeSchema = {
    type: "object",
    additionalProperties: false,
    properties: {
        full_name: {type: "string", minLength: 1},
        dob: {type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$"},
        passport_number: {type: "string", minLength: 5},
        nationality: {type: "string", minLength: 2}
    },
    required: ["full_name", "dob", "passport_number", "nationality"]
} as const;

export type VisaIntake = {
    full_name: string;
    dob: string; // YYYY-MM-DD
    passport_number: string;
    nationality: string;
};

// ---- Express app ----
const app = express();
app.use(express.json({limit: "1mb"}));

// Simple liveness probe
app.get("/healthz", (_req: Request, res: Response) => {
    console.log("healthz");
    res.send("ok");
});

// Helper: extract validated JSON from Responses API result, defensively
function extractJsonFromResponse(r: any): unknown {
    try {
        // Newer SDKs often provide an aggregated text field
        const maybeText: string | undefined = (r as any).output_text;
        if (maybeText) {
            try {
                return JSON.parse(maybeText);
            } catch { /* fallthrough */
            }
        }

        // Structured content path
        const content = (r as any)?.output?.[0]?.content?.[0];
        if (content?.type === "output_json") {
            return content.json;
        }

        // Older shapes: find any JSON-looking string
        const raw = JSON.stringify(r);
        const match = raw.match(/\{[\s\S]*\}$/);
        if (match) {
            return JSON.parse(match[0]);
        }
    } catch { /* ignore */
    }
    return null;
}

// POST /api/chat � returns JSON validated against VisaIntakeSchema
app.post("/api/chat", async (req: Request, res: Response, next: NextFunction) => {
    try {
        const {userMessage} = (req.body || {}) as { userMessage?: string };
        if (!userMessage || typeof userMessage !== "string") {
            return res.status(400).json({error: "bad_request", message: "userMessage (string) is required"});
        }

        const r = await openai.responses.create({
            model: DEFAULT_MODEL,
            input: [
                {
                    role: "system",
                    content: "You are a visa intake assistant. Extract ONLY the fields in the schema. If a field is unknown, return null."
                },
                {role: "user", content: userMessage}
            ],
            text: {
                // @ts-ignore
                format: {
                    name: "VisaIntake",
                    type: "json_schema",
                    schema: VisaIntakeSchema
                }
            }
        });

        const data = extractJsonFromResponse(r) as VisaIntake | null;
        return res.json({data});
    } catch (err) {
        return next(err);
    }
});

app.post("/api/tts", async (req: Request, res: Response, next: NextFunction) => {
    try {
        const { text, voice } = (req.body || {}) as { text?: string; voice?: string };
        if (!text || typeof text !== "string") {
            return res.status(400).json({ error: "bad_request", message: "text (string) is required" });
        }

        const ttsModel = process.env.OPENAI_TTS_MODEL || "gpt-4o-mini-tts";
        const speechResponse = await openai.audio.speech.create({
            model: ttsModel,
            voice: voice && typeof voice === "string" ? voice : "alloy",
            input: text,
        });

        const audioBuffer = Buffer.from(await speechResponse.arrayBuffer());
        return res.json({ audioBase64: audioBuffer.toString("base64"), format: "mp3" });
    } catch (err) {
        return next(err);
    }
});
// POST /api/chat/stream — SSE stream of incremental messages and final JSON
app.post("/api/chat/stream", async (req: Request, res: Response, next: NextFunction) => {
    try {
        const {userMessage} = (req.body || {}) as { userMessage?: string };
        if (!userMessage || typeof userMessage !== "string") {
            res.status(400).json({error: "bad_request", message: "userMessage (string) is required"});
            return;
        }

        // SSE headers
        res.setHeader("Content-Type", "text/event-stream");
        res.setHeader("Cache-Control", "no-cache, no-transform");
        res.setHeader("Connection", "keep-alive");

        const stream = openai.responses.stream({
            model: DEFAULT_MODEL,
            input: [
                {role: "system", content: "You are a concise visa intake assistant."},
                {role: "user", content: userMessage}
            ],
            text: {
                format: {
                    name: "VisaIntake",
                    type: "json_schema",
                    schema: VisaIntakeSchema
                }
            }
        });

        // Forward incremental messages as they arrive
        // @ts-ignore
        stream.on("message", (msg: unknown) => {
            console.log("msg" + msg);
            res.write(`data: ${JSON.stringify({event: "message", payload: msg})}\n\n`);
        });

        // When the model emits the final structured message
        // @ts-ignore
        stream.on("finalMessage", (finalMsg: unknown) => {
            try {
                const data = extractJsonFromResponse(finalMsg);
                console.log("msg" + finalMsg);
                res.write(`data: ${JSON.stringify({event: "final", data})}\n\n`);
            } catch {
                // ignore parse issues, client still got message events
            }
        });

        stream.on("end", () => {
            console.log("Streaming end");
            res.write(`event: end\n`);
            res.end();
        });

        stream.on("error", (err: unknown) => {
            console.log("Error" + err);
            console.error("[SSE stream error]", err);
            res.write(`event: error\n`);
            res.end();
        });
    } catch (err) {
        return next(err);
    }
});

// Basic error handler (avoid leaking details)
app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    console.error(err);
    const message = err instanceof Error ? err.message : "internal_error";
    res.status(500).json({error: "internal_error", message});
});

// Start server
const port = Number(process.env.PORT) || 3000;
app.listen(port, () => {
    console.log(`API listening on :${port}`);
});



