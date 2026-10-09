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

/**
 * Hash a freshly generated participant password.
 * Uses bcrypt (salt embedded in the hash, `password_salt` stores the
 * "bcrypt" marker); falls back to the legacy salted sha256 when bcrypt is
 * unavailable. Login verifies both formats, so existing credentials keep
 * working. Only hashes are ever stored — never plain text.
 */
async function hashPassword(password: string): Promise<{ salt: string; hash: string }> {
  try {
    const mod: any = await import("bcryptjs");
    const bcrypt = mod.default ?? mod;
    const hash: string = await bcrypt.hash(password, 10);
    return { salt: "bcrypt", hash };
  } catch {
    const salt = await randomToken(16);
    return { salt, hash: await hashWithSalt(password, salt) };
  }
}

/** True when the row uses bcrypt (see hashPassword). */
function isBcryptRow(password_salt: string | null, password_hash: string | null): boolean {
  return password_salt === "bcrypt" || (password_hash?.startsWith("$2") ?? false);
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
    const suffix = (await randomToken(6))
      .slice(0, 10)
      .toLowerCase()
      .replace(/[^a-z0-9]/g, "x");
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
  subject: string;
  description: string;
  duration_minutes: number;
  marks_correct: number;
  marks_wrong: number;
  total_marks: number | null;
  passing_marks: number | null;
  status: string;
  starts_at: string | null;
  ends_at: string | null;
  is_enabled: boolean;
  created_at: string;
  question_count: number;
  questions_marks: number;
  total_students: number;
  completed: number;
};

export type AdminStudent = {
  id: string;
  name: string;
  email: string;
  phone: string;
  roll_no: string;
  group_name: string;
  is_active: boolean;
  exam_id: string | null;
  exam_title: string | null;
  status: string;
  created_at: string;
};

/**
 * Select helper that tolerates databases where the organizer-panel migration
 * has not been applied yet: falls back to the legacy column list.
 */
async function selectExamsRows(supabaseAdmin: any) {
  const full =
    "id, slug, title, subject, description, duration_minutes, marks_correct, marks_wrong, total_marks, passing_marks, status, starts_at, ends_at, is_enabled, created_at, question_set_id";
  const { data, error } = await supabaseAdmin
    .from("exams")
    .select(full)
    .order("created_at", { ascending: false });
  if (!error) return data ?? [];
  if (!/column|schema cache/i.test(error.message)) throw new Error(error.message);
  const legacy = await supabaseAdmin
    .from("exams")
    .select(
      "id, slug, title, description, duration_minutes, marks_correct, marks_wrong, starts_at, ends_at, is_enabled, created_at, question_set_id",
    )
    .order("created_at", { ascending: false });
  if (legacy.error) throw new Error(legacy.error.message);
  return (legacy.data ?? []).map((e: any) => ({
    ...e,
    subject: "",
    total_marks: null,
    passing_marks: null,
    status: "draft",
  }));
}

async function selectParticipantsRows(supabaseAdmin: any) {
  const { data, error } = await supabaseAdmin.from("participants").select("*");
  if (!error) return data ?? [];
  if (!/column|schema cache/i.test(error.message)) throw new Error(error.message);
  const legacy = await supabaseAdmin.from("participants").select("*");
  if (legacy.error) throw new Error(legacy.error.message);
  return (legacy.data ?? []).map((p: any) => ({
    ...p,
    phone: "",
    roll_no: "",
    group_name: "",
    is_active: true,
  }));
}

