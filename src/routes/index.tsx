import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import {
  AlarmClock,
  ArrowRight,
  Check,
  ClipboardCheck,
  Link2,
  LockKeyhole,
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

const ASSURANCES = ["Private per-exam links", "Unique student passwords", "Auto-submit on timeout"];

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
    <main className="min-h-screen bg-background text-foreground antialiased">
      {/* Header */}
      <header className="sticky top-0 z-10 border-b border-border/80 bg-background/85 backdrop-blur-md">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-5">
          <Link to="/" className="flex items-center gap-2.5" aria-label={`${brand.appName} home`}>
            <span className="grid size-9 place-items-center rounded-xl bg-brand font-mono text-sm font-semibold text-brand-foreground shadow-sm">
              {brand.logoMark}
            </span>
            <span className="text-lg font-semibold tracking-tight">{brand.appName}</span>
          </Link>
          <nav className="flex items-center gap-1" aria-label="Primary">
            <a href="#features" className="hidden rounded-full px-4 py-2 text-sm text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground sm:inline-block">
              Features
            </a>
            <a href="#how-it-works" className="hidden rounded-full px-4 py-2 text-sm text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground sm:inline-block">
              How it works
            </a>
            <Link to="/panel-admin-login" className="ml-1 rounded-full bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-sm transition-all hover:bg-primary/90 hover:shadow">
              Organizer Login
            </Link>
          </nav>
        </div>
      </header>

      {/* Hero */}
      <section aria-labelledby="hero-heading" className="relative overflow-hidden">
        <div aria-hidden="true" className="pointer-events-none absolute inset-0">
          <div className="absolute inset-0 bg-gradient-to-b from-pale-blue via-background to-background" />
          <div className="absolute -top-32 left-1/2 h-96 w-[42rem] -translate-x-1/2 rounded-full bg-brand/10 blur-3xl" />
          <div className="absolute inset-0 bg-[linear-gradient(to_right,var(--color-border)_1px,transparent_1px),linear-gradient(to_bottom,var(--color-border)_1px,transparent_1px)] bg-[size:56px_56px] opacity-40 [mask-image:radial-gradient(ellipse_70%_60%_at_50%_0%,black,transparent)]" />
        </div>

        <div className="relative mx-auto grid max-w-6xl items-center gap-12 px-5 pb-20 pt-14 sm:pt-24 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,0.95fr)]">
          <div>
            <p className="mono-label inline-flex items-center gap-2 rounded-full border border-brand/25 bg-brand/[0.07] px-3.5 py-1.5 text-brand">
              <span className="relative flex size-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-brand opacity-60" />
                <span className="relative inline-flex size-2 rounded-full bg-brand" />
              </span>
              Secure online examinations
            </p>
            <h1 id="hero-heading" className="mt-6 text-5xl leading-[1.04] tracking-tight sm:text-6xl lg:text-7xl">
              Secure, seamless <em className="text-brand">online exams</em>
            </h1>
            <p className="mt-6 max-w-xl text-lg leading-relaxed text-muted-foreground">
              Every exam gets its own private link and every student gets their
              own password. Timed, proctored, auto-submitted — no accounts, no
              setup, no fuss.
            </p>
            <ul className="mt-7 flex flex-wrap gap-x-5 gap-y-2" aria-label="Highlights">
              {ASSURANCES.map((a) => (
                <li key={a} className="flex items-center gap-1.5 text-sm font-medium text-muted-foreground">
                  <Check className="size-4 text-brand" strokeWidth={3} /> {a}
                </li>
              ))}
            </ul>
            <div className="mt-9 flex flex-wrap items-center gap-3">
              <a href="#join" className="inline-flex h-12 items-center gap-2 rounded-full bg-brand px-7 text-sm font-semibold text-brand-foreground shadow-md shadow-brand/20 transition-all hover:-translate-y-0.5 hover:shadow-lg hover:shadow-brand/25">
                Join Your Exam <ArrowRight className="size-4" />
              </a>
              <p className="text-sm text-muted-foreground">
                No account needed — just your exam link.
              </p>
            </div>
          </div>

          {/* Join card */}
          <div id="join" className="scroll-mt-24 rounded-[24px] border border-border bg-card p-6 shadow-xl shadow-brand/[0.07] sm:p-8">
            <div className="flex items-center gap-3">
              <span className="grid size-11 shrink-0 place-items-center rounded-2xl bg-brand text-brand-foreground">
                <ShieldCheck className="size-5" />
              </span>
              <div>
                <p className="mono-label text-muted-foreground">Have an exam link?</p>
                <h2 className="text-2xl leading-tight">Enter code or paste link</h2>
              </div>
            </div>
            <form onSubmit={goToExam} className="mt-6">
              <label htmlFor="exam-code" className="sr-only">Exam code or link</label>
              <div className="flex flex-col gap-3 sm:flex-row">
                <div className="relative flex-1">
                  <Link2 className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    id="exam-code"
                    value={code}
                    onChange={(e) => setCode(e.target.value)}
                    placeholder="…/exam/physics-midterm-k7q9x2m4pz"
                    className="h-12 rounded-xl border-border bg-background pl-10 font-mono text-sm shadow-inner focus-visible:ring-brand"
                    autoComplete="off"
                    spellCheck={false}
                  />
                </div>
                <Button type="submit" className="h-12 shrink-0 rounded-full bg-brand px-7 font-semibold text-brand-foreground shadow-md shadow-brand/20 hover:bg-brand/90">
                  Go <ArrowRight className="size-4" />
                </Button>
              </div>
              <p role={codeError ? "alert" : undefined} className={`mt-3 text-sm ${codeError ? "font-medium text-destructive" : "text-muted-foreground"}`}>
                {codeError ?? "Paste the full link or just the code after /exam/. Press Enter to continue."}
              </p>
            </form>
          </div>
        </div>
      </section>

      {/* Features */}
      <section id="features" aria-labelledby="features-heading" className="mx-auto max-w-6xl scroll-mt-20 px-5 py-16 sm:py-20">
        <div className="max-w-2xl">
          <p className="mono-label text-brand">Why {brand.appName}</p>
          <h2 id="features-heading" className="mt-3 text-3xl tracking-tight sm:text-4xl">
            Everything a fair exam needs. Nothing it doesn&apos;t.
          </h2>
        </div>
        <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <FeatureCard
            icon={<LockKeyhole className="size-5" />}
            title="Secure login"
            text="Unique organizer-generated passwords that work only for their own exam — never reusable elsewhere."
          />
          <FeatureCard
            icon={<AlarmClock className="size-5" />}
            title="Timed exams"
            text="A live server-synced countdown with per-exam durations and optional start/end windows."
          />
          <FeatureCard
            icon={<ClipboardCheck className="size-5" />}
            title="Auto-submit"
            text="Answers save as you type and the test submits itself the moment time runs out."
          />
          <FeatureCard
            icon={<MousePointerClick className="size-5" />}
            title="Fair proctoring"
            text="Full-screen mode with tab-switch detection and warnings keeps every attempt honest."
          />
        </div>
      </section>

      {/* How it works */}
      <section id="how-it-works" aria-labelledby="how-heading" className="border-y border-border bg-muted/30">
        <div className="mx-auto max-w-6xl scroll-mt-20 px-5 py-16 sm:py-20">
          <div className="max-w-2xl">
            <p className="mono-label text-brand">How it works</p>
            <h2 id="how-heading" className="mt-3 text-3xl tracking-tight sm:text-4xl">
              From link to submitted in three steps
            </h2>
          </div>
          <ol className="relative mt-10 grid gap-4 md:grid-cols-3">
            <div aria-hidden="true" className="absolute left-0 right-0 top-11 hidden border-t-2 border-dashed border-border md:block" />
            <StepCard
              n="1"
              title="Get your link & password"
              text="Your organizer sends a private exam link plus your personal password."
            />
            <StepCard
              n="2"
              title="Log in on that page"
              text="Open your exam's link and sign in with name, email and password."
            />
            <StepCard
              n="3"
              title="Take it & submit"
              text="Read the instructions, beat the timer, and submit. Done."
            />
          </ol>
        </div>
      </section>

      {/* Organizer CTA */}
      <section aria-labelledby="cta-heading" className="mx-auto max-w-6xl px-5 py-16 sm:py-20">
        <div className="relative overflow-hidden rounded-[28px] bg-brand px-6 py-12 text-center text-brand-foreground shadow-xl shadow-brand/20 sm:px-12 sm:py-16">
          <div aria-hidden="true" className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_50%_0%,rgba(255,255,255,0.16),transparent_60%)]" />
          <div aria-hidden="true" className="pointer-events-none absolute inset-0 opacity-20 bg-[linear-gradient(to_right,white_1px,transparent_1px),linear-gradient(to_bottom,white_1px,transparent_1px)] bg-[size:44px_44px] [mask-image:radial-gradient(ellipse_60%_80%_at_50%_50%,black,transparent)]" />
          <div className="relative">
            <p className="mono-label opacity-80">For organizers</p>
            <h2 id="cta-heading" className="mx-auto mt-3 max-w-xl text-3xl tracking-tight sm:text-5xl">
              Run your next exam in minutes
            </h2>
            <p className="mx-auto mt-4 max-w-xl text-[16px] leading-relaxed opacity-90">
              Create the exam, share one link, auto-generate every password,
              upload questions, and watch results roll in.
            </p>
            <Link to="/panel-admin-login" className="mt-8 inline-flex h-12 items-center gap-2 rounded-full bg-brand-foreground px-8 text-sm font-semibold text-brand shadow-lg transition-all hover:-translate-y-0.5 hover:shadow-xl">
              Open organizer dashboard <ArrowRight className="size-4" />
            </Link>
          </div>
        </div>
      </section>

      <footer className="border-t border-border">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 px-5 py-8 text-sm text-muted-foreground sm:flex-row">
          <p className="flex items-center gap-2">
            <span className="grid size-7 place-items-center rounded-lg bg-brand font-mono text-[11px] font-semibold text-brand-foreground">
              {brand.logoMark}
            </span>
            {footerCopyright()}
          </p>
          <nav className="flex items-center gap-5" aria-label="Footer">
            <a href="#join" className="transition-colors hover:text-foreground">Join exam</a>
            <Link to="/panel-admin-login" className="transition-colors hover:text-foreground">Organizer login</Link>
            <a className="transition-colors hover:text-foreground" href={`mailto:${brand.supportEmail}`}>Support</a>
          </nav>
        </div>
      </footer>
    </main>
  );
}

