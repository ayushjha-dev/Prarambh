import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

/**
 * Multi-exam server functions.
 *
 * Every student credential belongs to exactly one exam (participants.exam_id).
 * A token issued for exam A never resolves inside exam B because all lookups
 * join the participant row to its exam and compare slugs.
 *
 * Passwords are never stored in plain text: each participant row keeps a
 * random `password_salt` and `password_hash = sha256(salt + password)`.
 */

export type SafeQuestion = {
  id: number;
  topic: string;
  subtopic?: string;
  difficulty?: string;
  question: string;
  option_a: string;
  option_b: string;
  option_c: string;
  option_d: string;
};

export type ExamMeta = {
  event: string;
  organiser: string;
  total_questions: number;
  marks_correct: number;
  marks_wrong: number;
  max_marks: number;
  duration_minutes: number;
};

export type ExamPhase = "live" | "upcoming" | "ended" | "disabled";

export type PublicExam = {
  slug: string;
  title: string;
  description: string;
  duration_minutes: number;
  total_questions: number;
  marks_correct: number;
  marks_wrong: number;
  starts_at: string | null;
  ends_at: string | null;
  is_enabled: boolean;
  phase: ExamPhase;
};

const tokenSchema = z.object({ token: z.string().uuid() });
const slugSchema = z
  .string()
  .trim()
  .min(1)
  .max(120)
  .transform((s) => {
    // Accept a full pasted URL as well as a bare slug/code.
    const m = s.match(/\/exam\/([A-Za-z0-9-]+)\/?/);
    return (m?.[1] ?? s).toLowerCase();
  });

const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_MINUTES = 10;

function stripQuestions(data: any): SafeQuestion[] {
  const list = Array.isArray(data?.questions) ? data.questions : [];
  return list.map((q: any) => ({
    id: Number(q.id),
    topic: String(q.topic ?? ""),
    subtopic: q.subtopic ? String(q.subtopic) : undefined,
    difficulty: q.difficulty ? String(q.difficulty) : undefined,
    question: String(q.question ?? ""),
    option_a: String(q.option_a ?? ""),
    option_b: String(q.option_b ?? ""),
    option_c: String(q.option_c ?? ""),
    option_d: String(q.option_d ?? ""),
  }));
}

function readMeta(data: any, exam: any): ExamMeta {
  const m = data?.meta ?? {};
  const total = Number(data?.questions?.length ?? 0);
  const mc = Number(exam?.marks_correct ?? m.marks_correct ?? 2);
  const mw = Number(exam?.marks_wrong ?? m.marks_wrong ?? -0.5);
  return {
    event: String(exam?.title ?? m.event ?? "Online Exam"),
    organiser: String(m.organiser ?? "ExamPortal"),
    total_questions: total,
    marks_correct: mc,
    marks_wrong: mw,
    max_marks: Number(m.max_marks ?? total * mc),
    duration_minutes: Number(exam?.duration_minutes ?? m.duration_minutes ?? 45),
  };
}

function phaseOf(exam: { is_enabled: boolean; starts_at: string | null; ends_at: string | null }): ExamPhase {
  if (!exam.is_enabled) return "disabled";
  const now = Date.now();
  if (exam.starts_at && now < new Date(exam.starts_at).getTime()) return "upcoming";
  if (exam.ends_at && now > new Date(exam.ends_at).getTime()) return "ended";
  return "live";
}

async function getExamBySlug(supabaseAdmin: any, slug: string) {
  const { data: exam } = await supabaseAdmin
    .from("exams")
    .select(
      "id, slug, title, description, duration_minutes, marks_correct, marks_wrong, starts_at, ends_at, is_enabled, question_set_id",
    )
    .eq("slug", slug)
    .maybeSingle();
  return exam ?? null;
}

async function getQuestionDoc(supabaseAdmin: any, exam: any, participantSetId?: string | null) {
  const setId = exam?.question_set_id ?? participantSetId ?? null;
  let setQuery = supabaseAdmin.from("question_sets").select("data");
  setQuery = setId ? setQuery.eq("id", setId) : setQuery.eq("is_active", true);
  const { data: qs } = await setQuery.maybeSingle();
  return qs?.data ?? null;
}

function toPublicExam(exam: any, totalQuestions: number): PublicExam {
  return {
    slug: exam.slug as string,
    title: exam.title as string,
    description: (exam.description ?? "") as string,
    duration_minutes: Number(exam.duration_minutes),
    total_questions: totalQuestions,
    marks_correct: Number(exam.marks_correct),
    marks_wrong: Number(exam.marks_wrong),
    starts_at: (exam.starts_at ?? null) as string | null,
    ends_at: (exam.ends_at ?? null) as string | null,
    is_enabled: Boolean(exam.is_enabled),
    phase: phaseOf(exam),
  };
}

