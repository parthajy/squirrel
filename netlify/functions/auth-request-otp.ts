import type { Handler } from "@netlify/functions";
import { adminSupabase } from "./_lib/supabase";
import { env } from "./_lib/env";
import { json } from "./_lib/http";
import { randomOtp, sha256, normalizePhoneToE164 } from "./_lib/crypto";
import { sendOtpSms } from "./_lib/sms";

export const handler: Handler = async (event) => {
  try {
    const body = JSON.parse(event.body || "{}");
    const phone = normalizePhoneToE164(String(body.phone || ""));
    const otp = randomOtp();

    const expiresAt = new Date(Date.now() + env.OTP_TTL_MINUTES * 60 * 1000).toISOString();

    // Store hashed OTP (no plain OTP in DB)
    const { error } = await adminSupabase.from("squirrel_otp_challenges").insert({
      phone_e164: phone,
      otp_hash: sha256(otp),
      expires_at: expiresAt,
    });
    if (error) throw error;

    await sendOtpSms(phone, otp);

    return json(200, { ok: true });
  } catch (e: any) {
    console.error("auth-request-otp", e);
    return json(400, { ok: false, error: e.message || "bad_request" });
  }
};
