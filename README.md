# Bristol Proteins & Oils — Production Ledger

A multi-device PWA for the fishmeal plant floor. Weighbridge, receiving, production, QC and
management each capture and see live data from their own devices. PIN-only login (no email
fields), offline write-queue on the floor-capture screens, and Realtime for the manager
dashboard.

## The material's journey

A truck is **one GRN record** that advances through states, each touched by a different role.
The security gate stays on paper — its register serial is just typed in at the weighbridge as a
cross-reference.

```
weighed_gross (weighbridge)  →  sampling (receiving)  →  weighed_tare (weighbridge)  →  received
```

Two independent raw-material measures are stored — **weighbridge net** (`gross − tare`) and the
**box-sample estimate** (`avg box × total boxes`). The app flags any truck where they diverge by
more than 5% (configurable in `src/lib/yield.ts`).

## Shift engine (the reporting spine)

- 12-hour shifts, **day 08:00–20:00 / night 20:00–08:00**. At most one open shift at a time
  (enforced by a partial unique index in the DB).
- Every GRN / batch / output created while a shift is open auto-attaches to it.
- Handover carries the balance: `opening = previous shift closing`, and
  `closing = opening + received − fed`.
- Closing a shift **freezes a `shift_report` snapshot** (received / fed / closing / meal-oil-FSP
  output / three yields / verified-by). Later edits never rewrite history.
- **Continuous peak season (24h for 10–15 days)** is just shifts chaining — close one, open the
  next; the calendar date is incidental. Yield is computed at the **shift level** from all raw fed
  and all output in the window, regardless of batch boundaries — so a continuous run still produces
  a clean received/fed/output/yield report every 12 hours. Per-batch yield is shown only as an
  *indicative* figure when a batch has both fed and output logged.

## Rate lockdown

Rate/kg is per truck (per GRN), entered **only by management** on the Dashboard, stored in a
separate `grn_pricing` table with **no read policy for any other role** — invisible at the data
layer everywhere else, even to a raw query.

## Stack

React 18 + Vite + TypeScript + Tailwind + React Router · `@supabase/supabase-js` · `dexie`
(offline queue) · `vite-plugin-pwa`. The client uses the **anon key only**; RLS enforces
everything. No service key is ever shipped to the browser.

## Setup

1. **Create a Supabase project.** Copy the project URL + anon key into `.env`:
   ```
   cp .env.example .env
   # fill in VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY
   ```
2. **Auth → Providers → Email:** turn **OFF** "Confirm email"; set minimum password length to 6.
   (PINs are 6-digit passwords behind hidden `<name>@bristol.local` accounts.)
3. **SQL Editor → run `supabase/schema.sql`.**
4. **Install & run:**
   ```
   npm install
   npm run dev
   ```
5. **Register yourself** in the app, then promote to manager in the SQL editor:
   ```sql
   update public.profiles set role = 'manager' where name = 'YOUR NAME';
   ```
6. **Log in as manager → Team →** set everyone else's roles.
7. **Deploy** (Vercel / Netlify) with the same two env vars.

## Roles & screens

| Role         | Screens                                              |
|--------------|-----------------------------------------------------|
| weighbridge  | Weighbridge                                         |
| receiving    | Receiving                                           |
| production   | Production, Shift                                   |
| qc           | Reports                                             |
| manager      | everything (incl. Dashboard, Team, rate entry)      |

People may hold several roles; a manager can do everything. Nav shows only the current role's
screens. The security gate is off-app (paper register).

## Offline capture

Weighbridge, Receiving and Production writes go through a Dexie-backed queue keyed by a client
uuid. When offline they're saved locally and replayed on reconnect using **upsert on the row id**,
so a reconnect never creates duplicates. The header shows an offline / syncing chip with the
pending count.

## Acceptance checks baked in

- One open shift at a time; opening balance = prior shift closing.
- Register no captured per GRN with a soft duplicate-per-day warning.
- gross 24860 / tare 8940 → net 15920; sample 30 boxes / 300 kg → estimate shown; >5% flags.
- Closing a shift freezes a report; later edits don't change it.
- Rate invisible to every non-manager, including via raw query to `grn_pricing`.
- A GRN or output on one device updates the manager dashboard without refresh (Realtime).
- Offline capture syncs on reconnect with no duplicates.
- Continuous multi-day runs work by chaining shifts with balances carried through.
