import { useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { Download } from "lucide-react";
import { toast } from "sonner";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  adminDashboard,
  adminListExams,
  adminParticipantDetail,
  type AdminRow,
} from "@/lib/admin.functions";
import { formatDuration } from "@/lib/exam-session";
import {
  downloadFile,
  exportRowsPdf,
  exportRowsXlsx,
  rankResults,
  toCsv,
} from "@/lib/organizer-utils";

/** Results section: picker, rank table, summaries, charts, exports, answer sheets. */
type AnswerRow = {
  id: number;
  topic: string;
  question: string;
  selected: string | null;
  correct: string;
  marks: number;
};
export function ResultsView(props: { initialExamId?: string | null }) {
  const listExamsFn = useServerFn(adminListExams);
  const dashboardFn = useServerFn(adminDashboard);
  const detailFn = useServerFn(adminParticipantDetail);

  const { data: examsData } = useQuery({ queryKey: ["admin-exams"], queryFn: () => listExamsFn() });
  const exams = useMemo(() => examsData?.exams ?? [], [examsData]);

  const [examId, setExamId] = useState<string>(props.initialExamId ?? "");
  const selectedId = examId || props.initialExamId || exams[0]?.id || "";
  const selectedExam = exams.find((e) => e.id === selectedId) ?? null;

  const { data, isLoading } = useQuery({
    queryKey: ["admin-dashboard", selectedId || "legacy"],
    queryFn: () => dashboardFn({ data: selectedId ? { examId: selectedId } : {} }),
    enabled: true,
  });

  const [detailId, setDetailId] = useState<string | null>(null);
  const { data: detail } = useQuery({
    queryKey: ["admin-detail", detailId],
    queryFn: () => {
      if (!detailId) throw new Error("No participant selected");
      return detailFn({ data: { participantId: detailId } });
    },
    enabled: Boolean(detailId),
  });

  const [search, setSearch] = useState("");
  const [passFilter, setPassFilter] = useState<"All" | "Pass" | "Fail">("All");
  const [sortMode, setSortMode] = useState<"rank" | "marks">("rank");

  const rows = useMemo(() => (data?.rows ?? []) as AdminRow[], [data]);
  const totalMarks =
    data?.examMeta?.total_marks ??
    (selectedExam && selectedExam.question_count
      ? Math.round(
          selectedExam.questions_marks || selectedExam.question_count * selectedExam.marks_correct,
        )
      : 0);
  const passing = data?.examMeta?.passing_marks ?? selectedExam?.passing_marks ?? null;

  const ranked = useMemo(
    () =>
      rankResults(rows, totalMarks, passing).filter(
        (r) =>
          (!search ||
            r.name.toLowerCase().includes(search.toLowerCase()) ||
            r.email.toLowerCase().includes(search.toLowerCase())) &&
          (passFilter === "All" || (passFilter === "Pass" ? r.pass : r.pass === false)),
      ),
    [rows, totalMarks, passing, search, passFilter],
  );
  const sorted = useMemo(
    () =>
      [...ranked].sort((a, b) =>
        sortMode === "rank" ? a.rank - b.rank : (b.marks ?? -Infinity) - (a.marks ?? -Infinity),
      ),
    [ranked, sortMode],
  );

  const completed = ranked.filter((r) => r.marks != null);
  const summary = {
    total: rows.filter((r) => r.status === "completed").length,
    highest: completed.length ? Math.max(...completed.map((r) => r.marks ?? 0)) : 0,
    average: completed.length
      ? Math.round((completed.reduce((s, r) => s + (r.marks ?? 0), 0) / completed.length) * 100) /
        100
      : 0,
    passPct:
      passing == null || !completed.length
        ? null
        : Math.round(
            (completed.filter((r) => (r.marks ?? 0) >= (passing ?? 0)).length / completed.length) *
              10000,
          ) / 100,
  };

  const distribution = useMemo(() => {
    const buckets = ["0–20", "20–40", "40–60", "60–80", "80–100"].map((label) => ({
      label,
      count: 0,
    }));
    completed.forEach((r) => {
      const pct = r.percentage ?? 0;
      const i = Math.min(4, Math.floor(pct / 20));
      buckets[i]!.count += 1;
    });
    return buckets;
  }, [completed]);

  const passFail = useMemo(() => {
    if (passing == null) return [];
    const pass = completed.filter((r) => (r.marks ?? 0) >= passing).length;
    return [
      { name: "Pass", value: pass },
      { name: "Fail", value: completed.length - pass },
    ];
  }, [completed, passing]);

  function exportRows(): { header: string[]; body: (string | number | null)[][] } {
    const header = [
      "Rank",
      "Name",
      "Email",
      "Marks",
      "Total",
      "Percentage",
      "Correct",
      "Wrong",
      "Unattempted",
      "Time Taken (s)",
      "Pass/Fail",
    ];
    const body = sorted.map((r) => [
      r.rank,
      r.name,
      r.email,
      r.marks,
      r.totalMarks,
      r.percentage,
      r.correct,
      r.wrong,
      r.unattempted,
      r.timeTaken,
      r.pass == null ? "—" : r.pass ? "Pass" : "Fail",
    ]);
    return { header, body };
  }

  function exportCsv() {
    const { header, body } = exportRows();
    downloadFile(`${selectedExam?.slug ?? "results"}-results.csv`, toCsv(header, body));
    toast.success("Results exported as CSV.");
  }

  async function exportXlsx() {
    try {
      const { header, body } = exportRows();
      await exportRowsXlsx(`${selectedExam?.slug ?? "results"}-results.xlsx`, header, body);
      toast.success("Results exported as Excel.");
    } catch {
      toast.error("Excel export failed.");
    }
  }

  async function exportPdf() {
    try {
      const { header, body } = exportRows();
      await exportRowsPdf(
        `Results — ${selectedExam?.title ?? ""}`,
        `${selectedExam?.slug ?? "results"}-results.pdf`,
        header,
        body,
      );
      toast.success("Results exported as PDF.");
    } catch {
      toast.error("PDF export failed.");
    }
  }

  return (
    <div className="mx-auto max-w-6xl px-5 py-6">
      <h1 className="text-2xl">Results</h1>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <Label className="mono-label text-muted-foreground">Exam</Label>
        {exams.length ? (
          <select
            value={selectedId}
            onChange={(e) => setExamId(e.target.value)}
            className="h-10 min-w-52 rounded-xl border border-input bg-background px-3 text-sm"
          >
            {exams.map((e) => (
              <option key={e.id} value={e.id}>
                {e.title}
              </option>
            ))}
          </select>
        ) : (
          <span className="text-sm text-muted-foreground">No exams yet — create one first.</span>
        )}
      </div>

      {!selectedId ? null : (
        <>
          <div className="mt-5 grid grid-cols-2 gap-3 md:grid-cols-4">
            <div className="rounded-2xl border border-border bg-card p-4">
              <p className="mono-label text-muted-foreground">Participants</p>
              <p className="mt-1 font-mono text-xl">{summary.total}</p>
            </div>
            <div className="rounded-2xl border border-border bg-card p-4">
              <p className="mono-label text-muted-foreground">Highest Score</p>
              <p className="mt-1 font-mono text-xl">{summary.highest}</p>
            </div>
            <div className="rounded-2xl border border-border bg-card p-4">
              <p className="mono-label text-muted-foreground">Average Score</p>
              <p className="mt-1 font-mono text-xl">{summary.average}</p>
            </div>
            <div className="rounded-2xl border border-border bg-card p-4">
              <p className="mono-label text-muted-foreground">Pass %</p>
              <p className="mt-1 font-mono text-xl">
                {summary.passPct == null ? "—" : `${summary.passPct}%`}
              </p>
            </div>
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-2">
            <Button size="sm" variant="secondary" className="rounded-full" onClick={exportCsv}>
              <Download className="size-3.5" /> CSV
            </Button>
            <Button
              size="sm"
              variant="secondary"
              className="rounded-full"
              onClick={() => void exportXlsx()}
            >
              <Download className="size-3.5" /> Excel
            </Button>
            <Button
              size="sm"
              variant="secondary"
              className="rounded-full"
              onClick={() => void exportPdf()}
            >
              <Download className="size-3.5" /> PDF
            </Button>
          </div>

          {completed.length ? (
            <div className="mt-4 grid gap-4 lg:grid-cols-2">
              <div className="rounded-[22px] border border-border p-5">
                <h2 className="text-lg">Score distribution (% bands)</h2>
                <div className="mt-3 h-52">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart
                      data={distribution}
                      margin={{ top: 4, right: 8, bottom: 0, left: -16 }}
                    >
                      <CartesianGrid strokeDasharray="3 3" opacity={0.4} />
                      <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                      <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
                      <Tooltip />
                      <Bar
                        dataKey="count"
                        name="Students"
                        fill="var(--color-brand)"
                        radius={[6, 6, 0, 0]}
                      />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>
              <div className="rounded-[22px] border border-border p-5">
                <h2 className="text-lg">
                  Pass vs Fail{" "}
                  {passing == null ? "(set passing marks to enable)" : `(≥ ${passing})`}
                </h2>
                {passing == null || !passFail.length ? (
                  <p className="mt-3 text-sm text-muted-foreground">No data.</p>
                ) : (
                  <div className="mt-3 h-52">
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie data={passFail} dataKey="value" nameKey="name" outerRadius={80} label>
                          <Cell fill="var(--color-brand)" />
                          <Cell fill="var(--color-destructive)" />
                        </Pie>
                        <Tooltip />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                )}
              </div>
            </div>
          ) : null}

          <div className="mt-4 flex flex-wrap items-center gap-3">
            <Input
              placeholder="Search by name or email"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="h-10 max-w-xs rounded-xl"
            />
            <select
              value={passFilter}
              onChange={(e) => setPassFilter(e.target.value as typeof passFilter)}
              className="h-10 rounded-xl border border-input bg-background px-3 text-sm"
              aria-label="Filter pass/fail"
            >
              {(["All", "Pass", "Fail"] as const).map((s) => (
                <option key={s} value={s}>
                  {s === "All" ? "Pass/Fail: All" : s}
                </option>
              ))}
            </select>
            <select
              value={sortMode}
              onChange={(e) => setSortMode(e.target.value as typeof sortMode)}
              className="h-10 rounded-xl border border-input bg-background px-3 text-sm"
              aria-label="Sort"
            >
              <option value="rank">Sort: Rank</option>
              <option value="marks">Sort: Marks</option>
            </select>
          </div>

          <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-[1000px] text-left text-sm">
              <thead>
                <tr className="mono-label border-b border-border text-muted-foreground">
                  {[
                    "Rank",
                    "Name",
                    "Email",
                    "Marks",
                    "Total",
                    "%",
                    "Correct",
                    "Wrong",
                    "Unatt.",
                    "Time",
                    "Result",
                  ].map((h) => (
                    <th key={h} className="py-3 pr-4 font-normal">
                      {h}
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
                ) : !sorted.length ? (
                  <tr>
                    <td className="py-6 text-muted-foreground" colSpan={11}>
                      No results yet for this exam.
                    </td>
                  </tr>
                ) : (
                  sorted.map((r) => (
                    <tr
                      key={r.id}
                      onClick={() => setDetailId(r.id)}
                      className="cursor-pointer border-b border-border hover:bg-secondary"
                    >
                      <td className="py-3 pr-4 font-mono font-semibold">#{r.rank}</td>
                      <td className="py-3 pr-4">{r.name}</td>
                      <td className="py-3 pr-4 text-muted-foreground">{r.email}</td>
                      <td className="py-3 pr-4 font-mono">{r.marks ?? "—"}</td>
                      <td className="py-3 pr-4">{r.totalMarks}</td>
                      <td className="py-3 pr-4">{r.percentage ?? "—"}</td>
                      <td className="py-3 pr-4">{r.correct ?? "—"}</td>
                      <td className="py-3 pr-4">{r.wrong ?? "—"}</td>
                      <td className="py-3 pr-4">{r.unattempted ?? "—"}</td>
                      <td className="py-3 pr-4">{formatDuration(r.timeTaken)}</td>
                      <td className="py-3 pr-4">
                        {r.pass == null ? "—" : r.pass ? "Pass" : "Fail"}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </>
      )}

      {detailId && detail ? (
        <div className="fixed inset-0 z-50 flex justify-end bg-black/40">
          <div className="h-full w-full max-w-2xl overflow-y-auto bg-card p-7">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="text-2xl">{detail.participant.name}</h2>
                <p className="mono-label text-muted-foreground">{detail.participant.email}</p>
              </div>
              <div className="flex gap-2">
                <Button
                  variant="secondary"
                  className="rounded-[32px]"
                  onClick={() => {
                    const header = [
                      "Question ID",
                      "Topic",
                      "Question",
                      "Selected",
                      "Correct",
                      "Marks",
                    ];
                    const lines = detail.questions.map((q: AnswerRow) =>
                      [
                        q.id,
                        q.topic,
                        q.question.replace(/\n/g, " "),
                        q.selected ?? "",
                        q.correct,
                        q.marks,
                      ]
                        .map((v: string | number | null) => `"${String(v).replace(/"/g, '""')}"`)
                        .join(","),
                    );
                    downloadFile(
                      `answer-sheet-${detail.participant.email}.csv`,
                      [header.join(","), ...lines].join("\n"),
                    );
                  }}
                >
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
            <div className="mt-6 space-y-4">
              {detail.questions.map((q: AnswerRow) => (
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
    </div>
  );
}
