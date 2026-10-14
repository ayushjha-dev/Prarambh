// Server-side Turso (libSQL) client with a Supabase-compatible query facade.
//
// WHY A FACADE: ~170 call sites in src/lib/*.functions.ts were written against
// supabase-js (`db.from(...).select(...).eq(...).maybeSingle()` returning
// `{ data, error }`). Re-implementing that small surface over libSQL keeps the
// application code identical apart from the import path, which is far safer
// than rewriting every query as raw SQL.
//
// Supported (the exact subset this app uses):
//   db.from(t).select(cols)      cols: "*" | "a, b" | "... exams!inner(slug)"
//     .eq / .neq / .in / .is / .order / .limit
//     await                      -> { data: rows, error }
//     .maybeSingle() / .single() -> { data: row | null, error }
//   db.from(t).insert(row)       -> defaults filled, RETURNING via .select()
//   db.from(t).update(patch)     -> filters required, RETURNING via .select()
//   db.from(t).delete()          -> filters required
//   db.from(t).upsert(row, { onConflict })
//   db.rpc("submit_exam" | "increment_violation", args)
//
// Error shape matches supabase-js: unique violations report code "23505"
// (the Postgres code the app already checks).
import { createClient, type Client, type InValue } from "@libsql/client";

// ------------------------------------------------------------ lazy client
let _client: Client | undefined;

export function getLibsql(): Client {
  if (_client) return _client;
  const url = process.env["TURSO_DATABASE_URL"];
  if (!url) {
    throw new Error(
      "Missing TURSO_DATABASE_URL environment variable (libsql://... or file:./local.db).",
    );
  }
  const config: { url: string; authToken?: string } = { url };
  const token = process.env["TURSO_AUTH_TOKEN"];
  if (token) config.authToken = token;
  _client = createClient(config);
  return _client;
}

// -------------------------------------------------------- schema metadata
// Boolean and JSON columns need value coercion in both directions; everything
// else passes through (SQLite INTEGER/REAL/TEXT map onto JS number/string).
type TableMeta = { bool?: string[]; json?: string[] };

const TABLES: Record<string, TableMeta> = {
  question_sets: { bool: ["is_active"], json: ["data"] },
  exams: { bool: ["is_enabled"] },
  participants: { bool: ["is_active"] },
  responses: { bool: ["is_correct"] },
  results: {},
  organizers: {},
};

// created_at exists on every table except responses (which has updated_at).
function hasCreatedAt(table: string): boolean {
  return table !== "responses";
}

// DB defaults Postgres used to generate (gen_random_uuid / now()). SQLite has
// no such defaults, so the facade fills them on insert.
function applyDefaults(table: string, row: Record<string, unknown>): Record<string, unknown> {
  const out = { ...row };
  if (!out["id"] && table !== "results") out["id"] = crypto.randomUUID();
  if (table === "participants" && !out["session_token"]) {
    out["session_token"] = crypto.randomUUID();
  }
  if (hasCreatedAt(table) && out["created_at"] === undefined) {
    out["created_at"] = new Date().toISOString();
  }
  return out;
}

function coerceWrite(table: string, col: string, value: unknown): InValue {
  const meta = TABLES[table];
  if (value === undefined) return null;
  if (meta?.json?.includes(col)) {
    if (value === null) return null;
    return typeof value === "string" ? value : JSON.stringify(value);
  }
  if (meta?.bool?.includes(col)) {
    if (value === null) return null;
    return value ? 1 : 0;
  }
  if (typeof value === "boolean") return value ? 1 : 0;
  if (value instanceof Date) return value.toISOString();
  if (value === null || typeof value === "string" || typeof value === "number") return value;
  return JSON.stringify(value);
}

function coerceRead(table: string, col: string, value: unknown): unknown {
  const meta = TABLES[table];
  if (value === null || value === undefined) return value;
  if (meta?.json?.includes(col)) {
    if (typeof value !== "string") return value;
    try {
      return JSON.parse(value);
    } catch {
      return value;
    }
  }
  if (meta?.bool?.includes(col)) return Boolean(value);
  return value;
}

// -------------------------------------------------------------- helpers
const IDENT = /^[A-Za-z_][A-Za-z0-9_]*$/;
// Embed parts: `exams(slug)`, `exams!inner(slug)`, `exams!exams_fkey(slug)`.
// Group 1 = table, group 2 = optional hint ("inner" => INNER join), group 3 = columns.
const EMBED = /^([A-Za-z_][A-Za-z0-9_]*)(?:!([A-Za-z0-9_]+))?\((.+)\)$/;

