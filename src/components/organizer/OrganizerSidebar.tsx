import { BarChart3, ClipboardList, LayoutDashboard, LogOut, Users } from "lucide-react";

import { brand } from "@/config/brand";

export type OrganizerView = "dashboard" | "exams" | "participants" | "results";

const ITEMS: { key: OrganizerView; label: string; icon: React.ReactNode }[] = [
  { key: "dashboard", label: "Dashboard", icon: <LayoutDashboard className="size-4" /> },
  { key: "exams", label: "Exams", icon: <ClipboardList className="size-4" /> },
  { key: "participants", label: "Participants", icon: <Users className="size-4" /> },
  { key: "results", label: "Results", icon: <BarChart3 className="size-4" /> },
];

/**
 * Responsive organizer navigation built for the mobile thumb rule:
 * - md+ screens: fixed sidebar.
 * - Phones: compact top bar + slide-in drawer, plus a thumb-reach bottom
 *   tab bar (min 44px targets, safe-area padding). Active section highlighted.
 */
export function OrganizerSidebar(props: {
  view: OrganizerView;
  onNavigate: (view: OrganizerView) => void;
  onLogout: () => void;
}) {
  function go(view: OrganizerView) {
    props.onNavigate(view);
  }

  const nav = (
    <nav className="flex flex-col gap-1 p-4" aria-label="Organizer">
      {ITEMS.map((item) => (
        <button
          key={item.key}
          onClick={() => go(item.key)}
          aria-current={props.view === item.key ? "page" : undefined}
          className={`flex min-h-11 items-center gap-3 rounded-xl px-4 py-2.5 text-sm font-medium transition-colors ${
            props.view === item.key
              ? "bg-primary text-primary-foreground shadow-sm"
              : "text-muted-foreground hover:bg-secondary hover:text-foreground"
          }`}
        >
          {item.icon}
          {item.label}
        </button>
      ))}
      <button
        onClick={props.onLogout}
        className="mt-2 flex min-h-11 items-center gap-3 rounded-xl px-4 py-2.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
      >
        <LogOut className="size-4" />
        Logout
      </button>
    </nav>
  );

  const bottomNav = (
    <nav
      aria-label="Organizer sections"
      className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-card/95 backdrop-blur-md md:hidden"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      <div className="grid grid-cols-5">
        {ITEMS.map((item) => {
          const active = props.view === item.key;
          return (
            <button
              key={item.key}
              onClick={() => go(item.key)}
              aria-current={active ? "page" : undefined}
              className={`flex min-h-16 flex-col items-center justify-center gap-1 text-[10px] font-medium transition-colors ${
                active ? "text-brand" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <span
                className={`grid size-6 place-items-center rounded-full ${active ? "bg-brand/10" : ""}`}
              >
                {item.icon}
              </span>
              {item.label}
            </button>
          );
        })}
        <button
          onClick={props.onLogout}
          aria-label="Logout"
          className="flex min-h-16 flex-col items-center justify-center gap-1 text-[10px] font-medium text-muted-foreground transition-colors hover:text-destructive"
        >
          <span className="grid size-6 place-items-center rounded-full">
            <LogOut className="size-4" />
          </span>
          Logout
        </button>
      </div>
    </nav>
  );

  return (
    <>
      {/* Mobile top bar (navigation lives in the bottom tabs) */}
      <div className="sticky top-0 z-40 flex items-center justify-center border-b border-border bg-background/90 px-4 py-3 backdrop-blur-md md:hidden">
        <p className="flex items-center gap-2 text-sm font-semibold">
          <span className="grid size-7 place-items-center rounded-lg bg-brand font-mono text-[11px] font-semibold text-brand-foreground">
            {brand.logoMark}
          </span>
          {brand.appName} · Organizer
        </p>
      </div>

      {/* Mobile thumb-reach bottom tabs */}
      {bottomNav}

      {/* Desktop sidebar */}
      <aside className="sticky top-0 hidden h-screen w-60 shrink-0 flex-col border-r border-border bg-card/50 md:flex">
        <div className="flex items-center gap-2.5 border-b border-border px-5 py-4">
          <span className="grid size-9 place-items-center rounded-xl bg-brand font-mono text-sm font-semibold text-brand-foreground">
            {brand.logoMark}
          </span>
          <div>
            <p className="text-sm font-semibold leading-tight">{brand.appName}</p>
            <p className="mono-label text-muted-foreground">Organizer</p>
          </div>
        </div>
        {nav}
      </aside>
    </>
  );
}
