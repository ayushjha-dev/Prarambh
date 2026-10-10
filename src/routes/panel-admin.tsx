import { createFileRoute, redirect, useBlocker, useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { brand } from "@/config/brand";
import { supabase } from "@/integrations/supabase/client";
import type { AdminExam } from "@/lib/admin.functions";
import { DashboardView } from "@/components/organizer/DashboardView";
import { ExamsView } from "@/components/organizer/ExamsView";
import { ParticipantsView } from "@/components/organizer/ParticipantsView";
import { QuestionsEditor } from "@/components/organizer/QuestionsEditor";
import { ResultsView } from "@/components/organizer/ResultsView";
import { OrganizerSidebar, type OrganizerView } from "@/components/organizer/OrganizerSidebar";

const VIEWS: OrganizerView[] = ["dashboard", "exams", "participants", "results"];

export const Route = createFileRoute("/panel-admin")({
  ssr: false,
  validateSearch: (search: Record<string, unknown>) => ({
    view: VIEWS.includes(search["view"] as OrganizerView)
      ? (search["view"] as OrganizerView)
      : undefined,
  }),
  beforeLoad: async () => {
    // Local session read (no network): the JWT itself is still verified
    // server-side on every server-function call. Using getUser() here would
    // hit the network and log the organizer out on any hiccup (notably the
    // Android-back navigation in the installed PWA).
    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (!session) throw redirect({ to: "/panel-admin-login" });
  },
  head: () => ({
    meta: [
      { title: `Organizer Dashboard — ${brand.appName}` },
      {
        name: "description",
        content: `Create exams, manage students and view results in ${brand.appName}.`,
      },
      { name: "robots", content: "noindex,nofollow" },
      { property: "og:title", content: `Organizer Dashboard — ${brand.appName}` },
      { property: "og:description", content: `Organizer dashboard for ${brand.appName}.` },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: AdminPanel,
});

function AdminPanel() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { view: viewParam } = Route.useSearch();
  const [view, setView] = useState<OrganizerView>(viewParam ?? "dashboard");
  // Add-Questions sub-screen (inside the Exams section) + deep-linked results exam.
  const [questionsExam, setQuestionsExam] = useState<AdminExam | null>(null);
  const [resultsExamId, setResultsExamId] = useState<string | null>(null);

  function go(next: OrganizerView) {
    setView(next);
    setQuestionsExam(null);
    void navigate({ to: "/panel-admin", search: { view: next }, replace: true });
  }

  // Back-button trap: leaving the organizer area (Android back / browser
  // back) never logs out and never lands on the login page while the session
  // is valid. Instead it resolves to the dashboard; on the dashboard the
  // first back press arms "press back again to exit", the second one exits.
  // Logout is the only path that sets allowLeave.
  const allowLeave = useRef(false);
  const exitArmedAt = useRef(0);
  const blocker = useBlocker({
    shouldBlockFn: ({ next }) => {
      if (allowLeave.current) return false;
      const p = next.pathname;
      return !p.startsWith("/panel-admin") && !p.startsWith("/organizer");
    },
    withResolver: true,
  });

  useEffect(() => {
    if (blocker.status !== "blocked") return;
    if (view === "dashboard" && !questionsExam) {
      if (Date.now() - exitArmedAt.current < 2500) {
        blocker.proceed();
        return;
      }
      exitArmedAt.current = Date.now();
      toast.message("Press back again to exit.");
      blocker.reset();
    } else {
      go("dashboard");
      blocker.reset();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [blocker.status]);

  async function signOut() {
    allowLeave.current = true;
    await queryClient.cancelQueries();
    queryClient.clear();
    await supabase.auth.signOut();
    navigate({ to: "/panel-admin-login", replace: true });
  }

  return (
    <main className="min-h-screen bg-background md:flex">
      <OrganizerSidebar view={view} onNavigate={go} onLogout={() => void signOut()} />

      <div className="min-w-0 flex-1 pb-24 md:pb-0">
        {questionsExam ? (
          <QuestionsEditor exam={questionsExam} onBack={() => setQuestionsExam(null)} />
        ) : view === "dashboard" ? (
          <DashboardView
            onOpenExam={(examId, target) => {
              if (target === "results") {
                setResultsExamId(examId);
                go("results");
              } else {
                go("exams");
              }
            }}
          />
        ) : view === "exams" ? (
          <ExamsView onAddQuestions={(exam) => setQuestionsExam(exam)} />
        ) : view === "participants" ? (
          <ParticipantsView />
        ) : (
          <ResultsView key={resultsExamId ?? "none"} initialExamId={resultsExamId} />
        )}
      </div>
    </main>
  );
}
