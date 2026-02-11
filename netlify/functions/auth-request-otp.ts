import type { Handler } from "@netlify/functions";
import { adminSupabase } from "./_lib/supabase";
import { env, assertEnv } from "./_lib/env";
import { json } from "./_lib/http";
import { sendOtpSms } from "./_lib/sms";

assertEnv();

function genOtp() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

export const handler: Handler = async (event) => {
  try {
    const body = JSON.parse(event.body || "{}");
    const phone = String(body.phone_e164 || "").trim();
    if (!phone.startsWith("+")) return json(400, { error: "phone_e164 must be in +E164 format" });

    // Ensure user exists (create-on-first-contact philosophy)
    // If you want to link Telegram->phone, you already store phone on squirrel_users.
    const { data: user, error: uerr } = await adminSupabase
      .from("squirrel_users")
      .select("*")
      .eq("phone_e164", phone)
      .maybeSingle();

    if (uerr) throw uerr;
    if (!user) {
      // Create a minimal user row so OTP login always works
      const { error: ierr } = await adminSupabase.from("squirrel_users").insert({
        phone_e164: phone,
        last_seen_at: new Date().toISOString(),
      });
      if (ierr) throw ierr;
    }

    const otp = genOtp();
    const expiresAt = new Date(Date.now() + Number(env.OTP_TTL_MINUTES) * 60_000).toISOString();

    // Store OTP (hash later; plaintext is ok for MVP but don’t log it)
    const { error } = await adminSupabase.from("squirrel_otps").insert({
      phone_e164: phone,
      otp,
      expires_at: expiresAt,
      used: false,
    });
    if (error) throw error;

    await sendOtpSms(phone, otp);
    return json(200, { ok: true });
  } catch (e: any) {
    console.error("auth-request-otp error", e);
    return json(500, { error: "otp_request_failed" });
  }
};
