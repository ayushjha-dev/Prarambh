import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import {
  Check,
  Copy,
  Download,
  FileUp,
  Link2,
  Plus,
  RefreshCw,
  RotateCcw,
  Trash2,
  Upload,
} from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { brand } from "@/config/brand";
import { supabase } from "@/integrations/supabase/client";
import {
  adminAddStudent,
  adminBulkAddStudents,
  adminCreateExam,
  adminDashboard,
  adminDeleteParticipant,
  adminGetQuestionSet,
  adminListExams,
  adminListStudents,
  adminParticipantDetail,
  adminRegenerateSlug,
  adminRegenerateStudentPassword,
  adminResetParticipant,
  adminUpdateExam,
  adminUpdateMeta,
  adminUploadQuestionSet,
  type AdminExam,
  type AdminRow,
} from "@/lib/admin.functions";
import { formatDuration } from "@/lib/exam-session";

export const Route = createFileRoute("/panel-admin")({
  ssr: false,
  beforeLoad: async () => {
    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user) throw redirect({ to: "/panel-admin-login" });
  },
  head: () => ({
    meta: [
      { title: `Organizer Dashboard — ${brand.appName}` },
      {
        name: "description",
        content: `Create exams, manage students and view results in ${brand.appName}.`,
      },
      { name: "robots", content: "noindex,nofollow" },
      { property: "og:title", content: `Organizer Dashboard — ${brand.appName}` },
      { property: "og:description", content: `Organizer dashboard for ${brand.appName}.` },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: AdminPanel,
});

type Tab = "exams" | "results" | "questions";
type SortKey = keyof AdminRow;
type FreshCredential = { name?: string; email: string; password: string };

function examLink(slug: string) {
  return `${window.location.origin}/exam/${slug}`;
}

function phaseOf(e: AdminExam): string {
  if (!e.is_enabled) return "Disabled";
  const now = Date.now();
  if (e.starts_at && now < new Date(e.starts_at).getTime()) return "Upcoming";
  if (e.ends_at && now > new Date(e.ends_at).getTime()) return "Ended";
  return "Live";
}

function download(filename: string, content: string) {
  const blob = new Blob([content], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function credentialsCsv(exam: AdminExam, rows: FreshCredential[]) {
  const header = ["Name", "Email", "Password", "Exam Link"];
  const lines = rows.map((r) =>
    [r.name ?? "", r.email, r.password, examLink(exam.slug)]
      .map((v) => `"${String(v).replace(/"/g, '""')}"`)
      .join(","),
  );
  return [header.join(","), ...lines].join("\n");
}

function mailtoFor(exam: AdminExam, row: FreshCredential) {
  const subject = `Your exam login: ${exam.title}`;
  const body = [
    `Hi${row.name ? ` ${row.name}` : ""},`,
    ``,
    `You are registered for "${exam.title}".`,
    `Exam link: ${examLink(exam.slug)}`,
    `Name: ${row.name ?? ""}`,
    `Email: ${row.email}`,
    `Password: ${row.password}`,
    ``,
    `Open the link on a laptop or desktop computer and log in with these details. Good luck!`,
  ].join("\n");
  return `mailto:${encodeURIComponent(row.email)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

function questionsJsonTemplate(exam: AdminExam): string {
  return JSON.stringify(
    {
      meta: {
        event: exam.title,
        organiser: "Prarambh",
        total_questions: 2,
        marks_correct: exam.marks_correct,
        marks_wrong: exam.marks_wrong,
        max_marks: 2 * exam.marks_correct,
        duration_minutes: exam.duration_minutes,
      },
      questions: [
        {
          id: 1,
          topic: "General",
          question: "What is 2 + 2?",
          option_a: "3",
          option_b: "4",
          option_c: "5",
          option_d: "6",
          correct: "B",
        },
        {
          id: 2,
          topic: "General",
          question: "Which is a programming language?",
          option_a: "Python",
          option_b: "Snake",
          option_c: "Ladder",
          option_d: "Chair",
          correct: "A",
        },
      ],
    },
    null,
    2,
  );
}

function questionsCsvTemplate(): string {
  return [
    "question,option_a,option_b,option_c,option_d,correct,topic",
    '"What is 2 + 2?",3,4,5,6,B,General',
    '"Which is a programming language?",Python,Snake,Ladder,Chair,A,General',
  ].join("\n");
}

function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === "," && !inQuotes) {
      out.push(cur.trim());
      cur = "";
    } else {
      cur += ch;
    }
  }
  out.push(cur.trim());
  return out;
}

/** Convert organizer-friendly CSV into the question-set JSON the server validates. */
function questionsCsvToJson(csvText: string, exam: AdminExam): string {
  const lines = csvText
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (!lines.length) throw new Error("CSV is empty.");
  const header = splitCsvLine(lines[0] ?? "").map((h) => h.toLowerCase().replace(/[^a-z_]/g, ""));
  const hasHeader = header.includes("question") && header.includes("option_a");
  const rows = (hasHeader ? lines.slice(1) : lines).map(splitCsvLine);
  if (!rows.length) throw new Error("No question rows found in CSV.");

  const questions = rows.map((cols, idx) => {
    // Supported column order (header or positional):
    // question, option_a, option_b, option_c, option_d, correct, topic?, difficulty?
    const map: Record<string, string> = {};
    if (hasHeader) {
      header.forEach((h, i) => {
        map[h] = (cols[i] ?? "").trim();
      });
    } else {
      const keys = [
        "question",
        "option_a",
        "option_b",
        "option_c",
        "option_d",
        "correct",
        "topic",
        "difficulty",
      ];
      keys.forEach((k, i) => {
        map[k] = (cols[i] ?? "").trim();
      });
    }
    const correct = (map["correct"] ?? "")
      .toUpperCase()
      .replace(/[^ABCD]/g, "")
      .slice(0, 1);
    if (
      !map["question"] ||
      !map["option_a"] ||
      !map["option_b"] ||
      !map["option_c"] ||
      !map["option_d"]
    ) {
      throw new Error(`Row ${idx + 1}: question and all 4 options are required.`);
    }
    if (!["A", "B", "C", "D"].includes(correct)) {
      throw new Error(`Row ${idx + 1}: correct must be one of A, B, C, D.`);
    }
    return {
      id: idx + 1,
      topic: map["topic"] || "General",
      ...(map["difficulty"] ? { difficulty: map["difficulty"] } : {}),
      question: map["question"],
      option_a: map["option_a"],
      option_b: map["option_b"],
      option_c: map["option_c"],
      option_d: map["option_d"],
      correct,
    };
  });

  return JSON.stringify(
    {
      meta: {
        event: exam.title,
        organiser: "Prarambh",
        total_questions: questions.length,
        marks_correct: exam.marks_correct,
        marks_wrong: exam.marks_wrong,
        max_marks: questions.length * exam.marks_correct,
        duration_minutes: exam.duration_minutes,
      },
      questions,
    },
    null,
    2,
  );
}

function AdminPanel() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const dashboard = useServerFn(adminDashboard);
  const detailFn = useServerFn(adminParticipantDetail);
  const resetParticipant = useServerFn(adminResetParticipant);
  const deleteParticipant = useServerFn(adminDeleteParticipant);
  const getSet = useServerFn(adminGetQuestionSet);
  const uploadSet = useServerFn(adminUploadQuestionSet);
  const updateMeta = useServerFn(adminUpdateMeta);
  const listExams = useServerFn(adminListExams);
  const createExam = useServerFn(adminCreateExam);
  const updateExam = useServerFn(adminUpdateExam);
  const regenSlug = useServerFn(adminRegenerateSlug);
  const listStudents = useServerFn(adminListStudents);
  const addStudent = useServerFn(adminAddStudent);
  const bulkAddStudents = useServerFn(adminBulkAddStudents);
  const regenPassword = useServerFn(adminRegenerateStudentPassword);

  const [tab, setTab] = useState<Tab>("exams");
  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("total_marks");
  const [asc, setAsc] = useState(false);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [raw, setRaw] = useState("");
  const [duration, setDuration] = useState("");
  const [mc, setMc] = useState("");
  const [mw, setMw] = useState("");
  const [participantAction, setParticipantAction] = useState<"reset" | "delete" | null>(null);
  const [participantActionPending, setParticipantActionPending] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);

  // exam creation
  const [examTitle, setExamTitle] = useState("");
  const [examDesc, setExamDesc] = useState("");
  const [examDuration, setExamDuration] = useState("45");
  const [examStarts, setExamStarts] = useState("");
  const [examEnds, setExamEnds] = useState("");
  const [creating, setCreating] = useState(false);
  const [showCreate, setShowCreate] = useState(false);

  // selected exam + students
  const [selectedExamId, setSelectedExamId] = useState<string | null>(null);
  const [studentName, setStudentName] = useState("");
  const [studentEmail, setStudentEmail] = useState("");
  const [addingStudent, setAddingStudent] = useState(false);
  const [csvText, setCsvText] = useState("");
  const [uploadingCsv, setUploadingCsv] = useState(false);
  const [uploadingQuestions, setUploadingQuestions] = useState(false);
  const [questionFileName, setQuestionFileName] = useState<string | null>(null);
  const [fresh, setFresh] = useState<FreshCredential[]>([]);
  const [revealed, setRevealed] = useState<{ email: string; password: string } | null>(null);

  const { data: examsData, isLoading: examsLoading } = useQuery({
    queryKey: ["admin-exams"],
    queryFn: () => listExams(),
    refetchInterval: 30000,
  });
  const exams = useMemo(() => examsData?.exams ?? [], [examsData]);
  const selectedExam = useMemo(
    () => exams.find((e) => e.id === selectedExamId) ?? exams[0] ?? null,
    [exams, selectedExamId],
  );

  const {
    data: resultsData,
    isLoading,
    error,
  } = useQuery({
    queryKey: ["admin-dashboard", selectedExam?.id ?? "legacy"],
    queryFn: () => dashboard({ data: selectedExam?.id ? { examId: selectedExam.id } : {} }),
  });

  const { data: studentsData } = useQuery({
    queryKey: ["admin-students", selectedExam?.id],
    queryFn: () => {
      if (!selectedExam) throw new Error("No exam selected");
      return listStudents({ data: { examId: selectedExam.id } });
    },
    enabled: Boolean(selectedExam),
  });

  const { data: activeSet } = useQuery({
    queryKey: ["admin-question-set", selectedExam?.id ?? "none"],
    queryFn: () => getSet({ data: selectedExam?.id ? { examId: selectedExam.id } : {} }),
  });

  const { data: detail } = useQuery({
    queryKey: ["admin-detail", detailId],
    queryFn: () => {
      if (!detailId) throw new Error("No participant selected");
      return detailFn({ data: { participantId: detailId } });
    },
    enabled: Boolean(detailId),
  });

  const rows = useMemo(() => {
    const list = (resultsData?.rows ?? []).filter(
      (r) =>
        r.name.toLowerCase().includes(search.toLowerCase()) ||
        r.email.toLowerCase().includes(search.toLowerCase()),
    );
    return [...list].sort((a, b) => {
      const av = a[sortKey];
      const bv = b[sortKey];
      if (av == null) return 1;
      if (bv == null) return -1;
      const cmp =
        typeof av === "number" && typeof bv === "number"
          ? av - bv
          : String(av).localeCompare(String(bv));
      return asc ? cmp : -cmp;
    });
  }, [resultsData, search, sortKey, asc]);

  function toggleSort(key: SortKey) {
    if (key === sortKey) setAsc((v) => !v);
    else {
      setSortKey(key);
      setAsc(false);
    }
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
    toast.success("Copied to clipboard.");
    setTimeout(() => setCopied((c) => (c === id ? null : c)), 2000);
  }

  function exportCsv() {
    const header = [
      "Name",
      "Email",
      "Status",
      "Score",
      "Correct",
      "Wrong",
      "Unattempted",
      "Time Taken (s)",
      "Violations",
      "Submit Reason",
      "Submitted At",
    ];
    const lines = rows.map((r) =>
      [
        r.name,
        r.email,
        r.status,
        r.total_marks ?? "",
        r.total_correct ?? "",
        r.total_wrong ?? "",
        r.total_unattempted ?? "",
        r.time_taken_seconds ?? "",
        r.tab_violation_count,
        r.submit_reason ?? "",
        r.exam_submitted_at ?? "",
      ]
        .map((v) => `"${String(v).replace(/"/g, '""')}"`)
        .join(","),
    );
    download(
      `${selectedExam ? `${selectedExam.slug}-` : ""}results.csv`,
      [header.join(","), ...lines].join("\n"),
    );
  }

  function exportAnswerSheet() {
    if (!detail) return;
    const header = ["Question ID", "Topic", "Question", "Selected", "Correct", "Marks"];
    const lines = detail.questions.map((q: any) =>
      [q.id, q.topic, q.question.replace(/\n/g, " "), q.selected ?? "", q.correct, q.marks]
        .map((v: any) => `"${String(v).replace(/"/g, '""')}"`)
        .join(","),
    );
    download(
      `answer-sheet-${detail.participant.email}.csv`,
      [header.join(","), ...lines].join("\n"),
    );
  }

  async function handleUpload() {
    if (!selectedExam) {
      toast.error("Create and select an exam first.");
      return;
    }
    setUploadingQuestions(true);
    try {
      const res = await uploadSet({ data: { raw, examId: selectedExam.id } });
      toast.success(`Question set activated with ${res.count} questions.`);
      setRaw("");
      setQuestionFileName(null);
      queryClient.invalidateQueries({ queryKey: ["admin-question-set"] });
      queryClient.invalidateQueries({ queryKey: ["admin-exams"] });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Upload failed.");
    } finally {
      setUploadingQuestions(false);
    }
  }

  async function handleQuestionFile(file: File) {
    if (!selectedExam) {
      toast.error("Create and select an exam first.");
      return;
    }
    try {
      const text = await file.text();
      const name = file.name.toLowerCase();
      if (name.endsWith(".csv") || name.endsWith(".txt")) {
        setRaw(questionsCsvToJson(text, selectedExam));
        setQuestionFileName(file.name);
        toast.success("CSV parsed. Review below, then click Validate & activate.");
      } else {
        setRaw(text);
        setQuestionFileName(file.name);
      }
      // Jump to questions tab content stays in sync via shared `raw` state.
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not read that file.");
    }
  }

  async function handleMeta() {
    try {
      if (selectedExam) {
        await updateExam({
          data: {
            id: selectedExam.id,
            duration_minutes: Number(duration),
            marks_correct: Number(mc),
            marks_wrong: Number(mw),
          },
        });
      } else {
        await updateMeta({
          data: {
            duration_minutes: Number(duration),
            marks_correct: Number(mc),
            marks_wrong: Number(mw),
          },
        });
      }
      toast.success("Exam settings updated.");
      queryClient.invalidateQueries({ queryKey: ["admin-question-set"] });
      queryClient.invalidateQueries({ queryKey: ["admin-exams"] });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Update failed.");
    }
  }

  async function handleCreateExam() {
    if (examTitle.trim().length < 2) {
      toast.error("Give the exam a title (min 2 characters).");
      return;
    }
    setCreating(true);
    try {
      const res = await createExam({
        data: {
          title: examTitle.trim(),
          description: examDesc.trim(),
          duration_minutes: Number(examDuration) || 45,
          starts_at: examStarts ? new Date(examStarts).toISOString() : null,
          ends_at: examEnds ? new Date(examEnds).toISOString() : null,
        },
      });
      toast.success("Exam created. Copy its private link below.");
      setExamTitle("");
      setExamDesc("");
      setExamDuration("45");
      setExamStarts("");
      setExamEnds("");
      setShowCreate(false);
      setSelectedExamId(res.id);
      await queryClient.invalidateQueries({ queryKey: ["admin-exams"] });
      await copyText(examLink(res.slug), `new-${res.id}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not create exam.");
    } finally {
      setCreating(false);
    }
  }

  async function handleToggleEnabled(exam: AdminExam) {
    try {
      await updateExam({ data: { id: exam.id, is_enabled: !exam.is_enabled } });
      toast.success(exam.is_enabled ? "Exam link disabled." : "Exam link enabled.");
      queryClient.invalidateQueries({ queryKey: ["admin-exams"] });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Update failed.");
    }
  }

  async function handleRegenSlug(exam: AdminExam) {
    try {
      const res = await regenSlug({ data: { id: exam.id } });
      toast.success("New exam link generated. The old link no longer works.");
      queryClient.invalidateQueries({ queryKey: ["admin-exams"] });
      await copyText(examLink(res.slug), `slug-${exam.id}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not regenerate link.");
    }
  }

  function parseCsv(text: string): { name: string; email: string }[] {
    return text
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean)
      .filter((l) => !/^name\s*,/i.test(l))
      .map((line) => {
        const parts = line.split(/[,;\t]/).map((p) => p.trim().replace(/^"|"$/g, ""));
        return { name: parts[0] ?? "", email: (parts[1] ?? "").toLowerCase() };
      })
      .filter((r) => r.name && r.email);
  }

  async function handleAddStudent() {
    if (!selectedExam) return;
    if (studentName.trim().length < 2) {
      toast.error("Enter the student's name.");
      return;
    }
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(studentEmail.trim())) {
      toast.error("Enter a valid email address.");
      return;
    }
    setAddingStudent(true);
    try {
      const res = await addStudent({
        data: { examId: selectedExam.id, name: studentName.trim(), email: studentEmail.trim() },
      });
      const row = { name: studentName.trim(), email: res.email, password: res.password };
      setFresh((f) => [row, ...f]);
      setRevealed({ email: res.email, password: res.password });
      setStudentName("");
      setStudentEmail("");
      queryClient.invalidateQueries({ queryKey: ["admin-students"] });
      queryClient.invalidateQueries({ queryKey: ["admin-exams"] });
      toast.success("Student added. Copy the password now — it is shown only once.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not add student.");
    } finally {
      setAddingStudent(false);
    }
  }

  async function handleCsvUpload() {
    if (!selectedExam) return;
    const parsed = parseCsv(csvText);
    if (!parsed.length) {
      toast.error("No valid rows found. Use one student per line: Name, email.");
      return;
    }
    setUploadingCsv(true);
    try {
      const res = await bulkAddStudents({ data: { examId: selectedExam.id, students: parsed } });
      const withNames = res.added.map((a) => ({
        name: parsed.find((p) => p.email.toLowerCase() === a.email.toLowerCase())?.name ?? "",
        ...a,
      }));
      setFresh((f) => [...withNames, ...f]);
      setCsvText("");
      queryClient.invalidateQueries({ queryKey: ["admin-students"] });
      queryClient.invalidateQueries({ queryKey: ["admin-exams"] });
      toast.success(
        `${res.added.length} students added${res.skipped.length ? `, ${res.skipped.length} skipped` : ""}. Download the CSV now — passwords are shown only once.`,
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Upload failed.");
    } finally {
      setUploadingCsv(false);
    }
  }

  async function handleRegenPassword(participantId: string, email: string) {
    try {
      const res = await regenPassword({ data: { participantId } });
      setRevealed({ email, password: res.password });
      setFresh((f) => [{ email, password: res.password }, ...f.filter((x) => x.email !== email)]);
      toast.success("New password generated. Copy it now — it is shown only once.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not regenerate password.");
    }
  }

  async function signOut() {
    await queryClient.cancelQueries();
    queryClient.clear();
    await supabase.auth.signOut();
    navigate({ to: "/panel-admin-login", replace: true });
  }

  async function handleParticipantAction() {
    if (!detailId || !participantAction) return;
    setParticipantActionPending(true);
    try {
      if (participantAction === "reset") {
        await resetParticipant({ data: { participantId: detailId } });
        toast.success("Participant exam reset.");
      } else {
        await deleteParticipant({ data: { participantId: detailId } });
        toast.success("Participant deleted.");
      }
      setParticipantAction(null);
      setDetailId(null);
      await queryClient.invalidateQueries({ queryKey: ["admin-dashboard"] });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Action failed.");
    } finally {
      setParticipantActionPending(false);
    }
  }

  if (error) {
    return (
      <main className="flex min-h-screen items-center justify-center px-5">
        <div className="text-center">
          <p className="text-destructive">
            {error instanceof Error ? error.message : "Access denied."}
          </p>
          <Button variant="ghost" className="mt-4 rounded-[32px]" onClick={signOut}>
            Sign out
          </Button>
        </div>
      </main>
    );
  }

  const meta = (activeSet?.meta ?? {}) as Record<string, string | number>;

  return (
    <main className="min-h-screen bg-background">
      <header className="flex items-center justify-between border-b border-border px-5 py-4">
        <div>
          <p className="mono-label text-muted-foreground">{brand.appName} · Organizer</p>
          <h1 className="text-2xl">Organizer Dashboard</h1>
        </div>
        <Button variant="ghost" className="rounded-[32px]" onClick={signOut}>
          Sign out
        </Button>
      </header>

      <nav className="flex gap-1 border-b border-border px-5">
        {(
          [
            ["exams", "Exams"],
            ["results", "Results"],
            ["questions", "Questions"],
          ] as [Tab, string][]
        ).map(([key, label]) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`mono-label border-b-2 px-4 py-3 transition-colors ${tab === key ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"}`}
          >
            {label}
          </button>
        ))}
      </nav>

      {tab === "exams" ? (
        <div className="mx-auto max-w-6xl px-5 py-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-xl">Exams {exams.length ? `(${exams.length})` : ""}</h2>
            <Button className="rounded-[32px]" onClick={() => setShowCreate((v) => !v)}>
              <Plus className="size-4" /> New exam
            </Button>
          </div>

          {showCreate ? (
            <section className="mt-4 rounded-[22px] border border-border p-6">
              <h3 className="text-2xl">Create exam</h3>
              <p className="mt-1 text-sm text-muted-foreground">
                A unique, hard-to-guess link is generated automatically.
              </p>
              <div className="mt-5 grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label className="mono-label text-muted-foreground">Title</Label>
                  <Input
                    value={examTitle}
                    onChange={(e) => setExamTitle(e.target.value)}
                    placeholder="e.g. Physics Midterm 2026"
                    className="rounded-xl"
                  />
                </div>
                <div className="space-y-2">
                  <Label className="mono-label text-muted-foreground">Duration (minutes)</Label>
                  <Input
                    value={examDuration}
                    onChange={(e) => setExamDuration(e.target.value)}
                    inputMode="numeric"
                    className="rounded-xl"
                  />
                </div>
                <div className="space-y-2 md:col-span-2">
                  <Label className="mono-label text-muted-foreground">
                    Description (shown on the login page)
                  </Label>
                  <Textarea
                    value={examDesc}
                    onChange={(e) => setExamDesc(e.target.value)}
                    placeholder="What is this exam about?"
                    className="rounded-xl"
                  />
                </div>
                <div className="space-y-2">
                  <Label className="mono-label text-muted-foreground">Start time (optional)</Label>
                  <Input
                    type="datetime-local"
                    value={examStarts}
                    onChange={(e) => setExamStarts(e.target.value)}
                    className="rounded-xl"
                  />
                </div>
                <div className="space-y-2">
                  <Label className="mono-label text-muted-foreground">End time (optional)</Label>
                  <Input
                    type="datetime-local"
                    value={examEnds}
                    onChange={(e) => setExamEnds(e.target.value)}
                    className="rounded-xl"
                  />
                </div>
              </div>
              <div className="mt-5 flex gap-2">
                <Button disabled={creating} onClick={handleCreateExam} className="rounded-[32px]">
                  {creating ? "Creating…" : "Create exam & copy link"}
                </Button>
                <Button
                  variant="ghost"
                  className="rounded-[32px]"
                  onClick={() => setShowCreate(false)}
                >
                  Cancel
                </Button>
              </div>
            </section>
          ) : null}

          <div className="mt-5 grid gap-4">
            {examsLoading ? <p className="text-muted-foreground">Loading exams…</p> : null}
            {!examsLoading && !exams.length ? (
              <div className="rounded-[22px] border border-dashed border-border p-10 text-center">
                <p className="text-lg">No exams yet</p>
                <p className="mt-2 text-sm text-muted-foreground">
                  Create your first exam to get its private link, then add students.
                </p>
              </div>
            ) : null}
            {exams.map((exam) => (
              <article
                key={exam.id}
                className={`rounded-[22px] border p-6 ${selectedExam?.id === exam.id ? "border-primary" : "border-border"}`}
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="text-2xl">{exam.title}</h3>
                      <span className="mono-label rounded-full bg-secondary px-3 py-1 text-muted-foreground">
                        {phaseOf(exam)}
                      </span>
                    </div>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {exam.duration_minutes} min · {exam.question_count} questions ·{" "}
                      {exam.total_students} students ({exam.completed} submitted)
                    </p>
                    {exam.starts_at || exam.ends_at ? (
                      <p className="mt-1 text-xs text-muted-foreground">
                        {exam.starts_at
                          ? `Starts ${new Date(exam.starts_at).toLocaleString()}`
                          : ""}
                        {exam.starts_at && exam.ends_at ? " · " : ""}
                        {exam.ends_at ? `Ends ${new Date(exam.ends_at).toLocaleString()}` : ""}
                      </p>
                    ) : null}
                  </div>
                  <Button
                    variant={selectedExam?.id === exam.id ? "default" : "outline"}
                    className="rounded-[32px]"
                    onClick={() => setSelectedExamId(exam.id)}
                  >
                    {selectedExam?.id === exam.id ? <Check className="size-4" /> : null} Manage
                  </Button>
                </div>

                <div className="mt-4 flex flex-col gap-2 rounded-2xl bg-muted/40 p-4 sm:flex-row sm:items-center">
                  <Link2 className="size-4 shrink-0 text-muted-foreground" />
                  <code className="min-w-0 flex-1 break-all font-mono text-sm">
                    {examLink(exam.slug)}
                  </code>
                  <div className="flex shrink-0 gap-2">
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
                      onClick={() => void handleRegenSlug(exam)}
                    >
                      <RefreshCw className="size-4" /> New link
                    </Button>
                    <Button
                      size="sm"
                      variant={exam.is_enabled ? "outline" : "default"}
                      className="rounded-full"
                      onClick={() => void handleToggleEnabled(exam)}
                    >
                      {exam.is_enabled ? "Disable" : "Enable"}
                    </Button>
                  </div>
                </div>

                {selectedExam?.id === exam.id ? (
                  <>
                    <StudentsManager
                      exam={exam}
                      students={studentsData?.students ?? []}
                      fresh={fresh}
                      studentName={studentName}
                      setStudentName={setStudentName}
                      studentEmail={studentEmail}
                      setStudentEmail={setStudentEmail}
                      addingStudent={addingStudent}
                      onAdd={handleAddStudent}
                      csvText={csvText}
                      setCsvText={setCsvText}
                      uploadingCsv={uploadingCsv}
                      onCsvUpload={handleCsvUpload}
                      onCsvFile={async (file) => setCsvText(await file.text())}
                      onRegenPassword={handleRegenPassword}
                      onDownloadCsv={() =>
                        download(`${exam.slug}-credentials.csv`, credentialsCsv(exam, fresh))
                      }
                      copied={copied}
                      onCopy={(text, id) => void copyText(text, id)}
                    />
                    <QuestionsUploader
                      exam={exam}
                      questionCount={activeSet?.count ?? exam.question_count}
                      raw={raw}
                      setRaw={setRaw}
                      fileName={questionFileName}
                      uploading={uploadingQuestions}
                      onFile={handleQuestionFile}
                      onUpload={handleUpload}
                      onDownloadJson={() =>
                        download(
                          `${exam.slug}-questions-template.json`,
                          questionsJsonTemplate(exam),
                        )
                      }
                      onDownloadCsv={() =>
                        download(`${exam.slug}-questions-template.csv`, questionsCsvTemplate())
                      }
                      onGotoQuestions={() => setTab("questions")}
                    />
                  </>
                ) : null}
              </article>
            ))}
          </div>
        </div>
      ) : null}

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

      {tab === "results" ? (
        <div className="px-5 py-6">
          <div className="flex flex-wrap items-center gap-3">
            <Label className="mono-label text-muted-foreground">Exam</Label>
            <select
              value={selectedExam?.id ?? ""}
              onChange={(e) => setSelectedExamId(e.target.value || null)}
              className="h-10 rounded-xl border border-input bg-background px-3 text-sm"
            >
              {exams.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.title}
                </option>
              ))}
            </select>
            {!exams.length ? (
              <span className="text-sm text-muted-foreground">
                No exams yet — create one first.
              </span>
            ) : null}
          </div>

          <div className="mt-5 grid grid-cols-2 gap-3 md:grid-cols-5">
            <Stat label="Registered" value={resultsData?.stats.total ?? 0} />
            <Stat label="Completed" value={resultsData?.stats.completed ?? 0} />
            <Stat label="In progress" value={resultsData?.stats.inProgress ?? 0} />
            <Stat label="Avg score" value={resultsData?.stats.avgScore ?? 0} />
            <Stat label="Avg time" value={formatDuration(resultsData?.stats.avgTime ?? 0)} />
          </div>
          <div className="mt-7">
            <Button className="h-10 rounded-[32px]" onClick={exportCsv}>
              Export CSV
            </Button>
          </div>

          <div className="mt-5 flex flex-wrap items-center gap-3">
            <Input
              placeholder="Search by name or email"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="h-10 max-w-xs rounded-xl"
            />
          </div>

          <div className="mt-5 overflow-x-auto">
            <table className="w-full min-w-[1000px] text-left text-sm">
              <thead>
                <tr className="mono-label border-b border-border text-muted-foreground">
                  {(
                    [
                      ["name", "Name"],
                      ["email", "Email"],
                      ["status", "Status"],
                      ["total_marks", "Score"],
                      ["total_correct", "Correct"],
                      ["total_wrong", "Wrong"],
                      ["total_unattempted", "Unatt."],
                      ["time_taken_seconds", "Time"],
                      ["tab_violation_count", "Viol."],
                      ["submit_reason", "Reason"],
                      ["exam_submitted_at", "Submitted"],
                    ] as [SortKey, string][]
                  ).map(([key, label]) => (
                    <th
                      key={key}
                      className="cursor-pointer py-3 pr-4 font-normal"
                      onClick={() => toggleSort(key)}
                    >
                      {label}
                      {sortKey === key ? (asc ? " ↑" : " ↓") : ""}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {isLoading ? (
                  <tr>
                    <td className="py-6 text-muted-foreground" colSpan={11}>
                      Loading…
                    </td>
                  </tr>
                ) : (
                  rows.map((r) => (
                    <tr
                      key={r.id}
                      onClick={() => setDetailId(r.id)}
                      className="cursor-pointer border-b border-border hover:bg-secondary"
                    >
                      <td className="py-3 pr-4">{r.name}</td>
                      <td className="py-3 pr-4 text-muted-foreground">{r.email}</td>
                      <td className="py-3 pr-4">{r.status.replace("_", " ")}</td>
                      <td className="py-3 pr-4 font-mono">{r.total_marks ?? "—"}</td>
                      <td className="py-3 pr-4">{r.total_correct ?? "—"}</td>
                      <td className="py-3 pr-4">{r.total_wrong ?? "—"}</td>
                      <td className="py-3 pr-4">{r.total_unattempted ?? "—"}</td>
                      <td className="py-3 pr-4">{formatDuration(r.time_taken_seconds)}</td>
                      <td className="py-3 pr-4">{r.tab_violation_count}</td>
                      <td className="py-3 pr-4">{r.submit_reason ?? "—"}</td>
                      <td className="py-3 pr-4 text-muted-foreground">
                        {r.exam_submitted_at ? new Date(r.exam_submitted_at).toLocaleString() : "—"}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}

      {tab === "questions" ? (
        <div className="px-5 py-6">
          <div className="mb-4 flex flex-wrap items-center gap-3">
            <Label className="mono-label text-muted-foreground">Exam</Label>
            <select
              value={selectedExam?.id ?? ""}
              onChange={(e) => setSelectedExamId(e.target.value || null)}
              className="h-10 rounded-xl border border-input bg-background px-3 text-sm"
            >
              {exams.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.title}
                </option>
              ))}
            </select>
          </div>
          {!selectedExam ? (
            <p className="text-sm text-muted-foreground">
              Create an exam first, then upload its question set here.
            </p>
          ) : (
            <section className="rounded-[22px] border border-border p-6">
              <h2 className="text-2xl">Question set — {selectedExam.title}</h2>
              {activeSet ? (
                <p className="mono-label mt-2 text-muted-foreground">
                  {String(meta["event"] ?? "")} · {activeSet.count} questions ·{" "}
                  {String(meta["duration_minutes"])} min · +{String(meta["marks_correct"])} /{" "}
                  {String(meta["marks_wrong"])}
                </p>
              ) : (
                <p className="mt-2 text-sm text-destructive">
                  No question set linked to this exam yet.
                </p>
              )}

              <div className="mt-5 grid gap-5 lg:grid-cols-2">
                <div>
                  <Label className="mono-label text-muted-foreground">
                    Upload questions (JSON or CSV)
                  </Label>
                  <input
                    type="file"
                    accept=".json,application/json,.csv,.txt"
                    className="mt-2 block text-sm"
                    onChange={async (e) => {
                      const file = e.target.files?.[0];
                      if (file) await handleQuestionFile(file);
                      e.target.value = "";
                    }}
                  />
                  {questionFileName ? (
                    <p className="mt-1 text-xs text-muted-foreground">Loaded: {questionFileName}</p>
                  ) : null}
                  <Textarea
                    value={raw}
                    onChange={(e) => setRaw(e.target.value)}
                    placeholder="Paste question-bank JSON, or upload a .json / .csv file above"
                    className="mt-3 h-40 rounded-xl font-mono text-xs"
                  />
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Button
                      disabled={!raw || uploadingQuestions}
                      onClick={handleUpload}
                      className="rounded-[32px]"
                    >
                      {uploadingQuestions ? "Validating…" : "Validate & activate"}
                    </Button>
                    <Button
                      variant="secondary"
                      className="rounded-[32px]"
                      onClick={() =>
                        download(
                          `${selectedExam.slug}-questions-template.json`,
                          questionsJsonTemplate(selectedExam),
                        )
                      }
                    >
                      <Download className="size-4" /> JSON template
                    </Button>
                    <Button
                      variant="secondary"
                      className="rounded-[32px]"
                      onClick={() =>
                        download(
                          `${selectedExam.slug}-questions-template.csv`,
                          questionsCsvTemplate(),
                        )
                      }
                    >
                      <Download className="size-4" /> CSV template
                    </Button>
                  </div>
                  <p className="mt-2 text-xs text-muted-foreground">
                    CSV columns: question, option_a, option_b, option_c, option_d, correct (A–D),
                    topic (optional).
                  </p>
                </div>
                <div>
                  <Label className="mono-label text-muted-foreground">Exam settings</Label>
                  <div className="mt-2 grid grid-cols-3 gap-3">
                    <Input
                      placeholder="Duration (min)"
                      value={duration}
                      onChange={(e) => setDuration(e.target.value)}
                      className="rounded-xl"
                    />
                    <Input
                      placeholder="Correct (+)"
                      value={mc}
                      onChange={(e) => setMc(e.target.value)}
                      className="rounded-xl"
                    />
                    <Input
                      placeholder="Wrong (−)"
                      value={mw}
                      onChange={(e) => setMw(e.target.value)}
                      className="rounded-xl"
                    />
                  </div>
                  <Button
                    className="mt-3 rounded-[32px]"
                    disabled={!duration || !mc || !mw}
                    onClick={handleMeta}
                  >
                    Save settings
                  </Button>
                </div>
              </div>
            </section>
          )}
        </div>
      ) : null}

      {detailId && detail ? (
        <div className="fixed inset-0 z-50 flex justify-end bg-black/40">
          <div className="h-full w-full max-w-2xl overflow-y-auto bg-card p-7">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="text-2xl">{detail.participant.name}</h2>
                <p className="mono-label text-muted-foreground">{detail.participant.email}</p>
              </div>
              <div className="flex gap-2">
                <Button variant="secondary" className="rounded-[32px]" onClick={exportAnswerSheet}>
                  Export
                </Button>
                <Button
                  variant="ghost"
                  className="rounded-[32px]"
                  onClick={() => setDetailId(null)}
                >
                  Close
                </Button>
              </div>
            </div>
            <div className="mt-5 flex flex-wrap gap-2 border-y border-border py-4">
              <Button
                variant="secondary"
                className="rounded-[32px]"
                onClick={() => setParticipantAction("reset")}
              >
                <RotateCcw className="size-4" /> Reset exam
              </Button>
              <Button
                variant="destructive"
                className="rounded-[32px]"
                onClick={() => setParticipantAction("delete")}
              >
                <Trash2 className="size-4" /> Delete participant
              </Button>
            </div>
            <div className="mt-6 space-y-4">
              {detail.questions.map((q: any) => (
                <div key={q.id} className="rounded-xl border border-border p-4">
                  <p className="mono-label text-muted-foreground">
                    Q{q.id} · {q.topic} · {q.marks > 0 ? `+${q.marks}` : q.marks}
                  </p>
                  <p className="mt-2 whitespace-pre-wrap text-[15px]">{q.question}</p>
                  <p className="mt-2 text-sm">
                    Selected: <strong>{q.selected ?? "—"}</strong> · Correct:{" "}
                    <strong>{q.correct}</strong>
                  </p>
                </div>
              ))}
            </div>
          </div>
        </div>
      ) : null}

      {participantAction && detail ? (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-background/80 px-5 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-[22px] border border-border bg-card p-7">
            <h2 className="text-2xl">
              {participantAction === "reset" ? "Reset this exam?" : "Delete this participant?"}
            </h2>
            <p className="mt-3 text-sm text-muted-foreground">
              {participantAction === "reset"
                ? `${detail.participant.name}'s answers, score, timer, and violations will be cleared. They can start again using the same credentials.`
                : `${detail.participant.name} and all of their exam data will be permanently deleted.`}
            </p>
            <div className="mt-6 flex justify-end gap-2">
              <Button
                variant="ghost"
                className="rounded-[32px]"
                disabled={participantActionPending}
                onClick={() => setParticipantAction(null)}
              >
                Cancel
              </Button>
              <Button
                variant={participantAction === "delete" ? "destructive" : "default"}
                className="rounded-[32px]"
                disabled={participantActionPending}
                onClick={() => void handleParticipantAction()}
              >
                {participantActionPending
                  ? "Please wait…"
                  : participantAction === "reset"
                    ? "Reset exam"
                    : "Delete permanently"}
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </main>
  );
}

function QuestionsUploader(props: {
  exam: AdminExam;
  questionCount: number;
  raw: string;
  setRaw: (v: string) => void;
  fileName: string | null;
  uploading: boolean;
  onFile: (file: File) => void;
  onUpload: () => void;
  onDownloadJson: () => void;
  onDownloadCsv: () => void;
  onGotoQuestions: () => void;
}) {
  return (
    <div className="mt-6 rounded-2xl border border-border p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h4 className="flex items-center gap-2 text-xl">
          <Upload className="size-5 text-muted-foreground" /> Upload Questions (
          {props.questionCount})
        </h4>
        <Button size="sm" variant="ghost" className="rounded-full" onClick={props.onGotoQuestions}>
          Open Questions tab
        </Button>
      </div>
      <p className="mt-1 text-sm text-muted-foreground">
        Upload a <strong>.json</strong> question bank or a simple <strong>.csv</strong> file. CSV
        columns:{" "}
        <code className="font-mono text-xs">
          question, option_a, option_b, option_c, option_d, correct, topic
        </code>
      </p>
      <div className="mt-3 grid gap-4 lg:grid-cols-2">
        <div>
          <Label className="mono-label text-muted-foreground">Upload file</Label>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <label className="inline-flex h-10 cursor-pointer items-center gap-2 rounded-[32px] border border-input bg-background px-4 text-sm font-medium transition-colors hover:bg-accent">
              <FileUp className="size-4" /> Choose .json / .csv
              <input
                type="file"
                accept=".json,application/json,.csv,.txt"
                className="hidden"
                onChange={async (e) => {
                  const file = e.target.files?.[0];
                  if (file) await props.onFile(file);
                  e.target.value = "";
                }}
              />
            </label>
            {props.fileName ? (
              <span className="text-xs text-muted-foreground">{props.fileName}</span>
            ) : null}
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="secondary"
              className="rounded-full"
              onClick={props.onDownloadJson}
            >
              <Download className="size-3.5" /> JSON template
            </Button>
            <Button
              size="sm"
              variant="secondary"
              className="rounded-full"
              onClick={props.onDownloadCsv}
            >
              <Download className="size-3.5" /> CSV template
            </Button>
          </div>
        </div>
        <div>
          <Label className="mono-label text-muted-foreground">Preview / paste JSON</Label>
          <Textarea
            value={props.raw}
            onChange={(e) => props.setRaw(e.target.value)}
            placeholder="Upload a file above or paste question-bank JSON here"
            className="mt-2 h-28 rounded-xl font-mono text-xs"
          />
          <Button
            disabled={!props.raw || props.uploading}
            onClick={props.onUpload}
            className="mt-3 rounded-[32px]"
          >
            {props.uploading ? "Validating…" : `Validate & activate for ${props.exam.title}`}
          </Button>
        </div>
      </div>
    </div>
  );
}

function StudentsManager(props: {
  exam: AdminExam;
  students: { id: string; name: string; email: string; status: string }[];
  fresh: FreshCredential[];
  studentName: string;
  setStudentName: (v: string) => void;
  studentEmail: string;
  setStudentEmail: (v: string) => void;
  addingStudent: boolean;
  onAdd: () => void;
  csvText: string;
  setCsvText: (v: string) => void;
  uploadingCsv: boolean;
  onCsvUpload: () => void;
  onCsvFile: (file: File) => void;
  onRegenPassword: (participantId: string, email: string) => void;
  onDownloadCsv: () => void;
  copied: string | null;
  onCopy: (text: string, id: string) => void;
}) {
  const { exam, students, fresh } = props;
  return (
    <div className="mt-6 border-t border-border pt-5">
      <h4 className="text-xl">Students ({students.length})</h4>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <div className="rounded-2xl border border-border p-4">
          <p className="mono-label text-muted-foreground">Add student</p>
          <div className="mt-3 grid gap-3">
            <Input
              placeholder="Full name"
              value={props.studentName}
              onChange={(e) => props.setStudentName(e.target.value)}
              className="rounded-xl"
            />
            <Input
              placeholder="Email address"
              type="email"
              value={props.studentEmail}
              onChange={(e) => props.setStudentEmail(e.target.value)}
              className="rounded-xl"
            />
            <Button disabled={props.addingStudent} onClick={props.onAdd} className="rounded-[32px]">
              <Plus className="size-4" />{" "}
              {props.addingStudent ? "Adding…" : "Add & generate password"}
            </Button>
          </div>
        </div>
        <div className="rounded-2xl border border-border p-4">
          <p className="mono-label text-muted-foreground">
            Bulk upload (CSV: Name, email per line)
          </p>
          <input
            type="file"
            accept=".csv,.txt"
            className="mt-3 block text-sm"
            onChange={async (e) => {
              const file = e.target.files?.[0];
              if (file) props.onCsvFile(file);
            }}
          />
          <Textarea
            value={props.csvText}
            onChange={(e) => props.setCsvText(e.target.value)}
            placeholder={"Aarav Sharma, aarav@example.com\nDiya Patel, diya@example.com"}
            className="mt-3 h-24 rounded-xl font-mono text-xs"
          />
          <Button
            disabled={props.uploadingCsv || !props.csvText}
            onClick={props.onCsvUpload}
            className="mt-3 rounded-[32px]"
          >
            {props.uploadingCsv ? "Uploading…" : "Upload & generate passwords"}
          </Button>
        </div>
      </div>

      {fresh.length ? (
        <div className="mt-4 rounded-2xl border border-brand/40 bg-brand/[0.04] p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="mono-label text-muted-foreground">
              New credentials — copy or download now (shown once)
            </p>
            <Button
              size="sm"
              variant="secondary"
              className="rounded-full"
              onClick={props.onDownloadCsv}
            >
              Download credentials CSV
            </Button>
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
                    onClick={() => props.onCopy(f.password, `pw-${f.email}`)}
                  >
                    {props.copied === `pw-${f.email}` ? (
                      <Check className="size-4" />
                    ) : (
                      <Copy className="size-4" />
                    )}
                  </Button>
                  <a
                    href={mailtoFor(exam, f)}
                    className="inline-flex h-8 items-center rounded-full border border-input px-3 text-xs font-medium transition-colors hover:bg-accent"
                  >
                    Email
                  </a>
                </span>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      <div className="mt-4 overflow-x-auto">
        <table className="w-full min-w-[560px] text-left text-sm">
          <thead>
            <tr className="mono-label border-b border-border text-muted-foreground">
              <th className="py-2 pr-4 font-normal">Name</th>
              <th className="py-2 pr-4 font-normal">Email</th>
              <th className="py-2 pr-4 font-normal">Status</th>
              <th className="py-2 pr-4 font-normal">Password</th>
            </tr>
          </thead>
          <tbody>
            {students.map((s) => (
              <tr key={s.id} className="border-b border-border">
                <td className="py-2.5 pr-4">{s.name}</td>
                <td className="py-2.5 pr-4 text-muted-foreground">{s.email}</td>
                <td className="py-2.5 pr-4">{s.status.replace("_", " ")}</td>
                <td className="py-2.5 pr-4">
                  <Button
                    size="sm"
                    variant="ghost"
                    className="rounded-full"
                    title="Generate a new password"
                    onClick={() => props.onRegenPassword(s.id, s.email)}
                  >
                    <RefreshCw className="size-3.5" /> Regenerate
                  </Button>
                </td>
              </tr>
            ))}
            {!students.length ? (
              <tr>
                <td colSpan={4} className="py-4 text-muted-foreground">
                  No students yet.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-2xl border border-border bg-[var(--stone)] p-4">
      <p className="mono-label text-muted-foreground">{label}</p>
      <p className="mt-1 font-mono text-xl">{value}</p>
    </div>
  );
}
