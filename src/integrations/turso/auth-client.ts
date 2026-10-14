// Browser-side organizer auth client (replaces the Supabase client's `auth`
// API). Keeps the call shapes the route guards and login page already use:
//
//   const { data: { session } } = await authClient.getSession();
//   const { error } = await authClient.signInWithPassword({ email, password });
//   const { error } = await authClient.signUp({ email, password });
//   await authClient.signOut();
//
// getSession() reads localStorage only — no network — so route guards and
// Android-back navigation in the installed PWA never depend on connectivity
// (the session token itself is still verified server-side on every call).
import { organizerLogin, organizerSignUp } from "@/lib/auth.functions";

import { clearSession, readSession, writeSession, type StoredSession } from "./session-storage";

export type OrganizerSession = StoredSession;

export const authClient = {
  /** Local session read: returns { data: { session } } like supabase.auth. */
  async getSession(): Promise<{ data: { session: OrganizerSession | null } }> {
    return { data: { session: readSession() } };
  },

  async signOut(): Promise<{ error: null }> {
    clearSession();
    return { error: null };
  },

  async signInWithPassword(creds: {
    email: string;
    password: string;
  }): Promise<{ error: { message: string } | null }> {
    try {
      const result = await organizerLogin({ data: creds });
      writeSession({
        token: result.token,
        expiresAt: result.expiresAt,
        user: result.user,
      });
      return { error: null };
    } catch (err) {
      return { error: { message: err instanceof Error ? err.message : "Sign in failed." } };
    }
  },

  /**
   * Bootstrap signup: creates the first organizer account (server enforces
   * that no organizer exists yet) and signs in immediately — there is no
   * email-confirmation step anymore. The `options` argument is accepted for
   * call-site compatibility with the old supabase.auth.signUp signature and
   * ignored.
   */
  async signUp(
    creds: { email: string; password: string },
    _options?: unknown,
  ): Promise<{ error: { message: string } | null }> {
    try {
      const result = await organizerSignUp({ data: creds });
      writeSession({
        token: result.token,
        expiresAt: result.expiresAt,
        user: result.user,
      });
      return { error: null };
    } catch (err) {
      return { error: { message: err instanceof Error ? err.message : "Sign up failed." } };
    }
  },
};
