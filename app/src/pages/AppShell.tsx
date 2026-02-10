import { useEffect, useState } from "react";
import { Navigate } from "react-router-dom";

async function get(path: string) {
  const res = await fetch(`/.netlify/functions/${path}`, { credentials: "include" });
  return res.json();
}

async function post(path: string, body: any) {
  const res = await fetch(`/.netlify/functions/${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    credentials: "include",
    body: JSON.stringify(body),
  });
  return res.json();
}

export default function AppShell() {
  const [me, setMe] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [memories, setMemories] = useState<any[]>([]);
  const [q, setQ] = useState("");
  const [ans, setAns] = useState<string>("");

  useEffect(() => {
    (async () => {
      const r = await get("api-me");
      if (!r.ok) {
        setLoading(false);
        setMe(null);
        return;
      }
      setMe(r.user);
      const m = await get("api-memories?limit=50");
      setMemories(m.memories || []);
      setLoading(false);
    })();
  }, []);

  if (loading) return <div style={{ padding: 32 }}>Loading…</div>;
  if (!me) return <Navigate to="/login" replace />;

  return (
    <div style={{ maxWidth: 920, margin: "40px auto", fontFamily: "system-ui" }}>
      <h2>Squirrel Dashboard</h2>
      <p style={{ opacity: 0.7 }}>Logged in as {me.phone_e164 || "unknown phone"}</p>

      <div style={{ display: "flex", gap: 16, marginTop: 20 }}>
        <div style={{ flex: 1 }}>
          <h3>Ask</h3>
          <div style={{ display: "flex", gap: 8 }}>
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Ask your memory…"
              style={{ flex: 1, padding: 12, borderRadius: 10, border: "1px solid #ddd" }}
            />
            <button
              onClick={async () => {
                const r = await post("api-ask", { query: q });
                if (r.ok) setAns(r.text || "");
              }}
              style={{ padding: "12px 16px", borderRadius: 10 }}
            >
              Ask
            </button>
          </div>
          {ans && (
            <pre style={{ whiteSpace: "pre-wrap", marginTop: 12, padding: 12, borderRadius: 12, background: "#f6f6f6" }}>
              {ans}
            </pre>
          )}
        </div>

        <div style={{ flex: 1 }}>
          <h3>Recent Memories</h3>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {memories.map((m) => (
              <div key={m.id} style={{ padding: 12, border: "1px solid #eee", borderRadius: 12 }}>
                <div style={{ fontWeight: 700 }}>{m.title}</div>
                <div style={{ opacity: 0.8, marginTop: 6 }}>{m.summary}</div>
                <div style={{ fontSize: 12, opacity: 0.6, marginTop: 8 }}>
                  {m.type} • {new Date(m.created_at).toLocaleString()}
                </div>
              </div>
            ))}
            {memories.length === 0 && <div style={{ opacity: 0.7 }}>No memories yet. Send something to the bot.</div>}
          </div>
        </div>
      </div>
    </div>
  );
}
