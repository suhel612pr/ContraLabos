# Contralabos — Supabase Setup Guide

This gets Contralabos running entirely on Supabase's **free tier** — no server
to rent, no Docker, nothing to pay for. You get a hosted Postgres database,
authentication, and file storage, and the frontend talks to all three
directly.

## What you'll need
- A free [Supabase](https://supabase.com) account
- A free static host for the frontend files — [Netlify](https://netlify.com),
  [Vercel](https://vercel.com), [GitHub Pages](https://pages.github.com), or
  just opening the files locally while you test

## Step 1 — Create your Supabase project
1. Go to [supabase.com](https://supabase.com) → New Project
2. Pick any name/region, set a database password (save it somewhere — you
   won't need it directly, Supabase manages the connection for you)
3. Wait ~2 minutes for it to provision

## Step 2 — Run the database setup
In your Supabase dashboard, go to **SQL Editor → New query**, and run these
**three files, in this exact order** (copy-paste each one's full contents,
run, then move to the next):

1. `schema.sql` — creates every table and Row Level Security policy
2. `functions.sql` — adds the calculated views/functions (budget totals,
   material stock, dashboard numbers) that a plain table query can't do
3. `storage.sql` — creates the three file-storage buckets and their access
   rules

If any of these fail partway through, check the error message — it's almost
always because a previous step didn't fully complete. You can safely re-run
`schema.sql` from a completely fresh project if needed (it will fail loudly
on a project that already has these tables, which is expected).

**What I verified vs. what I couldn't:** `schema.sql` and `functions.sql`
were tested against a real local PostgreSQL instance during development —
every table, policy, view, and function was confirmed to actually run
correctly, including a live signup simulation that confirmed the
auto-profile-creation trigger works. `storage.sql` uses Supabase's
documented, standard pattern for bucket policies but couldn't be tested the
same way, since Supabase's storage system doesn't exist in plain Postgres —
worth double-checking file uploads work once you have a real project.

## Step 3 — Get your API keys
In your Supabase dashboard: **Project Settings → API**. You need two values:
- **Project URL** (looks like `https://abcdefgh.supabase.co`)
- **anon public** key (a long string starting with `eyJ...`)

**Never use the `service_role` key anywhere in the frontend** — it bypasses
all the security policies you just set up. Only the `anon` key belongs in
browser code.

## Step 4 — Configure the frontend
Open `js/supabase-client.js` and fill in the two values from Step 3:

```js
const SUPABASE_URL = "https://abcdefgh.supabase.co";
const SUPABASE_ANON_KEY = "eyJ...your-anon-key...";
```

That's the only file you need to edit. Everything else already points at
these two constants.

## Step 5 — (Optional) Enable the AI chatbot
The chatbot works without this step — it just shows a clear "not connected"
message instead of a fake canned reply. To make it actually respond:

1. Install the [Supabase CLI](https://supabase.com/docs/guides/cli)
2. From this project's folder: `supabase login`, then `supabase link --project-ref your-project-ref`
3. `supabase functions deploy assistant`
4. Get a free-to-start API key at [console.anthropic.com](https://console.anthropic.com)
5. `supabase secrets set ANTHROPIC_API_KEY=sk-ant-your-real-key`

**I could not test this Edge Function running for real** — it needs the
Supabase CLI and a live deployment target neither of which exist in the
environment I built this in. The code follows Supabase's documented Edge
Function format exactly, but treat it as unverified until you deploy it
yourself and send a real test message.

## Step 6 — Create your first account
1. Serve the frontend — easiest is `python3 -m http.server 8080` from this
   folder, then open `http://localhost:8080/login.html`
2. Click **Register** → choose **Contractor/Owner** → fill in your details
   and an organization name → Create Account
3. You're now signed in as that organization's first Contractor. Go to
   **Profile** to find your **Organization ID** — share it with teammates so
   they can join via **Register → Join a team**

## Step 7 — Deploy the frontend somewhere real (optional, still free)
Drag-and-drop this whole folder onto [Netlify Drop](https://app.netlify.com/drop),
or connect the folder to Vercel/GitHub Pages. No build step, no configuration
needed beyond what you already did in Step 4.

## If something doesn't work
- **"relation does not exist" errors**: you likely ran the SQL files out of
  order, or skipped one. Re-run `schema.sql` → `functions.sql` → `storage.sql`
  in that exact sequence.
- **Login says "Invalid login credentials"**: double check you registered
  first (Step 6) — there's no pre-seeded demo account, since this is your own
  fresh Supabase project.
- **File uploads fail**: confirm `storage.sql` ran successfully and that
  `js/supabase-client.js` has your real project URL/key, not the placeholder
  text.
- **Chatbot always says "not connected"**: expected unless you completed
  Step 5 — it's not a bug, it's the honest default state.
