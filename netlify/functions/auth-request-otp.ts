import type { Handler } from "@netlify/functions";
import { adminSupabase } from "./_lib/supabase";
import { env, assertEnv } from "./_lib/env";
import { json } from "./_lib/http";
import { sendOtpSms } from "./_lib/sms";

assertEnv();

function genOtp() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

function normalizeE164(raw: string) {
  const t = String(raw || "").trim();
  if (!t) return "";
  if (t.startsWith("+")) return `+${t.replace(/[^\d]/g, "")}`; // keep +
  return `+${t.replace(/[^\d]/g, "")}`;
}

export const handler: Handler = async (event) => {
  try {
    const body = JSON.parse(event.body || "{}");
    const phone_e164 = normalizeE164(body.phone_e164);
    if (!phone_e164 || phone_e164.length < 8) return json(400, { error: "invalid_phone" });

    // Ensure a user exists (create-on-first-login is OK for your model)
    const { data: user, error: uerr } = await adminSupabase
      .from("squirrel_users")
      .select("id, phone_e164")
      .eq("phone_e164", phone_e164)
      .maybeSingle();

    if (uerr) throw uerr;

    if (!user) {
      const { error: ierr } = await adminSupabase.from("squirrel_users").insert({
        phone_e164,
        last_seen_at: new Date().toISOString(),
      });
      if (ierr) throw ierr;
    }

    const otp = genOtp();
    const expires_at = new Date(Date.now() + Number(env.OTP_TTL_MINUTES) * 60_000).toISOString();

    // Store challenge
    const { error } = await adminSupabase.from("squirrel_otp_challenges").insert({
      phone_e164,
      otp,
      expires_at,
      used: false,
    });
    if (error) throw error;

    await sendOtpSms(phone_e164, otp);
    return json(200, { ok: true });
  } catch (e: any) {
    console.error("auth-request-otp error", e);
    return json(500, { error: "otp_request_failed" });
  }
};
