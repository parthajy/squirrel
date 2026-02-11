import type { Handler } from "@netlify/functions";
import { adminSupabase } from "./_lib/supabase";
import { env, assertEnv } from "./_lib/env";
import { json } from "./_lib/http";

assertEnv();

function normalizeE164(raw: string) {
  const t = String(raw || "").trim();
  if (!t) return "";
  if (t.startsWith("+")) return `+${t.replace(/[^\d]/g, "")}`;
  return `+${t.replace(/[^\d]/g, "")}`;
}

function randomToken(len = 48) {
  const chars = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let out = "";
  for (let i = 0; i < len; i++) out += chars[Math.floor(Math.random() * chars.length)];
  return out;
}

export const handler: Handler = async (event) => {
  try {
    const body = JSON.parse(event.body || "{}");
    const phone_e164 = normalizeE164(body.phone_e164);
    const otp = String(body.otp || "").trim();

    if (!phone_e164 || otp.length < 4) return json(400, { error: "invalid_input" });

    // Find latest valid challenge
    const { data: rows, error } = await adminSupabase
      .from("squirrel_otp_challenges")
      .select("*")
      .eq("phone_e164", phone_e164)
      .eq("otp", otp)
      .eq("used", false)
      .order("created_at", { ascending: false })
      .limit(1);

    if (error) throw error;

    const row: any = rows?.[0];
    if (!row) return json(401, { error: "invalid_otp" });
    if (new Date(row.expires_at).getTime() < Date.now()) return json(401, { error: "expired_otp" });

    // Mark used
    await adminSupabase.from("squirrel_otp_challenges").update({ used: true }).eq("id", row.id);

    // Get user
    const { data: user, error: uerr } = await adminSupabase
      .from("squirrel_users")
      .select("*")
      .eq("phone_e164", phone_e164)
      .maybeSingle();
    if (uerr) throw uerr;
    if (!user) return json(401, { error: "no_user" });

    // Create session
    const token = randomToken();
    const expires_at = new Date(Date.now() + Number(env.SESSION_DAYS) * 24 * 60 * 60 * 1000).toISOString();

    const { error: serr } = await adminSupabase.from("squirrel_sessions").insert({
      user_id: user.id,
      token,
      expires_at,
    });
    if (serr) throw serr;

    // Update last_seen
    await adminSupabase.from("squirrel_users").update({ last_seen_at: new Date().toISOString() }).eq("id", user.id);

    return {
      statusCode: 200,
      headers: {
        "content-type": "application/json",
        "set-cookie": `${env.SESSION_COOKIE_NAME}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${
          Number(env.SESSION_DAYS) * 24 * 60 * 60
        }`,
      },
      body: JSON.stringify({ ok: true }),
    };
  } catch (e: any) {
    console.error("auth-verify-otp error", e);
    return json(500, { error: "otp_verify_failed" });
  }
};