// ------------------------------------------------------------------ exams
export const adminListExams = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const exams = await selectExamsRows(supabaseAdmin);

    const examIds = (exams ?? []).map((e: any) => e.id);
    const counts = new Map<string, { total: number; completed: number }>();
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
    const qCounts = new Map<string, number>();
    const qMarks = new Map<string, number>();
    if (setIds.length) {
      const { data: sets } = await supabaseAdmin
        .from("question_sets")
        .select("id, data")
        .in("id", setIds);
      for (const s of (sets ?? []) as any[]) {
        const qs = Array.isArray(s.data?.questions) ? s.data.questions : [];
        qCounts.set(s.id, qs.length);
        qMarks.set(
          s.id,
          qs.reduce((sum: number, q: any) => sum + (Number(q.marks) || 0), 0),
        );
      }
    }

    const rows: AdminExam[] = (exams ?? []).map((e: any) => ({
      id: e.id as string,
      slug: e.slug as string,
      title: e.title as string,
      subject: (e.subject ?? "") as string,
      description: (e.description ?? "") as string,
      duration_minutes: Number(e.duration_minutes),
      marks_correct: Number(e.marks_correct),
      marks_wrong: Number(e.marks_wrong),
      total_marks: e.total_marks == null ? null : Number(e.total_marks),
      passing_marks: e.passing_marks == null ? null : Number(e.passing_marks),
      status: (e.status ?? "draft") as string,
      starts_at: (e.starts_at ?? null) as string | null,
      ends_at: (e.ends_at ?? null) as string | null,
      is_enabled: Boolean(e.is_enabled),
      created_at: e.created_at as string,
      question_count: e.question_set_id ? (qCounts.get(e.question_set_id) ?? 0) : 0,
      questions_marks: e.question_set_id ? (qMarks.get(e.question_set_id) ?? 0) : 0,
      total_students: counts.get(e.id)?.total ?? 0,
      completed: counts.get(e.id)?.completed ?? 0,
    }));
    return { exams: rows };
  });

/** Organizer dashboard stats — GET /api/organizer/dashboard-stats equivalent. */
export const adminOrganizerStats = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const exams = await selectExamsRows(supabaseAdmin);
    const now = Date.now();
    const conducted = exams.filter(
      (e: any) => e.status === "completed" || (e.ends_at && now > new Date(e.ends_at).getTime()),
    ).length;
    const upcoming = exams.filter(
      (e: any) => e.starts_at && now < new Date(e.starts_at).getTime(),
    ).length;

    const participants = await selectParticipantsRows(supabaseAdmin);
    const attempted = (participants as any[]).filter((p) => p.status && p.status !== "not_started");
    const uniqueEmails = new Set(attempted.map((p) => String(p.email).toLowerCase()));

    const perExam = (exams as any[]).map((e: any) => {
      const rows = (participants as any[]).filter((p) => p.exam_id === e.id);
      return {
        examId: e.id as string,
        title: e.title as string,
        participants: rows.filter((p) => p.status !== "not_started").length,
        completed: rows.filter((p) => p.status === "completed").length,
        registered: rows.length,
      };
    });
    const recent = [...(exams as any[])]
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
      .slice(0, 8)
      .map((e: any) => ({
        id: e.id as string,
        title: e.title as string,
        date: (e.starts_at ?? e.created_at) as string,
        participants: (participants as any[]).filter(
          (p) => p.exam_id === e.id && p.status !== "not_started",
        ).length,
        status: (e.status ?? "draft") as string,
        is_enabled: Boolean(e.is_enabled),
      }));

    return {
      conducted,
      participatedStudents: uniqueEmails.size,
      upcoming,
      registered: (participants as any[]).length,
      totalExams: (exams as any[]).length,
      perExam,
      recent,
    };
  });

const examInput = z
  .object({
    title: z.string().trim().min(2).max(200),
    subject: z.string().trim().max(200).optional().default(""),
    description: z.string().trim().max(2000).optional().default(""),
    duration_minutes: z.number().int().positive().max(600).optional().default(45),
    marks_correct: z.number().optional().default(2),
    marks_wrong: z.number().optional().default(-0.5),
    total_marks: z.number().positive().optional().nullable(),
    passing_marks: z.number().min(0).optional().nullable(),
    starts_at: z.string().optional().nullable(),
    ends_at: z.string().optional().nullable(),
  })
  .refine(
    (v) => v.passing_marks == null || v.total_marks == null || v.passing_marks <= v.total_marks,
    {
      message: "Passing marks cannot exceed total marks.",
      path: ["passing_marks"],
    },
  );

