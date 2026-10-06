import { createFileRoute, useNavigate, useParams } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Menu, X } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { brand } from "@/config/brand";
import {
  getExamState,
  reportViolation,
  saveAnswer,
  submitExam,
  type ExamMeta,
  type SafeQuestion,
} from "@/lib/exam.functions";
import { formatClock, loadSessionForExam, playViolationAlarm } from "@/lib/exam-session";
import { DesktopOnlyScreen, useIsPhone } from "@/components/DesktopOnly";

export const Route = createFileRoute("/exam/$slug/start")({
  ssr: false,
  head: () => ({
    meta: [
      { title: `Exam in progress — ${brand.appName}` },
      { name: "description", content: "Timed examination in progress." },
      { name: "robots", content: "noindex,nofollow" },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: ExamPage,
});

type Letter = "A" | "B" | "C" | "D";
const LETTERS: Letter[] = ["A", "B", "C", "D"];

function ExamPage() {
  const { slug } = useParams({ from: "/exam/$slug/start" });
  const navigate = useNavigate();
  const session = useMemo(() => loadSessionForExam(slug), [slug]);
  const fetchState = useServerFn(getExamState);
  const persistAnswer = useServerFn(saveAnswer);
  const flagViolation = useServerFn(reportViolation);
  const finishExam = useServerFn(submitExam);

  const [loading, setLoading] = useState(true);
  const [questions, setQuestions] = useState<SafeQuestion[]>([]);
  const [meta, setMeta] = useState<ExamMeta | null>(null);
  const [examTitle, setExamTitle] = useState("");
  const [answers, setAnswers] = useState<Record<number, Letter>>({});
  const [visited, setVisited] = useState<Record<number, boolean>>({});
  const [current, setCurrent] = useState(0);
  const [remaining, setRemaining] = useState<number | null>(null);
  const [violations, setViolations] = useState(0);
  const [blocked, setBlocked] = useState<"none" | "fullscreen" | "violation" | "terminated">("none");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const isPhone = useIsPhone();

  const deadlineRef = useRef<number | null>(null);
  const armedRef = useRef(false);
  const handlingRef = useRef(false);
  const submittedRef = useRef(false);
  const saveTimers = useRef<Record<number, ReturnType<typeof setTimeout>>>({});

  const goSubmitted = useCallback(() => {
    submittedRef.current = true;
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    navigate({ to: "/exam/$slug/submitted", params: { slug } });
  }, [navigate, slug]);

  const doSubmit = useCallback(
    async (reason: "manual" | "timeout") => {
      if (submittedRef.current || !session) return;
      submittedRef.current = true;
      try {
        await finishExam({ data: { slug, token: session.token, reason } });
      } catch {
        /* server also enforces timeout on next read */
      }
      goSubmitted();
    },
    [finishExam, goSubmitted, session, slug],
  );

  const sync = useCallback(async () => {
    if (!session) return;
    const state = await fetchState({ data: { slug, token: session.token } });
    if (state.status === "completed") {
      goSubmitted();
      return;
    }
    if (state.status === "not_started" || !state.examStartedAt) {
      navigate({ to: "/exam/$slug/instructions", params: { slug } });
      return;
    }
    const serverNow = new Date(state.serverNow).getTime();
    const started = new Date(state.examStartedAt).getTime();
    const durationMs = state.meta.duration_minutes * 60 * 1000;
    deadlineRef.current = Date.now() + (started + durationMs - serverNow);
    setRemaining(Math.max(0, Math.round((deadlineRef.current - Date.now()) / 1000)));
    setMeta(state.meta);
    setExamTitle(state.examTitle);
    setViolations(state.violations);
    setQuestions(state.questions);
    setAnswers((prev) => ({ ...(state.answers as Record<number, Letter>), ...prev }));
  }, [fetchState, goSubmitted, navigate, session, slug]);

  // initial load
  useEffect(() => {
    if (isPhone) return;
    if (!session) {
      navigate({ to: "/exam/$slug", params: { slug } });
      return;
    }
    sync()
      .catch((err) => {
        if (err instanceof Error && err.message.includes("NOT_AUTHENTICATED")) {
          navigate({ to: "/exam/$slug", params: { slug } });
        } else {
          toast.error(err instanceof Error ? err.message : "Could not load the exam.");
          navigate({ to: "/exam/$slug", params: { slug } });
        }
      })
      .finally(() => setLoading(false));
  }, [isPhone, navigate, session, slug, sync]);

  // periodic resync with per-candidate jitter (avoids a synchronised burst)
  useEffect(() => {
    if (loading) return;
    const interval = 25000 + Math.floor(Math.random() * 8000);
    const id = setInterval(() => {
      if (!submittedRef.current) sync().catch(() => {});
    }, interval);
    return () => clearInterval(id);
  }, [loading, sync]);

  // local countdown
  useEffect(() => {
    const id = setInterval(() => {
      if (deadlineRef.current == null) return;
      const left = Math.max(0, Math.round((deadlineRef.current - Date.now()) / 1000));
      setRemaining(left);
      if (left <= 0 && !submittedRef.current) void doSubmit("timeout");
    }, 1000);
    return () => clearInterval(id);
  }, [doSubmit]);

  const handleViolation = useCallback(async () => {
    if (!session || submittedRef.current || handlingRef.current) return;
    handlingRef.current = true;
    playViolationAlarm();
    setBlocked("violation");
    try {
      const res = await flagViolation({ data: { slug, token: session.token } });
      setViolations(res.count);
      if (res.submitted) {
        setBlocked("terminated");
        submittedRef.current = true;
        setTimeout(() => goSubmitted(), 3500);
      }
    } catch {
      setViolations((v) => v + 1);
    } finally {
      handlingRef.current = false;
    }
  }, [flagViolation, goSubmitted, session, slug]);

  // full-screen + tab-switch enforcement
  useEffect(() => {
    if (loading || isPhone) return;

    if (document.fullscreenElement) armedRef.current = true;
    else setBlocked((b) => (b === "none" ? "fullscreen" : b));

    const onFsChange = () => {
      if (document.fullscreenElement) {
        armedRef.current = true;
        setBlocked((b) => (b === "fullscreen" ? "none" : b));
      } else if (armedRef.current && !submittedRef.current) {
        void handleViolation();
      }
    };
    const onHidden = () => {
      if (document.visibilityState === "hidden" && armedRef.current && !submittedRef.current) {
        void handleViolation();
      }
    };
    // Window lost focus (Windows key, Alt+Tab, another app/browser opened on top)
    const onBlur = () => {
      if (armedRef.current && !submittedRef.current) void handleViolation();
    };
    // Safety net: some OS switches don't fire blur reliably
    let wasFocused = document.hasFocus();
    const focusPoll = setInterval(() => {
      const focused = document.hasFocus();
      if (wasFocused && !focused && armedRef.current && !submittedRef.current) {
        void handleViolation();
      }
      wasFocused = focused;
    }, 1000);
    document.addEventListener("fullscreenchange", onFsChange);
    document.addEventListener("visibilitychange", onHidden);
    window.addEventListener("blur", onBlur);
    return () => {
      clearInterval(focusPoll);
      document.removeEventListener("fullscreenchange", onFsChange);
      document.removeEventListener("visibilitychange", onHidden);
      window.removeEventListener("blur", onBlur);
    };
  }, [handleViolation, isPhone, loading]);


  useEffect(() => {
    if (questions.length) setVisited((v) => ({ ...v, [questions[current]!.id]: true }));
  }, [current, questions]);

  function queueSave(questionId: number, option: Letter) {
    if (!session) return;
    clearTimeout(saveTimers.current[questionId]);
    saveTimers.current[questionId] = setTimeout(() => {
      const attempt = (tries: number) => {
        persistAnswer({ data: { slug, token: session.token, questionId, option } }).catch(() => {
          if (tries < 4) setTimeout(() => attempt(tries + 1), 800 * 2 ** tries);
          else toast.error("An answer could not be saved. Check your connection.");
        });
      };
      attempt(0);
    }, 600);
  }

  function selectOption(questionId: number, option: Letter) {
    setAnswers((a) => ({ ...a, [questionId]: option }));
    queueSave(questionId, option);
  }

  async function returnToFullscreen() {
    try {
      await document.documentElement.requestFullscreen();
      setBlocked("none");
    } catch {
      toast.error("Please allow full-screen to continue.");
    }
  }

  if (isPhone) return <DesktopOnlyScreen />;

  if (loading || !meta) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-background">
        <p className="mono-label text-muted-foreground">Loading examination…</p>
      </main>
    );
  }

  const q = questions[current];
  const answeredCount = Object.keys(answers).length;
  const critical = remaining !== null && remaining <= 300;
  const watermark = (examTitle || brand.appName).toUpperCase();

  return (
    <main className="flex h-screen flex-col overflow-hidden bg-background">
      <header className="sticky top-0 z-20 grid min-h-16 grid-cols-[minmax(0,1fr)_auto] items-center gap-3 border-b border-border bg-brand px-4 text-brand-foreground sm:px-5">
        <p className="mono-label min-w-0 truncate font-semibold">{examTitle || brand.appName}</p>
        <div className="flex shrink-0 items-center gap-3">
          <span className="mono-label hidden rounded-full bg-brand-foreground/10 px-3 py-1 text-[10px] sm:inline-flex">
            Violations: {violations} / 3
          </span>
          <span
            className={`font-mono text-xl font-semibold tabular-nums ${critical ? "text-coral" : ""}`}
          >
            {remaining === null ? "--:--" : formatClock(remaining)}
          </span>
          <Button
            variant="secondary"
            size="icon"
            className="size-10 border border-brand-foreground/15 bg-brand-foreground/10 text-brand-foreground shadow-none hover:bg-brand-foreground/20"
            onClick={() => setPaletteOpen((open) => !open)}
            title="Open question palette"
            aria-label="Open question palette"
            aria-expanded={paletteOpen}
          >
            {paletteOpen ? <X className="size-4" /> : <Menu className="size-4" />}
          </Button>
        </div>
      </header>

      <div className="relative flex min-h-0 flex-1 overflow-y-auto bg-muted/20">
        <div className="pointer-events-none absolute inset-0 grid grid-cols-3 content-around gap-y-10 overflow-hidden px-2 opacity-[0.055] sm:grid-cols-5" aria-hidden="true">
          {Array.from({ length: 35 }, (_, index) => (
            <span key={index} className="rotate-[-24deg] select-none text-center font-mono text-xl font-semibold text-brand sm:text-2xl">
              {watermark.slice(0, 12)}
            </span>
          ))}
        </div>
        <section className="relative z-10 mx-auto my-6 flex w-[calc(100%-2rem)] max-w-4xl flex-col self-start rounded-lg border border-border bg-card p-5 shadow-sm sm:my-7 sm:p-9">
          <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 border-b border-border pb-4">
            <span className="mono-label min-w-0 truncate font-semibold text-muted-foreground">
              Question {current + 1} of {questions.length}
            </span>
            <span className="shrink-0 rounded-full bg-secondary px-3 py-1 text-xs text-muted-foreground">
              {q && answers[q.id] ? "Answered" : "Not answered"}
            </span>
          </div>

          {q ? (
            <>
              <p className="mt-6 whitespace-pre-wrap text-[17px] leading-relaxed sm:text-xl">
                {q.question}
              </p>

              <div className="mt-7 space-y-3">
                {LETTERS.map((letter) => {
                  const text = q[`option_${letter.toLowerCase()}` as keyof SafeQuestion] as string;
                  const selected = answers[q.id] === letter;
                  return (
                    <Button
                      key={letter}
                      type="button"
                      variant="outline"
                      onClick={() => selectOption(q.id, letter)}
                      className={`h-auto min-h-16 w-full justify-start whitespace-normal rounded-lg px-4 py-3 text-left text-base font-normal shadow-none ${
                        selected
                          ? "border-brand bg-pale-green hover:bg-pale-green"
                          : "border-border bg-card hover:bg-secondary"
                      }`}
                    >
                      <span className="mono-label grid size-6 shrink-0 place-items-center rounded border border-border bg-secondary text-[11px] text-muted-foreground">
                        {letter}
                      </span>
                      <span className="leading-snug">{text}</span>
                    </Button>
                  );
                })}
              </div>

              <div className="mt-8 flex items-center gap-3 border-t border-border pt-5">
                <Button
                  variant="outline"
                  className="rounded-full shadow-none"
                  disabled={current === 0}
                  onClick={() => setCurrent((c) => Math.max(0, c - 1))}
                >
                  Previous
                </Button>
                {current < questions.length - 1 ? (
                  <Button
                    variant="outline"
                    className="rounded-full px-5 shadow-none"
                    onClick={() => setCurrent((c) => Math.min(questions.length - 1, c + 1))}
                  >
                    Next
                  </Button>
                ) : (
                  <Button className="rounded-full px-6" onClick={() => setConfirmOpen(true)}>
                    Submit Test
                  </Button>
                )}
              </div>
            </>
          ) : (
            <p className="mt-6 text-muted-foreground">No questions are available in this set.</p>
          )}
        </section>
      </div>

      {paletteOpen ? (
        <div className="fixed inset-0 z-30 bg-background/50" onClick={() => setPaletteOpen(false)}>
          <aside
            className="absolute right-3 top-[68px] max-h-[calc(100vh-80px)] w-[min(22rem,calc(100vw-1.5rem))] overflow-y-auto rounded-[18px] border border-border bg-stone p-5 shadow-xl"
            onClick={(event) => event.stopPropagation()}
          >
            <Palette
              questions={questions}
              answers={answers}
              visited={visited}
              current={current}
              onJump={(i) => {
                setCurrent(i);
                setPaletteOpen(false);
              }}
            />
            <div className="mt-5 border-t border-border pt-4 text-xs text-muted-foreground">
              <p>Answered: {answeredCount}</p>
              <p>Unattempted: {questions.length - answeredCount}</p>
              <p className="mt-2">Violations: {violations} / 3</p>
            </div>
          </aside>
        </div>
      ) : null}

      {confirmOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-5">
          <div className="w-full max-w-md rounded-[22px] border border-border bg-card p-7">
            <h2 className="text-2xl">Submit your test?</h2>
            <p className="mt-3 text-[15px] text-muted-foreground">
              Attempted: {answeredCount} · Unattempted: {questions.length - answeredCount}. Once
              submitted you cannot return to the exam.
            </p>
            <div className="mt-6 flex justify-end gap-3">
              <Button
                variant="ghost"
                className="rounded-[32px]"
                onClick={() => setConfirmOpen(false)}
              >
                Keep working
              </Button>
              <Button className="rounded-[32px] px-7" onClick={() => void doSubmit("manual")}>
                Submit Test
              </Button>
            </div>
          </div>
        </div>
      ) : null}

      {blocked !== "none" ? (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-background/95 px-5 backdrop-blur">
          <div className="w-full max-w-lg rounded-[22px] border border-destructive bg-card p-8 text-center">
            {blocked === "fullscreen" ? (
              <>
                <p className="mono-label text-muted-foreground">Full-screen required</p>
                <h2 className="mt-3 text-3xl">Return to full-screen to continue</h2>
                <p className="mt-3 text-[15px] text-muted-foreground">
                  The timer keeps running while the exam is paused.
                </p>
                <Button className="mt-6 rounded-[32px] px-7" onClick={returnToFullscreen}>
                  Return to Full-Screen
                </Button>
              </>
            ) : blocked === "violation" ? (
              <>
                <p className="mono-label text-destructive">
                  Violation {violations} of 3
                </p>
                <h2 className="mt-3 text-3xl text-destructive">Warning</h2>
                <p className="mt-3 text-[15px]">
                  Leaving full-screen or switching tabs during the exam is not allowed.{" "}
                  {3 - violations === 1
                    ? "One more violation will submit your test automatically."
                    : `${3 - violations} violations remaining before automatic submission.`}
                </p>
                <Button className="mt-6 rounded-[32px] px-7" onClick={returnToFullscreen}>
                  Return to Full-Screen
                </Button>
              </>
            ) : (
              <>
                <p className="mono-label text-destructive">Third violation detected</p>
                <h2 className="mt-3 text-3xl text-destructive">
                  Your test has been submitted automatically
                </h2>
                <p className="mt-3 text-[15px] text-muted-foreground">Redirecting…</p>
              </>
            )}
          </div>
        </div>
      ) : null}
    </main>
  );
}

function Palette({
  questions,
  answers,
  visited,
  current,
  onJump,
}: {
  questions: SafeQuestion[];
  answers: Record<number, string>;
  visited: Record<number, boolean>;
  current: number;
  onJump: (index: number) => void;
}) {
  return (
    <div>
      <p className="mono-label text-muted-foreground">Question palette</p>
      <div className="mt-3 grid grid-cols-6 gap-2">
        {questions.map((q, i) => {
          const answered = Boolean(answers[q.id]);
          const cls = answered
            ? "bg-brand text-brand-foreground"
            : visited[q.id]
              ? "border border-coral bg-background"
              : "border border-border bg-background text-muted-foreground";
          return (
            <Button
              key={q.id}
              variant="ghost"
              size="sm"
              onClick={() => onJump(i)}
              className={`h-9 min-w-0 rounded-lg p-0 text-xs font-medium ${cls} ${
                i === current ? "ring-2 ring-primary ring-offset-1" : ""
              }`}
            >
              {i + 1}
            </Button>
          );
        })}
      </div>
      <div className="mono-label mt-4 space-y-1 text-muted-foreground">
        <p>■ Answered · ▢ Visited · ▫ Not visited</p>
      </div>
    </div>
  );
}
