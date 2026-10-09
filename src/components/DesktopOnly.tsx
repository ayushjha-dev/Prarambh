import { useEffect, useState } from "react";

import { brand } from "@/config/brand";

function detectPhone() {
  if (typeof window === "undefined") return false;
  const narrow = window.innerWidth < 768;
  const mobileUA = /Android|iPhone|iPad|iPod|Mobile|Opera Mini|IEMobile/i.test(navigator.userAgent);
  return narrow || mobileUA;
}

/** True when the visitor is on a phone (or narrow mobile viewport). */
export function useIsPhone() {
  const [isPhone, setIsPhone] = useState(detectPhone);

  useEffect(() => {
    const update = () => setIsPhone(detectPhone());
    window.addEventListener("resize", update);
    window.addEventListener("orientationchange", update);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("orientationchange", update);
    };
  }, []);

  return isPhone;
}

/** Full-page notice shown instead of the exam on phones. */
export function DesktopOnlyScreen() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-background px-6 py-16 text-center">
      <p className="mono-label text-muted-foreground">{brand.appName} · Online Examination</p>
      <h1 className="mt-4 text-4xl leading-tight sm:text-5xl">Laptop or desktop required</h1>
      <p className="mt-5 max-w-md text-[15px] leading-relaxed text-muted-foreground">
        This exam can only be taken on a laptop or desktop computer. It needs a full-size browser
        window running in full-screen mode, which phones do not support.
      </p>
      <p className="mt-6 max-w-md rounded-2xl border border-border bg-card p-5 text-sm text-muted-foreground">
        Please open this page in Chrome, Edge, Firefox or Safari on a Windows, Mac or Linux computer
        to begin your attempt.
      </p>
      <p className="mono-label mt-10 leading-5 text-muted-foreground">
        {brand.appName} · {brand.footerNote}
      </p>
    </main>
  );
}

function mobileAckKey(slug: string) {
  return `prarambh.mobile-ack.${slug.toLowerCase()}`;
}

/**
 * Phone gate for exam pages: phones are allowed, but the student must
 * acknowledge the mobile-fairness notice once per exam (per tab session).
 * Returns [needsAck, acknowledge].
 */
export function useMobileAck(slug: string): [boolean, () => void] {
  const isPhone = useIsPhone();
  const [ack, setAck] = useState(() => {
    if (typeof window === "undefined") return false;
    try {
      return window.sessionStorage.getItem(mobileAckKey(slug)) === "1";
    } catch {
      return false;
    }
  });

  function acknowledge() {
    try {
      window.sessionStorage.setItem(mobileAckKey(slug), "1");
    } catch {
      /* private mode etc — notice simply reappears next visit */
    }
    setAck(true);
  }

  return [isPhone && !ack, acknowledge];
}

/** Fairness notice shown to phone users before they enter an exam. */
export function MobileNoticeScreen(props: { slug: string; onContinue: () => void }) {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-background px-6 py-16 text-center">
      <p className="mono-label text-muted-foreground">{brand.appName} · Online Examination</p>
      <h1 className="mt-4 text-4xl leading-tight sm:text-5xl">You&apos;re on a phone</h1>
      <p className="mt-5 max-w-md text-[15px] leading-relaxed text-muted-foreground">
        You can take this exam here, but phones can&apos;t lock into full-screen proctoring. Leaving
        this app or switching tabs still counts as a violation — three violations submit the test
        automatically. For the smoothest experience, use a laptop or desktop if you can.
      </p>
      <div className="mt-6 flex w-full max-w-md flex-col gap-2">
        <button
          onClick={props.onContinue}
          className="inline-flex h-12 items-center justify-center gap-2 rounded-full bg-brand px-7 text-sm font-semibold text-brand-foreground shadow-md shadow-brand/20"
        >
          Continue on this phone
        </button>
        <p className="text-xs text-muted-foreground">
          Install {brand.appName} to your home screen for a full-screen, app-like experience.
        </p>
      </div>
      <p className="mono-label mt-10 leading-5 text-muted-foreground">
        {brand.appName} · {brand.footerNote}
      </p>
    </main>
  );
}