function validateWindow(starts_at?: string | null, ends_at?: string | null) {
  if (starts_at && ends_at && new Date(starts_at).getTime() >= new Date(ends_at).getTime()) {
    throw new Error("Start time must be before end time.");
  }
}

/** Insert that drops unknown columns when the migration has not been applied. */
async function insertExamRow(supabaseAdmin: any, row: Record<string, any>) {
  let res = await supabaseAdmin.from("exams").insert(row).select("id, slug").single();
  if (res.error && /column|schema cache/i.test(res.error.message)) {
    const { subject, total_marks, passing_marks, status, ...legacy } = row;
    res = await supabaseAdmin.from("exams").insert(legacy).select("id, slug").single();
  }
  return res;
}

async function updateExamRow(supabaseAdmin: any, id: string, patch: Record<string, any>) {
  let res = await supabaseAdmin.from("exams").update(patch).eq("id", id);
  if (res.error && /column|schema cache/i.test(res.error.message)) {
    const { subject, total_marks, passing_marks, status, ...legacy } = patch;
    res = await supabaseAdmin.from("exams").update(legacy).eq("id", id);
  }
  return res;
}

export const adminCreateExam = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => examInput.parse(input))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    validateWindow(data.starts_at ?? null, data.ends_at ?? null);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const slug = await generateUniqueSlug(supabaseAdmin, data.title);
    const { data: created, error } = await insertExamRow(supabaseAdmin, {
      slug,
      title: data.title.trim(),
      subject: data.subject ?? "",
      description: data.description ?? "",
      duration_minutes: data.duration_minutes ?? 45,
      marks_correct: data.marks_correct ?? 2,
      marks_wrong: data.marks_wrong ?? -0.5,
      total_marks: data.total_marks ?? null,
      passing_marks: data.passing_marks ?? null,
      status: "draft",
      starts_at: data.starts_at || null,
      ends_at: data.ends_at || null,
      is_enabled: true,
      created_by: context.userId,
    });
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
        subject: z.string().trim().max(200).optional(),
        description: z.string().trim().max(2000).optional(),
        duration_minutes: z.number().int().positive().max(600).optional(),
        marks_correct: z.number().optional(),
        marks_wrong: z.number().optional(),
        total_marks: z.number().positive().optional().nullable(),
        passing_marks: z.number().min(0).optional().nullable(),
        status: z.enum(["draft", "scheduled", "live", "completed", "archived"]).optional(),
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
      .select("starts_at, ends_at, total_marks, passing_marks")
      .eq("id", data.id)
      .maybeSingle();
    if (!current) throw new Error("Exam not found.");
    validateWindow(
      data.starts_at !== undefined ? data.starts_at : (current.starts_at as string | null),
      data.ends_at !== undefined ? data.ends_at : (current.ends_at as string | null),
    );
    const total =
      data.total_marks !== undefined ? data.total_marks : (current.total_marks as number | null);
    const passing =
      data.passing_marks !== undefined
        ? data.passing_marks
        : (current.passing_marks as number | null);
    if (total != null && passing != null && passing > total) {
      throw new Error("Passing marks cannot exceed total marks.");
    }
    const patch: Database["public"]["Tables"]["exams"]["Update"] = {};
    if (data.title !== undefined) patch.title = data.title;
    if (data.subject !== undefined) patch.subject = data.subject;
    if (data.description !== undefined) patch.description = data.description;
    if (data.duration_minutes !== undefined) patch.duration_minutes = data.duration_minutes;
    if (data.marks_correct !== undefined) patch.marks_correct = data.marks_correct;
    if (data.marks_wrong !== undefined) patch.marks_wrong = data.marks_wrong;
    if (data.total_marks !== undefined) patch.total_marks = data.total_marks;
    if (data.passing_marks !== undefined) patch.passing_marks = data.passing_marks;
    if (data.status !== undefined) patch.status = data.status;
    if (data.starts_at !== undefined) patch.starts_at = data.starts_at;
    if (data.ends_at !== undefined) patch.ends_at = data.ends_at;
    if (data.is_enabled !== undefined) patch.is_enabled = data.is_enabled;
    const { error } = await updateExamRow(supabaseAdmin, data.id, patch);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/**
 * Delete an exam with its questions. Blocked when students attempted it
 * unless `force` is set — the UI offers soft-disable (keeps results) in
 * that case. DELETE /api/organizer/exams/:id equivalent.
 */
