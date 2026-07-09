-- ===== profiles + role helper + directory =====
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  name text not null unique,
  role text not null default 'weighbridge'
    check (role in ('weighbridge','receiving','production','qc','manager')),
  created_at timestamptz not null default now()
);
create or replace function public.my_role() returns text
  language sql stable security definer set search_path=public as $$
  select role from public.profiles where id = auth.uid() $$;
create or replace function public.handle_new_user() returns trigger
  language plpgsql security definer set search_path=public as $$
begin
  insert into public.profiles(id,name)
  values (new.id, coalesce(new.raw_user_meta_data->>'name', new.email));
  return new;
end $$;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();
create view public.staff_directory as select name from public.profiles order by name;
grant select on public.staff_directory to anon, authenticated;

-- ===== shifts =====
create table public.shift (
  id uuid primary key,
  label text not null check (label in ('day','night')),
  business_date date not null,
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  supervisor_id uuid references public.profiles(id),
  opening_balance_kg numeric not null default 0,
  closing_balance_kg numeric,
  status text not null default 'open' check (status in ('open','closed')),
  created_at timestamptz default now()
);
-- at most one open shift at a time
create unique index one_open_shift on public.shift(status) where status='open';

-- ===== GRN / intake (stateful) =====
create table public.grn (
  id uuid primary key,
  register_no text,                 -- typed off the paper gate register (cross-reference)
  entry_date date not null default current_date,
  shift_id uuid references public.shift(id),
  vehicle_no text not null,
  supplier text,
  driver_name text,
  species text,
  gross_kg numeric,
  tare_kg numeric,
  net_kg numeric generated always as (coalesce(gross_kg,0)-coalesce(tare_kg,0)) stored,
  total_boxes int,
  sample_boxes int,
  sample_weight_kg numeric,
  avg_box_kg numeric generated always as
    (case when sample_boxes>0 then sample_weight_kg/sample_boxes end) stored,
  sampled_estimate_kg numeric generated always as
    (case when sample_boxes>0 then (sample_weight_kg/sample_boxes)*total_boxes end) stored,
  status text not null default 'weighed_gross'
    check (status in ('weighed_gross','sampling','weighed_tare','received','rejected')),
  weighbridge_by uuid references public.profiles(id),
  receiving_by uuid references public.profiles(id),
  arrived_at timestamptz default now(),
  received_at timestamptz,
  remarks text
);

-- ===== rate (MANAGER ONLY) =====
create table public.grn_pricing (
  grn_id uuid primary key references public.grn(id) on delete cascade,
  rate_per_kg numeric,
  amount numeric,
  entered_by uuid references public.profiles(id),
  entered_at timestamptz default now()
);

-- ===== batches + output =====
create table public.batch (
  id uuid primary key,
  batch_no text not null,
  shift_id uuid references public.shift(id),
  raw_fed_kg numeric,
  species_note text,
  operator_id uuid references public.profiles(id),
  started_at timestamptz default now(),
  ended_at timestamptz,
  remarks text
);
create table public.batch_output (
  id uuid primary key,
  batch_id uuid references public.batch(id) on delete cascade,
  product text not null check (product in ('fishmeal','fishoil','fsp')),
  bags int,
  kg_per_bag numeric default 50,
  total_kg numeric,
  created_at timestamptz default now()
);

-- ===== frozen shift report =====
create table public.shift_report (
  id uuid primary key,
  shift_id uuid unique references public.shift(id),
  business_date date,
  label text,
  opening_balance_kg numeric,
  received_kg numeric,
  fed_kg numeric,
  closing_balance_kg numeric,
  fishmeal_kg numeric,
  fishoil_kg numeric,
  fsp_kg numeric,
  yield_fishmeal_pct numeric,
  yield_fishoil_pct numeric,
  yield_fsp_pct numeric,
  verified_by uuid references public.profiles(id),
  generated_at timestamptz default now()
);

-- ===== RLS =====
alter table public.profiles     enable row level security;
alter table public.shift        enable row level security;
alter table public.grn          enable row level security;
alter table public.grn_pricing  enable row level security;
alter table public.batch        enable row level security;
alter table public.batch_output enable row level security;
alter table public.shift_report enable row level security;

create policy "profiles read"   on public.profiles for select to authenticated using (true);
create policy "profiles manage" on public.profiles for update to authenticated
  using (public.my_role()='manager') with check (public.my_role()='manager');

-- shifts: all read; production/manager open+close
create policy "shift read"   on public.shift for select to authenticated using (true);
create policy "shift write"  on public.shift for insert to authenticated
  with check (public.my_role() in ('production','manager'));
create policy "shift update" on public.shift for update to authenticated
  using (public.my_role() in ('production','manager'));

-- grn: all read; weighbridge/receiving/manager insert+update; manager delete
create policy "grn read"   on public.grn for select to authenticated using (true);
create policy "grn insert" on public.grn for insert to authenticated
  with check (public.my_role() in ('weighbridge','receiving','manager'));
create policy "grn update" on public.grn for update to authenticated
  using (public.my_role() in ('weighbridge','receiving','manager'));
create policy "grn delete" on public.grn for delete to authenticated
  using (public.my_role()='manager');

-- rate: MANAGER ONLY (no other role has any policy = zero access)
create policy "pricing manager" on public.grn_pricing for all to authenticated
  using (public.my_role()='manager') with check (public.my_role()='manager');

-- batch/output: all read; production/manager write; manager delete
create policy "batch read"   on public.batch for select to authenticated using (true);
create policy "batch write"  on public.batch for insert to authenticated
  with check (public.my_role() in ('production','manager'));
create policy "batch update" on public.batch for update to authenticated
  using (public.my_role() in ('production','manager'));
create policy "batch delete" on public.batch for delete to authenticated
  using (public.my_role()='manager');
create policy "output read"  on public.batch_output for select to authenticated using (true);
create policy "output write" on public.batch_output for insert to authenticated
  with check (public.my_role() in ('production','manager'));
create policy "output update" on public.batch_output for update to authenticated
  using (public.my_role() in ('production','manager'));
create policy "output delete" on public.batch_output for delete to authenticated
  using (public.my_role()='manager');

-- shift_report: all read; qc/production/manager generate+verify
create policy "report read"  on public.shift_report for select to authenticated using (true);
create policy "report write" on public.shift_report for insert to authenticated
  with check (public.my_role() in ('production','qc','manager'));
create policy "report update" on public.shift_report for update to authenticated
  using (public.my_role() in ('qc','manager'));

-- ===== realtime =====
alter publication supabase_realtime add table public.shift, public.grn, public.batch, public.batch_output, public.shift_report;
