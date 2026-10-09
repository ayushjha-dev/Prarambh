import { useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Copy, Download, Pencil, Plus, RefreshCw, Trash2, Upload } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ConfirmModal } from "./ConfirmModal";
import {
  adminAddStudent,
  adminBulkAddStudents,
  adminBulkDeleteParticipants,
  adminDeleteParticipant,
  adminListAllParticipants,
  adminListExams,
  adminMoveParticipant,
  adminRegenerateStudentPassword,
  adminUpdateParticipant,
  type AdminStudent,
} from "@/lib/admin.functions";
import {
  downloadFile,
  exportRowsXlsx,
  parseParticipantFile,
  participantTemplateCsv,
  rowsToDrafts,
  toCsv,
  validateDraftRow,
  type ParticipantDraft,
} from "@/lib/organizer-utils";

type DraftRow = ParticipantDraft & { issues: string[] };
type FreshCredential = { name?: string; email: string; password: string };

const PAGE_SIZE = 20;

/** Participants portal: upload + preview + directory + credentials. */
export function ParticipantsView() {
  const queryClient = useQueryClient();
  const listExamsFn = useServerFn(adminListExams);
  const listAllFn = useServerFn(adminListAllParticipants);
  const addFn = useServerFn(adminAddStudent);
  const bulkFn = useServerFn(adminBulkAddStudents);
  const updateFn = useServerFn(adminUpdateParticipant);
  const deleteFn = useServerFn(adminDeleteParticipant);
  const bulkDeleteFn = useServerFn(adminBulkDeleteParticipants);
  const moveFn = useServerFn(adminMoveParticipant);
  const regenFn = useServerFn(adminRegenerateStudentPassword);

  const { data: examsData } = useQuery({ queryKey: ["admin-exams"], queryFn: () => listExamsFn() });
  const exams = useMemo(() => examsData?.exams ?? [], [examsData]);
  const { data: dirData, isLoading: dirLoading } = useQuery({
    queryKey: ["organizer-participants"],
    queryFn: () => listAllFn(),
  });
  const directory = useMemo(() => dirData?.students ?? [], [dirData]);

  const [examId, setExamId] = useState<string>("");
  const targetExam = exams.find((e) => e.id === examId) ?? exams[0] ?? null;
  const effectiveExamId = targetExam?.id ?? "";

  // single add
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [roll, setRoll] = useState("");
  const [group, setGroup] = useState("");
  const [adding, setAdding] = useState(false);

  // upload preview
  const [drafts, setDrafts] = useState<DraftRow[]>([]);
  const [fileName, setFileName] = useState<string | null>(null);
  const [skipInvalid, setSkipInvalid] = useState(true);
  const [importing, setImporting] = useState(false);
  const [fresh, setFresh] = useState<FreshCredential[]>([]);
  const [revealed, setRevealed] = useState<{ email: string; password: string } | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  // directory table
  const [q, setQ] = useState("");
  const [groupFilter, setGroupFilter] = useState("All");
  const [activeFilter, setActiveFilter] = useState("All");
  const [sortKey, setSortKey] = useState<"name" | "email" | "created_at">("created_at");
  const [asc, setAsc] = useState(false);
  const [page, setPage] = useState(0);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [editing, setEditing] = useState<AdminStudent | null>(null);
  const [editForm, setEditForm] = useState({
    name: "",
    email: "",
    phone: "",
    roll_no: "",
    group_name: "",
    is_active: true,
  });
  const [savingEdit, setSavingEdit] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const [assignId, setAssignId] = useState<string | null>(null);
  const [assignExam, setAssignExam] = useState("");
  const [assigning, setAssigning] = useState(false);

  const groups = useMemo(
    () => ["All", ...new Set(directory.map((d) => d.group_name).filter(Boolean))],
    [directory],
  );

  const filtered = useMemo(() => {
    const needle = q.toLowerCase();
    const list = directory.filter(
      (d) =>
        (!needle ||
          d.name.toLowerCase().includes(needle) ||
          d.email.toLowerCase().includes(needle)) &&
        (groupFilter === "All" || d.group_name === groupFilter) &&
        (activeFilter === "All" || (activeFilter === "Active" ? d.is_active : !d.is_active)),
    );
    return [...list].sort((a, b) => {
      const av = a[sortKey] ?? "";
      const bv = b[sortKey] ?? "";
      const cmp = String(av).localeCompare(String(bv));
      return asc ? cmp : -cmp;
    });
  }, [directory, q, groupFilter, activeFilter, sortKey, asc]);
  const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const pageRows = filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  function refreshAll() {
    queryClient.invalidateQueries({ queryKey: ["organizer-participants"] });
    queryClient.invalidateQueries({ queryKey: ["admin-exams"] });
    queryClient.invalidateQueries({ queryKey: ["admin-dashboard"] });
    queryClient.invalidateQueries({ queryKey: ["organizer-stats"] });
  }

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
    setTimeout(() => setCopied((c) => (c === id ? null : c)), 2000);
  }

  // ------------------------------------------------------------- upload
  async function handleFile(file: File) {
    if (!effectiveExamId) {
      toast.error("Create and select an exam first.");
      return;
    }
    try {
      const { rows } = await parseParticipantFile(file);
      const parsed = rowsToDrafts(rows);
      if (!parsed.length) {
        toast.error("No rows found in that file.");
        return;
      }
      const fileSeen = new Set<string>();
      const dbEmails = new Set(
        directory.filter((d) => d.exam_id === effectiveExamId).map((d) => d.email.toLowerCase()),
      );
      setDrafts(
        parsed.map((d) => {
          const issues = validateDraftRow(d, fileSeen, dbEmails);
          if (d.email) fileSeen.add(d.email.toLowerCase());
          return { ...d, issues };
        }),
      );
      setFileName(file.name);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not read that file.");
    }
  }

  const validDrafts = drafts.filter((d) => !d.issues.length);

  async function handleImport() {
    if (!effectiveExamId || !targetExam) return;
    const rows = skipInvalid ? validDrafts : drafts;
    if (!rows.length) {
      toast.error("Nothing to import.");
      return;
    }
    if (!skipInvalid && drafts.some((d) => d.issues.length)) {
      toast.error("Fix or skip invalid rows before importing.");
    }
    setImporting(true);
    try {
      const res = await bulkFn({
        data: {
          examId: effectiveExamId,
          students: rows.map((d) => ({
            name: d.name,
            email: d.email,
            phone: d.phone,
            roll_no: d.roll_no,
            group_name: d.group_name,
          })),
        },
      });
      const withNames = res.added.map((a) => ({
        name: rows.find((r) => r.email.toLowerCase() === a.email.toLowerCase())?.name ?? "",
        ...a,
      }));
      setFresh((f) => [...withNames, ...f]);
      setDrafts([]);
      setFileName(null);
      refreshAll();
      toast.success(
        `${res.added.length} participant(s) imported${res.skipped.length ? `, ${res.skipped.length} skipped` : ""}. Passwords are shown only once — download them now.`,
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Import failed.");
    } finally {
      setImporting(false);
    }
  }

  async function handleAddSingle() {
    if (!effectiveExamId) {
      toast.error("Create and select an exam first.");
      return;
    }
    if (name.trim().length < 2) {
      toast.error("Enter the participant's name.");
      return;
    }
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim())) {
      toast.error("Enter a valid email address.");
      return;
    }
    setAdding(true);
    try {
      const res = await addFn({
        data: {
          examId: effectiveExamId,
          name: name.trim(),
          email: email.trim(),
          phone: phone.trim(),
          roll_no: roll.trim(),
          group_name: group.trim(),
        },
      });
      setFresh((f) => [{ name: name.trim(), email: res.email, password: res.password }, ...f]);
      setRevealed({ email: res.email, password: res.password });
      setName("");
      setEmail("");
      setPhone("");
      setRoll("");
      setGroup("");
      refreshAll();
      toast.success("Participant added. Copy the password now — it is shown only once.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not add participant.");
    } finally {
      setAdding(false);
    }
  }

  // ---------------------------------------------------------- directory
  function openEdit(d: AdminStudent) {
    setEditing(d);
    setEditForm({
      name: d.name,
      email: d.email,
      phone: d.phone ?? "",
      roll_no: d.roll_no ?? "",
      group_name: d.group_name ?? "",
      is_active: d.is_active ?? true,
    });
  }

  async function handleSaveEdit() {
    if (!editing) return;
    setSavingEdit(true);
    try {
      await updateFn({
        data: {
          participantId: editing.id,
          name: editForm.name,
          email: editForm.email,
          phone: editForm.phone,
          roll_no: editForm.roll_no,
          group_name: editForm.group_name,
          is_active: editForm.is_active,
        },
      });
      toast.success("Participant updated.");
      setEditing(null);
      refreshAll();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Update failed.");
    } finally {
      setSavingEdit(false);
    }
  }

  async function handleDelete() {
    if (!deleteId) return;
    setDeleting(true);
    try {
      await deleteFn({ data: { participantId: deleteId } });
      toast.success("Participant deleted.");
      setDeleteId(null);
      setSelected((s) => {
        const next = new Set(s);
        next.delete(deleteId);
        return next;
      });
      refreshAll();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Delete failed.");
    } finally {
      setDeleting(false);
    }
  }

  async function handleBulkDelete() {
    if (!selected.size) return;
    setBulkDeleting(true);
    try {
      await bulkDeleteFn({ data: { participantIds: [...selected] } });
      toast.success(`${selected.size} participant(s) deleted.`);
      setSelected(new Set());
      refreshAll();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Bulk delete failed.");
    } finally {
      setBulkDeleting(false);
    }
  }

  async function handleRegen(id: string, em: string) {
    try {
      const res = await regenFn({ data: { participantId: id } });
      setRevealed({ email: em, password: res.password });
      setFresh((f) => [{ email: em, password: res.password }, ...f.filter((x) => x.email !== em)]);
      toast.success("New password generated. Copy it now — it is shown only once.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not regenerate password.");
    }
  }

  async function handleAssign() {
    if (!assignId || !assignExam) return;
    setAssigning(true);
    try {
      await moveFn({ data: { participantId: assignId, examId: assignExam } });
      toast.success("Participant assigned to the selected exam.");
      setAssignId(null);
      setAssignExam("");
      refreshAll();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Assign failed.");
    } finally {
      setAssigning(false);
    }
  }

  function toggleSort(key: typeof sortKey) {
    if (key === sortKey) setAsc((v) => !v);
    else {
      setSortKey(key);
      setAsc(true);
    }
  }

  return (
    <div className="mx-auto max-w-6xl px-5 py-6">
      <h1 className="text-2xl">Participants</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Upload, manage credentials, and maintain the directory.
      </p>

      {/* Exam picker */}
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <Label className="mono-label text-muted-foreground">Exam for uploads</Label>
        <select
          value={effectiveExamId}
          onChange={(e) => setExamId(e.target.value)}
          className="h-10 rounded-xl border border-input bg-background px-3 text-sm"
        >
          {exams.map((e) => (
            <option key={e.id} value={e.id}>
              {e.title}
            </option>
          ))}
        </select>
        {!exams.length ? (
          <span className="text-sm text-muted-foreground">No exams yet — create one first.</span>
        ) : null}
      </div>

      {/* Upload */}
      <section className="mt-4 grid gap-4 lg:grid-cols-2">
        <div className="rounded-[22px] border border-border p-5">
          <p className="mono-label text-muted-foreground">Add participant</p>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <Input
              placeholder="Full name *"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="rounded-xl"
            />
            <Input
              placeholder="Email address *"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="rounded-xl"
            />
            <Input
              placeholder="Phone (optional)"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              className="rounded-xl"
            />
            <Input
              placeholder="Roll No / ID (optional)"
              value={roll}
              onChange={(e) => setRoll(e.target.value)}
              className="rounded-xl"
            />
            <Input
              placeholder="Class / Group (optional)"
              value={group}
              onChange={(e) => setGroup(e.target.value)}
              className="rounded-xl sm:col-span-2"
            />
          </div>
          <Button disabled={adding} onClick={handleAddSingle} className="mt-3 rounded-[32px]">
            <Plus className="size-4" /> {adding ? "Adding…" : "Add & generate password"}
          </Button>
        </div>

        <div className="rounded-[22px] border border-border p-5">
          <p className="mono-label text-muted-foreground">
            Bulk upload (.csv, .xlsx, .xls — max 5 MB)
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <label className="inline-flex h-10 cursor-pointer items-center gap-2 rounded-[32px] border border-input bg-background px-4 text-sm font-medium hover:bg-accent">
              <Upload className="size-4" /> Choose file
              <input
                type="file"
                accept=".csv,.xlsx,.xls"
                className="hidden"
                onChange={async (e) => {
                  const file = e.target.files?.[0];
                  if (file) await handleFile(file);
                  e.target.value = "";
                }}
              />
            </label>
            {fileName ? <span className="text-xs text-muted-foreground">{fileName}</span> : null}
            <Button
              size="sm"
              variant="secondary"
              className="rounded-full"
              onClick={() => downloadFile("participants-template.csv", participantTemplateCsv())}
            >
              <Download className="size-3.5" /> Sample template
            </Button>
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            Columns: Name, Email, Phone, Roll No, Group. Preview validates before import.
          </p>
        </div>
      </section>

      {/* Preview */}
      {drafts.length ? (
        <section className="mt-4 rounded-[22px] border border-border p-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-xl">
              Preview ({drafts.length} rows · {validDrafts.length} valid)
            </h2>
            <label className="flex items-center gap-2 text-sm text-muted-foreground">
              <input
                type="checkbox"
                checked={skipInvalid}
                onChange={(e) => setSkipInvalid(e.target.checked)}
              />
              Skip invalid rows
            </label>
          </div>
          <div className="mt-3 max-h-72 overflow-auto">
            <table className="w-full min-w-[640px] text-left text-sm">
              <thead>
                <tr className="mono-label border-b border-border text-muted-foreground">
                  <th className="py-2 pr-3 font-normal">Name</th>
                  <th className="py-2 pr-3 font-normal">Email</th>
                  <th className="py-2 pr-3 font-normal">Phone</th>
                  <th className="py-2 pr-3 font-normal">Roll No</th>
                  <th className="py-2 pr-3 font-normal">Group</th>
                  <th className="py-2 font-normal">Issues</th>
                </tr>
              </thead>
              <tbody>
                {drafts.map((d, i) => (
                  <tr
                    key={i}
                    className={`border-b border-border ${d.issues.length ? "bg-destructive/5" : ""}`}
                  >
                    <td className="py-2 pr-3">{d.name || "—"}</td>
                    <td className="py-2 pr-3 text-muted-foreground">{d.email || "—"}</td>
                    <td className="py-2 pr-3">{d.phone || "—"}</td>
                    <td className="py-2 pr-3">{d.roll_no || "—"}</td>
                    <td className="py-2 pr-3">{d.group_name || "—"}</td>
                    <td className="py-2 text-xs text-destructive">{d.issues.join("; ") || "OK"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="mt-3 flex gap-2">
            <Button
              disabled={importing || !validDrafts.length}
              onClick={handleImport}
              className="rounded-[32px]"
            >
              {importing
                ? "Importing…"
                : `Import ${skipInvalid ? validDrafts.length : drafts.length} participant(s)`}
            </Button>
            <Button
              variant="ghost"
              className="rounded-[32px]"
              onClick={() => {
                setDrafts([]);
                setFileName(null);
              }}
            >
              Discard
            </Button>
          </div>
        </section>
      ) : null}

      {/* One-time credentials */}
      {fresh.length ? (
        <section className="mt-4 rounded-[22px] border border-brand/40 bg-brand/[0.04] p-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="mono-label text-muted-foreground">
              Credentials — shown once, download now
            </p>
            <div className="flex gap-2">
              <Button
                size="sm"
                variant="secondary"
                className="rounded-full"
                onClick={() =>
                  downloadFile(
                    `${targetExam?.slug ?? "participants"}-credentials.csv`,
                    toCsv(
                      ["Name", "Email", "Password", "Exam Link"],
                      fresh.map((f) => [
                        f.name ?? "",
                        f.email,
                        f.password,
                        targetExam ? `${window.location.origin}/exam/${targetExam.slug}` : "",
                      ]),
                    ),
                  )
                }
              >
                Download CSV
              </Button>
              <Button
                size="sm"
                variant="secondary"
                className="rounded-full"
                onClick={() =>
                  void exportRowsXlsx(
                    `${targetExam?.slug ?? "participants"}-credentials.xlsx`,
                    ["Name", "Email", "Password"],
                    fresh.map((f) => [f.name ?? "", f.email, f.password]),
                  )
                }
              >
                Download Excel
              </Button>
            </div>
          </div>
          <div className="mt-3 space-y-2">
            {fresh.map((f) => (
              <div
                key={f.email}
                className="flex flex-wrap items-center gap-2 rounded-xl bg-card p-3 text-sm"
              >
                <span className="font-medium">{f.email}</span>
                <code className="rounded bg-muted/60 px-2 py-0.5 font-mono">{f.password}</code>
                <span className="ml-auto flex gap-1.5">
                  <Button
                    size="sm"
                    variant="ghost"
                    className="rounded-full"
                    onClick={() => void copyText(f.password, `pw-${f.email}`)}
                  >
                    {copied === `pw-${f.email}` ? (
                      <Check className="size-4" />
                    ) : (
                      <Copy className="size-4" />
                    )}
                  </Button>
                  <a
                    href={`mailto:${encodeURIComponent(f.email)}?subject=${encodeURIComponent(`Your exam login: ${targetExam?.title ?? ""}`)}&body=${encodeURIComponent(`Exam link: ${targetExam ? `${window.location.origin}/exam/${targetExam.slug}` : ""}\nEmail: ${f.email}\nPassword: ${f.password}`)}`}
                    className="inline-flex h-8 items-center rounded-full border border-input px-3 text-xs font-medium hover:bg-accent"
                  >
                    Email
                  </a>
                </span>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {/* Directory */}
      <section className="mt-4 rounded-[22px] border border-border p-5">
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="text-xl">All participants ({filtered.length})</h2>
          {selected.size ? (
            <Button
              size="sm"
              variant="destructive"
              className="rounded-full"
              disabled={bulkDeleting}
              onClick={handleBulkDelete}
            >
              <Trash2 className="size-3.5" />{" "}
              {bulkDeleting ? "Deleting…" : `Delete ${selected.size} selected`}
            </Button>
          ) : null}
        </div>
        <div className="mt-3 flex flex-wrap gap-3">
          <Input
            placeholder="Search name or email"
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setPage(0);
            }}
            className="h-10 max-w-xs rounded-xl"
          />
          <select
            value={groupFilter}
            onChange={(e) => {
              setGroupFilter(e.target.value);
              setPage(0);
            }}
            className="h-10 rounded-xl border border-input bg-background px-3 text-sm"
            aria-label="Filter by group"
          >
            {groups.map((g) => (
              <option key={g} value={g}>
                {g === "All" ? "All groups" : g}
              </option>
            ))}
          </select>
          <select
            value={activeFilter}
            onChange={(e) => {
              setActiveFilter(e.target.value);
              setPage(0);
            }}
            className="h-10 rounded-xl border border-input bg-background px-3 text-sm"
            aria-label="Filter by status"
          >
            {["All", "Active", "Inactive"].map((s) => (
              <option key={s} value={s}>
                {s === "All" ? "All statuses" : s}
              </option>
            ))}
          </select>
        </div>

        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[900px] text-left text-sm">
            <thead>
              <tr className="mono-label border-b border-border text-muted-foreground">
                <th className="py-2 pr-3">
                  <input
                    type="checkbox"
                    checked={pageRows.length > 0 && pageRows.every((r) => selected.has(r.id))}
                    onChange={(e) => {
                      setSelected((s) => {
                        const next = new Set(s);
                        if (e.target.checked) pageRows.forEach((r) => next.add(r.id));
                        else pageRows.forEach((r) => next.delete(r.id));
                        return next;
                      });
                    }}
                    aria-label="Select page"
                  />
                </th>
                {(
                  [
                    ["name", "Name"],
                    ["email", "Email"],
                  ] as const
                ).map(([key, label]) => (
                  <th
                    key={key}
                    className="cursor-pointer py-2 pr-3 font-normal"
                    onClick={() => toggleSort(key)}
                  >
                    {label}
                    {sortKey === key ? (asc ? " ↑" : " ↓") : ""}
                  </th>
                ))}
                <th className="py-2 pr-3 font-normal">Phone</th>
                <th className="py-2 pr-3 font-normal">Roll No</th>
                <th className="py-2 pr-3 font-normal">Group</th>
                <th className="py-2 pr-3 font-normal">Exam</th>
                <th className="py-2 pr-3 font-normal">Status</th>
                <th className="py-2 pr-3 font-normal">Actions</th>
              </tr>
            </thead>
            <tbody>
              {dirLoading ? (
                <tr>
                  <td colSpan={9} className="py-6 text-muted-foreground">
                    Loading…
                  </td>
                </tr>
              ) : !pageRows.length ? (
                <tr>
                  <td colSpan={9} className="py-6 text-muted-foreground">
                    No participants yet. Add one above or bulk-upload a file.
                  </td>
                </tr>
              ) : (
                pageRows.map((d) => (
                  <tr key={d.id} className="border-b border-border">
                    <td className="py-2.5 pr-3">
                      <input
                        type="checkbox"
                        checked={selected.has(d.id)}
                        onChange={(e) => {
                          setSelected((s) => {
                            const next = new Set(s);
                            if (e.target.checked) next.add(d.id);
                            else next.delete(d.id);
                            return next;
                          });
                        }}
                        aria-label={`Select ${d.email}`}
                      />
                    </td>
                    <td className="py-2.5 pr-3 font-medium">{d.name}</td>
                    <td className="py-2.5 pr-3 text-muted-foreground">{d.email}</td>
                    <td className="py-2.5 pr-3">{d.phone || "—"}</td>
                    <td className="py-2.5 pr-3">{d.roll_no || "—"}</td>
                    <td className="py-2.5 pr-3">{d.group_name || "—"}</td>
                    <td className="py-2.5 pr-3 text-muted-foreground">{d.exam_title ?? "—"}</td>
                    <td className="py-2.5 pr-3">{d.is_active ? "Active" : "Inactive"}</td>
                    <td className="py-2.5 pr-3">
                      <span className="flex flex-wrap gap-1">
                        <Button
                          size="sm"
                          variant="ghost"
                          className="rounded-full"
                          title="Edit"
                          onClick={() => openEdit(d)}
                        >
                          <Pencil className="size-3.5" />
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="rounded-full"
                          title="Reset password"
                          onClick={() => void handleRegen(d.id, d.email)}
                        >
                          <RefreshCw className="size-3.5" />
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="rounded-full"
                          title="Assign to exam"
                          onClick={() => {
                            setAssignId(d.id);
                            setAssignExam(d.exam_id ?? "");
                          }}
                        >
                          <Plus className="size-3.5" />
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="rounded-full text-destructive"
                          title="Delete"
                          onClick={() => setDeleteId(d.id)}
                        >
                          <Trash2 className="size-3.5" />
                        </Button>
                      </span>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        <div className="mt-3 flex items-center gap-3 text-sm text-muted-foreground">
          <Button
            size="sm"
            variant="outline"
            className="rounded-full"
            disabled={page === 0}
            onClick={() => setPage((p) => p - 1)}
          >
            Previous
          </Button>
          <span>
            Page {page + 1} of {pages}
          </span>
          <Button
            size="sm"
            variant="outline"
            className="rounded-full"
            disabled={page + 1 >= pages}
            onClick={() => setPage((p) => p + 1)}
          >
            Next
          </Button>
        </div>
      </section>

      {/* Edit modal */}
      {editing ? (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-background/80 px-5 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-[22px] border border-border bg-card p-7">
            <h2 className="text-2xl">Edit participant</h2>
            <div className="mt-4 grid gap-3">
              <div className="space-y-1">
                <Label className="mono-label text-muted-foreground">Name</Label>
                <Input
                  value={editForm.name}
                  onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
                  className="rounded-xl"
                />
              </div>
              <div className="space-y-1">
                <Label className="mono-label text-muted-foreground">Email</Label>
                <Input
                  value={editForm.email}
                  onChange={(e) => setEditForm({ ...editForm, email: e.target.value })}
                  className="rounded-xl"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label className="mono-label text-muted-foreground">Phone</Label>
                  <Input
                    value={editForm.phone}
                    onChange={(e) => setEditForm({ ...editForm, phone: e.target.value })}
                    className="rounded-xl"
                  />
                </div>
                <div className="space-y-1">
                  <Label className="mono-label text-muted-foreground">Roll No</Label>
                  <Input
                    value={editForm.roll_no}
                    onChange={(e) => setEditForm({ ...editForm, roll_no: e.target.value })}
                    className="rounded-xl"
                  />
                </div>
              </div>
              <div className="space-y-1">
                <Label className="mono-label text-muted-foreground">Group</Label>
                <Input
                  value={editForm.group_name}
                  onChange={(e) => setEditForm({ ...editForm, group_name: e.target.value })}
                  className="rounded-xl"
                />
              </div>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={editForm.is_active}
                  onChange={(e) => setEditForm({ ...editForm, is_active: e.target.checked })}
                />
                Active
              </label>
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <Button variant="ghost" className="rounded-[32px]" onClick={() => setEditing(null)}>
                Cancel
              </Button>
              <Button disabled={savingEdit} className="rounded-[32px]" onClick={handleSaveEdit}>
                {savingEdit ? "Saving…" : "Save"}
              </Button>
            </div>
          </div>
        </div>
      ) : null}

      {/* Assign modal */}
      {assignId ? (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-background/80 px-5 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-[22px] border border-border bg-card p-7">
            <h2 className="text-2xl">Assign to exam</h2>
            <p className="mt-2 text-sm text-muted-foreground">
              Only participants who have not started can be moved.
            </p>
            <select
              value={assignExam}
              onChange={(e) => setAssignExam(e.target.value)}
              className="mt-4 h-10 w-full rounded-xl border border-input bg-background px-3 text-sm"
            >
              <option value="">Select exam…</option>
              {exams.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.title}
                </option>
              ))}
            </select>
            <div className="mt-5 flex justify-end gap-2">
              <Button variant="ghost" className="rounded-[32px]" onClick={() => setAssignId(null)}>
                Cancel
              </Button>
              <Button
                disabled={assigning || !assignExam}
                className="rounded-[32px]"
                onClick={handleAssign}
              >
                {assigning ? "Assigning…" : "Assign"}
              </Button>
            </div>
          </div>
        </div>
      ) : null}

      {/* Revealed password */}
      {revealed ? (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-background/80 px-5 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-[22px] border border-border bg-card p-7">
            <p className="mono-label text-muted-foreground">Password — shown once</p>
            <h2 className="mt-2 text-2xl">{revealed.email}</h2>
            <code className="mt-4 block break-all rounded-xl bg-muted/50 p-4 font-mono text-lg">
              {revealed.password}
            </code>
            <div className="mt-5 flex justify-end gap-2">
              <Button
                variant="secondary"
                className="rounded-[32px]"
                onClick={() => void copyText(revealed.password, "revealed")}
              >
                {copied === "revealed" ? <Check className="size-4" /> : <Copy className="size-4" />}{" "}
                Copy
              </Button>
              <Button className="rounded-[32px]" onClick={() => setRevealed(null)}>
                Done
              </Button>
            </div>
          </div>
        </div>
      ) : null}

      <ConfirmModal
        open={deleteId != null}
        title="Delete this participant?"
        body="Are you sure? This cannot be undone. Their answers and results will be removed too."
        confirmLabel="Delete"
        tone="danger"
        pending={deleting}
        onCancel={() => setDeleteId(null)}
        onConfirm={handleDelete}
      />
    </div>
  );
}
