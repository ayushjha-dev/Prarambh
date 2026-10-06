# ExamPortal — Secure, Seamless Online Exams

A brand-neutral, multi-exam online examination platform built with
TanStack Start, React, Tailwind CSS and Supabase.

## How exam URLs work

Each exam has its own unique, hard-to-guess URL generated automatically when
an organizer creates it:

```
https://<your-domain>/exam/<slug>
# e.g. /exam/physics-midterm-k7q9x2m4pz
```

- The slug is `<3 title words>-<10 random chars>` and is unique per exam.
- Organizers can copy the link with one click, disable/enable the link, set a
  start/end time window, and regenerate the link (the old one stops working).
- Student sessions are scoped to the exam slug: a login for exam A never works
  for exam B.
- Invalid or expired links show a friendly "Exam not found" page.
- Students who are not logged in are redirected to that exam's login page.

Routes:

| URL | Page |
| --- | ---- |
| `/` | Public landing page (no login form; exam-link/code lookup + organizer CTA) |
| `/exam` | "Find your exam" helper (paste a link/code) |
| `/exam/:slug` | Exam-specific student login (Name + Email + Password) |
| `/exam/:slug/instructions` | Instructions (after login) |
| `/exam/:slug/start` | The proctored exam (protected) |
| `/exam/:slug/submitted` | Submission confirmation |
| `/panel-admin` | Organizer dashboard (results, students, questions) |
| `/panel-admin-login` | Organizer sign-in |
| `/organizer` | Alias that redirects to `/panel-admin` |

## How organizers generate credentials

1. Sign in at `/panel-admin-login` (the first account becomes admin via the
   `grant_first_admin` trigger).
2. **Exams tab → New exam**: enter a title, duration and optional start/end
   times. The exam link is generated and copied to your clipboard.
3. Click **Manage** on the exam, then add students:
   - **Add student**: name + email → the system generates a random 10-character
     password (mixed case + digits). It is shown **once** — copy it immediately.
   - **Bulk upload**: paste or upload CSV lines (`Name, email`) → passwords are
     generated for every student.
4. **Download credentials CSV** (Name, Email, Password, Exam Link) right after
   creation, and/or use the per-row **Email** button (opens a pre-filled
   `mailto:` draft in your own mail client — no SMTP is configured server-side).
5. **Regenerate** issues a fresh password for one student (also shown once).
6. Upload the exam's question JSON under the **Questions** tab (same schema as
   before: `{ meta, questions[] }`).

Passwords are stored as salted SHA-256 hashes — never plain text. After 5
failed logins an account locks for 10 minutes.

## Student login

Students open their exam link and sign in with **Full Name + Email + Password**.
The email + password must belong to a student registered for **that** exam.
Clear errors are shown for: invalid credentials, exam not started yet, exam
ended, disabled link, lockout, and already-submitted attempts. Includes
show/hide password toggle and loading states.

## Run the project

Requirements: Node.js 20+ (or Bun), and a Supabase project.

```sh
# install
npm i        # or: bun install

# environment (.env)
SUPABASE_URL="https://<project>.supabase.co"
SUPABASE_PUBLISHABLE_KEY="<publishable key>"
SUPABASE_SERVICE_ROLE_KEY="<service-role key>"   # server only, never VITE_ prefixed
VITE_SUPABASE_URL="https://<project>.supabase.co"
VITE_SUPABASE_PUBLISHABLE_KEY="<publishable key>"

# database — apply migrations (Supabase SQL editor or CLI)
# supabase/migrations/20261006000000_multiexam_platform.sql adds:
#   exams table, participants.exam_id/password_hash columns, exam-aware submit_exam

# develop
npm run dev     # http://localhost:8080

# build / preview
npm run build
npm run preview
```

## Test the full flow

1. Sign in as organizer → **Exams → New exam** → copy the generated link.
2. **Manage** the exam → add a student (note the one-time password) → download
   the credentials CSV. Upload questions under **Questions** if needed.
3. Open the exam link in another browser/incognito → log in with the student's
   name, email and generated password.
4. Accept instructions → start (allow full-screen) → answer → submit.
5. Back as organizer → **Results** → verify the score and export CSV.

## Branding

All branding lives in one file: `src/config/brand.ts` (app name, tagline, logo
mark, support email). Colors live in `src/styles.css`. The default neutral
name is **ExamPortal**.

## Tech

- TanStack Start (SSR + server functions) + TanStack Router (file-based routes)
- React 19, Tailwind CSS 4, shadcn/ui, Supabase (Postgres + Auth)
- No extra auth/crypto libraries: password hashing uses Node `crypto`
