/**
 * Shared helpers for the Organizer panel.
 * Pure functions + lazy-loaded exporters (xlsx / jspdf stay out of the
 * initial bundle via dynamic import).
 */

// ------------------------------------------------------------ exam status
export type ExamStatus = "Draft" | "Scheduled" | "Live" | "Completed" | "Disabled" | "Archived";

export function examDisplayStatus(e: {
  is_enabled: boolean;
  status?: string | null;
  starts_at: string | null;
  ends_at: string | null;
}): ExamStatus {
  if (!e.is_enabled) return "Disabled";
  const stored = (e.status ?? "").toLowerCase();
  if (stored === "archived") return "Archived";
  if (stored === "draft") return "Draft";
  const now = Date.now();
  if (e.starts_at && now < new Date(e.starts_at).getTime()) return "Scheduled";
  if (e.ends_at && now > new Date(e.ends_at).getTime()) return "Completed";
  if (stored === "completed") return "Completed";
  if (stored === "scheduled") return "Scheduled";
  return "Live";
}

export const STATUS_FILTERS = [
  "All",
  "Draft",
  "Scheduled",
  "Live",
  "Completed",
  "Disabled",
] as const;

// ------------------------------------------------------------------ files
export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024; // 5 MB
export const PARTICIPANT_EXTS = [".csv", ".xlsx", ".xls"] as const;
export const QUESTION_EXTS = [".csv", ".xlsx", ".xls", ".json", ".txt"] as const;

export function assertUploadFile(file: File, allowed: readonly string[]) {
  const name = file.name.toLowerCase();
  const ok = allowed.some((ext) => name.endsWith(ext));
  if (!ok) throw new Error(`Unsupported file type. Allowed: ${allowed.join(", ")}`);
  if (file.size > MAX_UPLOAD_BYTES) {
    throw new Error(`File is too large (${(file.size / 1024 / 1024).toFixed(1)} MB). Max 5 MB.`);
  }
}

export function downloadFile(filename: string, content: string, mime = "text/csv;charset=utf-8;") {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function toCsv(header: string[], rows: (string | number | null | undefined)[][]): string {
  const esc = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  return [header.map(esc).join(","), ...rows.map((r) => r.map(esc).join(","))].join("\n");
}

// ---------------------------------------------------- participant upload
export type ParticipantDraft = {
  name: string;
  email: string;
  phone: string;
  roll_no: string;
  group_name: string;
};

export function participantTemplateCsv(): string {
  return toCsv(
    ["Name", "Email", "Phone", "Roll No", "Group"],
    [
      ["Aarav Sharma", "aarav@example.com", "9876543210", "R001", "Class A"],
      ["Diya Patel", "diya@example.com", "", "R002", "Class A"],
    ],
  );
}

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/** Row-level validation for the pre-import preview table. */
export function validateDraftRow(
  row: ParticipantDraft,
  fileSeen: Set<string>,
  dbEmails: Set<string>,
): string[] {
  const issues: string[] = [];
  if (!row.name.trim()) issues.push("Missing name");
  if (!row.email.trim()) issues.push("Missing email");
  else if (!EMAIL_RE.test(row.email.trim())) issues.push("Invalid email format");
  else {
    const key = row.email.trim().toLowerCase();
    if (fileSeen.has(key)) issues.push("Duplicate email in file");
    else if (dbEmails.has(key)) issues.push("Already registered for this exam");
  }
  return issues;
}

/** Parse a CSV/XLSX/XLS participant file into header + row maps. */
export async function parseParticipantFile(
  file: File,
): Promise<{ headers: string[]; rows: string[][] }> {
  assertUploadFile(file, PARTICIPANT_EXTS);
  const name = file.name.toLowerCase();
  if (name.endsWith(".csv")) {
    const text = await file.text();
    return { headers: [], rows: splitCsvRows(text) };
  }
  const { read, utils } = await import("xlsx");
  const buf = await file.arrayBuffer();
  const wb = read(buf, { type: "array" });
  const firstName = wb.SheetNames[0];
  const sheet = firstName ? wb.Sheets[firstName] : undefined;
  if (!sheet) throw new Error("No worksheet found in that file.");
  const aoa = utils.sheet_to_json<string[]>(sheet, { header: 1, raw: false, defval: "" });
  return {
    headers: [],
    rows: (aoa as string[][]).filter((r) => r.some((c) => String(c ?? "").trim())),
  };
}

function splitCsvRows(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cur = "";
  let inQ = false;
  const pushCell = () => {
    row.push(cur.trim());
    cur = "";
  };
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '"') {
      if (inQ && text[i + 1] === '"') {
        cur += '"';
        i++;
      } else inQ = !inQ;
    } else if ((ch === "\n" || ch === "\r") && !inQ) {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      pushCell();
      if (row.some((c) => c)) rows.push(row);
      row = [];
    } else if (ch === "," && !inQ) {
      pushCell();
    } else {
      cur += ch;
    }
  }
  pushCell();
  if (row.some((c) => c)) rows.push(row);
  return rows;
}