function assertIdent(name: string): string {
  if (!IDENT.test(name)) throw new Error(`Unsafe SQL identifier: ${name}`);
  return name;
}

type Err = { message: string; code?: string } | null;
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- rows mirror the legacy supabase-js result shape that existing call sites consume
type Result = { data: any; error: Err };

/** Map libSQL exceptions onto the supabase-js error shape the app expects. */
function toError(e: unknown): Err {
  const message = e instanceof Error ? e.message : String(e);
  const err: { message: string; code?: string } = { message };
  if (/UNIQUE constraint failed|SQLITE_CONSTRAINT_UNIQUE/i.test(message)) err.code = "23505";
  return err;
}

type Filter = { sql: string; args: InValue[] };
type Op = "select" | "insert" | "update" | "delete" | "upsert";
type Terminal = false | "single" | "maybe";

// ------------------------------------------------------------ query builder
class Query implements PromiseLike<Result> {
  private table: string;
  private op: Op = "select";
  private payload?: Record<string, unknown>;
  private onConflict: string[] | undefined;
  private cols: string | null = null; // projection / RETURNING list
  private embed: { table: string; cols: string[]; inner: boolean } | null = null;
  private filters: Filter[] = [];
  private orderBy: { col: string; asc: boolean } | null = null;
  private limitN: number | null = null;
  private terminal: Terminal = false;

  constructor(table: string) {
    this.table = assertIdent(table);
  }

  // -- operations ---------------------------------------------------------
  select(cols: string): this {
    this.cols = cols;
    this.embed = null;
    for (const raw of cols.split(",")) {
      const m = raw.trim().match(EMBED);
      if (m)
        this.embed = {
          table: assertIdent(m[1]!),
          cols: m[3]!.split(",").map((c) => assertIdent(c.trim())),
          inner: m[2] === "inner",
        };
    }
    return this;
  }

  insert(row: Record<string, unknown>): this {
    this.op = "insert";
    this.payload = row;
    return this;
  }

  update(patch: Record<string, unknown>): this {
    this.op = "update";
    this.payload = patch;
    return this;
  }

  delete(): this {
    this.op = "delete";
    return this;
  }

  upsert(row: Record<string, unknown>, opts?: { onConflict?: string }): this {
    this.op = "upsert";
    this.payload = row;
    this.onConflict = opts?.onConflict?.split(",").map((s) => s.trim());
    return this;
  }

  // -- filters ------------------------------------------------------------
  eq(col: string, value: unknown): this {
    if (value === null || value === undefined) return this.is(col, null);
    const c = assertIdent(col);
    this.filters.push({ sql: `"${c}" = ?`, args: [coerceWrite(this.table, c, value)] });
    return this;
  }

  neq(col: string, value: unknown): this {
    if (value === null || value === undefined) return this.is(col, "not.null");
    const c = assertIdent(col);
    this.filters.push({ sql: `"${c}" <> ?`, args: [coerceWrite(this.table, c, value)] });
    return this;
  }

  is(col: string, value: unknown): this {
    const c = assertIdent(col);
    if (value === "not.null") this.filters.push({ sql: `"${c}" IS NOT NULL`, args: [] });
    else this.filters.push({ sql: `"${c}" IS NULL`, args: [] });
    return this;
  }

  in(col: string, values: unknown[]): this {
    const c = assertIdent(col);
    if (!values.length) {
      this.filters.push({ sql: "0 = 1", args: [] });
      return this;
    }
    this.filters.push({
      sql: `"${c}" IN (${values.map(() => "?").join(", ")})`,
      args: values.map((v) => coerceWrite(this.table, c, v)),
    });
    return this;
  }

  order(col: string, opts?: { ascending?: boolean }): this {
    this.orderBy = { col: assertIdent(col), asc: opts?.ascending !== false };
    return this;
  }

  limit(n: number): this {
    this.limitN = n;
    return this;
  }

  // -- terminals ----------------------------------------------------------
  single(): Promise<Result> {
    this.terminal = "single";
    return this.execute();
  }

  maybeSingle(): Promise<Result> {
    this.terminal = "maybe";
    return this.execute();
  }

