import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { brand, footerCopyright } from "@/config/brand";

export const Route = createFileRoute("/exam/")({
  head: () => ({
    meta: [
      { title: `Find your exam — ${brand.appName}` },
      { name: "description", content: "Paste your exam link or code to open your exam login page." },
    ],
  }),
  component: ExamIndexPage,
});

function ExamIndexPage() {
  const navigate = useNavigate();
  const [value, setValue] = useState("");

  function go(e: React.FormEvent) {
    e.preventDefault();
    const v = value.trim();
    const m = v.match(/\/exam\/([A-Za-z0-9-]+)\/?/);
    const slug = (m?.[1] ?? v).toLowerCase();
    if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug)) {
      toast.error("Paste a valid exam link or code.");
      return;
    }
    navigate({ to: "/exam/$slug", params: { slug } });
  }

  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-background px-5 py-16">
      <div className="w-full max-w-md rounded-[22px] border border-border bg-card p-6 sm:p-8">
        <p className="mono-label text-muted-foreground">{brand.appName}</p>
        <h1 className="mt-2 text-3xl">Find your exam</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Paste the exam link or code shared by your organizer.
        </p>
        <form onSubmit={go} className="mt-5">
          <Input
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="exam link or code"
            className="h-12 rounded-xl"
            autoComplete="off"
            spellCheck={false}
          />
          <Button type="submit" className="mt-4 h-12 w-full rounded-[32px]">
            Continue
          </Button>
        </form>
      </div>
      <p className="mt-8 text-sm text-muted-foreground">
        <Link to="/" className="underline">Back to home</Link> · {footerCopyright()}
      </p>
    </main>
  );
}
