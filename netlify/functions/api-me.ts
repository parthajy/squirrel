import type { Handler } from "@netlify/functions";
import { adminSupabase } from "./_lib/supabase";
import { env } from "./_lib/env";
import { json, getCookie } from "./_lib/http";
import { sha256 } from "./_lib/crypto";

async function requireUser(event: any) {
  const token = getCookie(event.headers, env.SESSION_COOKIE_NAME);
  if (!token) return null;

  const tokenHash = sha256(token);

  const { data: sess, error } = await adminSupabase
    .from("squirrel_sessions")
    .select("user_id, expires_at, revoked_at")
    .eq("token_hash", tokenHash)
    .is("revoked_at", null)
    .gt("expires_at", new Date().toISOString())
    .maybeSingle();

  if (error || !sess) return null;

  const { data: user } = await adminSupabase.from("squirrel_users").select("*").eq("id", sess.user_id).maybeSingle();
  return user || null;
}

export const handler: Handler = async (event) => {
  const user = await requireUser(event);
  if (!user) return json(401, { ok: false, error: "unauthorized" });
  return json(200, { ok: true, user: { id: user.id, phone_e164: user.phone_e164, telegram_user_id: user.telegram_user_id } });
};
