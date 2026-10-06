import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";

import { Button } from "@/components/ui/button";
import { brand } from "@/config/brand";
import { clearSession } from "@/lib/exam-session";

export const Route = createFileRoute("/submitted")({
  ssr: false,
  head: () => ({
    meta: [
      { title: `Test submitted — ${brand.appName}` },
      {
        name: "description",
        content: `Your ${brand.appName} test has been submitted successfully.`,
      },
      { property: "og:title", content: `Test submitted — ${brand.appName}` },
      { property: "og:description", content: `Your ${brand.appName} test has been submitted.` },
    ],
  }),
  component: SubmittedPage,
});

function SubmittedPage() {
  const navigate = useNavigate();

  useEffect(() => {
    clearSession();
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
  }, []);

  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-5 py-16">
      <div className="w-full max-w-lg rounded-[22px] border border-border bg-[var(--pale-green)] p-8 text-center">
        <p className="mono-label text-muted-foreground">{brand.appName}</p>
        <h1 className="mt-3 text-4xl leading-tight">Your test has been submitted</h1>
        <p className="mt-4 text-[17px] text-muted-foreground">
          Your test has been submitted successfully. Results will be announced by
          the organisers.
        </p>
        <Button
          variant="ghost"
          className="mt-8 rounded-[32px]"
          onClick={() => navigate({ to: "/" })}
        >
          Back to start
        </Button>
      </div>
    </main>
  );
}
