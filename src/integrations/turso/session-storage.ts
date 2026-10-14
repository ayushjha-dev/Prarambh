// Browser-side persistence for the organizer session token.
//
// Replaces the storage layer Supabase Auth used internally. The token itself
// is an HMAC-signed blob (session-token.ts) — this module only stores it, so
// it must stay free of server-function imports: both the auth client and the
// request attacher read it.
const KEY = "prarambh.organizer.session";

export type StoredSession = {
  token: string;
  expiresAt: number; // unix milliseconds
  user: { id: string; email: string; role: string; display_name: string };
};

function available(): boolean {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
}

/** Returns the stored session, or null when absent/expired (expired entries are cleared). */
export function readSession(): StoredSession | null {
  if (!available()) return null;
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return null;
    const session = JSON.parse(raw) as StoredSession;
    if (!session?.token || typeof session.expiresAt !== "number") {
      clearSession();
      return null;
    }
    if (session.expiresAt <= Date.now()) {
      clearSession();
      return null;
    }
    return session;
  } catch {
    return null;
  }
}

export function writeSession(session: StoredSession): void {
  if (!available()) return;
  window.localStorage.setItem(KEY, JSON.stringify(session));
}

export function clearSession(): void {
  if (!available()) return;
  try {
    window.localStorage.removeItem(KEY);
  } catch {
    // Storage may be unavailable (private mode) — nothing to clear.
  }
}

/** Just the bearer token, for the request attacher. */
export function peekToken(): string | null {
  return readSession()?.token ?? null;
}
