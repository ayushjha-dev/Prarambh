import { createFileRoute, redirect } from "@tanstack/react-router";

import { supabase } from "@/integrations/supabase/client";

/** Organizer section route: /organizer/results */
export const Route = createFileRoute("/organizer/results")({
  ssr: false,
  beforeLoad: async () => {
    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user) throw redirect({ to: "/panel-admin-login" });
    throw redirect({ to: "/panel-admin", search: { view: "results" } });
  },
});
