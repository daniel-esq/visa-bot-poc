import type {Request, Response} from "express";
// @ts-ignore
import {openai, DEFAULT_MODEL} from "../openai";
// @ts-ignore
import {VisaIntakeSchema, type VisaIntake} from "../schemas/visa";

// @ts-ignore
export async function chatHandler(req: Request, res: Response) {
    const {userMessage} = req.body as { userMessage: string };

    const r = await openai.responses.create({
        model: DEFAULT_MODEL,
        input: [
            {
                role: "system",
                content:
                    "You are a visa intake assistant. Extract ONLY the fields in the schema. If a field is missing, infer cautiously or return a null."
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

    // In recent SDKs, text or json is conveniently aggregated:
    const json = (r as any).output ? (r as any).output[0].content[0] : null;
    const text = (r as any).output_text as string | undefined;

    let data: VisaIntake | null = null;
    if (json?.type === "output_json") {
        data = json.json as VisaIntake;
    } else if (text) {
        // Fallback for older SDKs that return JSON as text
        data = JSON.parse(text) as VisaIntake;
    }

    res.json({data});
}
