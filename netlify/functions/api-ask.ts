import type { Handler } from "@netlify/functions";
import OpenAI from "openai";
import { adminSupabase } from "./_lib/supabase";
import { env } from "./_lib/env";
import { json, getCookie } from "./_lib/http";
import { sha256 } from "./_lib/crypto";

const openai = new OpenAI({ apiKey: env.OPENAI_API_KEY });

async function requireUserId(event: any) {
  const token = getCookie(event.headers, env.SESSION_COOKIE_NAME);
  if (!token) return null;
  const tokenHash = sha256(token);

  const { data: sess } = await adminSupabase
    .from("squirrel_sessions")
    .select("user_id, expires_at, revoked_at")
    .eq("token_hash", tokenHash)
    .is("revoked_at", null)
    .gt("expires_at", new Date().toISOString())
    .maybeSingle();

  return sess?.user_id || null;
}

async function embedText(text: string): Promise<number[]> {
  const resp = await openai.embeddings.create({ model: "text-embedding-3-small", input: text });
  return resp.data[0].embedding as unknown as number[];
}

export const handler: Handler = async (event) => {
  try {
    const userId = await requireUserId(event);
    if (!userId) return json(401, { ok: false, error: "unauthorized" });

    const body = JSON.parse(event.body || "{}");
    const query = String(body.query || "").trim();
    if (!query) return json(400, { ok: false, error: "missing_query" });

    const qEmbed = await embedText(query);

    const { data: candidates, error } = await adminSupabase.rpc("squirrel_match_memories", {
      p_user_id: userId,
      p_query_embedding: qEmbed,
      p_match_count: 12,
    });
    if (error) throw error;

    const resp = await openai.chat.completions.create({
      model: "gpt-4.1-mini",
      temperature: 0.2,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: "Answer using ONLY provided memories. Output JSON: {text:string, used_ids:string[]}." },
        { role: "user", content: JSON.stringify({ query, candidates }, null, 2) },
      ],
    });

    const out = JSON.parse(resp.choices[0]?.message?.content || "{}");
    return json(200, { ok: true, text: out.text || "", candidates });
  } catch (e: any) {
    console.error("api-ask", e);
    return json(500, { ok: false, error: e.message || "server_error" });
  }
};
