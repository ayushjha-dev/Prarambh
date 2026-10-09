import { useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Copy, ExternalLink, Link2, Pencil, Plus, RefreshCw, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ConfirmModal } from "./ConfirmModal";
import {
  adminCreateExam,
  adminDeleteExam,
  adminListExams,
  adminRegenerateSlug,
  adminUpdateExam,
  type AdminExam,
} from "@/lib/admin.functions";
import { STATUS_FILTERS, examDisplayStatus } from "@/lib/organizer-utils";

function examLink(slug: string) {
  return `${window.location.origin}/exam/${slug}`;
}

type ExamForm = {
  title: string;
  subject: string;
  description: string;
  starts: string;
  ends: string;
  duration: string;
  totalMarks: string;
  passingMarks: string;
  mc: string;
  mw: string;
};

const EMPTY: ExamForm = {
  title: "",
  subject: "",
  description: "",
  starts: "",
  ends: "",
  duration: "45",
  totalMarks: "",
  passingMarks: "",
  mc: "2",
  mw: "-0.5",
};

function toLocalInput(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function validateForm(f: ExamForm): string | null {
  if (f.title.trim().length < 2) return "Exam title is required (min 2 characters).";
  if (!(Number(f.duration) > 0)) return "Duration must be a positive number of minutes.";
  if (f.starts && f.ends && new Date(f.starts).getTime() >= new Date(f.ends).getTime()) {
    return "End time must be after start time.";
  }
  const total = f.totalMarks.trim() ? Number(f.totalMarks) : null;
  const passing = f.passingMarks.trim() ? Number(f.passingMarks) : null;
  if (total != null && !(total > 0)) return "Total marks must be positive.";
  if (passing != null && !(passing >= 0)) return "Passing marks cannot be negative.";
  if (total != null && passing != null && passing > total)
    return "Passing marks cannot exceed total marks.";
  return null;
}

/** Exams section: list + search/filter, create/edit, delete, exam links. */
export function ExamsView(props: { onAddQuestions: (exam: AdminExam) => void }) {
  const queryClient = useQueryClient();
  const listFn = useServerFn(adminListExams);
  const createFn = useServerFn(adminCreateExam);
  const updateFn = useServerFn(adminUpdateExam);
  const deleteFn = useServerFn(adminDeleteExam);
  const regenSlugFn = useServerFn(adminRegenerateSlug);

  const { data, isLoading, refetch } = useQuery({
    queryKey: ["admin-exams"],
    queryFn: () => listFn(),
    refetchInterval: 30000,
  });
  const exams = useMemo(() => data?.exams ?? [], [data]);

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<(typeof STATUS_FILTERS)[number]>("All");
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState<ExamForm>(EMPTY);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<AdminExam | null>(null);
  const [deleteWarn, setDeleteWarn] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  const filtered = exams.filter((e) => {
    const q = search.toLowerCase();
    const hit =
      !q ||
      e.title.toLowerCase().includes(q) ||
      (e.subject ?? "").toLowerCase().includes(q) ||
      e.slug.toLowerCase().includes(q);
    const st = examDisplayStatus(e);
    return hit && (statusFilter === "All" || st === statusFilter);
  });

  async function copyText(text: string, id: string) {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const ta = document.createElement("textarea");
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      ta.remove();
    }
    setCopied(id);
    toast.success("Copied to clipboard.");
    setTimeout(() => setCopied((c) => (c === id ? null : c)), 2000);
  }

  async function refresh() {
    await queryClient.invalidateQueries({ queryKey: ["admin-exams"] });
    await queryClient.invalidateQueries({ queryKey: ["organizer-stats"] });
    await queryClient.invalidateQueries({ queryKey: ["organizer-participants"] });
    await queryClient.invalidateQueries({ queryKey: ["admin-dashboard"] });
  }

  function openCreate() {
    setEditingId(null);
    setForm(EMPTY);
    setShowCreate(true);
  }

  function openEdit(exam: AdminExam) {
    setEditingId(exam.id);
    setForm({
      title: exam.title,
      subject: exam.subject ?? "",
      description: exam.description ?? "",
      starts: toLocalInput(exam.starts_at),
      ends: toLocalInput(exam.ends_at),
      duration: String(exam.duration_minutes),
      totalMarks: exam.total_marks != null ? String(exam.total_marks) : "",
      passingMarks: exam.passing_marks != null ? String(exam.passing_marks) : "",
      mc: String(exam.marks_correct),
      mw: String(exam.marks_wrong),
    });
    setShowCreate(true);
  }

  async function handleSave() {
    const err = validateForm(form);
    if (err) {
      toast.error(err);
      return;
    }
    setBusy(true);
    try {
      const payload = {
        title: form.title.trim(),
        subject: form.subject.trim(),
        description: form.description.trim(),
        duration_minutes: Number(form.duration) || 45,
        marks_correct: Number(form.mc) || 0,
        marks_wrong: form.mw.trim() === "" ? 0 : Number(form.mw),
        total_marks: form.totalMarks.trim() ? Number(form.totalMarks) : null,
        passing_marks: form.passingMarks.trim() ? Number(form.passingMarks) : null,
        starts_at: form.starts ? new Date(form.starts).toISOString() : null,
        ends_at: form.ends ? new Date(form.ends).toISOString() : null,
      };
      if (editingId) {
        await updateFn({ data: { id: editingId, ...payload } });
        toast.success("Exam updated.");
        setShowCreate(false);
        setEditingId(null);
        await refresh();
      } else {
        const res = await createFn({ data: payload });
        toast.success("Exam created. Add questions next.");
        setShowCreate(false);
        await refresh();
        const fresh = await refetch();
        const created = (fresh.data?.exams ?? []).find((e) => e.id === res.id);
        if (created) props.onAddQuestions(created);
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Save failed.");
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete(force: boolean) {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await deleteFn({ data: { id: deleteTarget.id, force } });
      toast.success("Exam and its questions deleted.");
      setDeleteTarget(null);
      setDeleteWarn(null);
      await refresh();
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Delete failed.";
      if (msg.startsWith("ATTEMPTED:")) setDeleteWarn(msg.slice(msg.indexOf(": ", 10) + 2) || msg);
      else {
        toast.error(msg);
        setDeleteTarget(null);
      }
    } finally {
      setDeleting(false);
    }
  }

  async function handleToggle(exam: AdminExam) {
    try {
      await updateFn({ data: { id: exam.id, is_enabled: !exam.is_enabled } });
      toast.success(exam.is_enabled ? "Exam link disabled." : "Exam link enabled.");
      await refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Update failed.");
    }
  }

  return (
    <div className="mx-auto max-w-6xl px-5 py-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl">Exams {exams.length ? `(${exams.length})` : ""}</h1>
        <Button className="rounded-[32px]" onClick={openCreate}>
          <Plus className="size-4" /> Create Exam
        </Button>
      </div>

      <div className="mt-4 flex flex-wrap gap-3">
        <Input
          placeholder="Search title, subject or slug…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="h-10 max-w-xs rounded-xl"
        />
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as typeof statusFilter)}
          className="h-10 rounded-xl border border-input bg-background px-3 text-sm"
          aria-label="Filter by status"
        >
          {STATUS_FILTERS.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      </div>

      {showCreate ? (
        <section className="mt-4 rounded-[22px] border border-border p-6">
          <h2 className="text-2xl">{editingId ? "Edit exam" : "Create exam"}</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {editingId
              ? "Update the exam details below."
              : "A unique, hard-to-guess link is generated automatically."}
          </p>
          <div className="mt-5 grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label className="mono-label text-muted-foreground">Exam Title *</Label>
              <Input
                value={form.title}
                onChange={(e) => setForm({ ...form, title: e.target.value })}
                placeholder="e.g. Physics Midterm 2026"
                className="rounded-xl"
              />
            </div>
            <div className="space-y-2">
              <Label className="mono-label text-muted-foreground">Subject</Label>
              <Input
                value={form.subject}
                onChange={(e) => setForm({ ...form, subject: e.target.value })}
                placeholder="e.g. Physics"
                className="rounded-xl"
              />
            </div>
            <div className="space-y-2 md:col-span-2">
              <Label className="mono-label text-muted-foreground">Description / Instructions</Label>
              <Textarea
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
                placeholder="Shown on the login page"
                className="rounded-xl"
              />
            </div>
            <div className="space-y-2">
              <Label className="mono-label text-muted-foreground">Start Date & Time</Label>
              <Input
                type="datetime-local"
                value={form.starts}
                onChange={(e) => setForm({ ...form, starts: e.target.value })}
                className="rounded-xl"
              />
            </div>
            <div className="space-y-2">
              <Label className="mono-label text-muted-foreground">End Date & Time</Label>
              <Input
                type="datetime-local"
                value={form.ends}
                onChange={(e) => setForm({ ...form, ends: e.target.value })}
                className="rounded-xl"
              />
            </div>
            <div className="space-y-2">
              <Label className="mono-label text-muted-foreground">Duration (minutes) *</Label>
              <Input
                value={form.duration}
                onChange={(e) => setForm({ ...form, duration: e.target.value })}
                inputMode="numeric"
                className="rounded-xl"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label className="mono-label text-muted-foreground">Total Marks</Label>
                <Input
                  value={form.totalMarks}
                  onChange={(e) => setForm({ ...form, totalMarks: e.target.value })}
                  inputMode="decimal"
                  className="rounded-xl"
                />
              </div>
              <div className="space-y-2">
                <Label className="mono-label text-muted-foreground">Passing Marks</Label>
                <Input
                  value={form.passingMarks}
                  onChange={(e) => setForm({ ...form, passingMarks: e.target.value })}
                  inputMode="decimal"
                  className="rounded-xl"
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label className="mono-label text-muted-foreground">Marks per correct</Label>
                <Input
                  value={form.mc}
                  onChange={(e) => setForm({ ...form, mc: e.target.value })}
                  inputMode="decimal"
                  className="rounded-xl"
                />
              </div>
              <div className="space-y-2">
                <Label className="mono-label text-muted-foreground">Negative marking</Label>
                <Input
                  value={form.mw}
                  onChange={(e) => setForm({ ...form, mw: e.target.value })}
                  inputMode="decimal"
                  className="rounded-xl"
                />
              </div>
            </div>
          </div>
          <div className="mt-5 flex gap-2">
            <Button disabled={busy} onClick={handleSave} className="rounded-[32px]">
              {busy ? "Saving…" : editingId ? "Save changes" : "Create & add questions"}
            </Button>
            <Button
              variant="ghost"
              className="rounded-[32px]"
              onClick={() => {
                setShowCreate(false);
                setEditingId(null);
              }}
            >
              Cancel
            </Button>
          </div>
        </section>
      ) : null}

      <div className="mt-5 grid gap-4">
        {isLoading ? <p className="text-muted-foreground">Loading exams…</p> : null}
        {!isLoading && !filtered.length ? (
          <div className="rounded-[22px] border border-dashed border-border p-10 text-center">
            <p className="text-lg">
              {exams.length ? "No exams match your search" : "No exams yet"}
            </p>
            <p className="mt-2 text-sm text-muted-foreground">
              Create your first exam to get its private link, then add students.
            </p>
          </div>
        ) : null}
        {filtered.map((exam) => (
          <article key={exam.id} className="rounded-[22px] border border-border p-6">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="text-2xl">{exam.title}</h3>
                  <span className="mono-label rounded-full bg-secondary px-3 py-1 text-muted-foreground">
                    {examDisplayStatus(exam)}
                  </span>
                </div>
                <p className="mt-1 text-sm text-muted-foreground">
                  {[
                    exam.subject,
                    `${exam.duration_minutes} min`,
                    `${exam.question_count} questions`,
                    exam.total_marks != null ? `${exam.total_marks} marks` : null,
                    `${exam.total_students} students (${exam.completed} submitted)`,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </p>
                {(exam.starts_at || exam.ends_at) && (
                  <p className="mt-1 text-xs text-muted-foreground">
                    {exam.starts_at ? `Starts ${new Date(exam.starts_at).toLocaleString()}` : ""}
                    {exam.starts_at && exam.ends_at ? " · " : ""}
                    {exam.ends_at ? `Ends ${new Date(exam.ends_at).toLocaleString()}` : ""}
                  </p>
                )}
              </div>
              <div className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  className="rounded-full"
                  onClick={() => window.open(examLink(exam.slug), "_blank", "noopener")}
                >
                  <ExternalLink className="size-3.5" /> View
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="rounded-full"
                  onClick={() => openEdit(exam)}
                >
                  <Pencil className="size-3.5" /> Edit
                </Button>
                <Button
                  size="sm"
                  variant="default"
                  className="rounded-full"
                  onClick={() => props.onAddQuestions(exam)}
                >
                  <Plus className="size-3.5" /> Add Questions
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="rounded-full text-destructive"
                  onClick={() => {
                    setDeleteTarget(exam);
                    setDeleteWarn(null);
                  }}
                >
                  <Trash2 className="size-3.5" /> Delete
                </Button>
              </div>
            </div>

            <div className="mt-4 flex flex-col gap-2 rounded-2xl bg-muted/40 p-4 sm:flex-row sm:items-center">
              <Link2 className="size-4 shrink-0 text-muted-foreground" />
              <code className="min-w-0 flex-1 break-all font-mono text-sm">
                {examLink(exam.slug)}
              </code>
              <div className="flex shrink-0 flex-wrap gap-2">
                <Button
                  size="sm"
                  variant="secondary"
                  className="rounded-full"
                  onClick={() => void copyText(examLink(exam.slug), `copy-${exam.id}`)}
                >
                  {copied === `copy-${exam.id}` ? (
                    <Check className="size-4" />
                  ) : (
                    <Copy className="size-4" />
                  )}{" "}
                  Copy link
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="rounded-full"
                  title="Generate a new link (old one stops working)"
                  onClick={async () => {
                    try {
                      const res = await regenSlugFn({ data: { id: exam.id } });
                      toast.success("New exam link generated. The old link no longer works.");
                      await refresh();
                      await copyText(examLink(res.slug), `slug-${exam.id}`);
                    } catch (e) {
                      toast.error(e instanceof Error ? e.message : "Could not regenerate link.");
                    }
                  }}
                >
                  <RefreshCw className="size-4" /> New link
                </Button>
                <Button
                  size="sm"
                  variant={exam.is_enabled ? "outline" : "default"}
                  className="rounded-full"
                  onClick={() => void handleToggle(exam)}
                >
                  {exam.is_enabled ? "Disable" : "Enable"}
                </Button>
              </div>
            </div>
          </article>
        ))}
      </div>

      <ConfirmModal
        open={deleteTarget != null}
        title="Delete this exam?"
        body={
          deleteWarn ??
          `Are you sure? This cannot be undone.\n\n"${deleteTarget?.title}" and its ${deleteTarget?.question_count ?? 0} question(s) will be permanently removed.`
        }
        confirmLabel={deleteWarn ? "Delete anyway" : "Delete"}
        tone="danger"
        pending={deleting}
        extraAction={
          deleteWarn && deleteTarget
            ? {
                label: "Disable instead (keep results)",
                onClick: () => {
                  const target = deleteTarget;
                  setDeleteTarget(null);
                  setDeleteWarn(null);
                  void handleToggle(target);
                },
              }
            : undefined
        }
        onCancel={() => {
          setDeleteTarget(null);
          setDeleteWarn(null);
        }}
        onConfirm={() => void handleDelete(Boolean(deleteWarn))}
      />
    </div>
  );
}
