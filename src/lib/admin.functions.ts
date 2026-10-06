import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Database } from "@/integrations/supabase/types";
import { z } from "zod";

async function assertAdmin(context: any) {
  const { data: isAdmin } = await context.supabase.rpc("has_role", {
    _user_id: context.userId,
    _role: "admin",
  });
  if (!isAdmin) throw new Error("Forbidden");
}

// ------------------------------------------------------------ credential kit
const PASSWORD_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";

async function randomToken(bytes: number): Promise<string> {
  const { default: crypto } = await import("node:crypto");
  return crypto.randomBytes(bytes).toString("hex");
}

async function generateStudentPassword(length = 10): Promise<string> {
  const { default: crypto } = await import("node:crypto");
  const bytes = crypto.randomBytes(length);
  let out = "";
  for (let i = 0; i < length; i++) {
    out += PASSWORD_ALPHABET[(bytes[i] as number) % PASSWORD_ALPHABET.length];
  }
  return out;
}

async function hashWithSalt(password: string, salt: string): Promise<string> {
  const { default: crypto } = await import("node:crypto");
  return crypto.createHash("sha256").update(`${salt}${password}`).digest("hex");
}

function slugifyTitle(title: string): string {
  const words = title
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 3)
    .join("-")
    .replace(/-+/g, "-");
  return words || "exam";
}

async function generateUniqueSlug(supabaseAdmin: any, title: string): Promise<string> {
  const base = slugifyTitle(title);
  for (let attempt = 0; attempt < 5; attempt++) {
    const suffix = (await randomToken(6)).slice(0, 10).toLowerCase().replace(/[^a-z0-9]/g, "x");
    const slug = `${base}-${suffix}`.replace(/-+/g, "-");
    const { data } = await supabaseAdmin.from("exams").select("id").eq("slug", slug).maybeSingle();
    if (!data) return slug;
  }
  return `${base}-${Date.now().toString(36)}`;
}

// ------------------------------------------------------------------ types
export type AdminRow = {
  id: string;
  name: string;
  email: string;
  status: string;
  total_marks: number | null;
  total_correct: number | null;
  total_wrong: number | null;
  total_unattempted: number | null;
  time_taken_seconds: number | null;
  tab_violation_count: number;
  submit_reason: string | null;
  exam_submitted_at: string | null;
};

export type AdminExam = {
  id: string;
  slug: string;
  title: string;
  description: string;
  duration_minutes: number;
  marks_correct: number;
  marks_wrong: number;
  starts_at: string | null;
  ends_at: string | null;
  is_enabled: boolean;
  created_at: string;
  question_count: number;
  total_students: number;
  completed: number;
};

export type AdminStudent = {
  id: string;
  name: string;
  email: string;
  status: string;
  created_at: string;
};

// ------------------------------------------------------------------ exams
export const adminListExams = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: exams, error } = await supabaseAdmin
      .from("exams")
      .select(
        "id, slug, title, description, duration_minutes, marks_correct, marks_wrong, starts_at, ends_at, is_enabled, created_at, question_set_id",
      )
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);

    const examIds = (exams ?? []).map((e: any) => e.id);
    let counts = new Map<string, { total: number; completed: number }>();
    if (examIds.length) {
      const { data: parts } = await supabaseAdmin
        .from("participants")
        .select("exam_id, status")
        .in("exam_id", examIds);
      for (const p of (parts ?? []) as any[]) {
        const c = counts.get(p.exam_id) ?? { total: 0, completed: 0 };
        c.total += 1;
        if (p.status === "completed") c.completed += 1;
        counts.set(p.exam_id, c);
      }
    }

    const setIds = (exams ?? []).map((e: any) => e.question_set_id).filter(Boolean);
    let qCounts = new Map<string, number>();
    if (setIds.length) {
      const { data: sets } = await supabaseAdmin.from("question_sets").select("id, data").in("id", setIds);
      for (const s of (sets ?? []) as any[]) {
        qCounts.set(s.id, Array.isArray(s.data?.questions) ? s.data.questions.length : 0);
      }
    }

    const rows: AdminExam[] = (exams ?? []).map((e: any) => ({
      id: e.id as string,
      slug: e.slug as string,
      title: e.title as string,
      description: (e.description ?? "") as string,
      duration_minutes: Number(e.duration_minutes),
      marks_correct: Number(e.marks_correct),
      marks_wrong: Number(e.marks_wrong),
      starts_at: (e.starts_at ?? null) as string | null,
      ends_at: (e.ends_at ?? null) as string | null,
      is_enabled: Boolean(e.is_enabled),
      created_at: e.created_at as string,
      question_count: e.question_set_id ? (qCounts.get(e.question_set_id) ?? 0) : 0,
      total_students: counts.get(e.id)?.total ?? 0,
      completed: counts.get(e.id)?.completed ?? 0,
    }));
    return { exams: rows };
  });

