// @ts-ignore
export const VisaIntakeSchema = {
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
