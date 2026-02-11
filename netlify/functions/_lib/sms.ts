import twilio from "twilio";

const sid = process.env.TWILIO_ACCOUNT_SID || "";
const token = process.env.TWILIO_AUTH_TOKEN || "";
const from = process.env.TWILIO_FROM_NUMBER || "";

export async function sendOtpSms(phone_e164: string, otp: string) {
  // If Twilio is not configured, don't hard-fail (dev-friendly)
  if (!sid || !token || !from) {
    console.log(`[SQUIRREL OTP DEV] phone=${phone_e164} otp=${otp} (Twilio env missing)`);
    return;
  }

  const client = twilio(sid, token);
  await client.messages.create({
    to: phone_e164,
    from,
    body: `Squirrel OTP: ${otp} (valid for 10 minutes)`,
  });
}
