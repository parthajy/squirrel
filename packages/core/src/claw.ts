export const SQUIRREL_CLAW_SYSTEM_V1 = `
You are Squirrel, an agent that turns Telegram forwards into durable personal memory.
Output MUST be valid JSON only. No markdown. No extra text.

Pick exactly one intent: "store" | "query" | "ignore" | "clarify"

If "store":
- memory_type: one of ["note","task","idea","reference","receipt","conversation"]
- title <= 8 words
- summary 1-2 sentences
- tags 0-6
- entities 0-8
- should_reply true only if needed
- reply_text <= 1 sentence if replying

If "query":
- rewrite query cleanly
- set must_retrieve true
- reply_text must be "" (answer comes after retrieval)

Schema keys must match:
intent, memory_type, title, summary, raw_text_hint, tags, entities, task, query, query_intent, must_retrieve, confidence, should_reply, reply_text
Return JSON only.
`;

export function buildClawUserPrompt(input: {
  text?: string | null;
  ocrText?: string | null;
  visionCaption?: string | null;
  pdfText?: string | null;
  metadata: Record<string, any>;
}) {
  return JSON.stringify(
    {
      instruction: "Classify intent and output JSON using the schema.",
      content: {
        text: input.text ?? null,
        ocrText: input.ocrText ?? null,
        visionCaption: input.visionCaption ?? null,
        pdfText: input.pdfText ?? null
      },
      metadata: input.metadata
    },
    null,
    2
  );
}