function FeatureCard({ icon, title, text }: { icon: React.ReactNode; title: string; text: string }) {
  return (
    <div className="group relative overflow-hidden rounded-[22px] border border-border bg-card p-6 shadow-sm transition-all duration-300 hover:-translate-y-1 hover:border-brand/40 hover:shadow-lg hover:shadow-brand/[0.08]">
      <span className="grid size-11 place-items-center rounded-2xl bg-brand/10 text-brand transition-colors duration-300 group-hover:bg-brand group-hover:text-brand-foreground">
        {icon}
      </span>
      <h3 className="mt-5 text-xl tracking-tight">{title}</h3>
      <p className="mt-2 text-[15px] leading-relaxed text-muted-foreground">{text}</p>
    </div>
  );
}

function StepCard({ n, title, text }: { n: string; title: string; text: string }) {
  return (
    <li className="relative rounded-[22px] border border-border bg-card p-6 shadow-sm transition-shadow duration-300 hover:shadow-md sm:p-7">
      <span className="relative grid size-11 place-items-center rounded-full bg-brand font-mono text-sm font-bold text-brand-foreground ring-4 ring-background">
        {n}
      </span>
      <h3 className="mt-5 text-xl tracking-tight">{title}</h3>
      <p className="mt-2 text-[15px] leading-relaxed text-muted-foreground">{text}</p>
    </li>
  );
}
