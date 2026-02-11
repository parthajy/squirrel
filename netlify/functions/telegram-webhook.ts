import type { Handler } from "@netlify/functions";
import OpenAI from "openai";
import pdfParse from "pdf-parse";
import { adminSupabase } from "./_lib/supabase";
import { env, assertEnv } from "./_lib/env";
import { json } from "./_lib/http";
import { SQUIRREL_CLAW_SYSTEM_V1, buildClawUserPrompt, type ClawDecision } from "@squirrel/core";

assertEnv();
const openai = new OpenAI({ apiKey: env.OPENAI_API_KEY });

function isQuery(text: string) {
  const t = text.trim().toLowerCase();
  if (t.startsWith("?")) return true;
  if (t.startsWith("ask ")) return true;
  return /(what did i|when did i|find|show|summarize|recap|search|did i|deadline|remind me)/.test(t);
}

async function telegramGetFileUrl(fileId: string): Promise<string | null> {
  const r = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/getFile`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ file_id: fileId }),
  });
  const j: any = await r.json();
  const filePath = j?.result?.file_path;
  if (!filePath) return null;
  return `https://api.telegram.org/file/bot${env.TELEGRAM_BOT_TOKEN}/${filePath}`;
}

async function downloadBuffer(url: string): Promise<Buffer> {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`download failed ${r.status}`);
  const ab = await r.arrayBuffer();
  return Buffer.from(ab);
}

// Best-effort image caption. If vision fails, returns null (and we still store the image URL).
async function captionImageUrl(url: string): Promise<string | null> {
  try {
    // Uses Responses API if available in your openai version
    // If not available at runtime, catch and return null.
    const resp: any = await (openai as any).responses.create({
      model: "gpt-4.1-mini",
      input: [
        {
          role: "user",
          content: [
            { type: "input_text", text: "Write a short caption of what this image shows. Be specific. 1-2 sentences." },
            { type: "input_image", image_url: url },
          ],
        },
      ],
    });
    const text = resp?.output_text;
    return typeof text === "string" && text.trim() ? text.trim() : null;
  } catch {
    return null;
  }
}

async function extractPdfTextFromUrl(url: string): Promise<string | null> {
  try {
    const buf = await downloadBuffer(url);
    const out: any = await pdfParse(buf);
    const text = String(out?.text || "").trim();
    if (!text) return null;
    // Keep it bounded so embeddings + claw don’t explode
    return text.slice(0, 12000);
  } catch {
    return null;
  }
}

async function telegramSend(chatId: string | number, text: string, extra?: any) {
  const url = `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`;
  await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text, ...extra }),
  });
}

async function telegramAskShareContact(chatId: string | number) {
  return telegramSend(chatId, "To enable dashboard login, share your phone number:", {
    reply_markup: {
      keyboard: [[{ text: "Share Phone ✅", request_contact: true }]],
      resize_keyboard: true,
      one_time_keyboard: true,
    },
  });
}

async function getOrCreateUser(telegramUserId: string, username?: string) {
  const { data: existing } = await adminSupabase
    .from("squirrel_users")
    .select("*")
    .eq("telegram_user_id", telegramUserId)
    .maybeSingle();

  if (existing) {
    await adminSupabase.from("squirrel_users").update({ last_seen_at: new Date().toISOString() }).eq("id", existing.id);
    return existing;
  }

  const { data, error } = await adminSupabase
    .from("squirrel_users")
    .insert({
      telegram_user_id: telegramUserId,
      telegram_username: username ?? null,
      last_seen_at: new Date().toISOString(),
    })
    .select("*")
    .single();

  if (error) throw error;
  return data;
}

async function embedText(text: string): Promise<number[]> {
  const resp = await openai.embeddings.create({ model: "text-embedding-3-small", input: text });
  return resp.data[0].embedding as unknown as number[];
}

