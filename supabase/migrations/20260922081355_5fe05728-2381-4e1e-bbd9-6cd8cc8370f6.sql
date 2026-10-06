
REVOKE ALL ON FUNCTION public.submit_exam(uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.increment_violation(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.grant_first_admin() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.has_role(uuid, public.app_role) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.submit_exam(uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.increment_violation(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) TO authenticated, service_role;
