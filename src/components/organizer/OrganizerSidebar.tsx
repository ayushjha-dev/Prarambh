import { useState } from "react";
import { BarChart3, ClipboardList, LayoutDashboard, LogOut, Menu, Users, X } from "lucide-react";

import { brand } from "@/config/brand";

export type OrganizerView = "dashboard" | "exams" | "participants" | "results";

const ITEMS: { key: OrganizerView; label: string; icon: React.ReactNode }[] = [
  { key: "dashboard", label: "Dashboard", icon: <LayoutDashboard className="size-4" /> },
  { key: "exams", label: "Exams", icon: <ClipboardList className="size-4" /> },
  { key: "participants", label: "Participants", icon: <Users className="size-4" /> },
  { key: "results", label: "Results", icon: <BarChart3 className="size-4" /> },
];

/**
 * Responsive organizer navigation: fixed sidebar on md+ screens, top bar +
 * slide-in drawer on mobile. Active section is highlighted.
 */
export function OrganizerSidebar(props: {
  view: OrganizerView;
  onNavigate: (view: OrganizerView) => void;
  onLogout: () => void;
}) {
  const [open, setOpen] = useState(false);

  function go(view: OrganizerView) {
    props.onNavigate(view);
    setOpen(false);
  }

  const nav = (
    <nav className="flex flex-col gap-1 p-4" aria-label="Organizer">
      {ITEMS.map((item) => (
        <button
          key={item.key}
          onClick={() => go(item.key)}
          aria-current={props.view === item.key ? "page" : undefined}
          className={`flex items-center gap-3 rounded-xl px-4 py-2.5 text-sm font-medium transition-colors ${
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
        className="mt-2 flex items-center gap-3 rounded-xl px-4 py-2.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
      >
        <LogOut className="size-4" />
        Logout
      </button>
    </nav>
  );

  return (
    <>
      {/* Mobile top bar */}
      <div className="sticky top-0 z-40 flex items-center justify-between border-b border-border bg-background/90 px-4 py-3 backdrop-blur-md md:hidden">
        <button
          onClick={() => setOpen(true)}
          className="rounded-lg p-2 hover:bg-secondary"
          aria-label="Open menu"
        >
          <Menu className="size-5" />
        </button>
        <p className="flex items-center gap-2 text-sm font-semibold">
          <span className="grid size-7 place-items-center rounded-lg bg-brand font-mono text-[11px] font-semibold text-brand-foreground">
            {brand.logoMark}
          </span>
          {brand.appName} · Organizer
        </p>
        <span className="w-9" />
      </div>

      {/* Mobile drawer */}
      {open ? (
        <div className="fixed inset-0 z-50 md:hidden">
          <div className="absolute inset-0 bg-black/40" onClick={() => setOpen(false)} />
          <div className="absolute inset-y-0 left-0 w-72 max-w-[85vw] overflow-y-auto bg-card shadow-xl">
            <div className="flex items-center justify-between border-b border-border px-4 py-3">
              <p className="flex items-center gap-2 text-sm font-semibold">
                <span className="grid size-7 place-items-center rounded-lg bg-brand font-mono text-[11px] font-semibold text-brand-foreground">
                  {brand.logoMark}
                </span>
                Organizer
              </p>
              <button
                onClick={() => setOpen(false)}
                className="rounded-lg p-2 hover:bg-secondary"
                aria-label="Close menu"
              >
                <X className="size-5" />
              </button>
            </div>
            {nav}
          </div>
        </div>
      ) : null}

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