const examInput = z.object({
  title: z.string().trim().min(2).max(200),
  description: z.string().trim().max(2000).optional().default(""),
  duration_minutes: z.number().int().positive().max(600).optional().default(45),
  marks_correct: z.number().optional().default(2),
  marks_wrong: z.number().optional().default(-0.5),
  starts_at: z.string().optional().nullable(),
  ends_at: z.string().optional().nullable(),
});

function validateWindow(starts_at?: string | null, ends_at?: string | null) {
  if (starts_at && ends_at && new Date(starts_at).getTime() >= new Date(ends_at).getTime()) {
    throw new Error("Start time must be before end time.");
  }
}

export const adminCreateExam = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => examInput.parse(input))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    validateWindow(data.starts_at ?? null, data.ends_at ?? null);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const slug = await generateUniqueSlug(supabaseAdmin, data.title);
    const { data: created, error } = await supabaseAdmin
      .from("exams")
      .insert({
        slug,
        title: data.title.trim(),
        description: data.description ?? "",
        duration_minutes: data.duration_minutes ?? 45,
        marks_correct: data.marks_correct ?? 2,
        marks_wrong: data.marks_wrong ?? -0.5,
        starts_at: data.starts_at || null,
        ends_at: data.ends_at || null,
        is_enabled: true,
        created_by: context.userId,
      })
      .select("id, slug")
      .single();
    if (error) throw new Error(error.message);
    // Plain slug returned once alongside creation; it is also visible any time
    // on the dashboard with the Copy-link button.
    return { id: created.id as string, slug: created.slug as string };
  });

export const adminUpdateExam = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        id: z.string().uuid(),
        title: z.string().trim().min(2).max(200).optional(),
        description: z.string().trim().max(2000).optional(),
        duration_minutes: z.number().int().positive().max(600).optional(),
        marks_correct: z.number().optional(),
        marks_wrong: z.number().optional(),
        starts_at: z.string().optional().nullable(),
        ends_at: z.string().optional().nullable(),
        is_enabled: z.boolean().optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: current } = await supabaseAdmin
      .from("exams")
      .select("starts_at, ends_at")
      .eq("id", data.id)
      .maybeSingle();
    if (!current) throw new Error("Exam not found.");
    validateWindow(
      data.starts_at !== undefined ? data.starts_at : (current.starts_at as string | null),
      data.ends_at !== undefined ? data.ends_at : (current.ends_at as string | null),
    );
    const patch: Database["public"]["Tables"]["exams"]["Update"] = {};
    if (data.title !== undefined) patch.title = data.title;
    if (data.description !== undefined) patch.description = data.description;
    if (data.duration_minutes !== undefined) patch.duration_minutes = data.duration_minutes;
    if (data.marks_correct !== undefined) patch.marks_correct = data.marks_correct;
    if (data.marks_wrong !== undefined) patch.marks_wrong = data.marks_wrong;
    if (data.starts_at !== undefined) patch.starts_at = data.starts_at;
    if (data.ends_at !== undefined) patch.ends_at = data.ends_at;
    if (data.is_enabled !== undefined) patch.is_enabled = data.is_enabled;
    const { error } = await supabaseAdmin.from("exams").update(patch).eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const adminRegenerateSlug = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: current } = await supabaseAdmin
      .from("exams")
      .select("id, title")
      .eq("id", data.id)
      .maybeSingle();
    if (!current) throw new Error("Exam not found.");
    const slug = await generateUniqueSlug(supabaseAdmin, current.title as string);
    const { error } = await supabaseAdmin.from("exams").update({ slug }).eq("id", data.id);
    if (error) throw new Error(error.message);
    return { slug };
  });

// ---------------------------------------------------------------- students
export const adminListStudents = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ examId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: rows, error } = await supabaseAdmin
      .from("participants")
      .select("id, name, email, status, created_at")
      .eq("exam_id", data.examId)
      .order("created_at", { ascending: false })
      .limit(5000);
    if (error) throw new Error(error.message);
    return { students: (rows ?? []) as AdminStudent[] };
  });