/** Public exam details for the login page. Throws EXAM_NOT_FOUND for bad links. */
export const getExamPublic = createServerFn({ method: "POST" })
  .inputValidator((input) => z.object({ slug: slugSchema }).parse(input))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const exam = await getExamBySlug(supabaseAdmin, data.slug);
    if (!exam) throw new Error("EXAM_NOT_FOUND");
    const doc = await getQuestionDoc(supabaseAdmin, exam, null);
    return toPublicExam(exam, Array.isArray((doc as any)?.questions) ? (doc as any).questions.length : 0);
  });

export const loginExamParticipant = createServerFn({ method: "POST" })
  .inputValidator((input) =>
    z
      .object({
        slug: slugSchema,
        name: z.string().trim().min(2).max(120),
        email: z.string().trim().email().max(200),
        password: z.string().min(1).max(100),
      })
      .parse(input),
  )
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { default: crypto } = await import("node:crypto");

    const exam = await getExamBySlug(supabaseAdmin, data.slug);
    if (!exam) throw new Error("EXAM_NOT_FOUND");
    const phase = phaseOf(exam);
    if (phase === "disabled") throw new Error("This exam link is no longer active.");
    if (phase === "upcoming") throw new Error("Exam has not started yet.");
    if (phase === "ended") throw new Error("Exam has ended.");

    const email = data.email.toLowerCase();
    const { data: participant } = await supabaseAdmin
      .from("participants")
      .select("id, name, email, session_token, status, password_salt, password_hash, failed_attempts, locked_until")
      .eq("exam_id", exam.id)
      .eq("email", email)
      .maybeSingle();

    // Same message for unknown email vs wrong password: no account enumeration.
    const invalid = new Error("Invalid credentials.");
    if (!participant || !participant.password_salt || !participant.password_hash) throw invalid;

    if (participant.locked_until && new Date(participant.locked_until).getTime() > Date.now()) {
      throw new Error("Too many failed attempts. Please try again in a few minutes.");
    }

    const candidate = crypto
      .createHash("sha256")
      .update(`${participant.password_salt}${data.password}`)
      .digest("hex");
    const expected = Buffer.from(participant.password_hash, "hex");
    const actual = Buffer.from(candidate, "hex");
    const match = expected.length === actual.length && crypto.timingSafeEqual(expected, actual);

    if (!match) {
      const failed = Number(participant.failed_attempts ?? 0) + 1;
      const locked = failed >= MAX_FAILED_ATTEMPTS;
      await supabaseAdmin
        .from("participants")
        .update({
          failed_attempts: locked ? 0 : failed,
          locked_until: locked
            ? new Date(Date.now() + LOCKOUT_MINUTES * 60 * 1000).toISOString()
            : null,
        })
        .eq("id", participant.id);
      if (locked) throw new Error("Too many failed attempts. Please try again in a few minutes.");
      throw invalid;
    }

    if (participant.status === "completed") {
      throw new Error("You have already submitted this exam.");
    }

    await supabaseAdmin
      .from("participants")
      .update({
        failed_attempts: 0,
        locked_until: null,
        // Keep the roster fresh when a student types their name differently.
        ...(participant.name !== data.name.trim() ? { name: data.name.trim() } : {}),
      })
      .eq("id", participant.id);

    return { token: participant.session_token as string, name: (participant.name ?? data.name.trim()) as string };
  });

/** Exam brief for the instructions page (no questions leaked before start). */
export const getExamBrief = createServerFn({ method: "POST" })
  .inputValidator((input) => z.object({ slug: slugSchema, token: z.string().uuid() }).parse(input))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const exam = await getExamBySlug(supabaseAdmin, data.slug);
    if (!exam) throw new Error("EXAM_NOT_FOUND");

    const { data: p } = await supabaseAdmin
      .from("participants")
      .select("id, name, status")
      .eq("session_token", data.token)
      .eq("exam_id", exam.id)
      .maybeSingle();
    if (!p) throw new Error("NOT_AUTHENTICATED");

    const doc = await getQuestionDoc(supabaseAdmin, exam, null);
    return {
      name: p.name as string,
      status: p.status as string,
      meta: readMeta(doc, exam),
      phase: phaseOf(exam),
    };
  });

