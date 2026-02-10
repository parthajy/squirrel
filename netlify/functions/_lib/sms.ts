// MVP: log OTP to Netlify function logs.
// Replace later with Twilio/MSG91/etc.
export async function sendOtpSms(phone_e164: string, otp: string) {
  console.log(`[SQUIRREL OTP] phone=${phone_e164} otp=${otp}`);
  return true;
}
