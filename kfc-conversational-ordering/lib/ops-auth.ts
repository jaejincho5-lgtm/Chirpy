// Shared pieces of the /backend password gate. The gate itself lives in
// proxy.ts (pages redirect to /backend/login, ops APIs get a 401); the login
// route sets the cookie. Both sides derive the cookie value here so they can
// never disagree. Web Crypto only — this must run on the edge runtime too.

export const OPS_AUTH_COOKIE = "kfc_ops_auth";

export function opsPassword(): string {
  return process.env.BACKEND_PASSWORD || "letmein";
}

/** The cookie carries a SHA-256 of the password, never the password itself. */
export async function opsAuthToken(): Promise<string> {
  const bytes = new TextEncoder().encode(`kfc-ops:${opsPassword()}`);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
