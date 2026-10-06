import { useEffect, useState } from "react";

import { brand } from "@/config/brand";

function detectPhone() {
  if (typeof window === "undefined") return false;
  const narrow = window.innerWidth < 768;
  const mobileUA = /Android|iPhone|iPad|iPod|Mobile|Opera Mini|IEMobile/i.test(
    navigator.userAgent,
  );
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
        This exam can only be taken on a laptop or desktop computer. It needs a
        full-size browser window running in full-screen mode, which phones do not support.
      </p>
      <p className="mt-6 max-w-md rounded-2xl border border-border bg-card p-5 text-sm text-muted-foreground">
        Please open this page in Chrome, Edge, Firefox or Safari on a Windows, Mac or Linux
        computer to begin your attempt.
      </p>
      <p className="mono-label mt-10 leading-5 text-muted-foreground">
        {brand.appName} · {brand.footerNote}
      </p>
    </main>
  );
}
