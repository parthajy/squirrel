import type { Handler } from "@netlify/functions";
import { adminSupabase } from "./_lib/supabase";
import { env } from "./_lib/env";
import { json, getCookie } from "./_lib/http";
import { sha256 } from "./_lib/crypto";

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

export const handler: Handler = async (event) => {
  const userId = await requireUserId(event);
  if (!userId) return json(401, { ok: false, error: "unauthorized" });

  const url = new URL(event.rawUrl);
  const limit = Math.min(Number(url.searchParams.get("limit") || "50"), 200);

  const { data, error } = await adminSupabase
    .from("squirrel_memories")
    .select("id,type,title,summary,tags,entities,created_at")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) return json(500, { ok: false, error: error.message });
  return json(200, { ok: true, memories: data });
};