export const adminDeleteExam = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({ id: z.string().uuid(), force: z.boolean().optional().default(false) }).parse(input),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: exam } = await supabaseAdmin
      .from("exams")
      .select("id, question_set_id")
      .eq("id", data.id)
      .maybeSingle();
    if (!exam) throw new Error("Exam not found.");

    const { data: parts } = await supabaseAdmin
      .from("participants")
      .select("id, status")
      .eq("exam_id", data.id);
    const attempted = ((parts ?? []) as any[]).filter((p) => p.status !== "not_started").length;
    if (attempted > 0 && !data.force) {
      throw new Error(
        `ATTEMPTED:${attempted}: ${attempted} student(s) already attempted this exam. Disable it instead to keep results, or confirm deletion to remove everything.`,
      );
    }

    const ids = ((parts ?? []) as any[]).map((p) => p.id);
    if (ids.length) {
      await supabaseAdmin.from("responses").delete().in("participant_id", ids);
      await supabaseAdmin.from("results").delete().in("participant_id", ids);
      const { error: pErr } = await supabaseAdmin.from("participants").delete().in("id", ids);
      if (pErr) throw new Error(pErr.message);
    }
    const { error: eErr } = await supabaseAdmin.from("exams").delete().eq("id", data.id);
    if (eErr) throw new Error(eErr.message);

    // Remove the linked question set when no other exam references it.
    if (exam.question_set_id) {
      const { data: refs } = await supabaseAdmin
        .from("exams")
        .select("id")
        .eq("question_set_id", exam.question_set_id)
        .limit(1);
      if (!refs?.length) {
        await supabaseAdmin.from("question_sets").delete().eq("id", exam.question_set_id);
      }
    }
    return { ok: true, removedParticipants: ids.length };
  });

/**
 * Publish gate: an exam can go live only with at least 1 question.
 * Unpublishing returns it to draft.
 */
export const adminPublishExam = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ id: z.string().uuid(), publish: z.boolean() }).parse(input))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    if (data.publish) {
      const { data: exam } = await supabaseAdmin
        .from("exams")
        .select("question_set_id")
        .eq("id", data.id)
        .maybeSingle();
      if (!exam) throw new Error("Exam not found.");
      let count = 0;
      if (exam.question_set_id) {
        const { data: set } = await supabaseAdmin
          .from("question_sets")
          .select("data")
          .eq("id", exam.question_set_id)
          .maybeSingle();
        count = Array.isArray((set?.data as any)?.questions)
          ? (set?.data as any).questions.length
          : 0;
      }
      if (!count) throw new Error("Add at least 1 question before publishing this exam.");
      const { error } = await updateExamRow(supabaseAdmin, data.id, {
        is_enabled: true,
        status: "live",
      });
      if (error) throw new Error(error.message);
    } else {
      const { error } = await updateExamRow(supabaseAdmin, data.id, { status: "draft" });
      if (error) throw new Error(error.message);
    }
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
      .select("id, name, email, phone, roll_no, group_name, is_active, exam_id, status, created_at")
      .eq("exam_id", data.examId)
      .order("created_at", { ascending: false })
      .limit(5000);
    if (error) {
      if (/column|schema cache/i.test(error.message)) {
        const legacy = await supabaseAdmin
          .from("participants")
          .select("id, name, email, status, created_at")
          .eq("exam_id", data.examId)
          .order("created_at", { ascending: false })
          .limit(5000);
        if (legacy.error) throw new Error(legacy.error.message);
        return {
          students: ((legacy.data ?? []) as any[]).map((s) => ({
            ...s,
            phone: "",
            roll_no: "",
            group_name: "",
            is_active: true,
            exam_id: data.examId,
            exam_title: null,
          })) as AdminStudent[],
        };
      }
      throw new Error(error.message);
    }
    return {
      students: ((rows ?? []) as any[]).map((s) => ({ ...s, exam_title: null })) as AdminStudent[],
    };
  });

