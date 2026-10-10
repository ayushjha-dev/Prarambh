import { createFileRoute, redirect } from "@tanstack/react-router";

import { supabase } from "@/integrations/supabase/client";

/** Organizer section route: /organizer/dashboard */
export const Route = createFileRoute("/organizer/dashboard")({
  ssr: false,
  beforeLoad: async () => {
    // Local session read: no network, so back-navigation in the PWA never
    // drops a valid session on a hiccup.
    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (!session) throw redirect({ to: "/panel-admin-login" });
    throw redirect({ to: "/panel-admin", search: { view: "dashboard" } });
  },
});
