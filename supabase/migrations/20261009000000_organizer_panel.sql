-- Organizer panel upgrade: exam metadata, participant directory fields,
-- per-question marks/type support is stored inside question_sets.data (no DDL).
--
-- HOW TO APPLY: run against the project database (Supabase SQL editor or
-- `supabase db push`). All columns are nullable/with defaults, so existing
-- Student + Admin flows keep working untouched.

-- ------------------------------------------------------- exams additions ---
ALTER TABLE public.exams
  ADD COLUMN IF NOT EXISTS subject text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS total_marks numeric,
  ADD COLUMN IF NOT EXISTS passing_marks numeric,
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'scheduled', 'live', 'completed', 'archived'));

-- Backfill status from the existing scheduling columns (idempotent).
UPDATE public.exams SET status =
  CASE
    WHEN is_enabled = false THEN 'draft'
    WHEN ends_at IS NOT NULL AND now() > ends_at THEN 'completed'
    WHEN starts_at IS NOT NULL AND now() < starts_at THEN 'scheduled'
    ELSE 'live'
  END
WHERE status = 'draft';

CREATE INDEX IF NOT EXISTS exams_status_idx ON public.exams (status);
CREATE INDEX IF NOT EXISTS exams_subject_idx ON public.exams (subject);

-- ------------------------------------------------ participants additions ---
-- Extra directory columns for the Participants portal. Auth still uses the
-- existing exam-scoped email + password_hash / password_salt pair.
ALTER TABLE public.participants
  ADD COLUMN IF NOT EXISTS phone text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS roll_no text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS group_name text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true;

CREATE INDEX IF NOT EXISTS participants_group_idx ON public.participants (group_name);
CREATE INDEX IF NOT EXISTS participants_active_idx ON public.participants (is_active);

-- --------------------------------- submit_exam: per-question marks/types ----
-- Backward compatible: questions without `marks` fall back to meta-level
-- marks_correct / marks_wrong; `correct` may be a single letter ("B") or a
-- comma-separated set ("A,C") for multiple-correct questions (exact match
-- earns the marks, anything else earns marks_wrong). Selected answers are
-- compared as normalized letter sets, so legacy single-letter rows grade
-- exactly as before.
CREATE OR REPLACE FUNCTION public.submit_exam(p_participant uuid, p_reason text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  p public.participants%ROWTYPE;
  v_exam_id uuid;
  v_set jsonb; q jsonb; sel text;
  v_mc numeric; v_mw numeric;
  v_qmarks numeric;
  v_correct int := 0; v_wrong int := 0; v_unatt int := 0; v_marks numeric := 0;
  v_time int; v_qid int;
  v_sel text[]; v_exp text[];
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
    v_qmarks := COALESCE(NULLIF(q->>'marks', '')::numeric, v_mc);
    IF sel IS NULL THEN
      v_unatt := v_unatt + 1;
      INSERT INTO public.responses (participant_id, question_id, selected_option, is_correct, marks_awarded)
      VALUES (p_participant, v_qid, NULL, NULL, 0)
      ON CONFLICT (participant_id, question_id) DO UPDATE SET is_correct = NULL, marks_awarded = 0;
    ELSE
      SELECT array_agg(DISTINCT upper(trim(both ' ' FROM x)) ORDER BY 1) INTO v_sel
        FROM unnest(string_to_array(upper(sel), ',')) AS x
        WHERE trim(both ' ' FROM x) <> '';
      SELECT array_agg(DISTINCT upper(trim(both ' ' FROM x)) ORDER BY 1) INTO v_exp
        FROM unnest(string_to_array(COALESCE(q->>'correct', ''), ',')) AS x
        WHERE trim(both ' ' FROM x) <> '';
      IF v_sel = v_exp THEN
        v_correct := v_correct + 1; v_marks := v_marks + v_qmarks;
        UPDATE public.responses SET is_correct = true, marks_awarded = v_qmarks
          WHERE participant_id = p_participant AND question_id = v_qid;
      ELSE
        v_wrong := v_wrong + 1; v_marks := v_marks + v_mw;
        UPDATE public.responses SET is_correct = false, marks_awarded = v_mw
          WHERE participant_id = p_participant AND question_id = v_qid;
      END IF;
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