async function insertStudent(
  supabaseAdmin: any,
  examId: string,
  name: string,
  email: string,
): Promise<{ id: string; email: string; password: string }> {
  const password = await generateStudentPassword(10);
  const salt = await randomToken(16);
  const hash = await hashWithSalt(password, salt);
  const { data: created, error } = await supabaseAdmin
    .from("participants")
    .insert({
      exam_id: examId,
      name: name.trim(),
      email: email.toLowerCase(),
      password_salt: salt,
      password_hash: hash,
      status: "not_started",
    })
    .select("id")
    .single();
  if (error) {
    if (error.code === "23505") throw new Error(`Duplicate email: ${email}`);
    throw new Error(error.message);
  }
  return { id: created.id as string, email: email.toLowerCase(), password };
}

export const adminAddStudent = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        examId: z.string().uuid(),
        name: z.string().trim().min(2).max(120),
        email: z.string().trim().email().max(200),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    // The plain password is returned exactly once — the organizer must copy it
    // or download the credentials CSV now; only the hash is stored.
    return insertStudent(supabaseAdmin, data.examId, data.name, data.email);
  });

export const adminBulkAddStudents = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        examId: z.string().uuid(),
        students: z
          .array(z.object({ name: z.string().trim().min(2).max(120), email: z.string().trim().email().max(200) }))
          .max(2000),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const added: { email: string; password: string }[] = [];
    const skipped: { email: string; reason: string }[] = [];
    const seen = new Set<string>();
    for (const s of data.students) {
      const email = s.email.toLowerCase();
      if (seen.has(email)) {
        skipped.push({ email, reason: "Duplicate email in upload" });
        continue;
      }
      seen.add(email);
      try {
        const r = await insertStudent(supabaseAdmin, data.examId, s.name, email);
        added.push({ email: r.email, password: r.password });
      } catch (err) {
        skipped.push({ email, reason: err instanceof Error ? err.message : "Insert failed" });
      }
    }
    return { added, skipped };
  });

export const adminRegenerateStudentPassword = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ participantId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const password = await generateStudentPassword(10);
    const salt = await randomToken(16);
    const hash = await hashWithSalt(password, salt);
    const { error } = await supabaseAdmin
      .from("participants")
      .update({ password_salt: salt, password_hash: hash, failed_attempts: 0, locked_until: null })
      .eq("id", data.participantId);
    if (error) throw new Error(error.message);
    return { password };
  });

export const adminEmailCredentials = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({ examId: z.string().uuid(), Credentials: z.array(z.object({ email: z.string().email(), password: z.string() })).max(2000) }).parse(input),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    // No SMTP is configured in this project, so delivery happens through the
    // organizer's own mail client: the dashboard builds `mailto:` links from
    // the returned rows. If SMTP is added later, send here instead.
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: exam } = await supabaseAdmin
      .from("exams")
      .select("id, slug, title")
      .eq("id", data.examId)
      .maybeSingle();
    if (!exam) throw new Error("Exam not found.");
    return {
      examTitle: exam.title as string,
      slug: exam.slug as string,
      rows: data.Credentials,
      emailed: false,
      hint: "No SMTP configured — use the mailto links in the dashboard to send from your own email.",
    };
  });

// ------------------------------------------------- results / participants
export const adminDashboard = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ examId: z.string().uuid().optional() }).parse(input ?? {}))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    let query = supabaseAdmin
      .from("participants")
      .select(
        "id, name, email, status, tab_violation_count, submit_reason, exam_submitted_at, time_taken_seconds",
      )
      .order("created_at", { ascending: false })
      .limit(2000);
    query = data?.examId ? query.eq("exam_id", data.examId) : query.is("exam_id", null);
    const { data: participants, error } = await query;
    if (error) throw new Error(error.message);

    const ids = (participants ?? []).map((p: any) => p.id);
    let byId = new Map<string, any>();
    if (ids.length) {
      const { data: results } = await supabaseAdmin
        .from("results")
        .select("participant_id, total_correct, total_wrong, total_unattempted, total_marks")
        .in("participant_id", ids);
      byId = new Map((results ?? []).map((r: any) => [r.participant_id, r]));
    }
    const rows: AdminRow[] = (participants ?? []).map((p: any) => {
      const r = byId.get(p.id);
      return {
        id: p.id,
        name: p.name,
        email: p.email,
        status: p.status,
        total_marks: r ? Number(r.total_marks) : null,
        total_correct: r ? r.total_correct : null,
        total_wrong: r ? r.total_wrong : null,
        total_unattempted: r ? r.total_unattempted : null,
        time_taken_seconds: p.time_taken_seconds,
        tab_violation_count: p.tab_violation_count,
        submit_reason: p.submit_reason,
        exam_submitted_at: p.exam_submitted_at,
      };
    });

    const completed = rows.filter((r) => r.status === "completed");
    const avg = (nums: number[]) =>
      nums.length ? Math.round((nums.reduce((a, b) => a + b, 0) / nums.length) * 100) / 100 : 0;

    return {
      rows,
      stats: {
        total: rows.length,
        completed: completed.length,
        inProgress: rows.filter((r) => r.status === "in_progress").length,
        avgScore: avg(completed.map((r) => Number(r.total_marks ?? 0))),
        avgTime: avg(completed.map((r) => Number(r.time_taken_seconds ?? 0))),
      },
    };
  });