/** Full participant directory across exams — Participants portal table. */
export const adminListAllParticipants = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const participants = await selectParticipantsRows(supabaseAdmin);
    const exams = await selectExamsRows(supabaseAdmin);
    const titles = new Map((exams as any[]).map((e) => [e.id, e.title]));
    const rows: AdminStudent[] = (participants as any[])
      .map((p) => ({
        id: p.id as string,
        name: p.name as string,
        email: p.email as string,
        phone: (p.phone ?? "") as string,
        roll_no: (p.roll_no ?? "") as string,
        group_name: (p.group_name ?? "") as string,
        is_active: p.is_active ?? true,
        exam_id: (p.exam_id ?? null) as string | null,
        exam_title: p.exam_id ? ((titles.get(p.exam_id) ?? null) as string | null) : null,
        status: p.status as string,
        created_at: p.created_at as string,
      }))
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
    return { students: rows };
  });

export type ParticipantExtras = { phone?: string; roll_no?: string; group_name?: string };

async function insertStudent(
  supabaseAdmin: any,
  examId: string,
  name: string,
  email: string,
  extras?: ParticipantExtras,
): Promise<{ id: string; email: string; password: string }> {
  const password = await generateStudentPassword(10);
  const { salt, hash } = await hashPassword(password);
  let res = await supabaseAdmin
    .from("participants")
    .insert({
      exam_id: examId,
      name: name.trim(),
      email: email.toLowerCase(),
      phone: extras?.phone?.trim() ?? "",
      roll_no: extras?.roll_no?.trim() ?? "",
      group_name: extras?.group_name?.trim() ?? "",
      is_active: true,
      password_salt: salt,
      password_hash: hash,
      status: "not_started",
    })
    .select("id")
    .single();
  if (res.error && /column|schema cache/i.test(res.error.message)) {
    res = await supabaseAdmin
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
  }
  if (res.error) {
    if (res.error.code === "23505") throw new Error(`Duplicate email: ${email}`);
    throw new Error(res.error.message);
  }
  return { id: res.data.id as string, email: email.toLowerCase(), password };
}

const bulkStudentSchema = z.object({
  name: z.string().trim().min(2).max(120),
  email: z.string().trim().email().max(200),
  phone: z.string().trim().max(30).optional().default(""),
  roll_no: z.string().trim().max(60).optional().default(""),
  group_name: z.string().trim().max(120).optional().default(""),
});

export const adminAddStudent = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        examId: z.string().uuid(),
        name: z.string().trim().min(2).max(120),
        email: z.string().trim().email().max(200),
        phone: z.string().trim().max(30).optional().default(""),
        roll_no: z.string().trim().max(60).optional().default(""),
        group_name: z.string().trim().max(120).optional().default(""),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    // The plain password is returned exactly once — the organizer must copy it
    // or download the credentials CSV now; only the hash is stored.
    return insertStudent(supabaseAdmin, data.examId, data.name, data.email, {
      phone: data.phone,
      roll_no: data.roll_no,
      group_name: data.group_name,
    });
  });

export const adminBulkAddStudents = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        examId: z.string().uuid(),
        students: z.array(bulkStudentSchema).max(2000),
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
        const r = await insertStudent(supabaseAdmin, data.examId, s.name, email, {
          phone: s.phone,
          roll_no: s.roll_no,
          group_name: s.group_name,
        });
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
    const { salt, hash } = await hashPassword(password);
    const { error } = await supabaseAdmin
      .from("participants")
      .update({ password_salt: salt, password_hash: hash, failed_attempts: 0, locked_until: null })
      .eq("id", data.participantId);
    if (error) throw new Error(error.message);
    return { password };
  });

