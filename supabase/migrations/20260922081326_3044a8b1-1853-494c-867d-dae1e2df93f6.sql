
CREATE TABLE public.question_sets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  data jsonb NOT NULL,
  is_active boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX question_sets_one_active ON public.question_sets (is_active) WHERE is_active;

CREATE TABLE public.participants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  email text NOT NULL,
  session_token uuid NOT NULL DEFAULT gen_random_uuid(),
  question_set_id uuid REFERENCES public.question_sets(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  exam_started_at timestamptz,
  exam_submitted_at timestamptz,
  time_taken_seconds int,
  submit_reason text CHECK (submit_reason IN ('manual','timeout','violation')),
  tab_violation_count int NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'not_started' CHECK (status IN ('not_started','in_progress','completed'))
);
CREATE UNIQUE INDEX participants_email_unique ON public.participants (lower(email));
CREATE INDEX participants_token_idx ON public.participants (session_token);

CREATE TABLE public.responses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  participant_id uuid NOT NULL REFERENCES public.participants(id) ON DELETE CASCADE,
  question_id int NOT NULL,
  selected_option text CHECK (selected_option IN ('A','B','C','D')),
  is_correct boolean,
  marks_awarded numeric NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (participant_id, question_id)
);

CREATE TABLE public.results (
  participant_id uuid PRIMARY KEY REFERENCES public.participants(id) ON DELETE CASCADE,
  total_correct int NOT NULL DEFAULT 0,
  total_wrong int NOT NULL DEFAULT 0,
  total_unattempted int NOT NULL DEFAULT 0,
  total_marks numeric NOT NULL DEFAULT 0,
  time_taken_seconds int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TYPE public.app_role AS ENUM ('admin','user');

CREATE TABLE public.user_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  role public.app_role NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, role)
);

GRANT SELECT ON public.question_sets TO authenticated;
GRANT ALL ON public.question_sets TO service_role;
GRANT SELECT ON public.participants TO authenticated;
GRANT ALL ON public.participants TO service_role;
GRANT SELECT ON public.responses TO authenticated;
GRANT ALL ON public.responses TO service_role;
GRANT SELECT ON public.results TO authenticated;
GRANT ALL ON public.results TO service_role;
GRANT SELECT ON public.user_roles TO authenticated;
GRANT ALL ON public.user_roles TO service_role;

ALTER TABLE public.question_sets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.participants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.responses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.results ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role public.app_role)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role);
$$;

CREATE POLICY "own roles readable" ON public.user_roles FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY "admins read question sets" ON public.question_sets FOR SELECT TO authenticated USING (public.has_role(auth.uid(),'admin'));
CREATE POLICY "admins read participants" ON public.participants FOR SELECT TO authenticated USING (public.has_role(auth.uid(),'admin'));
CREATE POLICY "admins read responses" ON public.responses FOR SELECT TO authenticated USING (public.has_role(auth.uid(),'admin'));
CREATE POLICY "admins read results" ON public.results FOR SELECT TO authenticated USING (public.has_role(auth.uid(),'admin'));

-- First ever account becomes the admin
CREATE OR REPLACE FUNCTION public.grant_first_admin()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.user_roles WHERE role = 'admin') THEN
    INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'admin')
    ON CONFLICT DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER on_auth_user_created_grant_admin
AFTER INSERT ON auth.users
FOR EACH ROW EXECUTE FUNCTION public.grant_first_admin();

-- Atomic violation increment
CREATE OR REPLACE FUNCTION public.increment_violation(p_participant uuid)
RETURNS int LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_count int;
BEGIN
  UPDATE public.participants SET tab_violation_count = tab_violation_count + 1
  WHERE id = p_participant AND status = 'in_progress'
  RETURNING tab_violation_count INTO v_count;
  RETURN COALESCE(v_count, (SELECT tab_violation_count FROM public.participants WHERE id = p_participant));
END;
$$;

-- Server-side scoring, idempotent per participant
CREATE OR REPLACE FUNCTION public.submit_exam(p_participant uuid, p_reason text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  p public.participants%ROWTYPE;
  v_set jsonb; q jsonb; sel text;
  v_mc numeric; v_mw numeric;
  v_correct int := 0; v_wrong int := 0; v_unatt int := 0; v_marks numeric := 0;
  v_time int; v_qid int;
BEGIN
  SELECT * INTO p FROM public.participants WHERE id = p_participant FOR UPDATE;
  IF NOT FOUND OR p.status = 'completed' THEN RETURN; END IF;

  SELECT data INTO v_set FROM public.question_sets WHERE id = p.question_set_id;
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
