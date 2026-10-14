// TypeScript ports of the Postgres plpgsql functions from
// supabase/migrations/*.sql (Supabase RPCs). Run inside a single libSQL
// transaction so scoring stays atomic and idempotent per participant.
import type { Client, InValue, Transaction } from "@libsql/client";

type Row = Record<string, unknown>;

/** Parsed shape of `question_sets.data` (a JSON column). */
type QuestionSetDoc = {
  meta?: Record<string, unknown>;
  questions?: Array<Record<string, unknown>>;
} | null;

async function getParticipant(tx: Transaction | Client, id: string): Promise<Row | null> {
  const res = await tx.execute({
    sql: "SELECT * FROM participants WHERE id = ?",
    args: [id],
  });
  return (res.rows[0] as Row | undefined) ?? null;
}

/**
 * Server-side scoring (was public.submit_exam).
 *
 * Grading rules (identical to the organizer-panel plpgsql version):
 *  - question set priority: exam's set -> participant's set -> global active
 *  - per-question `marks` falls back to meta.marks_correct / marks_wrong
 *  - `correct` may be one letter or a comma set; answers compare as
 *    normalized letter sets
 *  - unattempted questions get an explicit NULL row
 *  - idempotent: a completed participant is never re-scored
 */
async function submitExam(tx: Transaction, participantId: string, reason: string): Promise<void> {
  const p = await getParticipant(tx, participantId);
  if (!p || p["status"] === "completed") return;

  // Resolve the question set: exam -> participant -> global active.
  let setDoc: QuestionSetDoc = null;
  if (p["exam_id"]) {
    const r = await tx.execute({
      sql: `SELECT qs.data AS data FROM exams e JOIN question_sets qs ON qs.id = e.question_set_id WHERE e.id = ?`,
      args: [p["exam_id"] as string],
    });
    if (r.rows[0]) setDoc = parseJson(r.rows[0]["data"]);
  }
  if (!setDoc && p["question_set_id"]) {
    const r = await tx.execute({
      sql: "SELECT data FROM question_sets WHERE id = ?",
      args: [p["question_set_id"] as string],
    });
    if (r.rows[0]) setDoc = parseJson(r.rows[0]["data"]);
  }
  if (!setDoc) {
    const r = await tx.execute({
      sql: "SELECT data FROM question_sets WHERE is_active = 1",
      args: [],
    });
    if (r.rows[0]) setDoc = parseJson(r.rows[0]["data"]);
  }

  const meta: Record<string, unknown> = setDoc?.meta ?? {};
  const marksCorrect = num(meta["marks_correct"], 2);
  const marksWrong = num(meta["marks_wrong"], -0.5);
  const rawQuestions = setDoc?.questions;
  const questions: Array<Record<string, unknown>> = Array.isArray(rawQuestions) ? rawQuestions : [];

  let correct = 0;
  let wrong = 0;
  let unattempted = 0;
  let marks = 0;

  for (const q of questions) {
    const qid = Number(q["id"]);
    if (!Number.isFinite(qid)) continue;
    // Per-question marks: a positive value wins; 0/absent falls back to
    // meta.marks_correct (same rule defaultMetaFor uses for max_marks).
    const perQ = Number(q["marks"]);
    const qmarks = Number.isFinite(perQ) && perQ > 0 ? perQ : marksCorrect;

    const selRes = await tx.execute({
      sql: "SELECT selected_option FROM responses WHERE participant_id = ? AND question_id = ?",
      args: [participantId, qid],
    });
    const sel = (selRes.rows[0]?.["selected_option"] as string | null) ?? null;

    if (sel == null || sel === "") {
      unattempted += 1;
      await tx.execute({
        sql: `INSERT INTO responses (id, participant_id, question_id, selected_option, is_correct, marks_awarded, updated_at)
              VALUES (?, ?, ?, NULL, NULL, 0, ?)
              ON CONFLICT (participant_id, question_id) DO UPDATE SET is_correct = NULL, marks_awarded = 0`,
        args: [crypto.randomUUID(), participantId, qid, new Date().toISOString()],
      });
      continue;
    }

    const expected = normalizeLetterSet(String(q["correct"] ?? ""));
    const got = normalizeLetterSet(sel);
    if (expected !== "" && got === expected) {
      correct += 1;
      marks += qmarks;
      await tx.execute({
        sql: "UPDATE responses SET is_correct = 1, marks_awarded = ? WHERE participant_id = ? AND question_id = ?",
        args: [qmarks, participantId, qid],
      });
    } else {
      wrong += 1;
      marks += marksWrong;
      await tx.execute({
        sql: "UPDATE responses SET is_correct = 0, marks_awarded = ? WHERE participant_id = ? AND question_id = ?",
        args: [marksWrong, participantId, qid],
      });
    }
  }

  const startedAt = p["exam_started_at"]
    ? new Date(String(p["exam_started_at"])).getTime()
    : Date.now();
  const elapsed = Math.max(0, Math.floor((Date.now() - startedAt) / 1000));

  await tx.execute({
    sql: `UPDATE participants SET status = 'completed', exam_submitted_at = ?, submit_reason = ?, time_taken_seconds = ? WHERE id = ?`,
    args: [new Date().toISOString(), reason, elapsed, participantId],
  });

  await tx.execute({
    sql: `INSERT INTO results (participant_id, total_correct, total_wrong, total_unattempted, total_marks, time_taken_seconds, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT (participant_id) DO UPDATE SET
            total_correct = excluded.total_correct,
            total_wrong = excluded.total_wrong,
            total_unattempted = excluded.total_unattempted,
            total_marks = excluded.total_marks,
            time_taken_seconds = excluded.time_taken_seconds`,
    args: [participantId, correct, wrong, unattempted, marks, elapsed, new Date().toISOString()],
  });
}

