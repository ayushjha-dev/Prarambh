import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Download, Pencil, Plus, Trash2, Upload } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ConfirmModal } from "./ConfirmModal";
import {
  adminAddQuestion,
  adminDeleteQuestion,
  adminListQuestions,
  adminPublishExam,
  adminUpdateQuestion,
  adminUploadQuestionSet,
  type AdminExam,
} from "@/lib/admin.functions";
import {
  downloadFile,
  questionsCsvTemplate,
  questionsJsonTemplate,
  readQuestionFile,
} from "@/lib/organizer-utils";

const LETTERS = ["A", "B", "C", "D"] as const;
const QTYPE_LABEL: Record<string, string> = {
  mcq: "MCQ",
  multi: "Multi-correct",
  true_false: "True/False",
};

type QForm = {
  qtype: "mcq" | "multi" | "true_false";
  topic: string;
  difficulty: string;
  question: string;
  options: string[];
  correct: string[];
  marks: string;
  explanation: string;
};

const EMPTY_FORM: QForm = {
  qtype: "mcq",
  topic: "General",
  difficulty: "",
  question: "",
  options: ["", "", "", ""],
  correct: [],
  marks: "",
  explanation: "",
};

type EditorQuestion = {
  id: number;
  topic?: string;
  difficulty?: string;
  qtype?: string;
  question?: string;
  option_a?: string;
  option_b?: string;
  option_c?: string;
  option_d?: string;
  correct?: string;
  marks?: number | string;
  explanation?: string;
};

function effectiveMarks(q: EditorQuestion, fallback: number): number {
  return Number(q?.marks) > 0 ? Number(q.marks) : fallback;
}

/**
 * Add-Questions screen for one exam: single-question CRUD (MCQ /
 * multi-correct / True-False), bulk upload (JSON/CSV/Excel), live marks
 * reconciliation and the publish gate (≥ 1 question).
 */