/** Edit a participant's directory fields. PUT /api/organizer/participants/:id */
export const adminUpdateParticipant = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        participantId: z.string().uuid(),
        name: z.string().trim().min(2).max(120).optional(),
        email: z.string().trim().email().max(200).optional(),
        phone: z.string().trim().max(30).optional(),
        roll_no: z.string().trim().max(60).optional(),
        group_name: z.string().trim().max(120).optional(),
        is_active: z.boolean().optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const participantId = data.participantId;
    const patch: Record<string, string | boolean> = {};
    if (data.name !== undefined) patch["name"] = data.name.trim();
    if (data.email !== undefined) patch["email"] = data.email.toLowerCase();
    if (data.phone !== undefined) patch["phone"] = data.phone.trim();
    if (data.roll_no !== undefined) patch["roll_no"] = data.roll_no.trim();
    if (data.group_name !== undefined) patch["group_name"] = data.group_name.trim();
    if (data.is_active !== undefined) patch["is_active"] = data.is_active;
    let res = await supabaseAdmin
      .from("participants")
      .update(patch as never)
      .eq("id", participantId);
    if (res.error && /column|schema cache/i.test(res.error.message)) {
      const { phone: _ph, roll_no: _rn, group_name: _gn, is_active: _ia, ...legacy } = patch;
      res = await supabaseAdmin
        .from("participants")
        .update(legacy as never)
        .eq("id", participantId);
    }
    if (res.error) {
      if (res.error.code === "23505")
        throw new Error("That email is already registered for this exam.");
      throw new Error(res.error.message);
    }
    return { ok: true };
  });

/** Bulk delete participants with their attempts. */
export const adminBulkDeleteParticipants = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({ participantIds: z.array(z.string().uuid()).min(1).max(2000) }).parse(input),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await supabaseAdmin.from("responses").delete().in("participant_id", data.participantIds);
    await supabaseAdmin.from("results").delete().in("participant_id", data.participantIds);
    const { error } = await supabaseAdmin
      .from("participants")
      .delete()
      .in("id", data.participantIds);
    if (error) throw new Error(error.message);
    return { ok: true, deleted: data.participantIds.length };
  });

/** Assign a participant to a specific exam (moves their credential). */
export const adminMoveParticipant = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({ participantId: z.string().uuid(), examId: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: p } = await supabaseAdmin
      .from("participants")
      .select("id, email, status")
      .eq("id", data.participantId)
      .maybeSingle();
    if (!p) throw new Error("Participant not found.");
    if (p.status !== "not_started") {
      throw new Error("Only participants who have not started can be moved between exams.");
    }
    const { error } = await supabaseAdmin
      .from("participants")
      .update({ exam_id: data.examId })
      .eq("id", data.participantId);
    if (error) {
      if (error.code === "23505")
        throw new Error("That email is already registered for the target exam.");
      throw new Error(error.message);
    }
    return { ok: true };
  });

