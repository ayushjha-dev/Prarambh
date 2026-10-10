import { useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { Download, MailCheck, Send, Upload } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { ConfirmModal } from "./ConfirmModal";
import {
  adminBulkSendCredentials,
  adminListAllParticipants,
  type AdminExam,
} from "@/lib/admin.functions";
import {
  downloadFile,
  parseParticipantFile,
  rowsToDrafts,
  toCsv,
  validateDraftRow,
} from "@/lib/organizer-utils";

const MAX_ROWS = 1000;

type SendDraft = { name: string; email: string; roll_no: string; issues: string[] };

function sendTemplateCsv(): string {
  return toCsv(
    ["Name", "Email", "Roll No"],
    [
      ["Aarav Sharma", "aarav@example.com", "R001"],
      ["Diya Patel", "diya@example.com", "R002"],
    ],
  );
}

/**
 * Bulk Send Credentials: pick exam → upload CSV/Excel → preview with
 * row validation → confirm → server creates/updates credentials and emails
 * each student their password + exam link. Summary at the end.
 */
export function BulkSendView(props: {
  exams: AdminExam[];
  examId: string;
  onExamChange: (id: string) => void;
}) {
  const { exams, examId } = props;
  const targetExam = exams.find((e) => e.id === examId) ?? null;

  const sendFn = useServerFn(adminBulkSendCredentials);
  const listAllFn = useServerFn(adminListAllParticipants);
  const { data: dirData } = useQuery({
    queryKey: ["organizer-participants"],
    queryFn: () => listAllFn(),
  });
  const directory = useMemo(() => dirData?.students ?? [], [dirData]);

  const [drafts, setDrafts] = useState<SendDraft[]>([]);
  const [fileName, setFileName] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [sending, setSending] = useState(false);
  const [summary, setSummary] = useState<{
    total: number;
    sent: { email: string }[];
    failed: { email: string; reason: string }[];
  } | null>(null);

  const valid = drafts.filter((d) => !d.issues.length);

  async function handleFile(file: File) {
    if (!targetExam) {
      toast.error("Select an exam first.");
      return;
    }
    try {
      const { rows } = await parseParticipantFile(file);
      if (rows.length > MAX_ROWS + 1) {
        toast.error(`Too many rows (max ${MAX_ROWS}). Split the file and try again.`);
        return;
      }
      const parsed = rowsToDrafts(rows);
      if (!parsed.length) {
        toast.error("No rows found in that file.");
        return;
      }
      const fileEmails = new Set<string>();
      const fileRolls = new Set<string>();
      const examRows = directory.filter((d) => d.exam_id === targetExam.id);
      const dbEmails = new Set(examRows.map((d) => d.email.toLowerCase()));
      const dbRolls = new Set(examRows.map((d) => (d.roll_no ?? "").trim()).filter(Boolean));
      setDrafts(
        parsed.map((d) => {
          const issues = validateDraftRow(
            { name: d.name, email: d.email, phone: "", roll_no: d.roll_no, group_name: "" },
            fileEmails,
            dbEmails,
          );
          if (!d.roll_no.trim()) issues.push("Missing roll no");
          else {
            if (fileRolls.has(d.roll_no.trim())) issues.push("Duplicate roll no in file");
            else if (dbRolls.has(d.roll_no.trim())) {
              // Updating an existing roll is allowed server-side; not an error.
            }
          }
          if (d.email) fileEmails.add(d.email.toLowerCase());
          if (d.roll_no) fileRolls.add(d.roll_no.trim());
          return { name: d.name, email: d.email, roll_no: d.roll_no, issues };
        }),
      );
      setFileName(file.name);
      setSummary(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not read that file.");
    }
  }

  async function handleSendAll() {
    if (!targetExam || !valid.length) return;
    setSending(true);
    try {
      const res = await sendFn({
        data: {
          examId: targetExam.id,
          students: valid.map((d) => ({ name: d.name, email: d.email, roll_no: d.roll_no })),
        },
      });
      setSummary({ total: valid.length, sent: res.sent, failed: res.failed });
      setDrafts([]);
      setFileName(null);
      if (res.failed.length === 0)
        toast.success(`Credentials sent to ${res.sent.length} student(s).`);
      else
        toast.warning(`Sent ${res.sent.length}, failed ${res.failed.length}. See summary below.`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Bulk send failed.");
    } finally {
      setSending(false);
      setConfirming(false);
    }
  }

  return (
    <div>
      <div className="flex flex-wrap items-center gap-3">
        <Label className="mono-label text-muted-foreground">Exam (required)</Label>
        {exams.length ? (
          <select
            value={examId}
            onChange={(e) => props.onExamChange(e.target.value)}
            className="h-10 min-w-52 rounded-xl border border-input bg-background px-3 text-sm"
          >
            <option value="">Select exam…</option>
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

      <div className="mt-4 rounded-[22px] border border-border p-5">
        <p className="mono-label text-muted-foreground">
          Upload students (.csv, .xlsx, .xls — max 5 MB)
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <label className="inline-flex h-10 min-h-11 cursor-pointer items-center gap-2 rounded-[32px] border border-input bg-background px-4 text-sm font-medium hover:bg-accent">
            <Upload className="size-4" /> Choose file
            <input
              type="file"
              accept=".csv,.xlsx,.xls"
              className="hidden"
              disabled={!targetExam}
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void handleFile(file);
                e.target.value = "";
              }}
            />
          </label>
          {fileName ? <span className="text-xs text-muted-foreground">{fileName}</span> : null}
          <Button
            size="sm"
            variant="secondary"
            className="rounded-full"
            onClick={() => downloadFile("bulk-send-template.csv", sendTemplateCsv())}
          >
            <Download className="size-3.5" /> Sample template
          </Button>
        </div>
        <p className="mt-2 text-xs text-muted-foreground">
          Columns: Name, Email, Roll No (required). Headers match case-insensitively. Existing
          emails/rolls are updated, not duplicated.
        </p>
      </div>

      {drafts.length ? (
        <section className="mt-4 rounded-[22px] border border-border p-5">
          <h2 className="text-xl">
            Preview ({drafts.length} rows · {valid.length} will be sent)
          </h2>
          <div className="mt-3 max-h-72 overflow-auto">
            <table className="w-full min-w-[560px] text-left text-sm">
              <thead>
                <tr className="mono-label border-b border-border text-muted-foreground">
                  <th className="py-2 pr-3 font-normal">Name</th>
                  <th className="py-2 pr-3 font-normal">Email</th>
                  <th className="py-2 pr-3 font-normal">Roll No</th>
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
                    <td className="py-2 pr-3">{d.roll_no || "—"}</td>
                    <td className="py-2 text-xs text-destructive">{d.issues.join("; ") || "OK"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="mt-3 flex gap-2">
            <Button
              disabled={!valid.length || sending}
              onClick={() => setConfirming(true)}
              className="min-h-11 rounded-[32px]"
            >
              <Send className="size-4" /> {sending ? "Sending…" : `Send All (${valid.length})`}
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

      {summary ? (
        <section className="mt-4 rounded-[22px] border border-border p-5">
          <h2 className="flex items-center gap-2 text-xl">
            <MailCheck className="size-5 text-brand" /> Send summary
          </h2>
          <div className="mt-3 grid grid-cols-3 gap-3">
            <div className="rounded-2xl border border-border p-3">
              <p className="mono-label text-muted-foreground">Total</p>
              <p className="font-mono text-xl">{summary.total}</p>
            </div>
            <div className="rounded-2xl border border-border p-3">
              <p className="mono-label text-muted-foreground">Sent</p>
              <p className="font-mono text-xl text-brand">{summary.sent.length}</p>
            </div>
            <div className="rounded-2xl border border-border p-3">
              <p className="mono-label text-muted-foreground">Failed</p>
              <p className="font-mono text-xl text-destructive">{summary.failed.length}</p>
            </div>
          </div>
          {summary.failed.length ? (
            <div className="mt-3 max-h-48 overflow-auto">
              <table className="w-full min-w-[400px] text-left text-sm">
                <tbody>
                  {summary.failed.map((f) => (
                    <tr key={f.email} className="border-b border-border">
                      <td className="py-2 pr-3">{f.email}</td>
                      <td className="py-2 text-xs text-destructive">{f.reason}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
        </section>
      ) : null}

      <ConfirmModal
        open={confirming}
        title={`Send credentials to ${valid.length} student(s) for ${targetExam?.title ?? "this exam"}?`}
        body="Each student gets a fresh password and the exam link by email. Invalid rows are excluded."
        confirmLabel={sending ? "Sending…" : "Send All"}
        pending={sending}
        onCancel={() => {
          if (!sending) setConfirming(false);
        }}
        onConfirm={() => void handleSendAll()}
      />
    </div>
  );
}
