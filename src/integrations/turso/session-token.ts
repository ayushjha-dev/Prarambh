// Stateless HMAC session tokens for organizer login (replaces Supabase Auth).
//
// Format: <base64url(payload)>.<base64url(hmac-sha256(payload))>
// Payload: { sub, email, role, exp } — signed with SESSION_SECRET so the
// server can verify offline (no network round-trip, unlike Supabase getClaims).
// Only the hash signature is compared (timing-safe); the payload is readable
// by design (like a JWT) and carries no secrets.
import { createHmac, timingSafeEqual } from "node:crypto";

export type OrganizerClaims = {
  sub: string; // organizer id
  email: string;
  role: "admin" | "user";
  exp: number; // unix seconds
};

function secret(): string {
  const s = process.env["SESSION_SECRET"];
  if (!s) {
    throw new Error("Missing SESSION_SECRET environment variable (server only).");
  }
  return s;
}

function sign(payloadB64: string, key: string): string {
  return createHmac("sha256", key).update(payloadB64).digest("base64url");
}

/** Issue a token valid for `days` days (default 30). */
export function signOrganizerToken(
  claims: Omit<OrganizerClaims, "exp">,
  days = 30,
): { token: string; expiresAt: number } {
  const exp = Math.floor(Date.now() / 1000) + days * 86_400;
  const payload = Buffer.from(JSON.stringify({ ...claims, exp })).toString("base64url");
  return { token: `${payload}.${sign(payload, secret())}`, expiresAt: exp * 1000 };
}

/** Verify signature + expiry. Returns the claims, or null when invalid. */
export function verifyOrganizerToken(token: string | null | undefined): OrganizerClaims | null {
  if (!token) return null;
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [payload, sig] = parts as [string, string];
  try {
    const expected = sign(payload, secret());
    const a = Buffer.from(sig);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
    const claims = JSON.parse(
      Buffer.from(payload, "base64url").toString("utf8"),
    ) as OrganizerClaims;
    if (!claims.sub || typeof claims.exp !== "number" || claims.exp * 1000 < Date.now()) {
      return null;
    }
    return claims;
  } catch {
    return null;
  }
}
