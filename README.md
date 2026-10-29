# Resumed Study Tracker

A productivity web app for first-year medical students, built from the **Resumed Planner** PDF
(design, mascot, illustrations and Year 1 course structure). React front-end + **Supabase**
(PostgreSQL, Auth, Row Level Security). Works on phones (Android/iOS), tablets and computers, and can
be installed to the home screen (PWA manifest).

```
supabase/migrations/001_schema.sql              tables, RLS policies, admin + timer functions, initial-admin setup
supabase/migrations/002_seed_year1_curriculum.sql  Year 1 S1 + S2 modules and lessons transcribed from the PDF
supabase/curriculum_year1.json                  the same curriculum as data (with PDF page numbers)
src/                                            React app (no framework lock-in, ~100 KB gzipped)
public/assets/                                  mascot, illustrations and 195 lesson icons extracted from the PDF
tests/                                          database tests (SQL) and end-to-end browser tests (Playwright)
tools/                                          scripts used to transcribe the PDF and extract its artwork
```

---

## 1. Create the database (Supabase) — about 10 minutes

1. Create a free project at <https://supabase.com> (choose a region close to your students, e.g. Europe).
2. **Authentication → Sign In / Providers → Email**: keep **Email** enabled and **Confirm email ON**.
   *Confirm email must stay ON — it is what makes the admin setup secure (see §2).*
3. **Authentication → URL Configuration**:
   - **Site URL**: the address where you will host the app (e.g. `https://resumed.netlify.app`).
   - **Redirect URLs**: add `https://YOUR-APP-ADDRESS/**` (and `http://localhost:8080/**` if you test locally).
4. **SQL Editor → New query**: paste the whole content of `supabase/migrations/001_schema.sql`, click **Run**.
   Then do the same with `supabase/migrations/002_seed_year1_curriculum.sql`.
   Both scripts can be re-run safely; the seed never overwrites changes you made later in the admin screen.
5. **Project Settings → API**: copy the **Project URL** and the **anon / publishable** key.
   **Never** copy the `service_role` / secret key anywhere in the app.

## 2. Set up the administrator account (ckm25.dz@gmail.com)

The administrator e-mail is stored in the database (table `app_config`, key `initial_admin_email`),
**not** in the code, and no password is stored anywhere in the project.

1. Open the deployed app → **Create account** → register with **ckm25.dz@gmail.com** and a strong password of your choice.
2. Open the confirmation e-mail Supabase sends and click the link.
3. Sign in. The account is automatically promoted to **admin / approved** — the **Admin** entry appears in the menu.

Why this is safe: the promotion only happens once that e-mail address is **confirmed**. Someone who registers
with your address before you cannot click your confirmation link, so their account stays a pending student
(and you can reject it).

*Alternative:* Supabase dashboard → **Authentication → Users → Add user → Create new user**, e-mail
`ckm25.dz@gmail.com`, your password, tick **Auto Confirm User**. It becomes admin immediately.

*To change the admin e-mail later*, run in the SQL editor:
`update app_config set value = 'new@address.com' where key = 'initial_admin_email';`
then create/confirm that account as above.

## 3. Configure and deploy the app

```bash
npm install
cp public/config.example.js public/config.js     # then edit: supabaseUrl + supabaseAnonKey
npm run build                                    # output in dist/
```

Upload the **`dist/`** folder to any static host — e.g. Netlify (drag-and-drop `dist/` at app.netlify.com/drop),
Vercel, Cloudflare Pages or GitHub Pages. No server rewrites are needed (the app uses `#/` routes).
You can also edit `dist/config.js` directly after building; it is plain JavaScript loaded at runtime.

Local preview: `npx serve dist` (or any static server), then open the printed address.
Development: `npm run dev` rebuilds `dist/` on every change.

Recommended in Supabase for production: set up a custom SMTP sender (**Authentication → Emails → SMTP**) —
the built-in sender is rate-limited and meant for testing — and keep **leaked-password protection** on if your plan offers it.

---

## How access control works