  then<T1 = Result, T2 = never>(
    onfulfilled?: ((value: Result) => T1 | PromiseLike<T1>) | null,
    onrejected?: ((reason: unknown) => T2 | PromiseLike<T2>) | null,
  ): Promise<T1 | T2> {
    return this.execute().then(onfulfilled, onrejected);
  }

  // -- execution ----------------------------------------------------------
  private whereClause(): { sql: string; args: InValue[] } {
    if (!this.filters.length) return { sql: "", args: [] };
    const args: InValue[] = [];
    const parts = this.filters.map((f) => {
      args.push(...f.args);
      return f.sql;
    });
    return { sql: ` WHERE ${parts.join(" AND ")}`, args };
  }

  private returning(): string {
    if (!this.cols) return "";
    return ` RETURNING ${this.projection()}`;
  }

  /** Projection without embed tokens (embeds are nested after the query). */
  private projection(): string {
    if (!this.cols || this.cols.trim() === "*") return "*";
    const parts: string[] = [];
    for (const raw of this.cols.split(",")) {
      const t = raw.trim();
      if (!t) continue;
      if (EMBED.test(t)) continue;
      parts.push(`"${assertIdent(t)}"`);
    }
    return parts.length ? parts.join(", ") : "*";
  }

  private finish(res: { rows: Record<string, unknown>[]; columns: string[] }): Result {
    const rows = res.rows.map((row) => {
      const out: Record<string, unknown> = {};
      for (const c of res.columns) out[c] = coerceRead(this.table, c, row[c]);
      return out;
    });
    if (this.terminal === "single") {
      if (rows.length !== 1) {
        return {
          data: null,
          error: { message: `Expected exactly one row, got ${rows.length}`, code: "PGRST116" },
        };
      }
      return { data: rows[0], error: null };
    }
    if (this.terminal === "maybe") return { data: rows[0] ?? null, error: null };
    return { data: rows, error: null };
  }

  async execute(): Promise<Result> {
    try {
      const db = getLibsql();
      if (this.op === "select") return await this.runSelect(db);
      if (this.op === "insert") return await this.runInsert(db);
      if (this.op === "upsert") return await this.runUpsert(db);
      if (this.op === "update") return await this.runUpdate(db);
      return await this.runDelete(db);
    } catch (e) {
      return { data: null, error: toError(e) };
    }
  }

  private async runSelect(db: Client): Promise<Result> {
    const where = this.whereClause();
    let sql = `SELECT ${this.projection()} FROM "${this.table}"${where.sql}`;
    if (this.orderBy) sql += ` ORDER BY "${this.orderBy.col}" ${this.orderBy.asc ? "ASC" : "DESC"}`;
    if (this.limitN != null) {
      sql += " LIMIT ?";
      where.args.push(this.limitN);
    }
    const res = await db.execute({ sql, args: where.args });
    let result = this.finish({ rows: res.rows as Record<string, unknown>[], columns: res.columns });

    // Embedded resource (e.g. "exams!inner(slug)"): fetch parents afterwards
    // and nest them; `!inner` drops rows whose parent is missing.
    if (this.embed && Array.isArray(result.data)) {
      result = { ...result, data: await this.attachEmbed(db, result.data) };
    } else if (this.embed && result.data) {
      const nested = await this.attachEmbed(db, [result.data]);
      result = {
        data: nested[0] ?? (this.terminal === "single" ? null : result.data),
        error: nested.length ? null : { message: "inner join found no parent", code: "PGRST116" },
      };
      if (this.terminal === "maybe" && !nested.length) result = { data: null, error: null };
    }
    return result;
  }