export const adminParticipantDetail = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ participantId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: p } = await supabaseAdmin
      .from("participants")
      .select("id, name, email, status, question_set_id, exam_id, time_taken_seconds, tab_violation_count")
      .eq("id", data.participantId)
      .maybeSingle();
    if (!p) throw new Error("Participant not found");

    const { data: responses } = await supabaseAdmin
      .from("responses")
      .select("question_id, selected_option, is_correct, marks_awarded")
      .eq("participant_id", p.id);

    let qs: any = null;
    if (p.exam_id) {
      const { data: exam } = await supabaseAdmin
        .from("exams")
        .select("question_set_id")
        .eq("id", p.exam_id)
        .maybeSingle();
      if (exam?.question_set_id) {
        const { data } = await supabaseAdmin
          .from("question_sets")
          .select("data")
          .eq("id", exam.question_set_id)
          .maybeSingle();
        qs = data;
      }
    }
    if (!qs) {
      let setQuery = supabaseAdmin.from("question_sets").select("data");
      setQuery = p.question_set_id
        ? setQuery.eq("id", p.question_set_id)
        : setQuery.eq("is_active", true);
      const { data } = await setQuery.maybeSingle();
      qs = data;
    }

    const responseMap = new Map((responses ?? []).map((r: any) => [r.question_id, r]));
    const questions = ((qs?.data as any)?.questions ?? []).map((q: any) => {
      const r = responseMap.get(Number(q.id));
      return {
        id: Number(q.id),
        question: String(q.question ?? ""),
        topic: String(q.topic ?? ""),
        correct: String(q.correct ?? ""),
        answer_text: String(q.answer_text ?? ""),
        selected: r?.selected_option ?? null,
        marks: r ? Number(r.marks_awarded) : 0,
      };
    });

    return { participant: p, questions };
  });

export const adminResetParticipant = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ participantId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { error: responsesError } = await supabaseAdmin
      .from("responses")
      .delete()
      .eq("participant_id", data.participantId);
    if (responsesError) throw new Error(responsesError.message);

    const { error: resultError } = await supabaseAdmin
      .from("results")
      .delete()
      .eq("participant_id", data.participantId);
    if (resultError) throw new Error(resultError.message);

    const { data: participant, error: participantError } = await supabaseAdmin
      .from("participants")
      .update({
        status: "not_started",
        exam_started_at: null,
        exam_submitted_at: null,
        time_taken_seconds: null,
        submit_reason: null,
        tab_violation_count: 0,
        failed_attempts: 0,
        locked_until: null,
      })
      .eq("id", data.participantId)
      .select("id")
      .maybeSingle();
    if (participantError) throw new Error(participantError.message);
    if (!participant) throw new Error("Participant not found");

    return { ok: true };
  });

export const adminDeleteParticipant = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ participantId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { error: responsesError } = await supabaseAdmin
      .from("responses")
      .delete()
      .eq("participant_id", data.participantId);
    if (responsesError) throw new Error(responsesError.message);

    const { error: resultError } = await supabaseAdmin
      .from("results")
      .delete()
      .eq("participant_id", data.participantId);
    if (resultError) throw new Error(resultError.message);

    const { data: participant, error: participantError } = await supabaseAdmin
      .from("participants")
      .delete()
      .eq("id", data.participantId)
      .select("id")
      .maybeSingle();
    if (participantError) throw new Error(participantError.message);
    if (!participant) throw new Error("Participant not found");

    return { ok: true };
  });

