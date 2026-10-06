/**
 * Student exam sessions, scoped per exam slug.
 *
 * The server issues an opaque `session_token` (uuid) per participant row.
 * The browser keeps `{ token, name }` in localStorage under a key derived
 * from the exam slug, so a session for exam A is never sent to exam B.
 * (This preserves the existing auth method, scoped to the exam, as the
 * spec allows instead of JWT httpOnly cookies.)
 */

function keyFor(slug: string): string {
  return `examportal.session.${slug.toLowerCase()}`;
}

const LEGACY_KEY = "prarambh.session";

export type StoredSession = { token: string; name: string };

export function saveSessionForExam(slug: string, s: StoredSession) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(keyFor(slug), JSON.stringify(s));
  } catch {
    /* storage unavailable — exam still works until reload */
  }
}

export function loadSessionForExam(slug: string | undefined): StoredSession | null {
  if (typeof window === "undefined" || !slug) return null;
  try {
    const raw = window.localStorage.getItem(keyFor(slug));
    if (raw) return JSON.parse(raw) as StoredSession;
    // One-time fallback: pick up a session stored by the legacy single-exam app.
    const legacy = window.localStorage.getItem(LEGACY_KEY);
    if (legacy) {
      const parsed = JSON.parse(legacy) as StoredSession;
      window.localStorage.setItem(keyFor(slug), JSON.stringify(parsed));
      return parsed;
    }
    return null;
  } catch {
    return null;
  }
}

export function clearSessionForExam(slug: string) {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(keyFor(slug));
}

/** @deprecated Use saveSessionForExam — kept for the legacy generic pages. */
export function saveSession(s: StoredSession) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(LEGACY_KEY, JSON.stringify(s));
}

/** @deprecated Use loadSessionForExam — kept for the legacy generic pages. */
export function loadSession(): StoredSession | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(LEGACY_KEY);
    return raw ? (JSON.parse(raw) as StoredSession) : null;
  } catch {
    return null;
  }
}

/** @deprecated Use clearSessionForExam — kept for the legacy generic pages. */
export function clearSession() {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(LEGACY_KEY);
}

export function formatClock(totalSeconds: number) {
  const s = Math.max(0, Math.floor(totalSeconds));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${String(m).padStart(2, "0")}:${String(r).padStart(2, "0")}`;
}

export function formatDuration(seconds: number | null | undefined) {
  if (seconds == null) return "—";
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}m ${String(s).padStart(2, "0")}s`;
}

/** Siren-style alert generated with the Web Audio API (no asset needed). */
export function playViolationAlarm() {
  if (typeof window === "undefined") return;
  try {
    const Ctx =
      window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new Ctx();
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.35, ctx.currentTime + 0.05);
    gain.connect(ctx.destination);

    const osc = ctx.createOscillator();
    osc.type = "sawtooth";
    const t = ctx.currentTime;
    osc.frequency.setValueAtTime(420, t);
    for (let i = 0; i < 3; i++) {
      osc.frequency.linearRampToValueAtTime(1000, t + 0.35 + i * 0.7);
      osc.frequency.linearRampToValueAtTime(420, t + 0.7 + i * 0.7);
    }
    osc.connect(gain);
    osc.start();
    gain.gain.setValueAtTime(0.35, t + 2.0);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 2.3);
    osc.stop(t + 2.35);
    osc.onended = () => ctx.close();
  } catch {
    /* audio blocked — visual warning still shows */
  }
}