export const adminEmailCredentials = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        examId: z.string().uuid(),
        Credentials: z
          .array(z.object({ email: z.string().email(), password: z.string() }))
          .max(2000),
      })
      .parse(input),
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

    let examMeta: {
      total_marks: number | null;
      passing_marks: number | null;
      title: string;
    } | null = null;
    if (data?.examId) {
      const exams = await selectExamsRows(supabaseAdmin);
      const e: any = exams.find((x: any) => x.id === data.examId);
      if (e) {
        examMeta = {
          total_marks: e.total_marks == null ? null : Number(e.total_marks),
          passing_marks: e.passing_marks == null ? null : Number(e.passing_marks),
          title: String(e.title ?? ""),
        };
      }
    }

    return {
      rows,
      examMeta,
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
      .select(
        "id, name, email, status, question_set_id, exam_id, time_taken_seconds, tab_violation_count",
      )
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

const LETTER_LIST = ["A", "B", "C", "D"] as const;

/** Normalizes "b" / "A,C" / "c, a" into sorted uppercase "A,C". */
function normalizeCorrect(value: string): string {
  const letters = value
    .toUpperCase()
    .split(",")
    .map((s) => s.trim())
    .filter((s) => /^[A-D]$/.test(s));
  return [...new Set(letters)].sort().join(",");
}

const questionSchema = z.object({
  id: z.number().int(),
  topic: z.string().default("General"),
  subtopic: z.string().optional(),
  difficulty: z.string().optional(),
  qtype: z.enum(["mcq", "multi", "true_false"]).optional().default("mcq"),
  question: z.string().min(1),
  option_a: z.string().min(1),
  option_b: z.string().min(1),
  option_c: z.string().optional().default(""),
  option_d: z.string().optional().default(""),
  correct: z
    .string()
    .min(1)
    .transform((s) => normalizeCorrect(s))
    .refine((s) => s.length > 0, { message: "Correct answer must be letter(s) A–D." }),
  marks: z.number().positive().optional().default(0),
  explanation: z.string().optional().default(""),
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

type StoredQuestion = z.infer<typeof questionSchema>;

/** Load the exam's question-set doc (or null when none is linked yet). */
async function getExamSetDoc(supabaseAdmin: any, examId: string) {
  const { data: exam } = await supabaseAdmin
    .from("exams")
    .select("id, title, duration_minutes, marks_correct, marks_wrong, question_set_id")
    .eq("id", examId)
    .maybeSingle();
  if (!exam) throw new Error("Exam not found.");
  let doc: any = { meta: {}, questions: [] };
  if (exam.question_set_id) {
    const { data: set } = await supabaseAdmin
      .from("question_sets")
      .select("id, data")
      .eq("id", exam.question_set_id)
      .maybeSingle();
    if (set?.data) doc = set.data;
  }
  if (!Array.isArray(doc.questions)) doc.questions = [];
  return { exam, doc, setId: (exam.question_set_id ?? null) as string | null };
}

function defaultMetaFor(exam: any, count: number, questions: any[]) {
  const mc = Number(exam?.marks_correct ?? 2);
  const perQ = questions.reduce((s, q) => s + (Number(q.marks) > 0 ? Number(q.marks) : mc), 0);
  return {
    event: String(exam?.title ?? "Exam"),
    organiser: "Prarambh",
    total_questions: count,
    marks_correct: mc,
    marks_wrong: Number(exam?.marks_wrong ?? -0.5),
    max_marks: perQ,
    duration_minutes: Number(exam?.duration_minutes ?? 45),
  };
}

/** Persist the question array back (creates + links a set on first use). */
async function saveExamSetDoc(
  supabaseAdmin: any,
  exam: any,
  setId: string | null,
  questions: any[],
) {
  const doc = { meta: defaultMetaFor(exam, questions.length, questions), questions };
  if (setId) {
    const { error } = await supabaseAdmin
      .from("question_sets")
      .update({ data: doc })
      .eq("id", setId);
    if (error) throw new Error(error.message);
    return { setId, count: questions.length };
  }
  const { data: inserted, error } = await supabaseAdmin
    .from("question_sets")
    .insert({ data: doc, is_active: false })
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  const { error: linkError } = await supabaseAdmin
    .from("exams")
    .update({ question_set_id: inserted.id })
    .eq("id", exam.id);
  if (linkError) throw new Error(linkError.message);
  return { setId: inserted.id as string, count: questions.length };
}

const singleQuestionInput = z.object({
  examId: z.string().uuid(),
  qtype: z.enum(["mcq", "multi", "true_false"]).optional().default("mcq"),
  topic: z.string().trim().max(120).optional().default("General"),
  difficulty: z.string().trim().max(60).optional().default(""),
  question: z.string().trim().min(1).max(5000),
  options: z.array(z.string().trim().min(1).max(2000)).min(2).max(4),
  correct: z
    .array(z.enum(["A", "B", "C", "D"]))
    .min(1)
    .max(4),
  marks: z.number().positive().max(1000).optional().default(0),
  explanation: z.string().trim().max(2000).optional().default(""),
});

function toStoredQuestion(id: number, input: z.infer<typeof singleQuestionInput>): StoredQuestion {
  const letters = ["a", "b", "c", "d"] as const;
  const opts = { option_a: "", option_b: "", option_c: "", option_d: "" };
  input.options.forEach((text, i) => {
    const suffix = letters[i];
    if (suffix) opts[`option_${suffix}` as keyof typeof opts] = text;
  });
  let qtype = input.qtype;
  const correct = [...new Set(input.correct)].sort().join(",");
  if (qtype === "mcq" && correct.includes(",")) qtype = "multi";
  if (qtype !== "multi" && correct.includes(",")) {
    throw new Error("Single-answer questions need exactly one correct option.");
  }
  if (qtype === "true_false" && (input.options.length !== 2 || correct.length !== 1)) {
    throw new Error("True/False questions need exactly 2 options and 1 correct answer.");
  }
  return {
    id,
    topic: input.topic || "General",
    difficulty: input.difficulty || undefined,
    qtype,
    question: input.question,
    option_a: opts.option_a,
    option_b: opts.option_b,
    option_c: opts.option_c,
    option_d: opts.option_d,
    correct,
    marks: input.marks || 0,
    explanation: input.explanation || "",
  } as StoredQuestion;
}

/** POST /api/organizer/exams/:examId/questions — add one question. */
export const adminAddQuestion = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => singleQuestionInput.parse(input))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { exam, doc, setId } = await getExamSetDoc(supabaseAdmin, data.examId);
    const nextId =
      doc.questions.reduce((m: number, q: any) => Math.max(m, Number(q.id) || 0), 0) + 1;
    doc.questions.push(toStoredQuestion(nextId, data));
    const saved = await saveExamSetDoc(supabaseAdmin, exam, setId, doc.questions);
    return { ok: true, id: nextId, ...saved };
  });

