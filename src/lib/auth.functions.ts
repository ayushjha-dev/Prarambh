// Organizer authentication server functions (replaces Supabase Auth/GoTrue).
//
//  - organizerLogin: bcrypt-verify email + password, issue an HMAC session.
//  - organizerSignUp: bootstrap-only — allowed while ZERO organizers exist
//    (mirrors the old grant_first_admin trigger; the UI labels this mode
//    "Create the first organizer account"). Later accounts must be created
//    server-side (scripts) with an explicit role.
//
// Only hashes are stored; passwords never leave the server. Failed attempts
// use the same 5-attempts / 10-minute lockout as the participant login.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_MINUTES = 10;

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export type OrganizerAuthResult = {
  token: string;
  expiresAt: number;
  user: { id: string; email: string; role: string; display_name: string };
};

async function bcryptCompare(password: string, hash: string): Promise<boolean> {
  try {
    const mod = await import("bcryptjs");
    const bcrypt = mod.default ?? mod;
    return (await bcrypt.compare(password, hash)) === true;
  } catch {
    return false;
  }
}

async function bcryptHash(password: string): Promise<string> {
  const mod = await import("bcryptjs");
  const bcrypt = mod.default ?? mod;
  return bcrypt.hash(password, 10);
}

export const organizerLogin = createServerFn({ method: "POST" })
  .inputValidator((input) =>
    z
      .object({
        email: z.string().trim().email().max(200),
        password: z.string().min(1).max(200),
      })
      .parse(input),
  )
  .handler(async ({ data }): Promise<OrganizerAuthResult> => {
    const { db } = await import("@/integrations/turso/client.server");
    const { signOrganizerToken } = await import("@/integrations/turso/session-token");

    const email = normalizeEmail(data.email);
    // Same message for unknown email vs wrong password: no account enumeration.
    const invalid = new Error("Invalid credentials.");

    const { data: organizer, error: readErr } = await db
      .from("organizers")
      .select("id, email, password_hash, role, display_name, failed_attempts, locked_until")
      .eq("email", email)
      .maybeSingle();
    if (readErr) throw new Error(readErr.message);
    if (!organizer?.password_hash) throw invalid;

    if (organizer.locked_until && new Date(organizer.locked_until).getTime() > Date.now()) {
      throw new Error("Too many failed attempts. Please try again in a few minutes.");
    }

    const match = await bcryptCompare(data.password, organizer.password_hash);
    if (!match) {
      const failed = Number(organizer.failed_attempts ?? 0) + 1;
      const locked = failed >= MAX_FAILED_ATTEMPTS;
      const { error: writeErr } = await db
        .from("organizers")
        .update({
          failed_attempts: locked ? 0 : failed,
          locked_until: locked
            ? new Date(Date.now() + LOCKOUT_MINUTES * 60 * 1000).toISOString()
            : null,
        })
        .eq("id", organizer.id);
      if (writeErr) throw new Error(writeErr.message);
      if (locked) {
        throw new Error("Too many failed attempts. Please try again in a few minutes.");
      }
      throw invalid;
    }

    const { error: resetErr } = await db
      .from("organizers")
      .update({ failed_attempts: 0, locked_until: null })
      .eq("id", organizer.id);
    if (resetErr) throw new Error(resetErr.message);

    const user = {
      id: String(organizer.id),
      email: String(organizer.email),
      role: String(organizer.role ?? "admin"),
      display_name: String(organizer.display_name ?? ""),
    };
    const { token, expiresAt } = signOrganizerToken({
      sub: user.id,
      email: user.email,
      role: user.role === "user" ? "user" : "admin",
    });
    return { token, expiresAt, user };
  });

export const organizerSignUp = createServerFn({ method: "POST" })
  .inputValidator((input) =>
    z
      .object({
        email: z.string().trim().email().max(200),
        password: z.string().max(200),
      })
      .parse(input),
  )
  .handler(async ({ data }): Promise<OrganizerAuthResult> => {
    if (data.password.length < 8) {
      throw new Error("Password must be at least 8 characters.");
    }
    const { db } = await import("@/integrations/turso/client.server");
    const { signOrganizerToken } = await import("@/integrations/turso/session-token");

    // Bootstrap gate: without Supabase email confirmation there is no invite
    // flow, so account creation stays closed once any organizer exists.
    const { data: existing, error: countErr } = await db.from("organizers").select("id").limit(1);
    if (countErr) throw new Error(countErr.message);
    if (existing?.length) {
      throw new Error("Registration is closed. Ask the existing organizer to add your account.");
    }

    const email = normalizeEmail(data.email);
    const passwordHash = await bcryptHash(data.password);
    const { data: created, error: insertErr } = await db
      .from("organizers")
      .insert({
        email,
        password_hash: passwordHash,
        display_name: "",
        role: "admin",
      })
      .select("id, email, role, display_name")
      .single();
    if (insertErr) {
      if (insertErr.code === "23505") throw new Error("That email is already registered.");
      throw new Error(insertErr.message);
    }

    const user = {
      id: String(created.id),
      email: String(created.email),
      role: String(created.role ?? "admin"),
      display_name: String(created.display_name ?? ""),
    };
    const { token, expiresAt } = signOrganizerToken({
      sub: user.id,
      email: user.email,
      role: user.role === "user" ? "user" : "admin",
    });
    return { token, expiresAt, user };
  });