| | |
|---|---|
| Roles | `admin`, `student` (column `profiles.role`) |
| Statuses | `pending` (default for every signup), `approved`, `rejected`, `suspended` |
| Who changes them | Only the admin, only through the database function `admin_set_status` (checks the caller is an approved admin, refuses invalid transitions, writes an audit log). |
| Self-promotion | Impossible: column-level grants + a trigger reject any change to `role`/`status`/`email` through the API, even by the admin. |
| Data isolation | Every personal table has RLS `user_id = auth.uid() and is_approved()` — a student can never read or write another student's rows. |
| Pending / rejected / suspended | The API returns **no data** to them (RLS), and the app shows the right page whatever URL is typed. |
| Suspension | Takes effect on the next request (RLS checks the status every time); the user's sessions are also deleted so their refresh token stops working. Their data is kept and comes back on reactivation. |
| Shared curriculum | Readable by approved users; writable only by the admin. |
| Admin privacy | The admin sees e-mails, dates and statuses — **not** students' notes, tasks or progress. |
| Secrets | Only the public anon key is in the front-end. No service-role key, no password anywhere. |

## Database structure (summary)

| Table | Purpose / key constraints |
|---|---|
| `profiles` | id (= auth user), email, display_name, role, status, selected_year, selected_semester, timestamps |
| `modules` | tree of subjects → chapters (`parent_id`), year, semester, title, description, icon, hero, position, active |
| `lessons` | module_id, number (as printed), title, icon, note, position, active |
| `lesson_progress` | **PK (user_id, lesson_id)** → no duplicate completion; learned / revised1 / revised2 / qcm + their dates |
| `planner_tasks` | user_id, title, description, task_date, start/end time, priority, category, status, completed_at, notes, module/lesson link |
| `weekly_notes` | **PK (user_id, week_start)** (Monday) — goals, reminders, study notes, topics to review, planning notes, version |
| `notes` | global notes: title, content, version, created_at, updated_at |
| `pomodoro_settings` | durations, sessions before long break, sound |
| `timer_state` | server-side timer: phase, status, duration, accumulated active seconds, running_since, association |
| `study_sessions` | **PK = timer session id** (never stored twice), active vs planned seconds, start/end, status, module/lesson/task |
| `user_preferences` | language + small UI preferences (e.g. last module studied) |
| `admin_audit_log` | every approve / reject / suspend / reactivate decision |

**Progress** of a module = lessons marked *Learned* ÷ active lessons in the module and its chapters × 100,
computed from the saved `lesson_progress` rows (never from study time). *Revised 1 / Revised 2 / QCM* —
the four columns shown in the PDF — are tracked and displayed separately.

**Persistence guarantees:** nothing is ever initialised to zero on login; pages show a loader until the real
data has arrived; every change is shown as done only after the database confirms it; failed saves keep what
was typed and offer *Retry*; notes use version numbers so a save from another device is detected instead of
silently overwritten; logout only ends the session.

**Pomodoro:** the timer is a server-side state machine based on timestamps, so refresh, closing the browser
or switching device never loses or double-counts time. Paused time is excluded from study time; a session is
recorded once (completed), or as *interrupted* if reset/skipped after ≥ 1 min of active focus.

---

## PDF verification report

All **42 pages** were rendered and inspected (layout pages 1–7 and 23, course pages 8–42).

| PDF pages | Used for |
|---|---|
| 1 | Login screen (mascot pose, logo, teal background, "Plan · Study · Track · Succeed") |
| 2, 6 | Dashboard / welcome and semester selection (S1/S2 cards, feature cards and their illustrations) |
| 3 | Weekly Planner layout (day cards, "Rappelle-toi" affirmations, motto) |
| 4 | Pomodoro layout (study illustration, ring timer, tomato) |
| 5 | Notes page (lined paper, decorations) |
| 7, 23 | S1 and S2 subject lists, in that order |
| 8–22 | S1 courses: Anatomie (Généralités, Ostéologie, Arthrologie, Myologie, Angiologie, Névrologie), Biochimie (Glucides, Protéines), Biophysique, Chimie, Cytologie, Embryologie, Statistiques/Biostat |
| 24–42 | S2 courses: SSH, Anatomie (6 chapters), Biochimie (Bioénergétique, Enzymes, Lipides), Biophysique, Chimie (générale, organique), Cytologie, Histologie, Physiologie, Statistiques/Biostat |

Result: **35 modules/chapters and 160 lessons**, in the PDF order, with the PDF titles and spelling, each with
its own icon cropped from the PDF (195 icons) and each module page with its own header art (36 crops).

**Points that need your decision or a clearer source** (nothing was invented to fill them):
1. **PDF p.19 (Chimie S1)** — the row between *"06. a. LA LIAISON CHIMIQUE"* and *"07."* is blurred/corrupted
   and unreadable. It is stored as an **inactive placeholder** (not counted in progress). Fill in its title in
   *Admin → Modules & lessons* and tick *Active*.
