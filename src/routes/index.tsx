import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import {
  AlarmClock,
  ArrowRight,
  ClipboardCheck,
  Link2,
  LockKeyhole,
  MailCheck,
  MonitorCheck,
  MousePointerClick,
  ShieldCheck,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { brand, footerCopyright } from "@/config/brand";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: `${brand.appName} — Secure, Seamless Online Exams` },
      {
        name: "description",
        content: `${brand.appName}: timed online exams with secure per-exam login links, auto-submit and proctoring.`,
      },
      { property: "og:title", content: `${brand.appName} — Secure, Seamless Online Exams` },
      {
        property: "og:description",
        content: "Open the exam link sent by your organizer, log in, and take your timed exam.",
      },
    ],
  }),
  component: LandingPage,
});

function extractSlug(input: string): string | null {
  const v = input.trim();
  if (!v) return null;
  const m = v.match(/\/exam\/([A-Za-z0-9-]+)\/?/);
  if (m?.[1]) return m[1].toLowerCase();
  if (/^[A-Za-z0-9-]+$/.test(v)) return v.toLowerCase();
  return null;
}

function LandingPage() {
  const navigate = useNavigate();
  const [code, setCode] = useState("");
  const [codeError, setCodeError] = useState<string | null>(null);

  function goToExam(e: React.FormEvent) {
    e.preventDefault();
    const slug = extractSlug(code);
    if (!slug) {
      setCodeError("Paste a valid exam link or code, e.g. physics-midterm-k7q9x2m4pz.");
      return;
    }
    setCodeError(null);
    navigate({ to: "/exam/$slug", params: { slug } });
  }

  return (
    <main className="min-h-screen bg-background text-foreground">
      {/* Header */}
      <header className="sticky top-0 z-10 border-b border-border bg-background/90 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-5">
          <Link to="/" className="flex items-center gap-2.5" aria-label={`${brand.appName} home`}>
            <span className="grid size-9 place-items-center rounded-xl bg-brand font-mono text-sm font-semibold text-brand-foreground">
              {brand.logoMark}
            </span>
            <span className="text-lg font-semibold tracking-tight">{brand.appName}</span>
          </Link>
          <nav className="flex items-center gap-2">
            <a href="#how-it-works" className="hidden rounded-full px-4 py-2 text-sm text-muted-foreground transition-colors hover:text-foreground sm:inline-block">
              How it works
            </a>
            <a href="#features" className="hidden rounded-full px-4 py-2 text-sm text-muted-foreground transition-colors hover:text-foreground sm:inline-block">
              Features
            </a>
            <Link to="/panel-admin-login" className="rounded-full bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90">
              Organizer Login
            </Link>
          </nav>
        </div>
      </header>

      {/* Hero */}
      <section className="relative overflow-hidden">
        <div aria-hidden="true" className="pointer-events-none absolute inset-0 bg-gradient-to-b from-pale-blue via-background to-background" />
        <div className="relative mx-auto grid max-w-6xl gap-10 px-5 pb-16 pt-14 sm:pt-20 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)] lg:items-center">
          <div>
            <p className="mono-label inline-flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1 text-muted-foreground">
              <ShieldCheck className="size-3.5" /> Secure online examinations
            </p>
            <h1 className="mt-5 text-5xl leading-[1.05] sm:text-6xl">
              Secure, Seamless Online Exams
            </h1>
            <p className="mt-5 max-w-xl text-lg leading-relaxed text-muted-foreground">
              Each exam gets its own private link. Students log in with the password shared by
              the organizer, take a timed, proctored test, and submit — all in one place.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <a href="#join" className="inline-flex h-12 items-center gap-2 rounded-full bg-brand px-6 text-sm font-medium text-brand-foreground shadow-sm transition-transform hover:scale-[1.02]">
                Join Your Exam <ArrowRight className="size-4" />
              </a>
              <Link to="/panel-admin-login" className="inline-flex h-12 items-center rounded-full border border-border bg-card px-6 text-sm font-medium transition-colors hover:bg-secondary">
                Organizer Login
              </Link>
            </div>
            <p className="mt-4 text-sm text-muted-foreground">
              Students: open the exam link sent by your organizer — no account needed.
            </p>
          </div>

          {/* Join card */}
          <div id="join" className="rounded-[22px] border border-border bg-card p-6 shadow-sm sm:p-8">
            <p className="mono-label text-muted-foreground">Have an exam link?</p>
            <h2 className="mt-2 text-2xl">Enter exam code or paste link</h2>
            <form onSubmit={goToExam} className="mt-5">
              <label htmlFor="exam-code" className="sr-only">Exam code or link</label>
              <div className="flex flex-col gap-3 sm:flex-row">
                <div className="relative flex-1">
                  <Link2 className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    id="exam-code"
                    value={code}
                    onChange={(e) => setCode(e.target.value)}
                    placeholder="exam-link-code or https://…/exam/…"
                    className="h-12 rounded-xl pl-10"
                    autoComplete="off"
                    spellCheck={false}
                  />
                </div>
                <Button type="submit" className="h-12 rounded-full px-6">
                  Go <ArrowRight className="size-4" />
                </Button>
              </div>
              {codeError ? (
                <p role="alert" className="mt-3 text-sm text-destructive">{codeError}</p>
              ) : (
                <p className="mt-3 text-sm text-muted-foreground">
                  The code is the last part of your exam link, e.g.{" "}
                  <span className="font-mono">…/exam/physics-midterm-k7q9x2m4pz</span>
                </p>
              )}
            </form>
            <div className="mt-6 space-y-3 border-t border-border pt-6 text-sm">
              <p className="flex items-start gap-2.5 text-muted-foreground">
                <MailCheck className="mt-0.5 size-4 shrink-0" /> Your organizer shares the exam link and your personal password by email or message.
              </p>
              <p className="flex items-start gap-2.5 text-muted-foreground">
                <MonitorCheck className="mt-0.5 size-4 shrink-0" /> Exams run on a laptop or desktop browser in full-screen mode.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Features */}
      <section id="features" className="mx-auto max-w-6xl scroll-mt-20 px-5 py-14">
        <p className="mono-label text-muted-foreground">Why {brand.appName}</p>
        <h2 className="mt-2 text-3xl sm:text-4xl">Built for fair, focused exams</h2>
        <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <FeatureCard
            icon={<LockKeyhole className="size-5" />}
            title="Secure login"
            text="Every student gets a unique organizer-generated password that works only for their exam."
          />
          <FeatureCard
            icon={<AlarmClock className="size-5" />}
            title="Timed exams"
            text="A live countdown keeps everyone on the same clock, with per-exam durations set by the organizer."
          />
          <FeatureCard
            icon={<ClipboardCheck className="size-5" />}
            title="Auto-submit"
            text="Answers save continuously and the test submits itself the moment time runs out."
          />
          <FeatureCard
            icon={<MousePointerClick className="size-5" />}
            title="Proctored fairly"
            text="Full-screen mode with tab-switch detection and warnings keeps the exam honest for everyone."
          />
        </div>
      </section>

      {/* How it works */}
      <section id="how-it-works" className="border-y border-border bg-muted/30">
        <div className="mx-auto max-w-6xl scroll-mt-20 px-5 py-14">
          <p className="mono-label text-muted-foreground">How it works</p>
          <h2 className="mt-2 text-3xl sm:text-4xl">Three steps to done</h2>
          <ol className="mt-8 grid gap-4 md:grid-cols-3">
            <StepCard
              n="1"
              title="Receive your link and password"
              text="Your organizer sends you a private exam link plus your personal password."
            />
            <StepCard
              n="2"
              title="Log in with name, email and password"
              text="Open your exam's link and sign in with the details exactly as registered."
            />
            <StepCard
              n="3"
              title="Take the exam and submit"
              text="Read the instructions, answer within the time limit, and submit — that's it."
            />
          </ol>
        </div>
      </section>

      {/* Organizer CTA */}
      <section className="mx-auto max-w-6xl px-5 py-14">
        <div className="rounded-[22px] bg-brand px-6 py-10 text-center text-brand-foreground sm:px-12 sm:py-12">
          <h2 className="text-3xl sm:text-4xl">Running an exam?</h2>
          <p className="mx-auto mt-3 max-w-xl text-[15px] leading-relaxed opacity-90">
            Create an exam, get a private link, add students with auto-generated passwords,
            and watch results roll in — all from one dashboard.
          </p>
          <Link to="/panel-admin-login" className="mt-6 inline-flex h-12 items-center gap-2 rounded-full bg-brand-foreground px-7 text-sm font-medium text-brand transition-transform hover:scale-[1.02]">
            Open organizer dashboard <ArrowRight className="size-4" />
          </Link>
        </div>
      </section>

      <footer className="border-t border-border">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-3 px-5 py-8 text-sm text-muted-foreground sm:flex-row">
          <p className="flex items-center gap-2">
            <span className="grid size-7 place-items-center rounded-lg bg-brand font-mono text-[11px] font-semibold text-brand-foreground">
              {brand.logoMark}
            </span>
            {footerCopyright()} · {brand.footerNote}
          </p>
          <p>
            Need help? Contact <a className="underline" href={`mailto:${brand.supportEmail}`}>{brand.supportEmail}</a>
          </p>
        </div>
      </footer>
    </main>
  );
}

function FeatureCard({ icon, title, text }: { icon: React.ReactNode; title: string; text: string }) {
  return (
    <div className="group rounded-[22px] border border-border bg-card p-6 shadow-sm transition-all hover:-translate-y-1 hover:shadow-md">
      <span className="grid size-11 place-items-center rounded-2xl bg-brand/10 text-brand transition-colors group-hover:bg-brand group-hover:text-brand-foreground">
        {icon}
      </span>
      <h3 className="mt-4 text-xl">{title}</h3>
      <p className="mt-2 text-[15px] leading-relaxed text-muted-foreground">{text}</p>
    </div>
  );
}

function StepCard({ n, title, text }: { n: string; title: string; text: string }) {
  return (
    <li className="rounded-[22px] border border-border bg-card p-6 shadow-sm">
      <span className="grid size-10 place-items-center rounded-full bg-brand font-mono text-sm font-semibold text-brand-foreground">
        {n}
      </span>
      <h3 className="mt-4 text-xl">{title}</h3>
      <p className="mt-2 text-[15px] leading-relaxed text-muted-foreground">{text}</p>
    </li>
  );
}
