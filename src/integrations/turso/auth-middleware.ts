// Server-side auth for organizer server functions.
//
// Replaces requireSupabaseAuth: instead of validating a Supabase JWT against
// GoTrue over the network, the Bearer token is a locally HMAC-signed session
// (session-token.ts) — verification is offline and instantaneous, which also
// keeps the PWA back-navigation guards (local session reads) consistent with
// what the server enforces.
import { createMiddleware } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";

import { verifyOrganizerToken, type OrganizerClaims } from "./session-token";

export const requireOrganizerAuth = createMiddleware({ type: "function" }).server(
  async ({ next }) => {
    const request = getRequest();

    if (!request?.headers) {
      throw new Error("Unauthorized: No request headers available");
    }

    const authHeader = request.headers.get("authorization");
    if (!authHeader) {
      throw new Error("Unauthorized: No authorization header provided");
    }
    if (!authHeader.startsWith("Bearer ")) {
      throw new Error("Unauthorized: Only Bearer tokens are supported");
    }

    const claims: OrganizerClaims | null = verifyOrganizerToken(authHeader.slice(7));
    if (!claims) {
      throw new Error("Unauthorized: Invalid token");
    }

    return next({
      context: {
        userId: claims.sub,
        claims,
      },
    });
  },
);