/** Atomic violation counter (was public.increment_violation). Returns new count. */
async function incrementViolation(tx: Transaction, participantId: string): Promise<number> {
  const res = await tx.execute({
    sql: `UPDATE participants SET tab_violation_count = tab_violation_count + 1
          WHERE id = ? AND status = 'in_progress'
          RETURNING tab_violation_count`,
    args: [participantId],
  });
  if (res.rows[0]) return Number(res.rows[0]["tab_violation_count"]);
  const cur = await getParticipant(tx, participantId);
  return Number(cur?.["tab_violation_count"] ?? 0);
}

// ------------------------------------------------------------- dispatch
export async function runRpc(
  name: string,
  args: Record<string, unknown>,
): Promise<{ data: unknown; error: { message: string; code?: string } | null }> {
  const { getLibsql } = await import("./client.server");
  const db = getLibsql();

  if (name === "submit_exam") {
    const tx = await db.transaction("write");
    try {
      await submitExam(tx, String(args["p_participant"]), String(args["p_reason"] ?? "manual"));
      await tx.commit();
      return { data: null, error: null };
    } catch (e) {
      await tx.rollback();
      throw e;
    }
  }

  if (name === "increment_violation") {
    const tx = await db.transaction("write");
    try {
      const count = await incrementViolation(tx, String(args["p_participant"]));
      await tx.commit();
      return { data: count, error: null };
    } catch (e) {
      await tx.rollback();
      throw e;
    }
  }

  throw new Error(`Unknown RPC: ${name}`);
}

// ------------------------------------------------------------- helpers
function parseJson(v: unknown): QuestionSetDoc {
  let value: unknown = v;
  if (typeof value === "string") {
    try {
      value = JSON.parse(value);
    } catch {
      return null;
    }
  }
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Exclude<QuestionSetDoc, null>)
    : null;
}

function num(v: unknown, fallback: number): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

/** "b,A c" -> "A,B,C" (sorted, deduped, uppercase) — matches plpgsql. */
function normalizeLetterSet(value: string): string {
  const letters = value
    .toUpperCase()
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s !== "");
  return [...new Set(letters)].sort().join(",");
}

export type { InValue };
