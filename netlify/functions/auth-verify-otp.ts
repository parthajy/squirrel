import type { Handler } from "@netlify/functions";
import { adminSupabase } from "./_lib/supabase";
import { env, assertEnv } from "./_lib/env";
import { json } from "./_lib/http";

assertEnv();

function randomToken(len = 48) {
  const chars = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  return Array.from({ length: len }, () => chars[Math.floor(Math.random() * chars.length)]).join("");
}

export const handler: Handler = async (event) => {
  try {
    const body = JSON.parse(event.body || "{}");
    const phone = String(body.phone_e164 || "").trim();
    const otp = String(body.otp || "").trim();

    if (!phone.startsWith("+") || otp.length < 4) return json(400, { error: "invalid_input" });

    // Find latest valid OTP
    const { data: rows, error } = await adminSupabase
      .from("squirrel_otps")
      .select("*")
      .eq("phone_e164", phone)
      .eq("otp", otp)
      .eq("used", false)
      .order("created_at", { ascending: false })
      .limit(1);

    if (error) throw error;
    const row = rows?.[0];
    if (!row) return json(401, { error: "invalid_otp" });

    if (new Date(row.expires_at).getTime() < Date.now()) return json(401, { error: "expired_otp" });

    // Mark used
    await adminSupabase.from("squirrel_otps").update({ used: true }).eq("id", row.id);

    // Fetch user
    const { data: user, error: uerr } = await adminSupabase
      .from("squirrel_users")
      .select("*")
      .eq("phone_e164", phone)
      .maybeSingle();
    if (uerr) throw uerr;
    if (!user) return json(401, { error: "no_user" });

    // Create session
    const token = randomToken();
    const expiresAt = new Date(Date.now() + Number(env.SESSION_DAYS) * 24 * 60 * 60 * 1000).toISOString();

    const { error: serr } = await adminSupabase.from("squirrel_sessions").insert({
      user_id: user.id,
      token,
      expires_at: expiresAt,
    });
    if (serr) throw serr;

    // httpOnly cookie
    return {
      statusCode: 200,
      headers: {
        "content-type": "application/json",
        "set-cookie": `${env.SESSION_COOKIE_NAME}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${Number(
          env.SESSION_DAYS
        ) * 24 * 60 * 60}`,
      },
      body: JSON.stringify({ ok: true }),
    };
  } catch (e: any) {
    console.error("auth-verify-otp error", e);
    return json(500, { error: "otp_verify_failed" });
  }
};
