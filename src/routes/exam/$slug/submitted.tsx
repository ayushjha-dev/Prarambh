import { createFileRoute, Link, useNavigate, useParams } from "@tanstack/react-router";
import { useEffect } from "react";

import { Button } from "@/components/ui/button";
import { brand } from "@/config/brand";
import { clearSessionForExam } from "@/lib/exam-session";

export const Route = createFileRoute("/exam/$slug/submitted")({
  ssr: false,
  head: () => ({
    meta: [
      { title: `Test submitted — ${brand.appName}` },
      { name: "description", content: "Your test has been submitted successfully." },
      { name: "robots", content: "noindex,nofollow" },
    ],
  }),
  component: ExamSubmittedPage,
});

function ExamSubmittedPage() {
  const { slug } = useParams({ from: "/exam/$slug/submitted" });
  const navigate = useNavigate();

  useEffect(() => {
    clearSessionForExam(slug);
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
  }, [slug]);

  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-5 py-16">
      <div className="w-full max-w-lg rounded-[22px] border border-border bg-[var(--pale-green)] p-8 text-center">
        <p className="mono-label text-muted-foreground">{brand.appName}</p>
        <h1 className="mt-3 text-4xl leading-tight">Your test has been submitted</h1>
        <p className="mt-4 text-[17px] text-muted-foreground">
          Your test has been submitted successfully. Results will be announced by
          the organisers.
        </p>
        <div className="mt-8 flex flex-wrap justify-center gap-2">
          <Button
            variant="ghost"
            className="rounded-[32px]"
            onClick={() => navigate({ to: "/exam/$slug", params: { slug } })}
          >
            Back to exam login
          </Button>
          <Link to="/" className="inline-flex h-10 items-center rounded-[32px] px-4 text-sm underline">
            Home
          </Link>
        </div>
      </div>
    </main>
  );
}