/** PUT /api/organizer/exams/:examId/questions/:id — edit one question. */
export const adminUpdateQuestion = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    singleQuestionInput
      .partial()
      .extend({ examId: z.string().uuid(), questionId: z.number().int() })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { exam, doc, setId } = await getExamSetDoc(supabaseAdmin, data.examId);
    const idx = doc.questions.findIndex((q: any) => Number(q.id) === data.questionId);
    if (idx < 0) throw new Error("Question not found.");
    const prev = doc.questions[idx];
    const merged = singleQuestionInput.parse({
      examId: data.examId,
      qtype: data.qtype ?? prev.qtype ?? "mcq",
      topic: data.topic ?? prev.topic ?? "General",
      difficulty: data.difficulty ?? prev.difficulty ?? "",
      question: data.question ?? prev.question,
      options:
        data.options ??
        [prev.option_a, prev.option_b, prev.option_c, prev.option_d].filter((o) =>
          String(o ?? "").trim(),
        ),
      correct: data.correct ?? String(prev.correct ?? "A").split(","),
      marks: data.marks ?? (Number(prev.marks) || 0),
      explanation: data.explanation ?? prev.explanation ?? "",
    });
    doc.questions[idx] = toStoredQuestion(data.questionId, merged);
    const saved = await saveExamSetDoc(supabaseAdmin, exam, setId, doc.questions);
    return { ok: true, ...saved };
  });

/** DELETE /api/organizer/exams/:examId/questions/:id — with confirmation in UI. */
export const adminDeleteQuestion = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({ examId: z.string().uuid(), questionId: z.number().int() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { exam, doc, setId } = await getExamSetDoc(supabaseAdmin, data.examId);
    const before = doc.questions.length;
    doc.questions = doc.questions.filter((q: any) => Number(q.id) !== data.questionId);
    if (doc.questions.length === before) throw new Error("Question not found.");
    // Ids stay stable (responses reference them); no re-indexing.
    const saved = await saveExamSetDoc(supabaseAdmin, exam, setId, doc.questions);
    return { ok: true, ...saved };
  });

/** Full question list for the Add-Questions editor (includes answers — organizer only). */
export const adminListQuestions = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ examId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { doc } = await getExamSetDoc(supabaseAdmin, data.examId);
    return { questions: (doc.questions ?? []) as StoredQuestion[] };
  });

export const adminUploadQuestionSet = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({ raw: z.string().min(2), examId: z.string().uuid().optional() }).parse(input),
  )
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
