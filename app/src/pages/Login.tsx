import { useState } from "react";

async function post(path: string, body: any) {
  const res = await fetch(`/.netlify/functions/${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    credentials: "include",
    body: JSON.stringify(body),
  });

  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    return { ok: false, error: text || `HTTP ${res.status}` };
  }
}

export default function Login() {
  const [phone, setPhone] = useState("+91");
  const [otp, setOtp] = useState("");
  const [step, setStep] = useState<"phone" | "otp">("phone");
  const [err, setErr] = useState<string | null>(null);

  return (
    <div style={{ maxWidth: 420, margin: "80px auto", fontFamily: "system-ui" }}>
      <h1>Squirrel</h1>
      <p>Login with phone OTP</p>

      {step === "phone" && (
        <>
          <input
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="+9198xxxxxxxx"
            style={{ width: "100%", padding: 12, borderRadius: 10, border: "1px solid #ddd" }}
          />
          <button
            onClick={async () => {
              setErr(null);
              const r = await post("auth-request-otp", { phone_e164: phone });
              if (!r.ok) return setErr(r.error || "Failed");
              setStep("otp");
            }}
            style={{ width: "100%", padding: 12, marginTop: 12, borderRadius: 10 }}
          >
            Send OTP
          </button>
        </>
      )}

      {step === "otp" && (
        <>
          <input
            value={otp}
            onChange={(e) => setOtp(e.target.value)}
            placeholder="6-digit OTP"
            style={{ width: "100%", padding: 12, borderRadius: 10, border: "1px solid #ddd" }}
          />
          <button
            onClick={async () => {
              setErr(null);
              const r = await post("auth-verify-otp", { phone_e164: phone, otp });
              if (!r.ok) return setErr(r.error || "Failed");
              window.location.href = "/";
            }}
            style={{ width: "100%", padding: 12, marginTop: 12, borderRadius: 10 }}
          >
            Verify & Login
          </button>
          <button
            onClick={() => setStep("phone")}
            style={{ width: "100%", padding: 12, marginTop: 8, borderRadius: 10, opacity: 0.8 }}
          >
            Back
          </button>
        </>
      )}

      {err && <p style={{ color: "crimson", marginTop: 12 }}>{err}</p>}
      <p style={{ marginTop: 24, fontSize: 12, opacity: 0.7 }}>
        MVP note: OTP is logged in Netlify function logs for now.
      </p>
    </div>
  );
}