export const getExamState = createServerFn({ method: "POST" })
  .inputValidator((input) => z.object({ slug: slugSchema, token: z.string().uuid() }).parse(input))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const exam = await getExamBySlug(supabaseAdmin, data.slug);
    if (!exam) throw new Error("EXAM_NOT_FOUND");

    const { data: p } = await supabaseAdmin
      .from("participants")
      .select(
        "id, name, email, status, exam_started_at, tab_violation_count, question_set_id, submit_reason",
      )
      .eq("session_token", data.token)
      .eq("exam_id", exam.id)
      .maybeSingle();

    if (!p) throw new Error("NOT_AUTHENTICATED");

    const doc = await getQuestionDoc(supabaseAdmin, exam, p.question_set_id as string | null);
    const meta = readMeta(doc, exam);
    const questions = stripQuestions(doc);

    let status = p.status as string;
    if (status === "in_progress" && p.exam_started_at) {
      const elapsed = (Date.now() - new Date(p.exam_started_at).getTime()) / 1000;
      if (elapsed >= meta.duration_minutes * 60) {
        await supabaseAdmin.rpc("submit_exam", { p_participant: p.id, p_reason: "timeout" });
        status = "completed";
      }
    }

    const { data: responses } = await supabaseAdmin
      .from("responses")
      .select("question_id, selected_option")
      .eq("participant_id", p.id);

    return {
      name: p.name as string,
      status,
      examStartedAt: p.exam_started_at as string | null,
      violations: p.tab_violation_count as number,
      serverNow: new Date().toISOString(),
      meta,
      examTitle: exam.title as string,
      questions: status === "completed" ? [] : questions,
      answers: (responses ?? []).reduce<Record<number, string>>((acc, r: any) => {
        if (r.selected_option) acc[r.question_id] = r.selected_option;
        return acc;
      }, {}),
    };
  });

export const startExam = createServerFn({ method: "POST" })
  .inputValidator((input) => z.object({ slug: slugSchema, token: z.string().uuid() }).parse(input))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const exam = await getExamBySlug(supabaseAdmin, data.slug);
    if (!exam) throw new Error("EXAM_NOT_FOUND");

    const { data: p } = await supabaseAdmin
      .from("participants")
      .select("id, status, exam_started_at")
      .eq("session_token", data.token)
      .eq("exam_id", exam.id)
      .maybeSingle();

    if (!p) throw new Error("NOT_AUTHENTICATED");
    if (p.status === "completed") throw new Error("You have already submitted this exam.");

    if (p.status === "not_started" || !p.exam_started_at) {
      await supabaseAdmin
        .from("participants")
        .update({ status: "in_progress", exam_started_at: new Date().toISOString() })
        .eq("id", p.id)
        .eq("status", "not_started");
    }
    return { ok: true };
  });

export const saveAnswer = createServerFn({ method: "POST" })
  .inputValidator((input) =>
    z
      .object({
        slug: slugSchema,
        token: z.string().uuid(),
        questionId: z.number().int(),
        option: z.enum(["A", "B", "C", "D"]).nullable(),
      })
      .parse(input),
  )
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: p } = await supabaseAdmin
      .from("participants")
      .select("id, status, exam_id, exams!inner(slug)")
      .eq("session_token", data.token)
      .maybeSingle();

    if (!p || p.status !== "in_progress") return { saved: false };
    if ((p as any).exams?.slug !== data.slug) return { saved: false };

    const { error } = await supabaseAdmin.from("responses").upsert(
      {
        participant_id: p.id,
        question_id: data.questionId,
        selected_option: data.option,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "participant_id,question_id" },
    );
    if (error) throw new Error(error.message);
    return { saved: true };
  });

export const reportViolation = createServerFn({ method: "POST" })
  .inputValidator((input) => z.object({ slug: slugSchema, token: z.string().uuid() }).parse(input))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: p } = await supabaseAdmin
      .from("participants")
      .select("id, status, exam_id, exams!inner(slug)")
      .eq("session_token", data.token)
      .maybeSingle();

    if (!p || p.status !== "in_progress") return { count: 0, submitted: true };
    if ((p as any).exams?.slug !== data.slug) return { count: 0, submitted: true };

    const { data: count } = await supabaseAdmin.rpc("increment_violation", {
      p_participant: p.id,
    });
    const n = Number(count ?? 0);
    if (n >= 3) {
      await supabaseAdmin.rpc("submit_exam", { p_participant: p.id, p_reason: "violation" });
      return { count: n, submitted: true };
    }
    return { count: n, submitted: false };
  });

export const submitExam = createServerFn({ method: "POST" })
  .inputValidator((input) =>
    z
      .object({ slug: slugSchema, token: z.string().uuid(), reason: z.enum(["manual", "timeout"]) })
      .parse(input),
  )
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: p } = await supabaseAdmin
      .from("participants")
      .select("id, status, exam_id, exams!inner(slug)")
      .eq("session_token", data.token)
      .maybeSingle();

    if (!p) throw new Error("Session not found.");
    if ((p as any).exams?.slug !== data.slug) throw new Error("Session not found.");
    if (p.status === "completed") return { submitted: true };

    await supabaseAdmin.rpc("submit_exam", { p_participant: p.id, p_reason: data.reason });
    return { submitted: true };
  });
