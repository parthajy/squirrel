export const env = {
  SUPABASE_URL: process.env.SUPABASE_URL!,
  SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY!,
  OPENAI_API_KEY: process.env.OPENAI_API_KEY!,
  TELEGRAM_BOT_TOKEN: process.env.TELEGRAM_BOT_TOKEN!,
  SESSION_COOKIE_NAME: process.env.SESSION_COOKIE_NAME || "squirrel_session",
  SESSION_DAYS: Number(process.env.SESSION_DAYS || "30"),
  OTP_TTL_MINUTES: Number(process.env.OTP_TTL_MINUTES || "10"),
};

export function assertEnv() {
  for (const [k, v] of Object.entries(env)) {
    if (v === undefined || v === null || v === "") throw new Error(`Missing env: ${k}`);
  }
}
