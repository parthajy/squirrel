export function json(statusCode: number, body: any, headers: Record<string, string> = {}) {
  return {
    statusCode,
    headers: {
      "content-type": "application/json",
      ...headers,
    },
    body: JSON.stringify(body),
  };
}

export function getCookie(reqHeaders: Record<string, string | undefined>, name: string) {
  const cookie = reqHeaders.cookie || reqHeaders.Cookie;
  if (!cookie) return null;
  const parts = cookie.split(";").map((x) => x.trim());
  for (const p of parts) {
    const [k, ...rest] = p.split("=");
    if (k === name) return decodeURIComponent(rest.join("="));
  }
  return null;
}
