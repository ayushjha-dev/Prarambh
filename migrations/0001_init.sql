-- Prarambh schema on SQLite/libSQL (Turso).
-- Port of supabase/migrations/* (Postgres) to SQLite:
--   uuid -> TEXT (generated app-side), timestamptz -> TEXT ISO-8601,
--   jsonb -> TEXT (JSON document), boolean -> INTEGER 0/1,
--   plpgsql functions/triggers -> TypeScript (src/integrations/turso/rpc.ts).
-- RLS/grants are gone: every query already runs server-side with the
-- service role equivalent; nothing reaches the DB from the browser.

CREATE TABLE question_sets (
  id TEXT PRIMARY KEY,
  data TEXT NOT NULL, -- JSON document { meta, questions }
  is_active INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
-- At most one globally-active set (partial unique index, as in Postgres).
CREATE UNIQUE INDEX question_sets_one_active ON question_sets (is_active) WHERE is_active = 1;

CREATE TABLE exams (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  subject TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  duration_minutes INTEGER NOT NULL DEFAULT 45
    CHECK (duration_minutes > 0 AND duration_minutes <= 600),
  marks_correct REAL NOT NULL DEFAULT 2,
  marks_wrong REAL NOT NULL DEFAULT -0.5,
  total_marks REAL,
  passing_marks REAL,
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'scheduled', 'live', 'completed', 'archived')),
  starts_at TEXT,
  ends_at TEXT,
  is_enabled INTEGER NOT NULL DEFAULT 1,
  question_set_id TEXT REFERENCES question_sets (id) ON DELETE SET NULL,
  created_by TEXT,
  created_at TEXT NOT NULL,
  CHECK (starts_at IS NULL OR ends_at IS NULL OR starts_at < ends_at)
);
CREATE INDEX exams_status_idx ON exams (status);
CREATE INDEX exams_subject_idx ON exams (subject);
CREATE INDEX exams_created_idx ON exams (created_at DESC);

CREATE TABLE participants (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  session_token TEXT NOT NULL UNIQUE,
  question_set_id TEXT REFERENCES question_sets (id),
  exam_id TEXT REFERENCES exams (id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  exam_started_at TEXT,
  exam_submitted_at TEXT,
  time_taken_seconds INTEGER,
  submit_reason TEXT
    CHECK (submit_reason IS NULL OR submit_reason IN ('manual', 'timeout', 'violation')),
  tab_violation_count INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'not_started'
    CHECK (status IN ('not_started', 'in_progress', 'completed')),
  phone TEXT NOT NULL DEFAULT '',
  roll_no TEXT NOT NULL DEFAULT '',
  group_name TEXT NOT NULL DEFAULT '',
  is_active INTEGER NOT NULL DEFAULT 1,
  password_salt TEXT,
  password_hash TEXT,
  failed_attempts INTEGER NOT NULL DEFAULT 0,
  locked_until TEXT
);
-- Credentials are per exam (NULL exam_id = legacy, never compared equal).
CREATE UNIQUE INDEX participants_exam_email_unique ON participants (exam_id, lower(email));
CREATE INDEX participants_token_idx ON participants (session_token);
CREATE INDEX participants_exam_idx ON participants (exam_id);
CREATE INDEX participants_group_idx ON participants (group_name);
CREATE INDEX participants_active_idx ON participants (is_active);

CREATE TABLE responses (
  id TEXT PRIMARY KEY,
  participant_id TEXT NOT NULL REFERENCES participants (id) ON DELETE CASCADE,
  question_id INTEGER NOT NULL,
  -- NOTE: the Postgres CHECK only allowed single letters ('A'..'D'), which
  -- rejected multi-correct answers like "A,C" that saveAnswer writes since
  -- the organizer-panel upgrade. SQLite check accepts comma sets too.
  selected_option TEXT
    CHECK (selected_option IS NULL OR selected_option GLOB '[A-D]*'),
  is_correct INTEGER,
  marks_awarded REAL NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL,
  UNIQUE (participant_id, question_id)
);

CREATE TABLE results (
  participant_id TEXT PRIMARY KEY REFERENCES participants (id) ON DELETE CASCADE,
  total_correct INTEGER NOT NULL DEFAULT 0,
  total_wrong INTEGER NOT NULL DEFAULT 0,
  total_unattempted INTEGER NOT NULL DEFAULT 0,
  total_marks REAL NOT NULL DEFAULT 0,
  time_taken_seconds INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

-- Replaces Supabase auth (auth.users) + user_roles: organizers log in with
-- email + bcrypt password; sessions are stateless HMAC tokens (SESSION_SECRET).
CREATE TABLE organizers (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  password_hash TEXT NOT NULL, -- bcrypt
  display_name TEXT NOT NULL DEFAULT '',
  role TEXT NOT NULL DEFAULT 'admin' CHECK (role IN ('admin', 'user')),
  failed_attempts INTEGER NOT NULL DEFAULT 0,
  locked_until TEXT,
  created_at TEXT NOT NULL
);
CREATE UNIQUE INDEX organizers_email_unique ON organizers (lower(email));
