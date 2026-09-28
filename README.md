# Bristol Proteins & Oils — Production Ledger

Phone-first React 18 / Vite / TypeScript / Tailwind PWA for truck receiving,
plant feeds, fishmeal and fish oil output, stock, frozen reports, and manager pricing.

## Run the existing app

The Supabase database and staff accounts already exist. **Do not run the reference
schema, recreate tables, or truncate production data.** `supabase/schema.sql` is
reference material only.

1. Copy `.env.example` to `.env`.
2. Set `VITE_SUPABASE_URL=https://wougpnmozbvrhnpkesjg.supabase.co` and the project's
   publishable/anon key. Never use a service-role key. Do not commit `.env` or PINs.
3. `npm ci`
4. `npm run dev`
5. Pick your name and enter your existing six-digit PIN.

New registrations begin as weighbridge; managers change roles in Team. Permissions
are enforced by the existing Supabase RLS policies, with additional navigation gates.

## Workflows

- Trucks: weigh loaded → count/sample boxes → weigh empty → confirm received.
- Day shifts start at 08:00; night shifts at 20:00. After midnight a night shift uses
  the previous local date. Plant devices should use the plant's local timezone.
- Opening balance carries from the previous closed shift. Infeed balance is opening
  + received truck net weight − fed weight.
- Feeds are numbered per shift. Outputs attach to the latest feed and appear in Stock.
  Yield is calculated by `lib/yield.ts`; shift totals combine all feeds and outputs.
- Closing creates an unverified frozen report. QC/manager verifies it separately.
- Dashboard exports five styled Excel sheets, loaded lazily, and UTF-8 BOM CSV files.
  Date ranges use shift business dates for production/stock/reports and entry dates
  for trucks/pricing. Workbook production yields are indicative per feed; official
  shift yields are in Shift Reports.

## Offline capture

Truck, feed, and output writes are durably queued in Dexie before sending. Inserts
upsert on their client UUID. An ordered single drain retries on startup, reconnect,
and every 20 seconds. Network failures remain queued; other failures are removed
and shown to the operator. Pending rows overlay cached reads, so locally captured
feeds can receive output and truck steps can advance while offline. Cached reads
and new mutations belong to the signed-in staff member; another login cannot send
their queued writes. Sign back in as the original person to send their records.

The offline shell and cached records require a prior online visit/sign-in. Starting
and ending shifts require a connection. Sync saved records on **all devices** before
ending a shift.

## Existing-schema constraints

No database changes are made by this application update. The supplied schema has
no transactional shift-closing RPC. The report is inserted first, then the shift is
closed. If closing fails, retry reuses the original report and its balance, without
recalculating or overwriting it. Concurrent captures on another device during close
cannot be atomically excluded with this schema. Coordinate shift handover on the floor.

The existing RLS allows QC/managers to update report rows; the UI updates only
`verified_by`. Database-level immutability against direct API writes would require
separate, explicitly approved policy/trigger changes. Similarly, concurrent operators
can choose the same feed number because the supplied schema has no per-shift sequence
or uniqueness constraint. Row UUIDs remain unique.

The supplied Realtime publication excludes `grn_pricing`; the dashboard listens for
it and also refreshes periodically, so pricing still updates without a page reload.

## Tests

- `npm test`: arithmetic, midnight dates, CSV escaping, pagination, offline replay,
  generated-column exclusion, shared-device ownership, and stale-read refusal.
- `npm run test:e2e`: Chrome locally / Playwright Chromium in CI; mocked Supabase
  only, never real PINs or live writes. Covers truck steps, feed/output/stock,
  close retry and frozen report, QC verification, offline retry, role routing,
  five-sheet Excel contents, and phone layout.
- `npm run build`: type-check and production/PWA build.

GitHub Actions runs checks on feature branches and pull requests. Local browser
execution may need an environment that permits launching Chrome.

## GitHub Pages

`.github/workflows/deploy.yml` deploys pushes to `main`. Repository secrets:
`VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`. Pages source must be GitHub Actions.
The Vite base is `/bristol-production-ledger/` in Actions and `/` locally; the deploy
workflow copies `index.html` to `404.html` for direct route loads.