const HEADER_ALIASES: Record<string, string> = {
  name: "name",
  fullname: "name",
  full_name: "name",
  studentname: "name",
  email: "email",
  emailaddress: "email",
  mail: "email",
  phone: "phone",
  mobile: "phone",
  phonenumber: "phone",
  rollno: "roll_no",
  roll_no: "roll_no",
  roll: "roll_no",
  id: "roll_no",
  class: "group_name",
  group: "group_name",
  classgroup: "group_name",
  section: "group_name",
};

function normHeader(h: string): string {
  const key = h.toLowerCase().replace(/[^a-z]/g, "");
  return HEADER_ALIASES[key] ?? "";
}

/** Map raw rows (first row may be a header) to ParticipantDraft objects. */
export function rowsToDrafts(raw: string[][]): ParticipantDraft[] {
  if (!raw.length) return [];
  const first = raw[0] ?? [];
  const mapped = first.map(normHeader);
  const hasHeader = mapped.includes("name") && mapped.includes("email");
  const keys = hasHeader ? mapped : ["name", "email", "phone", "roll_no", "group_name"];
  const body = hasHeader ? raw.slice(1) : raw;
  return body.map((cols) => {
    const get = (k: string) => {
      const i = keys.indexOf(k);
      return i >= 0
        ? String(cols[i] ?? "")
            .trim()
            .replace(/^"|"$/g, "")
        : "";
    };
    return {
      name: get("name"),
      email: get("email").toLowerCase(),
      phone: get("phone"),
      roll_no: get("roll_no"),
      group_name: get("group_name"),
    };
  });
}

// ---------------------------------------------------------------- exports
export async function exportRowsXlsx(filename: string, header: string[], rows: unknown[][]) {
  const { utils, writeFile } = await import("xlsx");
  const ws = utils.aoa_to_sheet([header, ...rows]);
  const wb = utils.book_new();
  utils.book_append_sheet(wb, ws, "Results");
  writeFile(wb, filename);
}

export async function exportRowsPdf(
  title: string,
  filename: string,
  header: string[],
  rows: unknown[][],
) {
  const { jsPDF } = await import("jspdf");
  const { default: autoTable } = await import("jspdf-autotable");
  const doc = new jsPDF({
    orientation: rows[0]?.length && rows[0].length > 6 ? "landscape" : "portrait",
  });
  doc.setFontSize(14);
  doc.text(title, 14, 16);
  autoTable(doc, {
    startY: 22,
    head: [header],
    body: rows.map((r) => r.map((c) => String(c ?? ""))),
    styles: { fontSize: 8 },
    headStyles: { fillColor: [30, 64, 175] },
  });
  doc.save(filename);
}

// ---------------------------------------------------------------- results
export type RankedResult = {
  rank: number;
  id: string;
  name: string;
  email: string;
  marks: number | null;
  totalMarks: number;
  percentage: number | null;
  correct: number | null;
  wrong: number | null;
  unattempted: number | null;
  timeTaken: number | null;
  pass: boolean | null;
  status: string;
  submittedAt: string | null;
};

