import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { brand } from "@/config/brand";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/panel-admin-login")({
  ssr: false,
  head: () => ({
    meta: [
      { title: `Organizer Login — ${brand.appName}` },
      { name: "description", content: `Organiser access for ${brand.appName} exams.` },
      { name: "robots", content: "noindex,nofollow" },
      { property: "og:title", content: `Organizer Login — ${brand.appName}` },
      { property: "og:description", content: `Organiser access for ${brand.appName}.` },
    ],
  }),
  component: AdminLogin,
});

function AdminLogin() {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      if (mode === "signup") {
        const { error } = await supabase.auth.signUp({
          email,
          password,
          options: { emailRedirectTo: `${window.location.origin}/panel-admin-login` },
        });
        if (error) throw error;
        toast.success("Account created. Check your email to confirm, then sign in.");
        setMode("signin");
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        navigate({ to: "/panel-admin" });
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Sign in failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-5 py-16">
      <form onSubmit={onSubmit} className="w-full max-w-sm rounded-[22px] border border-border p-8">
        <p className="mono-label text-muted-foreground">{brand.appName}</p>
        <h1 className="mt-2 text-3xl">Organizer Login</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Create exams, share private links, and manage student credentials.
        </p>
        <div className="mt-6 space-y-2">
          <Label htmlFor="email" className="mono-label text-muted-foreground">
            Email
          </Label>
          <Input
            id="email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="h-11 rounded-xl"
            required
          />
        </div>
        <div className="mt-4 space-y-2">
          <Label htmlFor="password" className="mono-label text-muted-foreground">
            Password
          </Label>
          <Input
            id="password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="h-11 rounded-xl"
            required
          />
        </div>
        <Button type="submit" disabled={busy} className="mt-6 h-11 w-full rounded-[32px]">
          {busy ? "Please wait…" : mode === "signin" ? "Sign in" : "Create organizer account"}
        </Button>
        <button
          type="button"
          className="mono-label mt-5 w-full text-center text-muted-foreground underline"
          onClick={() => setMode(mode === "signin" ? "signup" : "signin")}
        >
          {mode === "signin" ? "Create the first organizer account" : "Back to sign in"}
        </button>
      </form>
    </main>
  );
}
