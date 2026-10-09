import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import { adminOrganizerStats } from "@/lib/admin.functions";
import { examDisplayStatus } from "@/lib/organizer-utils";

/** Dashboard: summary cards, per-exam participation chart, recent exams. */
export function DashboardView(props: {
  onOpenExam: (examId: string, view: "exams" | "results") => void;
}) {
  const statsFn = useServerFn(adminOrganizerStats);
  const { data, isLoading } = useQuery({ queryKey: ["organizer-stats"], queryFn: () => statsFn() });

  if (isLoading) {
    return (
      <div className="grid gap-3 p-5 sm:grid-cols-2 lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <div
            key={i}
            className="h-24 animate-pulse rounded-2xl border border-border bg-muted/40"
          />
        ))}
      </div>
    );
  }

  if (!data) {
    return (
      <div className="p-5">
        <div className="rounded-[22px] border border-border p-10 text-center text-sm text-muted-foreground">
          Could not load dashboard stats. Please try again.
        </div>
      </div>
    );
  }

  const cards = [
    { label: "Conducted Exams", value: data.conducted, hint: "Ended or marked completed" },
    {
      label: "Participated Students",
      value: data.participatedStudents,
      hint: "Unique, attempted ≥ 1 exam",
    },
    { label: "Upcoming Exams", value: data.upcoming, hint: "Scheduled for the future" },
    { label: "Registered Participants", value: data.registered, hint: "Across all exams" },
  ];

  return (
    <div className="mx-auto max-w-6xl px-5 py-6">
      <h1 className="text-2xl">Dashboard</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        {data.totalExams} exam{data.totalExams === 1 ? "" : "s"} in this workspace.
      </p>

      <div className="mt-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {cards.map((c) => (
          <div key={c.label} className="rounded-2xl border border-border bg-card p-4">
            <p className="mono-label text-muted-foreground">{c.label}</p>
            <p className="mt-1 font-mono text-3xl">{c.value}</p>
            <p className="mt-1 text-xs text-muted-foreground">{c.hint}</p>
          </div>
        ))}
      </div>

      <section className="mt-5 rounded-[22px] border border-border p-6">
        <h2 className="text-xl">Participated students per exam</h2>
        {!data.perExam.length ? (
          <p className="mt-3 text-sm text-muted-foreground">
            No exams yet — create one to see the chart.
          </p>
        ) : (
          <div className="mt-4 h-64 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data.perExam} margin={{ top: 4, right: 8, bottom: 0, left: -12 }}>
                <CartesianGrid strokeDasharray="3 3" opacity={0.4} />
                <XAxis
                  dataKey="title"
                  tick={{ fontSize: 11 }}
                  interval={0}
                  angle={-18}
                  dy={10}
                  height={56}
                />
                <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
                <Tooltip />
                <Bar
                  dataKey="participants"
                  name="Participated"
                  fill="var(--color-brand)"
                  radius={[6, 6, 0, 0]}
                />
                <Bar
                  dataKey="registered"
                  name="Registered"
                  fill="var(--color-border)"
                  radius={[6, 6, 0, 0]}
                />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </section>

      <section className="mt-5 rounded-[22px] border border-border p-6">
        <h2 className="text-xl">Recent exams</h2>
        {!data.recent.length ? (
          <p className="mt-3 text-sm text-muted-foreground">No exams yet.</p>
        ) : (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[640px] text-left text-sm">
              <thead>
                <tr className="mono-label border-b border-border text-muted-foreground">
                  <th className="py-2 pr-4 font-normal">Exam</th>
                  <th className="py-2 pr-4 font-normal">Date</th>
                  <th className="py-2 pr-4 font-normal">Participants</th>
                  <th className="py-2 pr-4 font-normal">Status</th>
                  <th className="py-2 font-normal" />
                </tr>
              </thead>
              <tbody>
                {data.recent.map((e) => (
                  <tr key={e.id} className="border-b border-border">
                    <td className="py-2.5 pr-4 font-medium">{e.title}</td>
                    <td className="py-2.5 pr-4 text-muted-foreground">
                      {new Date(e.date).toLocaleString()}
                    </td>
                    <td className="py-2.5 pr-4">{e.participants}</td>
                    <td className="py-2.5 pr-4">
                      <span className="mono-label rounded-full bg-secondary px-3 py-1 text-muted-foreground">
                        {examDisplayStatus({
                          is_enabled: e.is_enabled,
                          status: e.status,
                          starts_at: null,
                          ends_at: null,
                        })}
                      </span>
                    </td>
                    <td className="py-2.5 text-right">
                      <button
                        className="text-xs font-medium text-brand hover:underline"
                        onClick={() => props.onOpenExam(e.id, "results")}
                      >
                        View results
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
