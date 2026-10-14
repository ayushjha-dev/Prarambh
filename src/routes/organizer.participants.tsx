import { createFileRoute, redirect } from "@tanstack/react-router";

import { authClient } from "@/integrations/turso/auth-client";

/** Organizer section route: /organizer/participants */
export const Route = createFileRoute("/organizer/participants")({
  ssr: false,
  beforeLoad: async () => {
    // Local session read: no network, so back-navigation in the PWA never
    // drops a valid session on a hiccup.
    const {
      data: { session },
    } = await authClient.getSession();
    if (!session) throw redirect({ to: "/panel-admin-login" });
    throw redirect({ to: "/panel-admin", search: { view: "participants" } });
  },
});
