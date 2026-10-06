import { createFileRoute, Link, useNavigate, useParams } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { AlarmClock, CalendarDays, Eye, EyeOff, ListChecks } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { brand, footerCopyright } from "@/config/brand";
import { DesktopOnlyScreen, useIsPhone } from "@/components/DesktopOnly";
import { getExamPublic, loginExamParticipant, type PublicExam } from "@/lib/exam.functions";
import { loadSessionForExam, saveSessionForExam } from "@/lib/exam-session";

export const Route = createFileRoute("/exam/$slug/")({
  ssr: false,
  head: () => ({
    meta: [
      { title: `Exam login — ${brand.appName}` },
      { name: "description", content: "Log in to your exam with your name, email and organizer-provided password." },
      { name: "robots", content: "noindex,nofollow" },
    ],
  }),
  component: ExamLoginPage,
});

function formatDateTime(iso: string | null) {
  if (!iso) return null;
  try {
    return new Date(iso).toLocaleString(undefined, {
      dateStyle: "medium",
      timeStyle: "short",
    });
  } catch {
    return iso;
  }
}

function ExamLoginPage() {
  const { slug } = useParams({ from: "/exam/$slug/" });
  const navigate = useNavigate();
  const fetchExam = useServerFn(getExamPublic);
  const login = useServerFn(loginExamParticipant);
  const isPhone = useIsPhone();

  const [exam, setExam] = useState<PublicExam | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loadingExam, setLoadingExam] = useState(true);

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const existing = loadSessionForExam(slug);
    if (existing) {
      navigate({ to: "/exam/$slug/instructions", params: { slug } });
    }
  }, [slug, navigate]);

  useEffect(() => {
    setLoadingExam(true);
    setNotFound(false);
    setLoadError(null);
    fetchExam({ data: { slug } })
      .then(setExam)
      .catch((err) => {
        if (err instanceof Error && err.message.includes("EXAM_NOT_FOUND")) setNotFound(true);
        else setLoadError(err instanceof Error ? err.message : "Could not load this exam.");
      })
      .finally(() => setLoadingExam(false));
  }, [fetchExam, slug]);

  if (isPhone) return <DesktopOnlyScreen />;

  if (loadingExam) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-background">
        <p className="mono-label text-muted-foreground">Loading exam…</p>
      </main>
    );
  }

  if (notFound) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center bg-background px-5 py-16 text-center">
        <p className="mono-label text-muted-foreground">{brand.appName}</p>
        <h1 className="mt-4 text-4xl leading-tight sm:text-5xl">Exam not found</h1>
        <p className="mt-4 max-w-md text-[16px] leading-relaxed text-muted-foreground">
          This exam link is invalid, has been replaced, or has expired. Please check the link
          with your organizer and try again.
        </p>
        <Link
          to="/"
          className="mt-8 inline-flex h-12 items-center rounded-full bg-primary px-7 text-sm font-medium text-primary-foreground"
        >
          Back to home
        </Link>
      </main>
    );
  }

  if (loadError || !exam) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center bg-background px-5 py-16 text-center">
        <p className="mono-label text-muted-foreground">{brand.appName}</p>
        <h1 className="mt-4 text-4xl leading-tight sm:text-5xl">Could not load this exam</h1>
        <p className="mt-4 max-w-md text-[16px] leading-relaxed text-muted-foreground">
          {loadError ?? "Something went wrong. Please try again."}
        </p>
        <div className="mt-8 flex flex-wrap justify-center gap-2">
          <Button className="h-12 rounded-full px-7" onClick={() => window.location.reload()}>
            Try again
          </Button>
          <Link
            to="/"
            className="inline-flex h-12 items-center rounded-full border border-border px-7 text-sm font-medium"
          >
            Back to home
          </Link>
        </div>
      </main>
    );
  }

  const blocked = exam.phase !== "live";

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (name.trim().length < 2) {
      toast.error("Please enter your full name (min 2 characters).");
      return;
    }
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim())) {
      toast.error("Please enter a valid email address.");
      return;
    }
    if (!password) {
      toast.error("Please enter the password shared by your organizer.");
      return;
    }
    setBusy(true);
    try {
      const res = await login({
        data: { slug, name: name.trim(), email: email.trim(), password },
      });
      saveSessionForExam(slug, { token: res.token, name: res.name });
      navigate({ to: "/exam/$slug/instructions", params: { slug } });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not continue. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="flex min-h-screen flex-col bg-background">
      <div className="mx-auto grid w-full max-w-5xl flex-1 gap-6 px-5 py-10 lg:grid-cols-2 lg:items-center lg:gap-10">
        {/* Exam details */}
        <section aria-label="Exam details">
          <p className="mono-label text-muted-foreground">{brand.appName} · Online Examination</p>
          <h1 className="mt-3 text-4xl leading-tight sm:text-5xl">{exam.title}</h1>
          {exam.description ? (
            <p className="mt-4 max-w-lg text-[16px] leading-relaxed text-muted-foreground">
              {exam.description}
            </p>
          ) : null}
          <dl className="mt-7 grid gap-3 sm:grid-cols-2">
            <Detail icon={<AlarmClock className="size-4" />} label="Duration" value={`${exam.duration_minutes} minutes`} />
            <Detail icon={<ListChecks className="size-4" />} label="Questions" value={exam.total_questions ? String(exam.total_questions) : "—"} />
            {formatDateTime(exam.starts_at) ? (
              <Detail icon={<CalendarDays className="size-4" />} label="Starts" value={formatDateTime(exam.starts_at) as string} />
            ) : null}
            {formatDateTime(exam.ends_at) ? (
              <Detail icon={<CalendarDays className="size-4" />} label="Ends" value={formatDateTime(exam.ends_at) as string} />
            ) : null}
          </dl>
          {exam.phase === "upcoming" ? (
            <p role="status" className="mt-6 rounded-2xl border border-border bg-card p-4 text-sm">
              This exam has not started yet. Please come back at the scheduled start time.
            </p>
          ) : null}
          {exam.phase === "ended" ? (
            <p role="status" className="mt-6 rounded-2xl border border-border bg-card p-4 text-sm">
              This exam has ended and no longer accepts logins.
            </p>
          ) : null}
          {exam.phase === "disabled" ? (
            <p role="status" className="mt-6 rounded-2xl border border-border bg-card p-4 text-sm">
              This exam link is currently disabled. Please contact your organizer.
            </p>
          ) : null}
        </section>

        {/* Login form */}
        <section aria-label="Student login" className="rounded-[22px] border border-border bg-card p-6 sm:p-8">
          <h2 className="text-2xl">Student login</h2>
          <p className="mt-1.5 text-sm text-muted-foreground">
            Use the name, email and password registered for this exam.
          </p>
          <form onSubmit={onSubmit} className="mt-6">
            <div className="space-y-2">
              <Label htmlFor="name" className="mono-label text-muted-foreground">Full name</Label>
              <Input
                id="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Your full name"
                autoComplete="name"
                className="h-12 rounded-xl"
              />
            </div>
            <div className="mt-5 space-y-2">
              <Label htmlFor="email" className="mono-label text-muted-foreground">Email address</Label>
              <Input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                autoComplete="email"
                className="h-12 rounded-xl"
              />
            </div>
            <div className="mt-5 space-y-2">
              <Label htmlFor="password" className="mono-label text-muted-foreground">
                Exam password
              </Label>
              <div className="relative">
                <Input
                  id="password"
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Password from your organizer"
                  autoComplete="current-password"
                  className="h-12 rounded-xl pr-12"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  aria-label={showPassword ? "Hide password" : "Show password"}
                  aria-pressed={showPassword}
                  className="absolute right-2 top-1/2 grid size-9 -translate-y-1/2 place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
                >
                  {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                </button>
              </div>
            </div>
            <Button type="submit" disabled={busy || blocked} className="mt-7 h-12 w-full rounded-[32px] text-sm font-medium">
              {busy ? "Signing you in…" : "Continue to instructions"}
            </Button>
            <p className="mt-4 text-center text-xs text-muted-foreground">
              One attempt per registered email. Passwords work only for this exam.
            </p>
          </form>
        </section>
      </div>
      <p className="mono-label pb-8 text-center leading-5 text-muted-foreground">
        {footerCopyright()} · {brand.footerNote}
      </p>
    </main>
  );
}

function Detail({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-border bg-card p-4">
      <p className="mono-label flex items-center gap-1.5 text-muted-foreground">
        {icon} {label}
      </p>
      <p className="mt-1.5 font-medium">{value}</p>
    </div>
  );
}
