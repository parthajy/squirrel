import crypto from "crypto";

export function sha256(input: string) {
  return crypto.createHash("sha256").update(input).digest("hex");
}

export function randomToken(bytes = 32) {
  return crypto.randomBytes(bytes).toString("base64url");
}

export function randomOtp() {
  // 6-digit
  return String(Math.floor(100000 + Math.random() * 900000));
}

export function normalizePhoneToE164(phone: string) {
  // MVP: accept already-e164 (+91...)
  // You can enhance later with libphonenumber
  const p = phone.trim();
  if (!p.startsWith("+")) throw new Error("Phone must be in E.164 format, e.g. +9198xxxxxxx");
  return p;
}
