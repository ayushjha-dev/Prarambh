/**
 * Single place to change the app's branding.
 * Name, tagline, logo text, and support contact live here so a rebrand
 * is a one-file edit. Colors stay in the design system (src/styles.css).
 */
export const brand = {
  /** Neutral placeholder product name. */
  appName: "ExamPortal",
  tagline: "Secure, Seamless Online Exams",
  /** Short mark rendered in headers when no image logo is set. */
  logoMark: "EP",
  /** Generic footer owner placeholder. */
  footerNote: "Secure online examination platform",
  supportEmail: "support@example.com",
} as const;

export function footerCopyright(year: number = new Date().getFullYear()): string {
  return `© ${year} ${brand.appName}`;
}
