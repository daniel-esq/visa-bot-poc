import {useCallback, useEffect, useMemo, useRef, useState} from "react";
import questionsConfig from "./questions.json";
import "./App.css";

// Same-origin in prod; proxied in dev via vite.config.ts
const API_BASE = "";

function classNames(...xs: Array<string | false | null | undefined>) {
    return xs.filter(Boolean).join(" ");
}

function extractTextFromPayload(payload: any): string {
    if (!payload || typeof payload !== "object") return "";
    if (typeof payload.delta === "string") return payload.delta;
    if (typeof payload.text === "string") return payload.text;
    if (payload.data && typeof payload.data.text === "string") return payload.data.text;
    try {
        const content = payload?.response?.output?.[0]?.content;
        if (Array.isArray(content)) {
            const parts = content
                .map((c: any) => (typeof c?.text === "string" ? c.text : null))
                .filter(Boolean)
                .join("");
            if (parts) return parts;
        }
    } catch {
    }
    return "";
}

export default function App() {
    type QuestionKey = "full_name" | "dob" | "nationality" | "passport_number";

    type QuestionDefinition = {
        key: QuestionKey;
        title: string;
        hint?: string;
        placeholder?: string;
        type?: string;
        order: number;
    };

    type Answers = Record<QuestionKey, string>;

    const questions = useMemo<QuestionDefinition[]>(() => {
        return [...questionsConfig.questions]
            .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
            .map((q) => ({
                key: q.key as QuestionKey,
                title: q.title,
                hint: q.hint,
                placeholder: q.placeholder,
                type: q.type ?? "text",
                order: q.order ?? 0,
            }));
    }, []);

    const initialAnswers = useMemo<Answers>(() => {
        return questions.reduce((acc, q) => {
            acc[q.key] = "";
            return acc;
        }, {} as Answers);
    }, [questions]);

    const [currentStep, setCurrentStep] = useState<number>(0);
    const [answers, setAnswers] = useState<Answers>(initialAnswers);
    const [wizardError, setWizardError] = useState<string | null>(null);
    const [wizardLoading, setWizardLoading] = useState(false);
    const [wizardFinalJson, setWizardFinalJson] = useState<any | null>(null);

    const validate = useCallback((key: QuestionKey, value: string): string | null => {
        switch (key) {
            case "full_name":
                return value.trim() ? null : "Please enter your full name.";
            case "dob":
                return /^\d{4}-\d{2}-\d{2}$/.test(value) ? null : "Use format YYYY-MM-DD.";
            case "nationality":
                return value.trim() ? null : "Please enter your nationality.";
            case "passport_number":
                return value.trim().length >= 5 ? null : "Passport number looks too short.";
            default:
                return null;
        }
    }, []);

    const goNext = useCallback(() => {
        setWizardError(null);
        if (currentStep >= questions.length) {
            return;
        }
        const step = questions[currentStep];
        const value = answers[step.key];
        const err = validate(step.key, value || "");
        if (err) {
            setWizardError(err);
            return;
        }
        setCurrentStep((s) => Math.min(s + 1, questions.length));
    }, [answers, currentStep, questions, validate]);

    const goBack = useCallback(() => {
        setWizardError(null);
        setCurrentStep((s) => Math.max(0, s - 1));
    }, []);

    const submitIntake = useCallback(async () => {
        setWizardError(null);
        setWizardFinalJson(null);
        for (const q of questions) {
            const val = answers[q.key];
            const err = validate(q.key, val || "");
            if (err) {
                setWizardError(`${q.title}: ${err}`);
                setCurrentStep(questions.indexOf(q));
                return;
            }
        }
        setWizardLoading(true);
        try {
            const msg = questions.map((q) => `${q.title}: ${answers[q.key] || ""}`).join("\n");
            const resp = await fetch(`${API_BASE}/api/chat`, {
                method: "POST",
                headers: {"Content-Type": "application/json"},
                body: JSON.stringify({userMessage: msg}),
            });
            if (!resp.ok) throw new Error(`Submit failed (${resp.status})`);
            const json = await resp.json();
            setWizardFinalJson(json?.data ?? null);
        } catch (e: any) {
            setWizardError(e?.message || "Submission error");
        } finally {
            setWizardLoading(false);
        }
    }, [answers, questions, validate]);

    const [userMessage, setUserMessage] = useState("");
    const [isStreaming, setIsStreaming] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [events, setEvents] = useState<any[]>([]);
    const [finalJson, setFinalJson] = useState<any | null>(null);
    const [transcript, setTranscript] = useState("");
    const controllerRef = useRef<AbortController | null>(null);
    const scrollRef = useRef<HTMLDivElement | null>(null);
    const questionAudioRef = useRef<HTMLAudioElement | null>(null);

    useEffect(() => {
        if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }, [transcript]);

    const startStream = useCallback(async () => {
        setError(null);
        setEvents([]);
        setFinalJson(null);
        setTranscript("");

        const controller = new AbortController();
        controllerRef.current = controller;

        try {
            setIsStreaming(true);
            const res = await fetch(`${API_BASE}/api/chat/stream`, {
                method: "POST",
                headers: {"Content-Type": "application/json"},
                body: JSON.stringify({userMessage}),
                signal: controller.signal,
            });
            if (!res.ok || !res.body) throw new Error(`Stream failed with status ${res.status}`);

            const reader = res.body.getReader();
            const decoder = new TextDecoder();
            let buffer = "";

            while (true) {
                const {done, value} = await reader.read();
                if (done) break;
                buffer += decoder.decode(value, {stream: true});
                const parts = buffer.split("\n\n");
                buffer = parts.pop() ?? "";
                for (const chunk of parts) {
                    const line = chunk.trim();
                    if (!line.startsWith("data:")) continue;
                    const jsonStr = line.replace(/^data:\s?/, "");
                    try {
                        const evt = JSON.parse(jsonStr);
                        setEvents((prev) => [...prev, evt]);
                        if (evt.event === "message" && evt.payload) {
                            const text = extractTextFromPayload(evt.payload);
                            if (text) setTranscript((t) => t + text);
                        }
                        if (evt.event === "final") setFinalJson(evt.data ?? null);
                    } catch {
                    }
                }
            }
        } catch (e: any) {
            if (e?.name !== "AbortError") setError(e?.message || "Stream error");
        } finally {
            setIsStreaming(false);
            controllerRef.current = null;
        }
    }, [userMessage]);

    const stopStream = useCallback(() => {
        controllerRef.current?.abort();
        controllerRef.current = null;
        setIsStreaming(false);
    }, []);

    const exampleMessage = useMemo(
        () => "I am Jane Mary Doe, born 1991-04-12, passport AB1234567, nationality UK.",
        []
    );

    const totalSteps = questions.length;
    const isReviewStep = currentStep >= totalSteps;
    const currentQuestion = !isReviewStep ? questions[currentStep] : null;
    useEffect(() => {
        if (isReviewStep || !currentQuestion?.title) {
            questionAudioRef.current?.pause();
            questionAudioRef.current = null;
            return;
        }

        let cancelled = false;

        const speak = async () => {
            try {
                const resp = await fetch(`${API_BASE}/api/tts`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ text: currentQuestion.title })
                });
                if (!resp.ok) throw new Error(`TTS failed with status ${resp.status}`);
                const json = await resp.json();
                if (cancelled) return;
                if (!json?.audioBase64) throw new Error("TTS response missing audioBase64");
                const mime = json?.format ? `audio/${json.format}` : "audio/mp3";
                const audioUrl = `data:${mime};base64,${json.audioBase64}`;
                questionAudioRef.current?.pause();
                questionAudioRef.current = new Audio(audioUrl);
                questionAudioRef.current.play().catch((err) => {
                    console.warn("Question audio playback was blocked", err);
                });
            } catch (err) {
                console.error("Question TTS error", err);
            }
        };

        speak();

        return () => {
            cancelled = true;
            questionAudioRef.current?.pause();
            questionAudioRef.current = null;
        };
    }, [isReviewStep, currentQuestion?.title]);

    if (totalSteps === 0) {
        return (
            <div className="govuk-width-container govuk-!-margin-top-9">
                <h1 className="govuk-heading-l">No questions configured</h1>
                <p className="govuk-body">Add entries to <code>web/src/questions.json</code> to drive the intake flow.</p>
            </div>
        );
    }

    const wizardErrorSummary = wizardError ? (
        <div
            className="govuk-error-summary"
            aria-labelledby="wizard-error-title"
            role="alert"
            tabIndex={-1}
        >
            <h2 className="govuk-error-summary__title" id="wizard-error-title">
                There is a problem
            </h2>
            <div className="govuk-error-summary__body">
                <p className="govuk-error-message">{wizardError}</p>
            </div>
        </div>
    ) : null;

    return (
        <div className="app-page">
            
            <header className="gem-c-layout-super-navigation-header">
                <div className="gem-c-layout-super-navigation-header__container govuk-width-container">
                    <nav className="gem-c-layout-super-navigation-header__content" aria-label="GOV.UK">
                        <div className="gem-c-layout-super-navigation-header__header-logo">
                            <a class="govuk-header__link govuk-header__link--homepage" data-ga4-link="{&quot;event_name&quot;:&quot;navigation&quot;,&quot;type&quot;:&quot;header menu bar&quot;,&quot;external&quot;:&quot;false&quot;,&quot;text&quot;:&quot;GOV.UK&quot;,&quot;section&quot;:&quot;Logo&quot;,&quot;index_link&quot;:1,&quot;index_section&quot;:0,&quot;index_section_count&quot;:2,&quot;index_total&quot;:1}" id="logo" aria-label="Go to the GOV.UK homepage">
                                    <svg xmlns="http://www.w3.org/2000/svg" focusable="false" role="img" viewBox="0 0 324 60" height="30" width="162" fill="currentcolor" class="govuk-header__logotype" aria-label="GOV.UK">
                            <title>GOV.UK</title>
                            <g>
                                <circle cx="20" cy="17.6" r="3.7"></circle>
                                <circle cx="10.2" cy="23.5" r="3.7"></circle>
                                <circle cx="3.7" cy="33.2" r="3.7"></circle>
                                <circle cx="31.7" cy="30.6" r="3.7"></circle>
                                <circle cx="43.3" cy="17.6" r="3.7"></circle>
                                <circle cx="53.2" cy="23.5" r="3.7"></circle>
                                <circle cx="59.7" cy="33.2" r="3.7"></circle>
                                <circle cx="31.7" cy="30.6" r="3.7"></circle>
                                <path d="M33.1,9.8c.2-.1.3-.3.5-.5l4.6,2.4v-6.8l-4.6,1.5c-.1-.2-.3-.3-.5-.5l1.9-5.9h-6.7l1.9,5.9c-.2.1-.3.3-.5.5l-4.6-1.5v6.8l4.6-2.4c.1.2.3.3.5.5l-2.6,8c-.9,2.8,1.2,5.7,4.1,5.7h0c3,0,5.1-2.9,4.1-5.7l-2.6-8ZM37,37.9s-3.4,3.8-4.1,6.1c2.2,0,4.2-.5,6.4-2.8l-.7,8.5c-2-2.8-4.4-4.1-5.7-3.8.1,3.1.5,6.7,5.8,7.2,3.7.3,6.7-1.5,7-3.8.4-2.6-2-4.3-3.7-1.6-1.4-4.5,2.4-6.1,4.9-3.2-1.9-4.5-1.8-7.7,2.4-10.9,3,4,2.6,7.3-1.2,11.1,2.4-1.3,6.2,0,4,4.6-1.2-2.8-3.7-2.2-4.2.2-.3,1.7.7,3.7,3,4.2,1.9.3,4.7-.9,7-5.9-1.3,0-2.4.7-3.9,1.7l2.4-8c.6,2.3,1.4,3.7,2.2,4.5.6-1.6.5-2.8,0-5.3l5,1.8c-2.6,3.6-5.2,8.7-7.3,17.5-7.4-1.1-15.7-1.7-24.5-1.7h0c-8.8,0-17.1.6-24.5,1.7-2.1-8.9-4.7-13.9-7.3-17.5l5-1.8c-.5,2.5-.6,3.7,0,5.3.8-.8,1.6-2.3,2.2-4.5l2.4,8c-1.5-1-2.6-1.7-3.9-1.7,2.3,5,5.2,6.2,7,5.9,2.3-.4,3.3-2.4,3-4.2-.5-2.4-3-3.1-4.2-.2-2.2-4.6,1.6-6,4-4.6-3.7-3.7-4.2-7.1-1.2-11.1,4.2,3.2,4.3,6.4,2.4,10.9,2.5-2.8,6.3-1.3,4.9,3.2-1.8-2.7-4.1-1-3.7,1.6.3,2.3,3.3,4.1,7,3.8,5.4-.5,5.7-4.2,5.8-7.2-1.3-.2-3.7,1-5.7,3.8l-.7-8.5c2.2,2.3,4.2,2.7,6.4,2.8-.7-2.3-4.1-6.1-4.1-6.1h10.6,0Z"></path>
                            </g>
                            <circle class="govuk-logo-dot" cx="226" cy="36" r="7.3"></circle>
                            <path d="M93.94 41.25c.4 1.81 1.2 3.21 2.21 4.62 1 1.4 2.21 2.41 3.61 3.21s3.21 1.2 5.22 1.2 3.61-.4 4.82-1c1.4-.6 2.41-1.4 3.21-2.41.8-1 1.4-2.01 1.61-3.01s.4-2.01.4-3.01v.14h-10.86v-7.02h20.07v24.08h-8.03v-5.56c-.6.8-1.38 1.61-2.19 2.41-.8.8-1.81 1.2-2.81 1.81-1 .4-2.21.8-3.41 1.2s-2.41.4-3.81.4a18.56 18.56 0 0 1-14.65-6.63c-1.6-2.01-3.01-4.41-3.81-7.02s-1.4-5.62-1.4-8.83.4-6.02 1.4-8.83a20.45 20.45 0 0 1 19.46-13.65c3.21 0 4.01.2 5.82.8 1.81.4 3.61 1.2 5.02 2.01 1.61.8 2.81 2.01 4.01 3.21s2.21 2.61 2.81 4.21l-7.63 4.41c-.4-1-1-1.81-1.61-2.61-.6-.8-1.4-1.4-2.21-2.01-.8-.6-1.81-1-2.81-1.4-1-.4-2.21-.4-3.61-.4-2.01 0-3.81.4-5.22 1.2-1.4.8-2.61 1.81-3.61 3.21s-1.61 2.81-2.21 4.62c-.4 1.81-.6 3.71-.6 5.42s.8 5.22.8 5.22Zm57.8-27.9c3.21 0 6.22.6 8.63 1.81 2.41 1.2 4.82 2.81 6.62 4.82S170.2 24.39 171 27s1.4 5.62 1.4 8.83-.4 6.02-1.4 8.83-2.41 5.02-4.01 7.02-4.01 3.61-6.62 4.82-5.42 1.81-8.63 1.81-6.22-.6-8.63-1.81-4.82-2.81-6.42-4.82-3.21-4.41-4.01-7.02-1.4-5.62-1.4-8.83.4-6.02 1.4-8.83 2.41-5.02 4.01-7.02 4.01-3.61 6.42-4.82 5.42-1.81 8.63-1.81Zm0 36.73c1.81 0 3.61-.4 5.02-1s2.61-1.81 3.61-3.01 1.81-2.81 2.21-4.41c.4-1.81.8-3.61.8-5.62 0-2.21-.2-4.21-.8-6.02s-1.2-3.21-2.21-4.62c-1-1.2-2.21-2.21-3.61-3.01s-3.21-1-5.02-1-3.61.4-5.02 1c-1.4.8-2.61 1.81-3.61 3.01s-1.81 2.81-2.21 4.62c-.4 1.81-.8 3.61-.8 5.62 0 2.41.2 4.21.8 6.02.4 1.81 1.2 3.21 2.21 4.41s2.21 2.21 3.61 3.01c1.4.8 3.21 1 5.02 1Zm36.32 7.96-12.24-44.15h9.83l8.43 32.77h.4l8.23-32.77h9.83L200.3 58.04h-12.24Zm74.14-7.96c2.18 0 3.51-.6 3.51-.6 1.2-.6 2.01-1 2.81-1.81s1.4-1.81 1.81-2.81a13 13 0 0 0 .8-4.01V13.9h8.63v28.15c0 2.41-.4 4.62-1.4 6.62-.8 2.01-2.21 3.61-3.61 5.02s-3.41 2.41-5.62 3.21-4.62 1.2-7.02 1.2-5.02-.4-7.02-1.2c-2.21-.8-4.01-1.81-5.62-3.21s-2.81-3.01-3.61-5.02-1.4-4.21-1.4-6.62V13.9h8.63v26.95c0 1.61.2 3.01.8 4.01.4 1.2 1.2 2.21 2.01 2.81.8.8 1.81 1.4 2.81 1.81 0 0 1.34.6 3.51.6Zm34.22-36.18v18.92l15.65-18.92h10.82l-15.03 17.32 16.03 26.83h-10.21l-11.44-20.21-5.62 6.22v13.99h-8.83V13.9"></path>
                            </svg>
                            </a>
                        </div>
                    </nav>
                </div>
            </header>

            <div className="govuk-width-container govuk-!-margin-top-3">
                <nav className="govuk-breadcrumbs" aria-label="Breadcrumb">
                    <ol className="govuk-breadcrumbs__list">
                        <li className="govuk-breadcrumbs__list-item">
                            <a className="govuk-breadcrumbs__link" href="#">Home</a>
                        </li>
                        <li className="govuk-breadcrumbs__list-item">
                            <a className="govuk-breadcrumbs__link" href="#">Visas and immigration</a>
                        </li>
                        <li className="govuk-breadcrumbs__list-item" aria-current="page">
                            Apply for a Standard Visitor visa
                        </li>
                    </ol>
                </nav>
            </div>

            <main className="govuk-width-container govuk-main-wrapper" id="main-content" role="main">

                <div className="govuk-grid-row minWidth960">
                    <div className="govuk-grid-column-two-thirds">
                        <section className="govuk-!-margin-bottom-7">
                            {!isReviewStep ? (
                                <>


                                    <div className="govuk-form-group govuk-!-margin-bottom-4">
                                        <label className="govuk-label govuk-label--m" htmlFor="wizard-input">
                                            {currentQuestion?.title}
                                        </label>
                                        {currentQuestion?.hint && <div className="govuk-hint">{currentQuestion.hint}</div>}
                                        <input
                                            id="wizard-input"
                                            className="govuk-input"
                                            type={currentQuestion?.type}
                                            value={currentQuestion ? answers[currentQuestion.key] : ""}
                                            placeholder={currentQuestion?.placeholder}
                                            onChange={(e) =>
                                                currentQuestion &&
                                                setAnswers((a) => ({ ...a, [currentQuestion.key]: e.target.value }))
                                            }
                                            onKeyDown={(e) => {
                                                if (e.key === "Enter") {
                                                    e.preventDefault();
                                                    goNext();
                                                }
                                            }}
                                        />
                                    </div>

                                    {wizardErrorSummary}

                                    <div className="govuk-button-group">
                                        {currentStep > 0 && (
                                            <button
                                                type="button"
                                                className="govuk-button govuk-button--secondary"
                                                onClick={goBack}
                                            >
                                                Back
                                            </button>
                                        )}
                                        <button type="button" className="govuk-button" onClick={goNext}>
                                            {currentStep === totalSteps - 1 ? "Review your answers" : "Next question"}
                                        </button>
                                    </div>

                                    <p className="govuk-body govuk-!-margin-top-3">
                                        <strong>Progress:</strong> Step {currentStep + 1} of {totalSteps}
                                    </p>
                                </>
                            ) : (
                                <>
                                    <h2 className="govuk-heading-l">Review your answers</h2>
                                    <p className="govuk-body">
                                        Check the information below before submitting your responses to the visa team.
                                    </p>

                                    {wizardErrorSummary}

                                    <dl className="govuk-summary-list app-summary-list">
                                        {questions.map((q) => (
                                            <div className="govuk-summary-list__row" key={q.key}>
                                                <dt className="govuk-summary-list__key">{q.title}</dt>
                                                <dd className="govuk-summary-list__value">
                                                    {answers[q.key] || <span className="govuk-hint">Not provided</span>}
                                                </dd>
                                            </div>
                                        ))}
                                    </dl>

                                    <div className="govuk-button-group">
                                        <button
                                            type="button"
                                            className="govuk-button govuk-button--secondary"
                                            onClick={goBack}
                                        >
                                            Back
                                        </button>
                                        <button
                                            type="button"
                                            className="govuk-button"
                                            onClick={submitIntake}
                                            disabled={wizardLoading}
                                        >
                                            {wizardLoading ? "Submitting..." : "Submit responses"}
                                        </button>
                                    </div>

                                                                        {wizardFinalJson && (
                                        <>
                                            <h3 className="govuk-heading-m">Structured payload</h3>
                                            <div className="govuk-inset-text" style={{ maxHeight: 240, overflow: "auto" }}>
                                                <code>{JSON.stringify(wizardFinalJson, null, 2)}</code>
                                            </div>
                                        </>
                                    )}
                                </>
                            )}
                        </section>

                        
                    </div>

                    
                </div>
            </main>

            <footer className="govuk-footer" role="contentinfo">
                <div className="govuk-width-container">
                    <div className="govuk-footer__meta">
                        <div className="govuk-footer__meta-item govuk-footer__meta-item--grow">
                            <span className="govuk-footer__licence-description">
                                Built as a proof of concept using the GOV.UK Design System.
                            </span>
                        </div>
                    </div>
                </div>
            </footer>                                

        </div>
    );
}





















