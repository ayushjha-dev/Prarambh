import { createFileRoute, useNavigate, useParams } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { brand } from "@/config/brand";
import { MobileNoticeScreen, useIsPhone, useMobileAck } from "@/components/DesktopOnly";
import { getExamBrief, startExam } from "@/lib/exam.functions";
import { clearSessionForExam, loadSessionForExam } from "@/lib/exam-session";

export const Route = createFileRoute("/exam/$slug/instructions")({
  ssr: false,
  head: () => ({
    meta: [
      { title: `Instructions — ${brand.appName}` },
      { name: "description", content: "Read the exam rules and marking scheme before you begin." },
      { name: "robots", content: "noindex,nofollow" },
    ],
  }),
  component: InstructionsPage,
});

function InstructionsPage() {
  const { slug } = useParams({ from: "/exam/$slug/instructions" });
  const navigate = useNavigate();
  const brief = useServerFn(getExamBrief);
  const start = useServerFn(startExam);
  const [agreed, setAgreed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [meta, setMeta] = useState<{
    event: string;
    total_questions: number;
    marks_correct: number;
    marks_wrong: number;
    max_marks: number;
    duration_minutes: number;
  } | null>(null);
  const session = typeof window !== "undefined" ? loadSessionForExam(slug) : null;
  const isPhone = useIsPhone();
  const [needsAck, ackMobile] = useMobileAck(slug);

  useEffect(() => {
    if (!session) {
      navigate({ to: "/exam/$slug", params: { slug } });
      return;
    }
    brief({ data: { slug, token: session.token } })
      .then((res) => {
        if (res.status === "completed") {
          navigate({ to: "/exam/$slug/submitted", params: { slug } });
          return;
        }
        setMeta(res.meta);
      })
      .catch((err) => {
        if (err instanceof Error && err.message.includes("NOT_AUTHENTICATED")) {
          clearSessionForExam(slug);
          navigate({ to: "/exam/$slug", params: { slug } });
        } else {
          setError(err instanceof Error ? err.message : "Could not load the instructions.");
        }
      });
  }, [slug, navigate, brief, session?.token]);

  if (needsAck) return <MobileNoticeScreen slug={slug} onContinue={ackMobile} />;

  async function handleStart() {
    if (!session) return;
    setError(null);
    setBusy(true);
    try {
      // Full-screen proctoring on devices that support it; phones and other
      // browsers without the API proceed without the lock (tab-switch
      // detection still applies during the attempt).
      const canLock = Boolean(document.documentElement.requestFullscreen) && !isPhone;
      if (canLock) {
        await document.documentElement.requestFullscreen();
        if (!document.fullscreenElement) {
          setError("Full-screen was blocked. Please allow full-screen and try again.");
          return;
        }
      }
      await start({ data: { slug, token: session.token } });
      navigate({ to: "/exam/$slug/start", params: { slug } });
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Full-screen could not be started. Please try again on a supported browser.",
      );
      toast.error("Could not start the exam.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="min-h-screen bg-background">
      <header className="bg-brand px-5 py-8 text-brand-foreground sm:py-12">
        <div className="mx-auto max-w-3xl">
          <p className="mono-label opacity-80">{brand.appName} · Online Examination</p>
          <h1 className="mt-2 text-4xl leading-none sm:text-5xl">
            {meta ? `${meta.event} — Instructions` : "Instructions"}
          </h1>
        </div>
      </header>

      <div className="mx-auto max-w-3xl px-5 py-10">
        <div className="max-h-[52vh] overflow-y-auto rounded-[22px] border border-border bg-card p-6 text-[17px] leading-relaxed sm:p-8">
          <h2 className="text-2xl">Exam format</h2>
          <ul className="mt-3 list-disc space-y-2 pl-5">
            <li>
              The exam consists of {meta ? meta.total_questions : "—"} multiple-choice questions to
              be completed in {meta ? meta.duration_minutes : "—"} minutes.
            </li>
            <li>The test is auto-submitted the moment the timer reaches zero.</li>
            <li>Every question has exactly one correct option (A, B, C or D).</li>
          </ul>

          <h2 className="mt-7 text-2xl">Marking scheme</h2>
          <ul className="mt-3 list-disc space-y-2 pl-5">
            <li>
              <strong>+{meta ? meta.marks_correct : "—"}</strong> marks for every correct answer.
            </li>
            <li>
              <strong className="text-destructive">{meta ? meta.marks_wrong : "—"}</strong> marks
              for every wrong answer (negative marking applies).
            </li>
            <li>
              <strong>0</strong> marks for unattempted questions. Maximum score:{" "}
              {meta ? meta.max_marks : "—"}.
            </li>
          </ul>

          <h2 className="mt-7 text-2xl">Full-screen &amp; violations</h2>
          <p className="mt-3">
            The exam runs in full-screen mode only. Exiting full-screen, switching tabs, minimising
            the window or moving to another app is recorded as a violation.
          </p>
          <p className="mt-3 rounded-xl bg-[var(--coral)]/15 p-4 font-medium text-destructive">
            Three violations will submit your test automatically and end your attempt. You will be
            warned on the first and second violation.
          </p>

          <h2 className="mt-7 text-2xl">Conduct</h2>
          <ul className="mt-3 list-disc space-y-2 pl-5">
            <li>No external help, notes, devices or communication with other candidates.</li>
            <li>
              Reloading is allowed: your answers are saved continuously and the exam resumes from
              where you left off, with the clock still running. Reloading does not pause the timer
              and will require you to re-enter full-screen.
            </li>
            <li>Closing the browser does not stop the timer; the exam auto-submits at zero.</li>
          </ul>

          <h2 className="mt-7 text-2xl">Data</h2>
          <p className="mt-3">
            Your name, email, responses and time taken are collected and used solely for evaluating
            this exam. Results are announced by the organisers.
          </p>
        </div>

        <label className="mt-6 flex items-start gap-3 text-[15px]">
          <Checkbox
            checked={agreed}
            onCheckedChange={(v) => setAgreed(v === true)}
            className="mt-1"
          />
          <span>I have read and agree to the above instructions.</span>
        </label>

        {error ? <p className="mt-4 text-sm text-destructive">{error}</p> : null}

        <Button
          disabled={!agreed || busy}
          onClick={handleStart}
          className="mt-6 h-12 rounded-[32px] px-8 text-sm font-medium"
        >
          {busy ? "Starting…" : "Start the exam"}
        </Button>

        <p className="mono-label mt-10 leading-5 text-muted-foreground">
          {brand.appName} · {brand.footerNote}
        </p>
      </div>
    </main>
  );
}