export function rankResults(
  rows: {
    id: string;
    name: string;
    email: string;
    status: string;
    total_marks: number | null;
    total_correct: number | null;
    total_wrong: number | null;
    total_unattempted: number | null;
    time_taken_seconds: number | null;
    exam_submitted_at: string | null;
  }[],
  totalMarks: number,
  passingMarks: number | null,
): RankedResult[] {
  const done = rows
    .filter((r) => r.status === "completed")
    .map((r) => ({
      rank: 0,
      id: r.id,
      name: r.name,
      email: r.email,
      marks: r.total_marks,
      totalMarks,
      percentage:
        r.total_marks == null || !totalMarks
          ? null
          : Math.round((r.total_marks / totalMarks) * 10000) / 100,
      correct: r.total_correct,
      wrong: r.total_wrong,
      unattempted: r.total_unattempted,
      timeTaken: r.time_taken_seconds,
      pass: r.total_marks == null || passingMarks == null ? null : r.total_marks >= passingMarks,
      status: r.status,
      submittedAt: r.exam_submitted_at,
    }))
    .sort((a, b) => (b.marks ?? -Infinity) - (a.marks ?? -Infinity));
  let last: number | null = null;
  let rank = 0;
  done.forEach((r, i) => {
    if (r.marks !== last) {
      rank = i + 1;
      last = r.marks;
    }
    r.rank = rank;
  });
  return done;
}

// ------------------------------------------------------ question bank io
export function questionsJsonTemplate(exam: {
  title: string;
  marks_correct: number;
  marks_wrong: number;
  duration_minutes: number;
}): string {
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

export function questionsCsvTemplate(): string {
  return [
    "question,option_a,option_b,option_c,option_d,correct,topic",
    '"What is 2 + 2?",3,4,5,6,B,General',
    '"Which is a programming language?",Python,Snake,Ladder,Chair,A,General',
  ].join("\n");
}

/** Convert organizer-friendly CSV into the question-set JSON the server validates. */
export function questionsCsvToJson(
  csvText: string,
  exam: { title: string; marks_correct: number; marks_wrong: number; duration_minutes: number },
): string {
  const lines = csvText
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (!lines.length) throw new Error("CSV is empty.");
  const head = splitCsvLine(lines[0] ?? "").map((h) => h.toLowerCase().replace(/[^a-z_]/g, ""));
  const hasHeader = head.includes("question") && head.includes("option_a");
  const rows = (hasHeader ? lines.slice(1) : lines).map(splitCsvLine);
  if (!rows.length) throw new Error("No question rows found in CSV.");

  const questions = rows.map((cols, idx) => {
    const map: Record<string, string> = {};
    if (hasHeader) {
      head.forEach((h, i) => {
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

/** Read a question file (.json/.csv/.xlsx/.txt) into raw JSON text. */
export async function readQuestionFile(
  file: File,
  exam: { title: string; marks_correct: number; marks_wrong: number; duration_minutes: number },
): Promise<string> {
  assertUploadFile(file, QUESTION_EXTS);
  const name = file.name.toLowerCase();
  if (name.endsWith(".xlsx") || name.endsWith(".xls")) {
    const { read, utils } = await import("xlsx");
    const buf = await file.arrayBuffer();
    const wb = read(buf, { type: "array" });
    const firstName = wb.SheetNames[0];
    const sheet = firstName ? wb.Sheets[firstName] : undefined;
    if (!sheet) throw new Error("No worksheet found in that file.");
    const aoa = utils.sheet_to_json<string[]>(sheet, { header: 1, raw: false, defval: "" });
    const rows = (aoa as string[][]).filter((r) => r.some((c) => String(c ?? "").trim()));
    return questionsCsvToJson(
      rows
        .map((r) => r.map((c) => `"${String(c ?? "").replace(/"/g, '""')}"`).join(","))
        .join("\n"),
      exam,
    );
  }
  const text = await file.text();
  if (name.endsWith(".csv") || name.endsWith(".txt")) return questionsCsvToJson(text, exam);
  return text;
}
