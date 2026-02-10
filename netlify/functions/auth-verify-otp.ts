import type { Handler } from "@netlify/functions";
import { adminSupabase } from "./_lib/supabase";
import { env } from "./_lib/env";
import { json } from "./_lib/http";
import { sha256, randomToken, normalizePhoneToE164 } from "./_lib/crypto";

function cookieHeader(token: string) {
  const maxAge = env.SESSION_DAYS * 24 * 60 * 60;
  // secure should be true on https (Netlify is https)
  return `${env.SESSION_COOKIE_NAME}=${encodeURIComponent(token)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;
}

export const handler: Handler = async (event) => {
  try {
    const body = JSON.parse(event.body || "{}");
    const phone = normalizePhoneToE164(String(body.phone || ""));
    const otp = String(body.otp || "").trim();

    if (!/^\d{6}$/.test(otp)) return json(400, { ok: false, error: "invalid_otp" });

    // Get latest active challenge
    const { data: chal, error: chalErr } = await adminSupabase
      .from("squirrel_otp_challenges")
      .select("*")
      .eq("phone_e164", phone)
      .is("consumed_at", null)
      .gt("expires_at", new Date().toISOString())
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (chalErr) throw chalErr;
    if (!chal) return json(400, { ok: false, error: "otp_expired" });

    // attempts check
    if (chal.attempts >= 5) return json(429, { ok: false, error: "too_many_attempts" });

    const otpHash = sha256(otp);
    const ok = otpHash === chal.otp_hash;

    // increment attempts always
    await adminSupabase.from("squirrel_otp_challenges").update({ attempts: chal.attempts + 1 }).eq("id", chal.id);

    if (!ok) return json(400, { ok: false, error: "wrong_otp" });

    // Consume
    await adminSupabase.from("squirrel_otp_challenges").update({ consumed_at: new Date().toISOString() }).eq("id", chal.id);

    // Find or create user by phone
    let user = await adminSupabase.from("squirrel_users").select("*").eq("phone_e164", phone).maybeSingle();
    if (user.error) throw user.error;

    if (!user.data) {
      const created = await adminSupabase
        .from("squirrel_users")
        .insert({ phone_e164: phone, last_seen_at: new Date().toISOString() })
        .select("*")
        .single();
      if (created.error) throw created.error;
      user = { data: created.data, error: null };
    } else {
      await adminSupabase.from("squirrel_users").update({ last_seen_at: new Date().toISOString() }).eq("id", user.data.id);
    }

    // Create session
    const token = randomToken(32);
    const tokenHash = sha256(token);
    const expiresAt = new Date(Date.now() + env.SESSION_DAYS * 24 * 60 * 60 * 1000).toISOString();

    const { error: sessErr } = await adminSupabase.from("squirrel_sessions").insert({
      user_id: user.data.id,
      token_hash: tokenHash,
      expires_at: expiresAt,
    });
    if (sessErr) throw sessErr;

    return json(
      200,
      { ok: true },
      {
        "set-cookie": cookieHeader(token),
      }
    );
  } catch (e: any) {
    console.error("auth-verify-otp", e);
    return json(400, { ok: false, error: e.message || "bad_request" });
  }
};