export const adminGetQuestionSet = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ examId: z.string().uuid().optional() }).parse(input ?? {}))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    if (data?.examId) {
      const { data: exam } = await supabaseAdmin
        .from("exams")
        .select("question_set_id")
        .eq("id", data.examId)
        .maybeSingle();
      if (!exam?.question_set_id) return null;
      const { data: set } = await supabaseAdmin
        .from("question_sets")
        .select("id, data, created_at")
        .eq("id", exam.question_set_id)
        .maybeSingle();
      if (!set) return null;
      return {
        id: set.id as string,
        created_at: set.created_at as string,
        meta: (set.data as any)?.meta ?? {},
        count: ((set.data as any)?.questions ?? []).length as number,
      };
    }
    const { data: active } = await supabaseAdmin
      .from("question_sets")
      .select("id, data, created_at")
      .eq("is_active", true)
      .maybeSingle();
    if (!active) return null;
    return {
      id: active.id as string,
      created_at: active.created_at as string,
      meta: (active.data as any)?.meta ?? {},
      count: ((active.data as any)?.questions ?? []).length as number,
    };
  });

const questionSchema = z.object({
  id: z.number().int(),
  topic: z.string(),
  subtopic: z.string().optional(),
  difficulty: z.string().optional(),
  question: z.string().min(1),
  option_a: z.string().min(1),
  option_b: z.string().min(1),
  option_c: z.string().min(1),
  option_d: z.string().min(1),
  correct: z.enum(["A", "B", "C", "D"]),
  answer_text: z.string().optional(),
});

const setSchema = z.object({
  meta: z.object({
    event: z.string(),
    organiser: z.string(),
    total_questions: z.number().int().positive(),
    marks_correct: z.number(),
    marks_wrong: z.number(),
    max_marks: z.number(),
    duration_minutes: z.number().int().positive(),
  }),
  questions: z.array(questionSchema).min(1),
});

export const adminUploadQuestionSet = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ raw: z.string().min(2), examId: z.string().uuid().optional() }).parse(input))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);

    let parsed: unknown;
    try {
      parsed = JSON.parse(data.raw);
    } catch {
      throw new Error("That file is not valid JSON.");
    }
    const result = setSchema.safeParse(parsed);
    if (!result.success) {
      const first = result.error.issues[0];
      throw new Error(`Invalid question set: ${first?.path.join(".")} — ${first?.message}`);
    }
    const set = result.data;
    if (set.questions.length !== set.meta.total_questions) {
      throw new Error(
        `Question count (${set.questions.length}) does not match meta.total_questions (${set.meta.total_questions}).`,
      );
    }
    const ids = new Set(set.questions.map((q) => q.id));
    if (ids.size !== set.questions.length) throw new Error("Duplicate question ids found.");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: inserted, error } = await supabaseAdmin
      .from("question_sets")
      .insert({ data: set as any, is_active: data.examId ? false : true })
      .select("id")
      .single();
    if (error) throw new Error(error.message);

    if (data.examId) {
      const { error: linkError } = await supabaseAdmin
        .from("exams")
        .update({ question_set_id: inserted.id })
        .eq("id", data.examId);
      if (linkError) throw new Error(linkError.message);
    } else {
      await supabaseAdmin.from("question_sets").update({ is_active: false }).neq("id", inserted.id);
      await supabaseAdmin.from("question_sets").update({ is_active: true }).eq("id", inserted.id);
    }
    return { ok: true, count: set.questions.length };
  });

export const adminUpdateMeta = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        examId: z.string().uuid().optional(),
        duration_minutes: z.number().int().positive().max(600),
        marks_correct: z.number(),
        marks_wrong: z.number(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    if (data.examId) {
      const { error } = await supabaseAdmin
        .from("exams")
        .update({
          duration_minutes: data.duration_minutes,
          marks_correct: data.marks_correct,
          marks_wrong: data.marks_wrong,
        })
        .eq("id", data.examId);
      if (error) throw new Error(error.message);
      return { ok: true };
    }
    const { data: active } = await supabaseAdmin
      .from("question_sets")
      .select("id, data")
      .eq("is_active", true)
      .maybeSingle();
    if (!active) throw new Error("No active question set.");

    const doc = active.data as any;
    doc.meta = {
      ...doc.meta,
      duration_minutes: data.duration_minutes,
      marks_correct: data.marks_correct,
      marks_wrong: data.marks_wrong,
      max_marks: (doc.questions?.length ?? 0) * data.marks_correct,
    };
    const { error } = await supabaseAdmin
      .from("question_sets")
      .update({ data: doc })
      .eq("id", active.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