  private async attachEmbed(
    db: Client,
    rows: Array<Record<string, unknown>>,
  ): Promise<Array<Record<string, unknown>>> {
    if (!rows.length) return [];
    const embed = this.embed!;
    // FK naming: participants.exam_id -> exams (table "exams" -> "exam_id").
    const fk = `${embed.table.replace(/s$/, "")}_id`;
    const ids = [...new Set(rows.map((r) => r[fk]).filter(Boolean))] as string[];
    if (!ids.length) return [];
    const proj = embed.cols.map((c) => `"${c}"`).join(", ");
    const res = await db.execute({
      sql: `SELECT "id", ${proj} FROM "${embed.table}" WHERE "id" IN (${ids.map(() => "?").join(", ")})`,
      args: ids,
    });
    const parents = res.rows as Array<Record<string, unknown>>;
    const byId = new Map(parents.map((r) => [String(r["id"]), r] as const));
    const out = [];
    for (const row of rows) {
      const parent = row[fk] ? byId.get(String(row[fk])) : undefined;
      if (!parent) {
        // `!inner` drops rows without a parent; plain embeds keep them with null.
        if (embed.inner) continue;
        out.push({ ...row, [embed.table]: null });
        continue;
      }
      const nested: Record<string, unknown> = {};
      for (const c of embed.cols) nested[c] = parent[c];
      out.push({ ...row, [embed.table]: nested });
    }
    return out;
  }

  private async runInsert(db: Client): Promise<Result> {
    const row = applyDefaults(this.table, this.payload!);
    const cols = Object.keys(row).map(assertIdent);
    const sql =
      `INSERT INTO "${this.table}" (${cols.map((c) => `"${c}"`).join(", ")}) ` +
      `VALUES (${cols.map(() => "?").join(", ")})${this.returning()}`;
    const args = cols.map((c) => coerceWrite(this.table, c, row[c]));
    const res = await db.execute({ sql, args });
    if (!this.cols) return { data: null, error: null };
    return this.finish({ rows: res.rows as Record<string, unknown>[], columns: res.columns });
  }

  private async runUpsert(db: Client): Promise<Result> {
    const row = applyDefaults(this.table, this.payload!);
    const cols = Object.keys(row).map(assertIdent);
    const conflict = (this.onConflict ?? []).map(assertIdent);
    const updates = cols.filter((c) => !conflict.includes(c));
    const setSql = updates.length
      ? updates.map((c) => `"${c}" = excluded."${c}"`).join(", ")
      : `"${cols[0]}" = excluded."${cols[0]}"`;
    const sql =
      `INSERT INTO "${this.table}" (${cols.map((c) => `"${c}"`).join(", ")}) ` +
      `VALUES (${cols.map(() => "?").join(", ")})` +
      (conflict.length
        ? ` ON CONFLICT (${conflict.map((c) => `"${c}"`).join(", ")}) DO UPDATE SET ${setSql}`
        : "") +
      this.returning();
    const args = cols.map((c) => coerceWrite(this.table, c, row[c]));
    const res = await db.execute({ sql, args });
    if (!this.cols) return { data: null, error: null };
    return this.finish({ rows: res.rows as Record<string, unknown>[], columns: res.columns });
  }

  private async runUpdate(db: Client): Promise<Result> {
    const patch = { ...this.payload! };
    const cols = Object.keys(patch).map(assertIdent);
    if (!cols.length) return { data: null, error: { message: "Empty update patch" } };
    const where = this.whereClause();
    if (!where.sql) return { data: null, error: { message: "Refusing unfiltered UPDATE" } };
    const args: InValue[] = cols.map((c) => coerceWrite(this.table, c, patch[c]));
    args.push(...where.args);
    const sql =
      `UPDATE "${this.table}" SET ${cols.map((c) => `"${c}" = ?`).join(", ")}${where.sql}` +
      this.returning();
    const res = await db.execute({ sql, args });
    if (!this.cols) return { data: null, error: null };
    return this.finish({ rows: res.rows as Record<string, unknown>[], columns: res.columns });
  }

  private async runDelete(db: Client): Promise<Result> {
    const where = this.whereClause();
    if (!where.sql) return { data: null, error: { message: "Refusing unfiltered DELETE" } };
    const sql = `DELETE FROM "${this.table}"${where.sql}${this.returning()}`;
    const res = await db.execute({ sql, args: where.args });
    if (!this.cols) return { data: null, error: null };
    return this.finish({ rows: res.rows as Record<string, unknown>[], columns: res.columns });
  }
}

// ------------------------------------------------------------- rpc dispatch
// Supabase RPCs (plpgsql) are ported to TypeScript — see rpc.ts.
async function rpc(name: string, args: Record<string, unknown>): Promise<Result> {
  try {
    const { runRpc } = await import("./rpc");
    return await runRpc(name, args);
  } catch (e) {
    return { data: null, error: toError(e) };
  }
}

// -------------------------------------------------------------- entry point
export const db = {
  from(table: string): Query {
    return new Query(table);
  },
  rpc,
};