2. **PDF p.25 (Anatomie S2)** lists *"01. Généralités"* but no lesson page was provided → the chapter exists
   with an empty state ("No lessons yet").
3. **PDF p.30 (Neurologie S2)** starts at *"02. Plexus lombaire"*; no *"01."* is visible.
4. **PDF p.16 (Les glucides)**: 9 lessons are visible; the list may continue behind the bottom navigation bar.
5. Spelling kept exactly as printed (please confirm): "Névérologie" on p.8 vs "Névrologie" on p.14 (the app uses
   the page title *Névrologie*), "Les déterminants de santé craduation", "notions de besoin de demande et d offre de soins",
   "bioethics", "Plexus sacrée", and both "articulation de la cheville" and "ANKLE JOINT" (p.27).
6. The PDF contains lesson **titles only** (no medical text), so no scientific content was transferred or written.

**Assets:** the mascot is reused from the PDF in 6 poses/crops (login, wave, study scene, per-page portraits) on
the login, pending, year/semester, dashboard, sidebar, empty-state and module screens. The PDF has no
transparent cut-outs and no background-removal tool was available, so illustrations are **feathered crops**
of the original pages (not redrawn, not AI-generated). Typography is approximated with Google Fonts
(Kalam, Patrick Hand, Nunito); colours were sampled from the PDF.

---

## Tests (all run on the final build)

`npm run test:db` — 79 checks against a real PostgreSQL 16 with the migrations applied (a minimal stand-in
replaces Supabase's `auth` schema): approval workflow, self-promotion attempts, cross-student isolation,
40 % → 50 % → 40 % progress, duplicate protection, version conflicts, suspension, Pomodoro state machine
(pause excluded, browser closed for 3 h, two devices completing at once, early completion refused).

`npm run test:e2e` — 33 browser scenarios (Chromium; phone 375 px, tablet 820 px, desktop 1440 px) driving the
real app against a local server that speaks the Supabase Auth/REST protocols and runs every query in the same
PostgreSQL under the real RLS policies. Covers all 17 tests of the specification plus duplicate e-mail, wrong
password, URL bypass attempts, password reset by e-mail, token expiry and refresh, admin curriculum editing,
injected database failures, cross-device note conflicts, layout overflow on every route and console errors.

| Spec test | Result |
|---|---|
| 1 Registration → pending, visible to admin | ✅ |
| 2 Approve grants / reject & suspend deny | ✅ |
| 3 Students cannot change permissions | ✅ (API returns 403) |
| 4 No access to another student's data | ✅ (read, update, delete, insert all blocked) |
| 5 4 of 10 lessons → 40 % ("Les lipides") | ✅ |
| 6 Logout/login keeps 40 % | ✅ |
| 7 Refresh keeps 40 % (first value rendered is 40 %, never 0 %) | ✅ |
| 8 Other device (tablet) shows 40 % | ✅ |
| 9 Another lesson → 50 % | ✅ |
| 10 Reopening a lesson → 40 % | ✅ |
| 11 Modules independent | ✅ |
| 12 Tasks + weekly notes survive logout | ✅ |
| 13 Previous weeks accessible, new week erases nothing | ✅ |
| 14 Pomodoro restore, no duplicates | ✅ |
| 15 Statistics match saved data | ✅ |
| 16 DB failures never erase progress; no false "Saved" | ✅ |
| 17 Routes, buttons, responsive layouts | ✅ |

## Remaining limitations

- **Not yet run against a live Supabase project** (no project or credentials were available here). The SQL was
  executed on PostgreSQL 16 and the browser tests used a protocol-compatible stand-in, so the remaining risk is
  limited to Supabase-specific configuration (e-mail settings, redirect URLs). On hosted Supabase, if the
  database is not allowed to delete sessions, suspension still cuts data access instantly; the old login token
  then simply expires within its normal lifetime (1 h by default).
- E-mail confirmation and password-reset e-mails are sent by Supabase; configure SMTP for real use.
- Years 2–7 are shown as "Not available yet" (no content in the PDF). The admin can add modules for them later.
- Only English UI for now; strings live in `src/lib/i18n.js`, ready for French or Arabic dictionaries. Course
  titles stay in their original language.
- No dark theme (the spec marked it optional). No offline mode: changes need a connection, and the app says so.
- Changes made on one device appear on another when that screen is reopened or the app regains focus
  (no live push updates).
- Fonts load from Google Fonts; on networks that block it, a fallback font is shown.
