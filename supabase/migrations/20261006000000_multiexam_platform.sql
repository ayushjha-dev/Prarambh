-- Multi-exam platform: exams table + per-exam student credentials.
--
-- HOW TO APPLY (Supabase SQL editor or `supabase db push`):
--   1. Run this file against the project database.
--   2. No seed data is inserted; organizers create exams from the dashboard.
--   3. Existing single-exam rows (if any) keep working: participants with a
--      NULL exam_id fall back to the global active question set.

-- ---------------------------------------------------------------- exams ---
CREATE TABLE IF NOT EXISTS public.exams (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL UNIQUE,
  title text NOT NULL,
  description text NOT NULL DEFAULT '',
  duration_minutes int NOT NULL DEFAULT 45 CHECK (duration_minutes > 0 AND duration_minutes <= 600),
  marks_correct numeric NOT NULL DEFAULT 2,
  marks_wrong numeric NOT NULL DEFAULT -0.5,
  starts_at timestamptz,
  ends_at timestamptz,
  is_enabled boolean NOT NULL DEFAULT true,
  question_set_id uuid REFERENCES public.question_sets(id) ON DELETE SET NULL,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT exams_slug_format CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  CONSTRAINT exams_window_valid CHECK (starts_at IS NULL OR ends_at IS NULL OR starts_at < ends_at)
);
CREATE INDEX IF NOT EXISTS exams_slug_idx ON public.exams (slug);
CREATE INDEX IF NOT EXISTS exams_created_idx ON public.exams (created_at DESC);

-- ------------------------------------------------- participants additions ---
ALTER TABLE public.participants
  ADD COLUMN IF NOT EXISTS exam_id uuid REFERENCES public.exams(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS password_salt text,
  ADD COLUMN IF NOT EXISTS password_hash text,
  ADD COLUMN IF NOT EXISTS failed_attempts int NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS locked_until timestamptz;

-- Credentials are per exam: the same email can sit different exams with
-- different passwords. The legacy global unique index on lower(email) is
-- replaced by a per-exam one (NULL exam_id rows = legacy data, kept distinct
-- since NULLs never compare equal).
DROP INDEX IF EXISTS public.participants_email_unique;
DROP INDEX IF EXISTS public.participants_exam_email_unique;
CREATE UNIQUE INDEX participants_exam_email_unique
  ON public.participants (exam_id, lower(email));
CREATE INDEX IF NOT EXISTS participants_exam_idx ON public.participants (exam_id);

-- ------------------------------------------------------------------ RLS ---
GRANT ALL ON public.exams TO service_role;
GRANT SELECT ON public.exams TO authenticated;

ALTER TABLE public.exams ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "admins read exams" ON public.exams;
CREATE POLICY "admins read exams" ON public.exams
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));

-- --------------------------------- submit_exam: prefer the exam's question --
-- set when the participant belongs to an exam; otherwise fall back to the
-- legacy behaviour (participant set, then global active set).
CREATE OR REPLACE FUNCTION public.submit_exam(p_participant uuid, p_reason text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  p public.participants%ROWTYPE;
  v_exam_id uuid;
  v_set jsonb; q jsonb; sel text;
  v_mc numeric; v_mw numeric;
  v_correct int := 0; v_wrong int := 0; v_unatt int := 0; v_marks numeric := 0;
  v_time int; v_qid int;
BEGIN
  SELECT * INTO p FROM public.participants WHERE id = p_participant FOR UPDATE;
  IF NOT FOUND OR p.status = 'completed' THEN RETURN; END IF;

  v_exam_id := p.exam_id;
  IF v_exam_id IS NOT NULL THEN
    SELECT qs.data INTO v_set FROM public.exams e
    JOIN public.question_sets qs ON qs.id = e.question_set_id
    WHERE e.id = v_exam_id;
  END IF;
  IF v_set IS NULL AND p.question_set_id IS NOT NULL THEN
    SELECT data INTO v_set FROM public.question_sets WHERE id = p.question_set_id;
  END IF;
  IF v_set IS NULL THEN SELECT data INTO v_set FROM public.question_sets WHERE is_active; END IF;

  v_mc := COALESCE((v_set->'meta'->>'marks_correct')::numeric, 2);
  v_mw := COALESCE((v_set->'meta'->>'marks_wrong')::numeric, -0.5);

  FOR q IN SELECT * FROM jsonb_array_elements(v_set->'questions') LOOP
    v_qid := (q->>'id')::int;
    SELECT selected_option INTO sel FROM public.responses
      WHERE participant_id = p_participant AND question_id = v_qid;
    IF sel IS NULL THEN
      v_unatt := v_unatt + 1;
      INSERT INTO public.responses (participant_id, question_id, selected_option, is_correct, marks_awarded)
      VALUES (p_participant, v_qid, NULL, NULL, 0)
      ON CONFLICT (participant_id, question_id) DO UPDATE SET is_correct = NULL, marks_awarded = 0;
    ELSIF sel = upper(q->>'correct') THEN
      v_correct := v_correct + 1; v_marks := v_marks + v_mc;
      UPDATE public.responses SET is_correct = true, marks_awarded = v_mc
        WHERE participant_id = p_participant AND question_id = v_qid;
    ELSE
      v_wrong := v_wrong + 1; v_marks := v_marks + v_mw;
      UPDATE public.responses SET is_correct = false, marks_awarded = v_mw
        WHERE participant_id = p_participant AND question_id = v_qid;
    END IF;
  END LOOP;

  v_time := GREATEST(0, EXTRACT(EPOCH FROM (now() - COALESCE(p.exam_started_at, now())))::int);

  UPDATE public.participants
     SET status = 'completed', exam_submitted_at = now(),
         submit_reason = p_reason, time_taken_seconds = v_time
   WHERE id = p_participant;

  INSERT INTO public.results (participant_id, total_correct, total_wrong, total_unattempted, total_marks, time_taken_seconds)
  VALUES (p_participant, v_correct, v_wrong, v_unatt, v_marks, v_time)
  ON CONFLICT (participant_id) DO UPDATE SET
    total_correct = EXCLUDED.total_correct, total_wrong = EXCLUDED.total_wrong,
    total_unattempted = EXCLUDED.total_unattempted, total_marks = EXCLUDED.total_marks,
    time_taken_seconds = EXCLUDED.time_taken_seconds;
END;
$$;

REVOKE ALL ON FUNCTION public.submit_exam(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.submit_exam(uuid, text) TO service_role;