async function clawDecide(input: {
  text?: string | null;
  ocrText?: string | null;
  visionCaption?: string | null;
  pdfText?: string | null;
  metadata: Record<string, any>;
}): Promise<ClawDecision> {
  const resp = await openai.chat.completions.create({
    model: "gpt-4.1-mini",
    temperature: 0.2,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: SQUIRREL_CLAW_SYSTEM_V1 },
      { role: "user", content: buildClawUserPrompt(input) },
    ],
  });

  return JSON.parse(resp.choices[0]?.message?.content || "{}");
}

async function storeMemory(
  userId: string,
  decision: any,
  rawText: string | null,
  metadata: Record<string, any>
) {
  // Fallbacks (critical for attachments)
  const title =
    (decision.title && String(decision.title).trim()) ||
    metadata.file_name ||
    (metadata.kind === "pdf" ? "PDF Document" : metadata.kind === "image" ? "Image" : "Note");

  const summary =
    (decision.summary && String(decision.summary).trim()) ||
    (metadata.kind === "pdf" ? "Saved a PDF." : metadata.kind === "image" ? "Saved an image." : (rawText || "").slice(0, 240));

  const toEmbed = `${title}\n${summary}\n${rawText ?? ""}\n\nMETA:\n${JSON.stringify(metadata)}`.slice(0, 8000);
  const embedding = await embedText(toEmbed);

  const { data, error } = await adminSupabase
    .from("squirrel_memories")
    .insert({
      user_id: userId,
      type: decision.memory_type || metadata.kind || "note",
      title,
      summary,
      raw_text: rawText,
      tags: decision.tags ?? [],
      entities: decision.entities ?? [],
      embedding,
      // store some lightweight metadata in raw_text and/or add a jsonb column later
    })
    .select("id")
    .single();

  if (error) throw error;
  return data;
}

async function retrieve(userId: string, query: string) {
  const qEmbed = await embedText(query);
  const { data, error } = await adminSupabase.rpc("squirrel_match_memories", {
    p_user_id: userId,
    p_query_embedding: qEmbed,
    p_match_count: 12,
  });
  if (error) throw error;

  const rows = (data as any[]) ?? [];

// Deduplicate by id/title
const seen = new Set<string>();
const deduped = rows.filter((r) => {
  const k = String(r.id || r.title || "").trim();
  if (!k || seen.has(k)) return false;
  seen.add(k);
  return true;
});

const strong = deduped.filter((r) => (r.similarity ?? 0) >= 0.78);
return strong.length ? strong : deduped.slice(0, 4);
}

async function answerQuery(userId: string, query: string) {
  const candidates = await retrieve(userId, query);

  if (!candidates.length) {
    return "I don’t have anything solid on that yet. Save a bit more context and try again.";
  }

  const resp = await openai.chat.completions.create({
    model: "gpt-4.1-mini",
    temperature: 0.2,
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content:
  "You are Squirrel, a personal memory assistant. Answer using ONLY the provided memories. " +
  "Be specific: mention file names, captions, and concrete details. " +
  "If the answer isn't present, say: 'I don’t know based on what you’ve saved yet.' " +
  "Output JSON: {text:string}.",

      },
      { role: "user", content: JSON.stringify({ query, candidates }, null, 2) },
    ],
  });

  const out = JSON.parse(resp.choices[0]?.message?.content || "{}");
  const sources =
    "\n\nSources:\n" +
    candidates
      .slice(0, 4)
      .map((c: any) => `• ${c.title} (${new Date(c.created_at).toLocaleDateString()})`)
      .join("\n");

  return `${out.text || "I couldn’t find that in your memories yet."}${sources}`;
}

