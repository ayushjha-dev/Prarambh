// Client-side middleware that attaches the organizer bearer token to every
// server-function RPC. Replaces attachSupabaseAuth (Supabase session lookup)
// with a synchronous read of the locally stored session — no network, so a
// transient failure can never drop auth headers mid-navigation.
import { createMiddleware } from "@tanstack/react-start";

import { peekToken } from "./session-storage";

export const attachOrganizerAuth = createMiddleware({ type: "function" }).client(
  async ({ next }) => {
    const token = peekToken();
    return next({
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
  },
);
