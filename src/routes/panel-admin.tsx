import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

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
    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user) throw redirect({ to: "/panel-admin-login" });
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

  async function signOut() {
    await queryClient.cancelQueries();
    queryClient.clear();
    await supabase.auth.signOut();
    navigate({ to: "/panel-admin-login", replace: true });
  }

  return (
    <main className="min-h-screen bg-background md:flex">
      <OrganizerSidebar view={view} onNavigate={go} onLogout={() => void signOut()} />

      <div className="min-w-0 flex-1">
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