export function QuestionsEditor(props: { exam: AdminExam; onBack: () => void }) {
  const { exam } = props;
  const queryClient = useQueryClient();
  const listFn = useServerFn(adminListQuestions);
  const addFn = useServerFn(adminAddQuestion);
  const updateFn = useServerFn(adminUpdateQuestion);
  const deleteFn = useServerFn(adminDeleteQuestion);
  const uploadFn = useServerFn(adminUploadQuestionSet);
  const publishFn = useServerFn(adminPublishExam);

  const { data, isLoading } = useQuery({
    queryKey: ["organizer-questions", exam.id],
    queryFn: () => listFn({ data: { examId: exam.id } }),
  });
  const questions = (data?.questions ?? []) as EditorQuestion[];

  const [form, setForm] = useState<QForm>(EMPTY_FORM);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [deleteId, setDeleteId] = useState<number | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [raw, setRaw] = useState("");
  const [fileName, setFileName] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [publishing, setPublishing] = useState(false);

  const sumMarks = questions.reduce((s, q) => s + effectiveMarks(q, exam.marks_correct), 0);
  const target = exam.total_marks;
  const mismatch = target != null && questions.length > 0 && Math.abs(sumMarks - target) > 1e-9;

  function refresh() {
    queryClient.invalidateQueries({ queryKey: ["organizer-questions", exam.id] });
    queryClient.invalidateQueries({ queryKey: ["admin-exams"] });
    queryClient.invalidateQueries({ queryKey: ["organizer-stats"] });
  }

  function startEdit(q: EditorQuestion) {
    const opts = [q.option_a, q.option_b, q.option_c, q.option_d]
      .map((o) => String(o ?? "").trim())
      .filter((o) => o);
    setEditingId(Number(q.id));
    setForm({
      qtype: (q.qtype as QForm["qtype"]) ?? "mcq",
      topic: String(q.topic ?? "General"),
      difficulty: String(q.difficulty ?? ""),
      question: String(q.question ?? ""),
      options: opts.length >= 2 ? opts : ["", ""],
      correct: String(q.correct ?? "A")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
      marks: q.marks ? String(q.marks) : "",
      explanation: String(q.explanation ?? ""),
    });
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function toggleCorrect(letter: string) {
    setForm((f) => {
      if (f.qtype === "multi") {
        const has = f.correct.includes(letter);
        return {
          ...f,
          correct: has ? f.correct.filter((c) => c !== letter) : [...f.correct, letter],
        };
      }
      return { ...f, correct: [letter] };
    });
  }

  async function handleSave() {
    const opts = form.options.map((o) => o.trim());
    if (!form.question.trim()) {
      toast.error("Question text is required.");
      return;
    }
    if (opts.filter(Boolean).length < 2) {
      toast.error("At least 2 options are required.");
      return;
    }
    if (!form.correct.length) {
      toast.error("Mark at least one correct answer.");
      return;
    }
    if (form.qtype !== "multi" && form.correct.length !== 1) {
      toast.error("This question type needs exactly one correct answer.");
    }
    const marks = form.marks.trim() ? Number(form.marks) : 0;
    if (form.marks.trim() && !(marks > 0)) {
      toast.error("Marks must be a positive number.");
      return;
    }
    setSaving(true);
    try {
      const payload = {
        examId: exam.id,
        qtype: form.qtype,
        topic: form.topic.trim() || "General",
        difficulty: form.difficulty.trim(),
        question: form.question.trim(),
        options: form.qtype === "true_false" ? ["True", "False"] : opts.filter(Boolean),
        correct: form.correct as ("A" | "B" | "C" | "D")[],
        marks,
        explanation: form.explanation.trim(),
      };
      if (editingId == null) {
        await addFn({ data: payload });
        toast.success("Question added.");
      } else {
        await updateFn({ data: { ...payload, questionId: editingId } });
        toast.success("Question updated.");
      }
      setForm(EMPTY_FORM);
      setEditingId(null);
      refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Save failed.");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (deleteId == null) return;
    setDeleting(true);
    try {
      await deleteFn({ data: { examId: exam.id, questionId: deleteId } });
      toast.success("Question deleted.");
      setDeleteId(null);
      refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Delete failed.");
    } finally {
      setDeleting(false);
    }
  }

  async function handleBulkUpload() {
    if (!raw.trim()) return;
    setUploading(true);
    try {
      const res = await uploadFn({ data: { raw, examId: exam.id } });
      toast.success(`Question set activated with ${res.count} questions.`);
      setRaw("");
      setFileName(null);
      refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Upload failed.");
    } finally {
      setUploading(false);
    }
  }

  async function handlePublish(publish: boolean) {
    setPublishing(true);
    try {
      await publishFn({ data: { id: exam.id, publish } });
      toast.success(publish ? "Exam published and live." : "Exam returned to draft.");
      refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Publish failed.");
    } finally {
      setPublishing(false);
    }
  }

  return (
    <div className="mx-auto max-w-6xl px-5 py-6">
      <button
        onClick={props.onBack}
        className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" /> Back to exams
      </button>
      <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl">Add Questions — {exam.title}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {questions.length} question{questions.length === 1 ? "" : "s"} · {sumMarks} marks total
            {target != null ? ` · target ${target}` : ""}
          </p>
        </div>
        <Button
          disabled={
            publishing ||
            (exam.is_enabled && exam.status === "live" ? false : questions.length === 0)
          }
          onClick={() => handlePublish(!(exam.is_enabled && exam.status === "live"))}
          className="rounded-[32px]"
          title={questions.length === 0 ? "Add at least 1 question before publishing" : undefined}
        >
          {publishing
            ? "Please wait…"
            : exam.is_enabled && exam.status === "live"
              ? "Unpublish"
              : "Publish exam"}
        </Button>
      </div>

      {mismatch ? (
        <p
          className="mt-3 rounded-2xl border border-destructive/40 bg-destructive/5 p-4 text-sm text-destructive"
          role="alert"
        >
          Warning: question marks sum to {sumMarks}, but the exam total is {target}. Adjust marks or
          update the exam.
        </p>
      ) : null}

      {/* Single-question form */}
      <section className="mt-5 rounded-[22px] border border-border p-6">
        <h2 className="text-xl">
          {editingId == null ? "New question" : `Edit question #${editingId}`}
        </h2>
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <div className="space-y-2">
            <Label className="mono-label text-muted-foreground">Type</Label>
            <select
              value={form.qtype}
              onChange={(e) => {
                const qtype = e.target.value as QForm["qtype"];
                setForm((f) => ({
                  ...f,
                  qtype,
                  options:
                    qtype === "true_false"
                      ? ["True", "False"]
                      : f.options.length >= 2
                        ? f.options
                        : ["", ""],
                  correct: [],
                }));
              }}
              className="h-10 w-full rounded-xl border border-input bg-background px-3 text-sm"
            >
              <option value="mcq">MCQ (single correct)</option>
              <option value="multi">Multiple correct</option>
              <option value="true_false">True / False</option>
            </select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label className="mono-label text-muted-foreground">Topic</Label>
              <Input
                value={form.topic}
                onChange={(e) => setForm({ ...form, topic: e.target.value })}
                className="rounded-xl"
              />
            </div>
            <div className="space-y-2">
              <Label className="mono-label text-muted-foreground">
                Marks (default {exam.marks_correct})
              </Label>
              <Input
                value={form.marks}
                onChange={(e) => setForm({ ...form, marks: e.target.value })}
                inputMode="decimal"
                placeholder="e.g. 2"
                className="rounded-xl"
              />
            </div>
          </div>
        </div>

        <div className="mt-4 space-y-2">
          <Label className="mono-label text-muted-foreground">Question text</Label>
          <Textarea
            value={form.question}
            onChange={(e) => setForm({ ...form, question: e.target.value })}
            rows={3}
            className="rounded-xl"
            placeholder="Write the question…"
          />
        </div>

        <div className="mt-4 space-y-2">
          <Label className="mono-label text-muted-foreground">
            Options{" "}
            {form.qtype === "multi" ? "(tick all correct answers)" : "(tick the correct answer)"}
          </Label>
          {form.options.map((opt, i) => {
            const letter = LETTERS[i] as string;
            const checked = form.correct.includes(letter);
            return (
              <div key={i} className="flex items-center gap-2">
                <button
                  type="button"
                  role={form.qtype === "multi" ? "checkbox" : "radio"}
                  aria-checked={checked}
                  title={`Mark ${letter} as correct`}
                  onClick={() => toggleCorrect(letter)}
                  className={`grid size-8 shrink-0 place-items-center rounded-lg border font-mono text-xs font-semibold transition-colors ${
                    checked
                      ? "border-brand bg-brand text-brand-foreground"
                      : "border-input bg-background text-muted-foreground hover:border-brand"
                  }`}
                >
                  {letter}
                </button>
                <Input
                  value={opt}
                  disabled={form.qtype === "true_false"}
                  onChange={(e) =>
                    setForm((f) => ({
                      ...f,
                      options: f.options.map((o, j) => (j === i ? e.target.value : o)),
                    }))
                  }
                  placeholder={`Option ${letter}`}
                  className="rounded-xl"
                />
                {form.options.length > 2 && form.qtype !== "true_false" ? (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="shrink-0 rounded-full"
                    onClick={() =>
                      setForm((f) => ({
                        ...f,
                        options: f.options.filter((_, j) => j !== i),
                        correct: f.correct.filter((c) => c !== letter),
                      }))
                    }
                  >
                    <Trash2 className="size-4" />
                  </Button>
                ) : null}
              </div>
            );
          })}
          {form.options.length < 4 && form.qtype !== "true_false" ? (
            <Button
              size="sm"
              variant="secondary"
              className="rounded-full"
              onClick={() => setForm((f) => ({ ...f, options: [...f.options, ""] }))}
            >
              <Plus className="size-3.5" /> Add option
            </Button>
          ) : null}
        </div>

        <div className="mt-4 space-y-2">
          <Label className="mono-label text-muted-foreground">Explanation (optional)</Label>
          <Textarea
            value={form.explanation}
            onChange={(e) => setForm({ ...form, explanation: e.target.value })}
            rows={2}
            className="rounded-xl"
          />
        </div>

        <div className="mt-4 flex gap-2">
          <Button disabled={saving} onClick={handleSave} className="rounded-[32px]">
            {saving ? "Saving…" : editingId == null ? "Add question" : "Save changes"}
          </Button>
          {editingId != null ? (
            <Button
              variant="ghost"
              className="rounded-[32px]"
              onClick={() => {
                setEditingId(null);
                setForm(EMPTY_FORM);
              }}
            >
              Cancel
            </Button>
          ) : null}
        </div>
      </section>

      {/* Live list */}
      <section className="mt-5 rounded-[22px] border border-border p-6">
        <h2 className="text-xl">Questions ({questions.length})</h2>
        {isLoading ? (
          <p className="mt-3 text-sm text-muted-foreground">Loading…</p>
        ) : !questions.length ? (
          <p className="mt-3 text-sm text-muted-foreground">
            No questions yet. Add one above or bulk-upload below.
          </p>
        ) : (
          <div className="mt-4 space-y-3">
            {questions.map((q: EditorQuestion) => (
              <div key={q.id} className="rounded-2xl border border-border p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="mono-label rounded-full bg-secondary px-3 py-1 text-muted-foreground">
                    #{q.id} · {QTYPE_LABEL[q.qtype as string] ?? "MCQ"} ·{" "}
                    {effectiveMarks(q, exam.marks_correct)} marks
                  </span>
                  <span className="ml-auto flex gap-1">
                    <Button
                      size="sm"
                      variant="ghost"
                      className="rounded-full"
                      onClick={() => startEdit(q)}
                    >
                      <Pencil className="size-3.5" /> Edit
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="rounded-full text-destructive"
                      onClick={() => setDeleteId(Number(q.id))}
                    >
                      <Trash2 className="size-3.5" /> Delete
                    </Button>
                  </span>
                </div>
                <p className="mt-2 whitespace-pre-wrap text-[15px]">{q.question}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Correct: <strong>{String(q.correct)}</strong>
                  {q.explanation ? ` · ${q.explanation}` : ""}
                </p>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Bulk upload */}
      <section className="mt-5 rounded-[22px] border border-border p-6">
        <h2 className="flex items-center gap-2 text-xl">
          <Upload className="size-5" /> Bulk upload (JSON / CSV / Excel)
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Replaces the whole set for this exam. CSV columns: question, option_a, option_b, option_c,
          option_d, correct, topic.
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <label className="inline-flex h-10 cursor-pointer items-center gap-2 rounded-[32px] border border-input bg-background px-4 text-sm font-medium hover:bg-accent">
            Choose file
            <input
              type="file"
              accept=".json,.csv,.txt,.xlsx,.xls"
              className="hidden"
              onChange={async (e) => {
                const file = e.target.files?.[0];
                if (!file) return;
                try {
                  setRaw(await readQuestionFile(file, exam));
                  setFileName(file.name);
                  toast.success("File parsed. Review, then Validate & activate.");
                } catch (err) {
                  toast.error(err instanceof Error ? err.message : "Could not read that file.");
                }
                e.target.value = "";
              }}
            />
          </label>
          {fileName ? <span className="text-xs text-muted-foreground">{fileName}</span> : null}
          <Button
            size="sm"
            variant="secondary"
            className="rounded-full"
            onClick={() =>
              downloadFile(
                `${exam.slug}-questions-template.json`,
                questionsJsonTemplate(exam),
                "application/json",
              )
            }
          >
            <Download className="size-3.5" /> JSON template
          </Button>
          <Button
            size="sm"
            variant="secondary"
            className="rounded-full"
            onClick={() =>
              downloadFile(`${exam.slug}-questions-template.csv`, questionsCsvTemplate())
            }
          >
            <Download className="size-3.5" /> CSV template
          </Button>
        </div>
        <Textarea
          value={raw}
          onChange={(e) => setRaw(e.target.value)}
          placeholder="Upload a file above or paste question-bank JSON"
          className="mt-3 h-32 rounded-xl font-mono text-xs"
        />
        <Button
          disabled={!raw.trim() || uploading}
          onClick={handleBulkUpload}
          className="mt-3 rounded-[32px]"
        >
          {uploading ? "Validating…" : "Validate & activate"}
        </Button>
      </section>

      <ConfirmModal
        open={deleteId != null}
        title="Delete this question?"
        body="Are you sure? This cannot be undone."
        confirmLabel="Delete"
        tone="danger"
        pending={deleting}
        onCancel={() => setDeleteId(null)}
        onConfirm={handleDelete}
      />
    </div>
  );
}
