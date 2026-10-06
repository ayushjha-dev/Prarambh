import { createFileRoute, redirect } from "@tanstack/react-router";

/**
 * Friendly alias: /organizer -> the organizer dashboard.
 * The dashboard itself lives at /panel-admin (kept for compatibility).
 */
export const Route = createFileRoute("/organizer")({
  ssr: false,
  beforeLoad: () => {
    throw redirect({ to: "/panel-admin" });
  },
});