export const handler: Handler = async (event) => {
  try {
    const update = JSON.parse(event.body || "{}");
    const msg = update.message || update.edited_message;
    if (!msg) return json(200, { ok: true });

    const chatId = msg.chat?.id;
    const from = msg.from;
    const telegramUserId = String(from?.id || "");
    const username = from?.username ? String(from.username) : undefined;
    if (!chatId || !telegramUserId) return json(200, { ok: true });

    const user = await getOrCreateUser(telegramUserId, username);

    // Contact capture (for dashboard OTP login later)
    if (msg.contact?.phone_number) {
      // Telegram gives local format sometimes; store raw and normalize later if needed
      const phoneRaw = String(msg.contact.phone_number);
      const phoneE164 = phoneRaw.startsWith("+") ? phoneRaw : `+${phoneRaw.replace(/[^\d]/g, "")}`;

      await adminSupabase.from("squirrel_users").update({ phone_e164: phoneE164 }).eq("id", user.id);
      await telegramSend(chatId, "✅ Phone linked. You can login to the dashboard anytime.");
      return json(200, { ok: true });
    }

    // Start command
    if (msg.text?.trim() === "/start") {
      await telegramSend(chatId, "Welcome to Squirrel. Forward anything here and I’ll remember it.");
      if (!user.phone_e164) await telegramAskShareContact(chatId);
      return json(200, { ok: true });
    }

    const text = (msg.text || msg.caption || "").trim();

const metadata = {
  chat_id: chatId,
  message_id: msg.message_id,
  telegram_user_id: telegramUserId,
  telegram_username: username ?? null,
  date: msg.date,
  forward_from: msg.forward_from ? { id: msg.forward_from.id, username: msg.forward_from.username } : null,
  forward_from_chat: msg.forward_from_chat ? { id: msg.forward_from_chat.id, title: msg.forward_from_chat.title } : null,
};

// ✅ Fast path: if it's clearly a question, answer immediately (no Claw)
if (msg.text && text && isQuery(text)) {
  const q = text.replace(/^\?/, "").replace(/^ask\s+/i, "").trim();
  const ans = await answerQuery(user.id, q);
  await telegramSend(chatId, ans);
  return json(200, { ok: true });
}

// --- Attachments (Phase 1) ---
let pdfText: string | null = null;
let visionCaption: string | null = null;

const document = msg.document;
const photos = msg.photo;

// PDF
if (document?.file_id && (document?.mime_type === "application/pdf" || String(document?.file_name || "").toLowerCase().endsWith(".pdf"))) {
  const url = await telegramGetFileUrl(String(document.file_id));
  if (url) pdfText = await extractPdfTextFromUrl(url);
}

// Image (pick the largest photo)
if (Array.isArray(photos) && photos.length) {
  const best = photos[photos.length - 1];
  const url = await telegramGetFileUrl(String(best.file_id));
  if (url) visionCaption = await captionImageUrl(url);
}

// Feed Claw with richer input (text + pdf + image caption)
const decision = await clawDecide({
  text: text || null,
  pdfText,
  visionCaption,
  metadata,
});

    if (decision.intent === "ignore") return json(200, { ok: true });

    if (decision.intent === "clarify") {
      await telegramSend(chatId, decision.reply_text || "Quick question—what should I remember from this?");
      return json(200, { ok: true });
    }

    if (decision.intent === "store") {
  const kind = pdfText ? "pdf" : visionCaption ? "image" : "note";

  const file_name =
    msg.document?.file_name ||
    (kind === "image" ? "Telegram Photo" : null);

  const raw =
    [
      text ? `[Text]\n${text}` : "",
      visionCaption ? `\n\n[Image Caption]\n${visionCaption}` : "",
      pdfText ? `\n\n[PDF Text]\n${pdfText}` : "",
      file_name ? `\n\n[File]\n${file_name}` : "",
    ]
      .join("")
      .trim() || null;

  await storeMemory(user.id, decision, raw, {
    kind,
    file_name,
    mime_type: msg.document?.mime_type || null,
    telegram: { chat_id: chatId, message_id: msg.message_id },
  });

  await telegramSend(chatId, "✅ Saved.");
  return json(200, { ok: true });
}

    if (decision.intent === "query") {
      const ans = await answerQuery(user.id, decision.query || text);
      await telegramSend(chatId, ans);
      return json(200, { ok: true });
    }

    return json(200, { ok: true });
  } catch (e: any) {
    console.error("telegram-webhook error", e);
    return json(200, { ok: true });
  }
};
