# Contralabos Frontend

A complete construction-management portal — dark navy/gold enterprise UI,
28 pages, full role-based flows — running on **Supabase** (free tier): a
hosted Postgres database, authentication, and file storage, with no server
of your own to run or pay for.

## Getting started

**Follow `supabase/SETUP.md` first** — it walks through creating a free
Supabase project, running the database setup, and connecting this frontend
to it. That file is the actual starting point; this README just documents
what's here once it's running.

Quick version: create a Supabase project → run `supabase/schema.sql`, then
`supabase/functions.sql`, then `supabase/storage.sql` in the SQL Editor →
fill in your project URL and anon key in `js/supabase-client.js` → serve
these files with any static host and open `login.html`.

## Structure

```
contralabos/
├── supabase/
│   ├── SETUP.md          step-by-step setup guide — start here
│   ├── schema.sql         tables + Row Level Security policies
│   ├── functions.sql      derived calculations (budget totals, stock, etc.)
│   ├── storage.sql        file-upload buckets + access policies
│   └── functions/assistant/index.ts   AI chatbot Edge Function (optional)
├── css/
│   ├── tokens.css        colors, type, spacing — single source of truth
│   └── app.css            navbar, sidebar, tables, forms, stepper, charts, chatbot
├── js/
│   ├── supabase-client.js   ← put your project URL + anon key here
│   ├── api.js                real Supabase client (auth, data, storage)
│   ├── i18n.js                EN/HI/MR dictionary (288 keys) + language switcher
│   ├── shell.js               role-based navbar/sidebar, route guarding
│   ├── charts.js              skyline (tower) chart renderer with tooltips
│   ├── chatbot.js             support widget: text + voice, EN/HI/MR
│   └── validate.js            inline form validation, wired site-wide
├── images/                 local photography (user-provided/license-verified)
├── login.html / register.html / forgot-password.html / reset-password.html
├── onboarding.html
├── dashboard.html (contractor) / dashboard-{worker,supervisor,accountant,admin}.html
├── projects.html / project-detail.html
├── workers.html / attendance.html / payments.html
├── materials.html / expenses.html / budget.html / progress.html
├── requests.html / request-detail.html    ← status-tracking workflow
├── documents.html / notifications.html / profile.html / support.html
├── admin.html
└── index.html               session-aware redirect (root entry point)
```

## How security works here

There's no custom backend server checking permissions — Supabase serves
your database's tables directly to the browser. Safety comes entirely from
**Row Level Security (RLS) policies** defined in `supabase/schema.sql`:
every table only returns/accepts rows belonging to your own organization,
enforced by Postgres itself, not by application code that could have bugs.
This is genuinely how Supabase apps are supposed to work, not a shortcut.

## What's real vs. known gaps

**Fully real:** authentication (Supabase Auth — real password hashing,
real sessions), every CRUD operation for projects/workers/attendance/
requests/materials/expenses/payments/progress/documents/notifications, the
full request status-tracking workflow with audit history, file uploads
(avatars/documents/progress media via Supabase Storage), and the AI chatbot
(real Anthropic API call via a Supabase Edge Function if you complete Step 5
in the setup guide — shows a clear "not connected" message otherwise).

**Known gaps, honestly:**
- **Team invites work via sharing your Organization ID**, not email
  invitations — sending real emails would need Supabase's privileged
  `service_role` key, which must never be used in browser code. Simple and
  functional, just not as polished as "click a link in your inbox."
- **The org-directory (Admin → Users) can't show email addresses** — that
  requires an admin-only Supabase API that isn't safe to call from a
  browser with the public key. Name/role/phone/status all still show.
- Pagination is a "Page 1 of 1" label, not real pagination — fine for
  small teams, would need work before thousands of records pile up.
- No automated test suite.
- The Storage bucket policies (`storage.sql`) follow Supabase's documented
  pattern correctly but weren't testable the same way the database schema
  was during development — worth confirming uploads work once you have a
  real project (see `supabase/SETUP.md` for the honest testing breakdown).

## Language switching

Every page's UI chrome (nav, headers, buttons, table columns, status
badges) translates live between English, Hindi, and Marathi with no page
reload. Actual data (names, project titles, amounts) intentionally stays
as-entered in every language — that's standard i18n practice, not a gap.

## Design system

Dark navy (`#0a0d13`) background with a gold (`#c9974a`) accent, Fraunces
serif for headings, Inter for body text, IBM Plex Mono for labels/data.
Internal app pages are deliberately dense and flat — sharp corners, no
gradients, no hover-glow — to read as a real enterprise/government portal
rather than a decorative consumer dashboard.
