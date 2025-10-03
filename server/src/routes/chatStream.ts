import type {Request, Response} from "express";
// @ts-ignore
import {openai, DEFAULT_MODEL} from "../openai";
// @ts-ignore
import {VisaIntakeSchema} from "../schemas/visa";

// @ts-ignore
export async function chatStreamHandler(req: Request, res: Response) {
    const {userMessage} = req.body as { userMessage: string };

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
            // @ts-ignore
            format: {
                name: "VisaIntake",
                type: "json_schema",
                schema: VisaIntakeSchema
            }
        }
    });

    // Stream tokens & final JSON
    // @ts-ignore
    stream.on("message", (msg) => {
        // msg contains incremental events; you can forward partial text if desired.
        res.write(`data: ${JSON.stringify(msg)}\n\n`);
    });

    stream.on("end", () => res.end());
    stream.on("error", (err: any) => {
        console.error(err);
        res.write(`event: error\ndata: ${JSON.stringify({error: "stream_error"})}\n\n`);
        res.end();
    });
}
