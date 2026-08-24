-- ============================================================================
-- JIO CLUB v7 — Supabase Schema (Complete)
-- Run this ENTIRE file in Supabase SQL Editor (one paste, one Run).
-- It is IDEMPOTENT: safe to re-run. Drops the old v5 tables first.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- STEP 0: Cleanup — old v5/v6 tables (firebase-era)
-- ----------------------------------------------------------------------------
drop table if exists public.coupon_usages cascade;
drop table if exists public.admin_logs cascade;
drop table if exists public.announcements cascade;
drop table if exists public.notifications cascade;
drop table if exists public.chats cascade;
drop table if exists public.bets cascade;
drop table if exists public.deposits cascade;
drop table if exists public.withdrawals cascade;
drop table if exists public.results cascade;
drop table if exists public.coupons cascade;
drop table if exists public.settings cascade;
drop table if exists public.admin_log cascade;
drop table if exists public.profiles cascade;
drop table if exists public.users cascade;
drop table if exists public.games cascade;
drop table if exists public.admin_settings cascade;
drop table if exists public.red_envelopes cascade;
drop table if exists public.tickets cascade;
drop table if exists public.logs cascade;

-- ----------------------------------------------------------------------------
-- STEP 1: Tables
-- ----------------------------------------------------------------------------

-- 1.1 Profiles (1:1 with auth.users)
create table public.profiles (
  id             uuid primary key references auth.users(id) on delete cascade,
  email          text not null default '',
  phone          text not null default '',
  upi_id         text not null default '',
  balance        numeric(12,2) not null default 0,
  role           text not null default 'user' check (role in ('user','admin')),
  status         text not null default 'active' check (status in ('active','blocked')),
  referral_code  text not null unique,
  referred_by    uuid references public.profiles(id) on delete set null,
  rank           text not null default 'bronze',
  referral_count int not null default 0,
  bonus_applied  boolean not null default false,
  total_deposits numeric(12,2) not null default 0,
  total_withdrawn numeric(12,2) not null default 0,
  total_bet      numeric(12,2) not null default 0,
  total_won      numeric(12,2) not null default 0,
  created_at     timestamptz not null default now(),
  last_seen      timestamptz not null default now()
);

-- 1.2 Settings — key/value (admin editable)
create table public.settings (
  key   text primary key,
  value jsonb not null
);

-- 1.3 Game results (server-generated only)
create table public.results (
  period_id  text primary key,
  number     int not null check (number between 0 and 9),
  color      text not null,
  size       text not null,
  created_at timestamptz not null default now()
);
create index results_created_idx on public.results(created_at desc);

-- 1.4 Bets
create table public.bets (
  id         bigint generated always as identity primary key,
  uid        uuid not null references public.profiles(id) on delete cascade,
  period_id  text not null,
  type       text not null check (type in ('color','number','size')),
  selection  text not null,
  amount     numeric(12,2) not null check (amount > 0),
  payout     numeric(8,2) not null default 0,
  result     text not null default 'pending' check (result in ('pending','win','lose')),
  win_amount numeric(12,2) not null default 0,
  created_at timestamptz not null default now()
);
create index bets_period_idx on public.bets(period_id, result);
create index bets_uid_idx on public.bets(uid, created_at desc);

-- 1.5 Deposits
create table public.deposits (
  id             bigint generated always as identity primary key,
  uid            uuid not null references public.profiles(id) on delete cascade,
  amount         numeric(12,2) not null check (amount > 0),
  upi_ref        text not null default '',
  screenshot_url text not null default '',
  payment_mode   text not null default 'upi',
  status         text not null default 'pending' check (status in ('pending','approved','rejected')),
  note           text not null default '',
  processed_at   timestamptz,
  created_at     timestamptz not null default now()
);
create index deposits_status_idx on public.deposits(status, created_at desc);
create index deposits_uid_idx on public.deposits(uid, created_at desc);

-- 1.6 Withdrawals
create table public.withdrawals (
  id             bigint generated always as identity primary key,
  uid            uuid not null references public.profiles(id) on delete cascade,
  amount         numeric(12,2) not null check (amount > 0),
  upi_id         text not null default '',
  status         text not null default 'pending' check (status in ('pending','approved','rejected')),
  note           text not null default '',
  processed_at   timestamptz,
  created_at     timestamptz not null default now()
);
create index withdrawals_status_idx on public.withdrawals(status, created_at desc);
create index withdrawals_uid_idx on public.withdrawals(uid, created_at desc);

-- 1.7 Coupons
create table public.coupons (
  code        text primary key,
  amount      numeric(12,2) not null check (amount > 0),
  min_balance numeric(12,2) not null default 0,
  max_uses    int not null default 0,
  used_count  int not null default 0,
  expires_at  timestamptz,
  active      boolean not null default true,
  created_at  timestamptz not null default now()
);

-- 1.8 Coupon usages
create table public.coupon_usages (
  uid        uuid not null references public.profiles(id) on delete cascade,
  code       text not null references public.coupons(code) on delete cascade,
  amount     numeric(12,2) not null,
  created_at timestamptz not null default now(),
  primary key (uid, code)
);

-- 1.9 Announcements
create table public.announcements (
  id         bigint generated always as identity primary key,
  title      text not null,
  body       text not null,
  priority   text not null default 'info' check (priority in ('info','warning','success')),
  active     boolean not null default true,
  created_at timestamptz not null default now()
);

-- 1.10 Notifications (uid null = broadcast)
create table public.notifications (
  id         bigint generated always as identity primary key,
  uid        uuid references public.profiles(id) on delete cascade,
  title      text not null,
  body       text not null,
  read       boolean not null default false,
  created_at timestamptz not null default now()
);
create index notifications_uid_idx on public.notifications(uid, created_at desc);

-- 1.11 Chats (public feed)
create table public.chats (
  id         bigint generated always as identity primary key,
  uid        uuid not null references public.profiles(id) on delete cascade,
  name       text not null,
  rank       text not null default 'bronze',
  message    text not null check (char_length(message) between 1 and 500),
  created_at timestamptz not null default now()
);
create index chats_created_idx on public.chats(created_at desc);

-- 1.12 Admin logs
create table public.admin_logs (
  id         bigint generated always as identity primary key,
  admin_id   uuid references public.profiles(id) on delete set null,
  action     text not null,
  detail     jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

-- ----------------------------------------------------------------------------
-- STEP 2: Helper function — is_admin (security definer, no RLS recursion)
-- ----------------------------------------------------------------------------
create or replace function public.is_admin()
returns boolean
language sql stable security definer set search_path = public
as $$
  select coalesce((select role from public.profiles where id = auth.uid()), 'user') = 'admin'
$$;

-- ----------------------------------------------------------------------------
-- STEP 3: RLS policies
-- ----------------------------------------------------------------------------
alter table public.profiles enable row level security;
alter table public.settings enable row level security;
alter table public.results enable row level security;
alter table public.bets enable row level security;
alter table public.deposits enable row level security;
alter table public.withdrawals enable row level security;
alter table public.coupons enable row level security;
alter table public.coupon_usages enable row level security;
alter table public.announcements enable row level security;
alter table public.notifications enable row level security;
alter table public.chats enable row level security;
alter table public.admin_logs enable row level security;

-- profiles
drop policy if exists "profiles_select" on public.profiles;
create policy "profiles_select" on public.profiles for select using (id = auth.uid() or public.is_admin());
drop policy if exists "profiles_admin_write" on public.profiles;
create policy "profiles_admin_write" on public.profiles for all using (public.is_admin()) with check (public.is_admin());

-- settings
drop policy if exists "settings_read" on public.settings;
create policy "settings_read" on public.settings for select using (auth.uid() is not null);
drop policy if exists "settings_admin_write" on public.settings;
create policy "settings_admin_write" on public.settings for all using (public.is_admin()) with check (public.is_admin());

-- results
drop policy if exists "results_read" on public.results;
create policy "results_read" on public.results for select using (true);

-- bets
drop policy if exists "bets_select" on public.bets;
create policy "bets_select" on public.bets for select using (uid = auth.uid() or public.is_admin());
drop policy if exists "bets_admin_write" on public.bets;
create policy "bets_admin_write" on public.bets for all using (public.is_admin()) with check (public.is_admin());

-- deposits
drop policy if exists "deposits_select" on public.deposits;
create policy "deposits_select" on public.deposits for select using (uid = auth.uid() or public.is_admin());
drop policy if exists "deposits_insert_own" on public.deposits;
create policy "deposits_insert_own" on public.deposits for insert with check (uid = auth.uid() and status = 'pending');
drop policy if exists "deposits_admin_write" on public.deposits;
create policy "deposits_admin_write" on public.deposits for all using (public.is_admin()) with check (public.is_admin());

-- withdrawals
drop policy if exists "withdrawals_select" on public.withdrawals;
create policy "withdrawals_select" on public.withdrawals for select using (uid = auth.uid() or public.is_admin());
drop policy if exists "withdrawals_admin_write" on public.withdrawals;
create policy "withdrawals_admin_write" on public.withdrawals for all using (public.is_admin()) with check (public.is_admin());

-- coupons
drop policy if exists "coupons_read" on public.coupons;
create policy "coupons_read" on public.coupons for select using (true);
drop policy if exists "coupons_admin_write" on public.coupons;
create policy "coupons_admin_write" on public.coupons for all using (public.is_admin()) with check (public.is_admin());

-- coupon_usages
drop policy if exists "usages_select" on public.coupon_usages;
create policy "usages_select" on public.coupon_usages for select using (uid = auth.uid() or public.is_admin());

-- announcements
drop policy if exists "announcements_read" on public.announcements;
create policy "announcements_read" on public.announcements for select using (active = true or public.is_admin());
drop policy if exists "announcements_admin_write" on public.announcements;
create policy "announcements_admin_write" on public.announcements for all using (public.is_admin()) with check (public.is_admin());

-- notifications
drop policy if exists "notifications_read" on public.notifications;
create policy "notifications_read" on public.notifications for select using (auth.uid() is not null and (uid = auth.uid() or uid is null));
drop policy if exists "notifications_insert" on public.notifications;
create policy "notifications_insert" on public.notifications for insert with check (auth.uid() is not null and (uid = auth.uid() or public.is_admin()));
drop policy if exists "notifications_update_own" on public.notifications;
create policy "notifications_update_own" on public.notifications for update using (uid = auth.uid());
drop policy if exists "notifications_admin_write" on public.notifications;
create policy "notifications_admin_write" on public.notifications for all using (public.is_admin()) with check (public.is_admin());

-- chats
drop policy if exists "chats_read" on public.chats;
create policy "chats_read" on public.chats for select using (true);
drop policy if exists "chats_insert_own" on public.chats;
create policy "chats_insert_own" on public.chats for insert with check (uid = auth.uid());
drop policy if exists "chats_delete_own_or_admin" on public.chats;
create policy "chats_delete_own_or_admin" on public.chats for delete using (public.is_admin() or uid = auth.uid());

-- admin_logs
drop policy if exists "admin_logs_admin" on public.admin_logs;
create policy "admin_logs_admin" on public.admin_logs for select using (public.is_admin());
drop policy if exists "admin_logs_insert" on public.admin_logs;
create policy "admin_logs_insert" on public.admin_logs for insert with check (public.is_admin());

-- ----------------------------------------------------------------------------
-- STEP 4: New-user trigger — auto profile + referral code
-- ----------------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  v_code text;
begin
  v_code := upper(substr(md5(gen_random_uuid()::text), 1, 6));
  while exists (select 1 from public.profiles where referral_code = v_code) loop
    v_code := upper(substr(md5(gen_random_uuid()::text), 1, 6));
  end loop;
  insert into public.profiles (id, email, referral_code)
  values (new.id, coalesce(new.email, ''), v_code)
  on conflict (id) do update set email = coalesce(excluded.email, public.profiles.email);
  return new;
end
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

-- Backfill profiles for pre-existing auth users (idempotent, crash-safe)
do $$
begin
  insert into public.profiles (id, email, referral_code)
  select u.id, coalesce(u.email, ''),
         upper(substr(md5(u.id::text || u.created_at || coalesce(u.email, '')), 1, 6))
  from auth.users u
  where not exists (select 1 from public.profiles p where p.id = u.id)
  on conflict do nothing;
exception when others then
  raise notice 'Profile backfill skipped (non-fatal): %', sqlerrm;
end $$;

-- ----------------------------------------------------------------------------
-- STEP 5: Rank helper
-- ----------------------------------------------------------------------------
create or replace function public.rank_for_count(p_count int)
returns text
language plpgsql stable
as $$
declare
  v_ref  jsonb;
  v_thr  jsonb;
  v_name text := 'bronze';
begin
  select value into v_ref from public.settings where key = 'referral';
  v_ref := coalesce(v_ref, '{"thresholds":[{"rank":"bronze","min":0},{"rank":"silver","min":3},{"rank":"gold","min":10},{"rank":"platinum","min":25},{"rank":"diamond","min":50}]}'::jsonb);
  for v_thr in select value from jsonb_array_elements(coalesce(v_ref->'thresholds','[]'::jsonb)) order by (value->>'min')::int asc
  loop
    if p_count >= (v_thr->>'min')::int then v_name := v_thr->>'rank'; end if;
  end loop;
  return v_name;
end
$$;

-- ----------------------------------------------------------------------------
-- STEP 6: settle_period — THE server-side bet settlement (idempotent)
-- Original v5 rules: 0=Red+Violet, even=Red, odd=Green; 0-4=Small, 5-9=Big
-- ----------------------------------------------------------------------------
create or replace function public.settle_period(p_period_id text, p_number int)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_color   text;
  v_size    text;
  v_payouts jsonb;
begin
  if exists (select 1 from public.results where period_id = p_period_id) then
    return; -- already settled (idempotent guard)
  end if;

  v_color := case
    when p_number = 0 then 'Red+Violet'
    when p_number % 2 = 0 then 'Red'
    else 'Green'
  end;
  v_size  := case when p_number >= 5 then 'Big' else 'Small' end;

  insert into public.results (period_id, number, color, size)
  values (p_period_id, p_number, v_color, v_size)
  on conflict (period_id) do nothing;

  select value into v_payouts from public.settings where key = 'payouts';
  v_payouts := coalesce(v_payouts, '{"green":2,"red":2,"violet":4.5,"number":9,"size":2}'::jsonb);

  with s as (
    select b.id,
      case
        when b.type = 'color' and (
             (b.selection = 'Green'  and (v_color = 'Green' or v_color = 'Red+Violet')) or
             (b.selection = 'Red'    and (v_color = 'Red'   or v_color = 'Red+Violet')) or
             (b.selection = 'Violet' and v_color = 'Red+Violet')
           ) then true
        when b.type = 'number' and (b.selection::int) = p_number then true
        when b.type = 'size'   and b.selection = v_size then true
        else false
      end as is_win,
      case
        when b.type = 'color' and b.selection = 'Green'  then (v_payouts->>'green')::numeric
        when b.type = 'color' and b.selection = 'Red'    then (v_payouts->>'red')::numeric
        when b.type = 'color' and b.selection = 'Violet' then (v_payouts->>'violet')::numeric
        when b.type = 'number' then (v_payouts->>'number')::numeric
        when b.type = 'size'   then (v_payouts->>'size')::numeric
        else 0
      end as p_mult
    from public.bets b
    where b.period_id = p_period_id and b.result = 'pending'
  )
  update public.bets b2 set
    result     = case when s.is_win then 'win' else 'lose' end,
    payout     = s.p_mult,
    win_amount = case when s.is_win then b2.amount * s.p_mult else 0 end
  from s
  where b2.id = s.id;

  update public.profiles p set
    balance   = p.balance + w.win_total,
    total_won = p.total_won + w.win_total
  from (
    select uid, sum(win_amount) as win_total
    from public.bets
    where period_id = p_period_id and result = 'win'
    group by uid
  ) w
  where p.id = w.uid;
end
$$;

-- ----------------------------------------------------------------------------
-- STEP 7a: pick_result — WIN PROBABILITY ENGINE
-- Modes (settings.game.winMode):
--   'random'  → fair 10% each number
--   'weighted' → per-number weights (settings.game.numberWeights[10])
--   'target'  → engine picks the candidate number whose win/total stake ratio
--               is closest to settings.game.winTarget (0..1) for THIS period
-- ----------------------------------------------------------------------------
create or replace function public.pick_result(p_period_id text)
returns int
language plpgsql volatile security definer set search_path = public
as $$
declare
  v_game    jsonb;
  v_mode    text;
  v_target  numeric;
  v_weights jsonb;
  v_total_w numeric;
  v_r       numeric;
  v_cand    int;
  v_staked  numeric;
  v_win_amt numeric;
  v_diff    numeric;
  v_best    int := -1;
  v_best_d  numeric := 1e9;
  v_payouts jsonb;
begin
  select value into v_game from public.settings where key = 'game';
  v_game := coalesce(v_game, '{}'::jsonb);
  v_mode := coalesce(v_game->>'winMode', 'random');
  v_target := coalesce((v_game->>'winTarget')::numeric, 0.5);

  -- WEIGHTED mode
  if v_mode = 'weighted' and coalesce(v_game->'numberWeights', '[]'::jsonb) is not null
     and jsonb_array_length(v_game->'numberWeights') = 10 then
    v_weights := v_game->'numberWeights';
    select coalesce(sum((v_weights->i)::numeric), 0) into v_total_w from generate_series(0, 9) i;
    if coalesce(v_total_w, 0) > 0 then
      v_r := random() * v_total_w;
      for v_cand in 0..9 loop
        v_r := v_r - (v_weights->v_cand)::numeric;
        if v_r <= 0 then return v_cand; end if;
      end loop;
      return 9;
    end if;
  end if;

  -- TARGET WIN-RATE mode (uses pending bets of this period)
  if v_mode = 'target' then
    select coalesce(sum(amount), 0) into v_staked
    from public.bets where period_id = p_period_id and result = 'pending';
    if coalesce(v_staked, 0) > 0 then
      select coalesce(value, '{"green":2,"red":2,"violet":4.5,"number":9,"size":2}'::jsonb) into v_payouts
      from public.settings where key = 'payouts';
      for v_cand in 0..9 loop
        select coalesce(sum(
          case
            when b.type = 'color' and b.selection = 'Green'  and (v_cand % 2 = 1 or v_cand = 0) then b.amount * (v_payouts->>'green')::numeric
            when b.type = 'color' and b.selection = 'Red'    and (v_cand % 2 = 0)               then b.amount * (v_payouts->>'red')::numeric
            when b.type = 'color' and b.selection = 'Violet' and (v_cand = 0)                   then b.amount * (v_payouts->>'violet')::numeric
            when b.type = 'number' and (b.selection::int) = v_cand                             then b.amount * (v_payouts->>'number')::numeric
            when b.type = 'size'   and b.selection = case when v_cand >= 5 then 'Big' else 'Small' end then b.amount * (v_payouts->>'size')::numeric
            else 0
          end), 0)
        into v_win_amt
        from public.bets b
        where b.period_id = p_period_id and b.result = 'pending';
        v_diff := abs((coalesce(v_win_amt, 0) / v_staked) - v_target);
        if v_best = -1 or v_diff < v_best_d or (abs(v_diff - v_best_d) < 0.001 and random() < 0.5) then
          v_best := v_cand;
          v_best_d := v_diff;
        end if;
      end loop;
      if v_best >= 0 then return v_best; end if;
    end if;
    -- no pending bets → fall through to random
  end if;

  return (floor(random() * 10))::int;
end
$$;

-- ----------------------------------------------------------------------------
-- STEP 7: tick_game — cron entry (runs every minute, settles last period)
-- ----------------------------------------------------------------------------
create or replace function public.tick_game()
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_game      jsonb;
  v_dur       int;
  v_now       bigint;
  v_cur_start bigint;
  v_start     bigint;
  v_period_id text;
  v_force     int;
  v_num       int;
begin
  select value into v_game from public.settings where key = 'game';
  if v_game is null then return; end if;
  if coalesce((v_game->>'active')::boolean, true) = false then return; end if;
  if coalesce((v_game->>'maintenance')::boolean, false) = true then return; end if;

  v_dur := coalesce((v_game->>'duration')::int, 60);
  if v_dur < 10 then v_dur := 60; end if;

  v_now       := (extract(epoch from now()) * 1000)::bigint;
  v_cur_start := (v_now / (v_dur * 1000)) * (v_dur * 1000);

  -- 1) most recent ended period without a result
  v_start := v_cur_start - v_dur * 1000;
  v_period_id := 'P' || (v_start / 1000);

  if not exists (select 1 from public.results where period_id = v_period_id) then
    v_force := nullif(v_game->>'forceNextResult', 'null')::int;
    if v_force is not null then
      update public.settings set value = jsonb_set(value, '{forceNextResult}', 'null'::jsonb) where key = 'game';
      v_num := v_force;
    else
      v_num := public.pick_result(v_period_id);
    end if;
    perform public.settle_period(v_period_id, v_num);
    return;
  end if;

  -- 2) fallback: settle up to 5 older unsettled periods (after downtime)
  for v_start in select (v_cur_start - i * v_dur * 1000)::bigint from generate_series(2, 6) i
  loop
    v_period_id := 'P' || (v_start / 1000);
    if not exists (select 1 from public.results where period_id = v_period_id) then
      v_num := public.pick_result(v_period_id);
      perform public.settle_period(v_period_id, v_num);
      exit;
    end if;
  end loop;
end
$$;

-- ----------------------------------------------------------------------------
-- STEP 8: place_bet — atomic balance check + deduct + insert (definer)
-- ----------------------------------------------------------------------------
create or replace function public.place_bet(p_type text, p_selection text, p_amount numeric)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_game        jsonb;
  v_dur         int;
  v_now         bigint;
  v_period_start bigint;
  v_period_id   text;
  v_bal         numeric;
  v_bet_id      bigint;
begin
  if auth.uid() is null then raise exception 'unauthorized'; end if;
  if p_type not in ('color','number','size') then raise exception 'invalid bet type'; end if;
  if p_amount is null or p_amount <= 0 then raise exception 'invalid amount'; end if;

  select value into v_game from public.settings where key = 'game';
  v_game := coalesce(v_game, '{"duration":60,"minBet":10,"maxBet":10000,"betCloseSeconds":5,"active":true,"maintenance":false,"enableColor":true,"enableNumber":true,"enableSize":true}'::jsonb);

  if coalesce((v_game->>'active')::boolean, true) = false then raise exception 'Game is paused by admin'; end if;
  if coalesce((v_game->>'maintenance')::boolean, false) = true then raise exception 'Under maintenance. Try later.'; end if;
  if p_type = 'color' and coalesce((v_game->>'enableColor')::boolean, true) = false then raise exception 'Color betting is disabled'; end if;
  if p_type = 'number' and coalesce((v_game->>'enableNumber')::boolean, true) = false then raise exception 'Number betting is disabled'; end if;
  if p_type = 'size' and coalesce((v_game->>'enableSize')::boolean, true) = false then raise exception 'Size betting is disabled'; end if;

  v_dur := coalesce((v_game->>'duration')::int, 60);
  if v_dur < 10 then v_dur := 60; end if;

  v_now          := (extract(epoch from now()) * 1000)::bigint;
  v_period_start := (v_now / (v_dur * 1000)) * (v_dur * 1000);
  v_period_id    := 'P' || (v_period_start / 1000);

  if (v_now - v_period_start) > (v_dur * 1000 - coalesce((v_game->>'betCloseSeconds')::int, 5) * 1000) then
    raise exception 'Betting closed for this period';
  end if;

  if p_amount < coalesce((v_game->>'minBet')::numeric, 10) then
    raise exception 'Minimum bet is %', (v_game->>'minBet');
  end if;
  if p_amount > coalesce((v_game->>'maxBet')::numeric, 10000) then
    raise exception 'Maximum bet is %', (v_game->>'maxBet');
  end if;

  update public.profiles
  set balance = balance - p_amount, total_bet = total_bet + p_amount, last_seen = now()
  where id = auth.uid() and status = 'active' and balance >= p_amount
  returning balance into v_bal;

  if not found then
    raise exception 'Insufficient balance or account blocked';
  end if;

  insert into public.bets (uid, period_id, type, selection, amount)
  values (auth.uid(), v_period_id, p_type, p_selection, p_amount)
  returning id into v_bet_id;

  return jsonb_build_object('ok', true, 'betId', v_bet_id, 'periodId', v_period_id, 'balance', v_bal);
end
$$;

-- ----------------------------------------------------------------------------
-- STEP 9: request_withdrawal — atomic deduct + pending withdrawal
-- ----------------------------------------------------------------------------
create or replace function public.request_withdrawal(p_amount numeric, p_upi text)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_wallet jsonb;
  v_bal    numeric;
  v_id     bigint;
begin
  if auth.uid() is null then raise exception 'unauthorized'; end if;
  if p_amount is null or p_amount <= 0 then raise exception 'invalid amount'; end if;
  if p_upi is null or char_length(trim(p_upi)) < 5 then raise exception 'valid UPI ID required'; end if;

  select value into v_wallet from public.settings where key = 'wallet';
  v_wallet := coalesce(v_wallet, '{"minDeposit":10,"minWithdrawal":200,"maxWithdrawal":100000}'::jsonb);

  if p_amount < coalesce((v_wallet->>'minWithdrawal')::numeric, 200) then
    raise exception 'Minimum withdrawal is %', (v_wallet->>'minWithdrawal');
  end if;
  if p_amount > coalesce((v_wallet->>'maxWithdrawal')::numeric, 100000) then
    raise exception 'Maximum withdrawal is %', (v_wallet->>'maxWithdrawal');
  end if;

  update public.profiles
  set balance = balance - p_amount, last_seen = now()
  where id = auth.uid() and status = 'active' and balance >= p_amount
  returning balance into v_bal;

  if not found then
    raise exception 'Insufficient balance or account blocked';
  end if;

  insert into public.withdrawals (uid, amount, upi_id, status)
  values (auth.uid(), p_amount, trim(p_upi), 'pending')
  returning id into v_id;

  return jsonb_build_object('ok', true, 'withdrawalId', v_id, 'balance', v_bal);
end
$$;

-- ----------------------------------------------------------------------------
-- STEP 10: update_my_profile (user can only touch contact fields)
-- ----------------------------------------------------------------------------
create or replace function public.update_my_profile(p_phone text default null, p_upi_id text default null, p_email text default null)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  if auth.uid() is null then raise exception 'unauthorized'; end if;
  update public.profiles
  set phone  = coalesce(p_phone, phone),
      upi_id = coalesce(p_upi_id, upi_id),
      email  = coalesce(p_email, email)
  where id = auth.uid();
end
$$;

-- ----------------------------------------------------------------------------
-- STEP 11: claim_welcome_bonus (once)
-- ----------------------------------------------------------------------------
create or replace function public.claim_welcome_bonus()
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_wallet jsonb;
  v_bonus  numeric;
  v_bal    numeric;
begin
  if auth.uid() is null then raise exception 'unauthorized'; end if;
  select value into v_wallet from public.settings where key = 'wallet';
  v_bonus := coalesce((coalesce(v_wallet,'{}'::jsonb)->>'welcomeBonus')::numeric, 0);
  if v_bonus <= 0 then
    return jsonb_build_object('ok', true, 'bonus', 0);
  end if;
  update public.profiles
  set balance = balance + v_bonus, bonus_applied = true, last_seen = now()
  where id = auth.uid() and bonus_applied = false and status = 'active'
  returning balance into v_bal;
  if not found then
    return jsonb_build_object('ok', true, 'bonus', 0);
  end if;
  insert into public.notifications (uid, title, body)
  values (auth.uid(), 'Welcome Bonus', 'Congratulations! ₹' || v_bonus || ' welcome bonus added to your wallet.');
  return jsonb_build_object('ok', true, 'bonus', v_bonus, 'balance', v_bal);
end
$$;

-- ----------------------------------------------------------------------------
-- STEP 12: referral — claim + dashboard
-- ----------------------------------------------------------------------------
create or replace function public.claim_referral(p_code text)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_me    uuid := auth.uid();
  v_ref   uuid;
  v_count int;
  v_rank  text;
begin
  if v_me is null then raise exception 'unauthorized'; end if;
  if p_code is null or char_length(trim(p_code)) < 4 then raise exception 'invalid referral code'; end if;

  select id into v_ref from public.profiles where referral_code = upper(trim(p_code));
  if v_ref is null then raise exception 'Invalid referral code'; end if;
  if v_ref = v_me then raise exception 'You cannot refer yourself'; end if;

  update public.profiles set referred_by = v_ref where id = v_me and referred_by is null;
  if not found then raise exception 'You already used a referral code'; end if;

  select count(*) into v_count from public.profiles where referred_by = v_ref;
  v_rank := public.rank_for_count(v_count);
  update public.profiles set referral_count = v_count, rank = v_rank where id = v_ref;

  return jsonb_build_object('ok', true, 'referrerRank', v_rank, 'referrerCount', v_count);
end
$$;

create or replace function public.referral_dashboard()
returns jsonb
language plpgsql  security definer set search_path = public
as $$
declare
  v_me    public.profiles%rowtype;
  v_ref   jsonb;
  v_count int;
begin
  if auth.uid() is null then raise exception 'unauthorized'; end if;
  select * into v_me from public.profiles where id = auth.uid();
  select value into v_ref from public.settings where key = 'referral';
  v_ref := coalesce(v_ref, '{"enabled":true,"thresholds":[{"rank":"bronze","min":0},{"rank":"silver","min":3},{"rank":"gold","min":10},{"rank":"platinum","min":25},{"rank":"diamond","min":50}]}'::jsonb);
  v_count := v_me.referral_count;

  return jsonb_build_object(
    'code', v_me.referral_code,
    'count', v_count,
    'rank', v_me.rank,
    'enabled', coalesce((v_ref->>'enabled')::boolean, true),
    'thresholds', coalesce(v_ref->'thresholds', '[]'::jsonb),
    'leaderboard', coalesce((
      select jsonb_agg(row_to_json(t)) from (
        select p.referral_code, p.referral_count, p.rank
        from public.profiles p
        where p.referral_count > 0
        order by p.referral_count desc limit 10
      ) t
    ), '[]'::jsonb),
    'team', coalesce((
      select jsonb_agg(row_to_json(m)) from (
        select p.email, p.rank, p.created_at
        from public.profiles p
        where p.referred_by = auth.uid()
        order by p.created_at desc limit 50
      ) m
    ), '[]'::jsonb)
  );
end
$$;

-- ----------------------------------------------------------------------------
-- STEP 13: apply_coupon
-- ----------------------------------------------------------------------------
create or replace function public.apply_coupon(p_code text)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  c     public.coupons%rowtype;
  v_bal numeric;
  v_p   public.profiles%rowtype;
begin
  if auth.uid() is null then raise exception 'unauthorized'; end if;
  select * into c from public.coupons where code = upper(trim(p_code)) for update;
  if not found or not c.active then raise exception 'Invalid coupon code'; end if;
  if c.expires_at is not null and c.expires_at < now() then raise exception 'Coupon expired'; end if;
  if c.max_uses > 0 and c.used_count >= c.max_uses then raise exception 'Coupon limit reached'; end if;
  if exists (select 1 from public.coupon_usages where uid = auth.uid() and code = c.code) then
    raise exception 'You already used this coupon';
  end if;
  select * into v_p from public.profiles where id = auth.uid();
  if v_p.balance < c.min_balance then
    raise exception 'Minimum balance ₹% required', c.min_balance;
  end if;
  if v_p.status <> 'active' then raise exception 'Account blocked'; end if;

  insert into public.coupon_usages (uid, code, amount) values (auth.uid(), c.code, c.amount);
  update public.coupons set used_count = used_count + 1 where code = c.code;
  update public.profiles set balance = balance + c.amount where id = auth.uid() returning balance into v_bal;
  insert into public.notifications (uid, title, body)
  values (auth.uid(), 'Coupon Applied', 'Coupon ' || c.code || ' applied: +₹' || c.amount);
  return jsonb_build_object('ok', true, 'amount', c.amount, 'balance', v_bal);
end
$$;

-- ----------------------------------------------------------------------------
-- STEP 14: game_state — one RPC for the whole game screen
-- ----------------------------------------------------------------------------
create or replace function public.game_state()
returns jsonb
language plpgsql  security definer set search_path = public
as $$
declare
  v_game jsonb; v_payouts jsonb; v_appearance jsonb; v_chat jsonb; v_sounds jsonb;
  v_wallet jsonb; v_upi jsonb; v_referral jsonb; v_pay jsonb; v_features jsonb;
  v_dur int; v_now bigint; v_start bigint; v_elapsed bigint; v_close_ms bigint;
begin
  select coalesce(value,'{"duration":60,"minBet":10,"maxBet":10000,"betCloseSeconds":5,"active":true,"maintenance":false,"forceNextResult":null,"enableColor":true,"enableNumber":true,"enableSize":true,"winMode":"random","winTarget":0.5,"numberWeights":[10,10,10,10,10,10,10,10,10,10]}') into v_game from public.settings where key='game';
  select coalesce(value,'{"green":2,"red":2,"violet":4.5,"number":9,"size":2}') into v_payouts from public.settings where key='payouts';
  select coalesce(value,'{"appName":"JIO CLUB","tagline":"Color Prediction","theme":"dark","accent":"#7c6cff"}') into v_appearance from public.settings where key='appearance';
  select coalesce(value,'{"enabled":true,"maxMessage":500}') into v_chat from public.settings where key='chat';
  select coalesce(value,'{"enabled":true,"volume":0.5,"tick":true,"win":true,"lose":true}') into v_sounds from public.settings where key='sounds';
  select coalesce(value,'{"minDeposit":10,"minWithdrawal":200,"maxWithdrawal":100000,"welcomeBonus":0}') into v_wallet from public.settings where key='wallet';
  select coalesce(value,'{"upiId":"","qrText":"","apps":["GPay","PhonePe","Paytm","Bhimbhi"]}') into v_upi from public.settings where key='upi';
  select coalesce(value,'{"enabled":true,"thresholds":[]}') into v_referral from public.settings where key='referral';
  select coalesce(value,'{"mode":"upi","razorpayKeyId":""}') into v_pay from public.settings where key='payments';
  select coalesce(value,'{"deposit":true,"withdraw":true,"coupons":true,"referral":true}') into v_features from public.settings where key='features';

  v_dur := coalesce((v_game->>'duration')::int, 60);
  if v_dur < 10 then v_dur := 60; end if;
  v_now := (extract(epoch from now()) * 1000)::bigint;
  v_start := (v_now / (v_dur * 1000)) * (v_dur * 1000);
  v_elapsed := v_now - v_start;
  v_close_ms := (v_dur * 1000) - coalesce((v_game->>'betCloseSeconds')::int, 5) * 1000 - v_elapsed;
  if v_close_ms < 0 then v_close_ms := 0; end if;

  return jsonb_build_object(
    'periodId', 'P' || (v_start / 1000),
    'periodStart', v_start,
    'serverNow', v_now,
    'duration', v_dur,
    'bettingClosesInMs', v_close_ms,
    'bettingOpen', v_elapsed < (v_dur * 1000 - coalesce((v_game->>'betCloseSeconds')::int, 5) * 1000),
    'game', v_game,
    'payouts', v_payouts,
    'appearance', v_appearance,
    'chat', v_chat,
    'sounds', v_sounds,
    'wallet', v_wallet,
    'upi', v_upi,
    'referral', v_referral,
    'payments', v_pay,
    'features', v_features,
    'lastResults', (
      select coalesce(jsonb_agg(row_to_json(r)), '[]'::jsonb)
      from (select period_id, number, color, size, created_at from public.results order by created_at desc limit 50) r
    )
  );
end
$$;

-- ----------------------------------------------------------------------------
-- STEP 15: stats_overview — admin dashboard
-- ----------------------------------------------------------------------------
create or replace function public.stats_overview()
returns jsonb
language plpgsql  security definer set search_path = public
as $$
begin
  if not public.is_admin() then raise exception 'forbidden'; end if;
  return jsonb_build_object(
    'totalUsers',      (select count(*) from public.profiles),
    'activeUsers',     (select count(*) from public.profiles where status='active'),
    'blockedUsers',    (select count(*) from public.profiles where status='blocked'),
    'todayUsers',      (select count(*) from public.profiles where created_at > date_trunc('day', now())),
    'totalBalance',    (select coalesce(sum(balance),0) from public.profiles),
    'totalDeposits',   (select coalesce(sum(total_deposits),0) from public.profiles),
    'todayDeposits',   (select coalesce(sum(amount),0) from public.deposits where status='approved' and processed_at > date_trunc('day', now())),
    'totalWithdrawn',  (select coalesce(sum(total_withdrawn),0) from public.profiles),
    'todayBets',       (select count(*) from public.bets where created_at > date_trunc('day', now())),
    'totalBets',       (select count(*) from public.bets),
    'pendingBets',     (select count(*) from public.bets where result='pending'),
    'totalBetAmount',  (select coalesce(sum(amount),0) from public.bets),
    'totalPaidOut',    (select coalesce(sum(win_amount),0) from public.bets),
    'pendingDeposits', (select jsonb_build_object('count', count(*), 'amount', coalesce(sum(amount),0)) from public.deposits where status='pending'),
    'pendingWithdrawals', (select jsonb_build_object('count', count(*), 'amount', coalesce(sum(amount),0)) from public.withdrawals where status='pending'),
    'revenue',         (select coalesce(sum(total_deposits),0) - coalesce(sum(total_withdrawn),0) - coalesce(sum(total_won),0) from public.profiles)
  );
end
$$;

-- ----------------------------------------------------------------------------
-- STEP 16: analytics_summary — admin analytics
-- ----------------------------------------------------------------------------
create or replace function public.analytics_summary()
returns jsonb
language plpgsql  security definer set search_path = public
as $$
begin
  if not public.is_admin() then raise exception 'forbidden'; end if;
  return jsonb_build_object(
    'winRate', (select round(100.0 * count(*) filter (where result='win') / nullif(count(*),0), 1)
                from public.bets where result in ('win','lose'))::text,
    'byType', (select coalesce(jsonb_agg(row_to_json(x)), '[]'::jsonb) from (
      select type, count(*)::int as bets, round(coalesce(sum(amount),0),2)::text as amount, round(coalesce(sum(win_amount),0),2)::text as paid
      from public.bets group by type) x),
    'byColor', (select coalesce(jsonb_agg(row_to_json(x)), '[]'::jsonb) from (
      select selection, count(*)::int as bets, count(*) filter (where result='win')::int as wins
      from public.bets where type='color' group by selection) x),
    'byNumber', (select coalesce(jsonb_agg(row_to_json(x)), '[]'::jsonb) from (
      select selection, count(*)::int as bets, count(*) filter (where result='win')::int as wins
      from public.bets where type='number' group by selection order by selection::int) x),
    'bySize', (select coalesce(jsonb_agg(row_to_json(x)), '[]'::jsonb) from (
      select selection, count(*)::int as bets, count(*) filter (where result='win')::int as wins
      from public.bets where type='size' group by selection) x),
    'topWinners', (select coalesce(jsonb_agg(row_to_json(t)), '[]'::jsonb) from (
      select p.email, p.rank, round(sum(b.win_amount),2)::text as won, round(sum(b.amount),2)::text as bet
      from public.bets b join public.profiles p on p.id = b.uid
      where b.result='win'
      group by p.id, p.email, p.rank order by won::numeric desc limit 10) t),
    'topDepositors', (select coalesce(jsonb_agg(row_to_json(t)), '[]'::jsonb) from (
      select p.email, p.rank, round(sum(d.amount),2)::text as deposited, count(*)::int as txns
      from public.deposits d join public.profiles p on p.id = d.uid
      where d.status='approved'
      group by p.id, p.email, p.rank order by deposited::numeric desc limit 10) t),
    'daily', (select coalesce(jsonb_agg(row_to_json(t) order by d), '[]'::jsonb) from (
      select to_char(date, 'YYYY-MM-DD') as d,
             round(coalesce((select sum(amount) from public.deposits where status='approved' and coalesce(processed_at, created_at)::date = date),0),2)::text as deposits,
             round(coalesce((select sum(amount) from public.withdrawals where status='approved' and coalesce(processed_at, created_at)::date = date),0),2)::text as withdrawals,
             (select count(*) from public.bets where created_at::date = date)::int as bets
      from generate_series((current_date - 13), current_date, interval '1 day') date) t)
  );
end
$$;

-- ----------------------------------------------------------------------------
-- STEP 17: admin_action — ALL admin operations (logged)
-- ----------------------------------------------------------------------------
create or replace function public.admin_action(p_action text, p_params jsonb default '{}'::jsonb)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_uid   uuid;
  v_id    bigint;
  v_row   record;
  v_out   jsonb := '{}'::jsonb;
begin
  if auth.uid() is null then raise exception 'unauthorized'; end if;
  if not public.is_admin() then raise exception 'forbidden'; end if;

  insert into public.admin_logs (admin_id, action, detail) values (auth.uid(), p_action, p_params);

  if p_action = 'adjust-balance' then
    v_uid := p_params->>'uid'; v_id := null;
    update public.profiles set balance = balance + coalesce((p_params->>'delta')::numeric, 0)
    where id = v_uid
    returning balance into v_row;
    if not found then raise exception 'user not found'; end if;
    insert into public.notifications (uid, title, body)
    values (v_uid, 'Balance Updated', coalesce(p_params->>'reason', 'Admin adjusted your balance'));
    v_out := jsonb_build_object('balance', v_row);

  elsif p_action = 'set-status' then
    v_uid := p_params->>'uid';
    update public.profiles set status = (p_params->>'status') where id = v_uid;
    insert into public.notifications (uid, title, body)
    values (v_uid, 'Account ' || upper(p_params->>'status'),
            case when p_params->>'status' = 'blocked' then 'Your account has been suspended.' else 'Your account has been re-activated.' end);
    v_out := jsonb_build_object('status', p_params->>'status');

  elsif p_action = 'set-rank' then
    update public.profiles set rank = p_params->>'rank' where id = p_params->>'uid';
    v_out := jsonb_build_object('rank', p_params->>'rank');

  elsif p_action = 'set-role' then
    update public.profiles set role = p_params->>'role' where id = p_params->>'uid';
    v_out := jsonb_build_object('role', p_params->>'role');

  elsif p_action = 'force-result' then
    update public.settings set value = jsonb_set(value, '{forceNextResult}', to_jsonb(p_params->'number')) where key = 'game';
    v_out := jsonb_build_object('forced', p_params->'number');

  elsif p_action = 'set-game' then
    update public.settings
    set value = value || p_params
    where key = 'game';
    v_out := jsonb_build_object('saved', true);

  elsif p_action = 'approve-deposit' then
    v_id := (p_params->>'id')::bigint;
    update public.deposits set status='approved', note=coalesce(p_params->>'note',''), processed_at=now()
    where id = v_id and status='pending'
    returning uid, amount into v_row;
    if not found then raise exception 'deposit not found or not pending'; end if;
    update public.profiles set balance = balance + v_row.amount, total_deposits = total_deposits + v_row.amount where id = v_row.uid;
    insert into public.notifications (uid, title, body) values (v_row.uid, 'Deposit Approved', '₹' || v_row.amount || ' added to your wallet.');
    v_out := jsonb_build_object('approved', v_row.amount);

  elsif p_action = 'reject-deposit' then
    v_id := (p_params->>'id')::bigint;
    update public.deposits set status='rejected', note=coalesce(p_params->>'note','Rejected'), processed_at=now()
    where id = v_id and status='pending'
    returning uid into v_row;
    if not found then raise exception 'deposit not found or not pending'; end if;
    insert into public.notifications (uid, title, body) values (v_row.uid, 'Deposit Rejected', coalesce(p_params->>'note','Please contact support.'));
    v_out := jsonb_build_object('rejected', true);

  elsif p_action = 'bulk-approve-deposits' then
    for i in select (jsonb_array_elements_text(coalesce(p_params->'ids','[]'::jsonb)))->>0
    loop
      perform public.admin_action('approve-deposit', jsonb_build_object('id', i));
    end loop;
    v_out := jsonb_build_object('ok', true);

  elsif p_action = 'delete-deposit' then
    delete from public.deposits where id = (p_params->>'id')::bigint;
    v_out := jsonb_build_object('deleted', true);

  elsif p_action = 'approve-withdrawal' then
    v_id := (p_params->>'id')::bigint;
    update public.withdrawals set status='approved', note=coalesce(p_params->>'note',''), processed_at=now()
    where id = v_id and status='pending'
    returning uid, amount into v_row;
    if not found then raise exception 'withdrawal not found or not pending'; end if;
    update public.profiles set total_withdrawn = total_withdrawn + v_row.amount where id = v_row.uid;
    insert into public.notifications (uid, title, body) values (v_row.uid, 'Withdrawal Processed', '₹' || v_row.amount || ' sent to your UPI.');
    v_out := jsonb_build_object('approved', v_row.amount);

  elsif p_action = 'reject-withdrawal' then
    v_id := (p_params->>'id')::bigint;
    update public.withdrawals set status='rejected', note=coalesce(p_params->>'note','Rejected'), processed_at=now()
    where id = v_id and status='pending'
    returning uid, amount into v_row;
    if not found then raise exception 'withdrawal not found or not pending'; end if;
    update public.profiles set balance = balance + v_row.amount where id = v_row.uid;
    insert into public.notifications (uid, title, body) values (v_row.uid, 'Withdrawal Rejected', '₹' || v_row.amount || ' refunded. ' || coalesce(p_params->>'note',''));
    v_out := jsonb_build_object('refunded', v_row.amount);

  elsif p_action = 'delete-withdrawal' then
    delete from public.withdrawals where id = (p_params->>'id')::bigint;
    v_out := jsonb_build_object('deleted', true);

  elsif p_action = 'add-coupon' then
    insert into public.coupons (code, amount, min_balance, max_uses, expires_at, active)
    values (upper(p_params->>'code'), (p_params->>'amount')::numeric,
            coalesce((p_params->>'minBalance')::numeric, 0),
            coalesce((p_params->>'maxUses')::int, 0),
            case when p_params->>'expiresAt' is null or p_params->>'expiresAt' = '' then null else (p_params->>'expiresAt')::timestamptz end,
            true)
    on conflict (code) do nothing;
    v_out := jsonb_build_object('code', upper(p_params->>'code'));

  elsif p_action = 'update-coupon' then
    update public.coupons c set
      active      = coalesce((p_params->>'active')::boolean, c.active),
      amount      = coalesce((p_params->>'amount')::numeric, c.amount),
      min_balance = coalesce((p_params->>'minBalance')::numeric, c.min_balance),
      max_uses    = coalesce((p_params->>'maxUses')::int, c.max_uses)
    where c.code = upper(p_params->>'code');
    v_out := jsonb_build_object('code', upper(p_params->>'code'));

  elsif p_action = 'delete-coupon' then
    delete from public.coupons where code = upper(p_params->>'code');
    v_out := jsonb_build_object('deleted', true);

  elsif p_action = 'add-announcement' then
    insert into public.announcements (title, body, priority, active)
    values (p_params->>'title', p_params->>'body', coalesce(p_params->>'priority','info'), true);
    v_out := jsonb_build_object('ok', true);

  elsif p_action = 'update-announcement' then
    update public.announcements set
      title = coalesce(p_params->>'title', title),
      body  = coalesce(p_params->>'body', body),
      priority = coalesce(p_params->>'priority', priority),
      active   = coalesce((p_params->>'active')::boolean, active)
    where id = (p_params->>'id')::bigint;
    v_out := jsonb_build_object('ok', true);

  elsif p_action = 'delete-announcement' then
    delete from public.announcements where id = (p_params->>'id')::bigint;
    v_out := jsonb_build_object('deleted', true);

  elsif p_action = 'notify-user' then
    insert into public.notifications (uid, title, body) values (p_params->>'uid', p_params->>'title', coalesce(p_params->>'body',''));
    v_out := jsonb_build_object('ok', true);

  elsif p_action = 'broadcast' then
    insert into public.notifications (uid, title, body) values (null, p_params->>'title', coalesce(p_params->>'body',''));
    v_out := jsonb_build_object('ok', true);

  elsif p_action = 'delete-notification' then
    delete from public.notifications where id = (p_params->>'id')::bigint;
    v_out := jsonb_build_object('deleted', true);

  elsif p_action = 'delete-chat' then
    delete from public.chats where id = (p_params->>'id')::bigint;
    v_out := jsonb_build_object('deleted', true);

  elsif p_action = 'clear-chat' then
    delete from public.chats;
    v_out := jsonb_build_object('ok', true);

  elsif p_action = 'tick-now' then
    perform public.tick_game();
    v_out := jsonb_build_object('ok', true);

  elsif p_action = 'recompute-ranks' then
    update public.profiles p set
      referral_count = (select count(*) from public.profiles c where c.referred_by = p.id),
      rank = public.rank_for_count((select count(*) from public.profiles c where c.referred_by = p.id));
    v_out := jsonb_build_object('ok', true);

  elsif p_action = 'delete-user' then
    delete from public.profiles where id = p_params->>'uid' and role <> 'admin';
    v_out := jsonb_build_object('deleted', found);

  else
    v_out := jsonb_build_object('ok', false, 'unknownAction', p_action);
  end if;

  return v_out || jsonb_build_object('ok', true, 'action', p_action);
end
$$;

-- ----------------------------------------------------------------------------
-- STEP 18: Default settings (seeded once)
-- ----------------------------------------------------------------------------
insert into public.settings (key, value) values
  ('game',       '{"duration":60,"minBet":10,"maxBet":10000,"betCloseSeconds":5,"active":true,"maintenance":false,"forceNextResult":null,"enableColor":true,"enableNumber":true,"enableSize":true,"winMode":"random","winTarget":0.5,"numberWeights":[10,10,10,10,10,10,10,10,10,10]}'),
  ('features',   '{"deposit":true,"withdraw":true,"coupons":true,"referral":true}'),
  ('payouts',    '{"green":2,"red":2,"violet":4.5,"number":9,"size":2}'),
  ('wallet',     '{"minDeposit":10,"minWithdrawal":200,"maxWithdrawal":100000,"welcomeBonus":0}'),
  ('upi',        '{"upiId":"","qrText":"","apps":["GPay","PhonePe","Paytm","Bhimbhi"]}'),
  ('payments',   '{"mode":"upi","razorpayKeyId":""}'),
  ('referral',   '{"enabled":true,"thresholds":[{"rank":"bronze","min":0},{"rank":"silver","min":3},{"rank":"gold","min":10},{"rank":"platinum","min":25},{"rank":"diamond","min":50}]}'),
  ('chat',       '{"enabled":true,"maxMessage":500}'),
  ('notifications','{"enabled":true}'),
  ('appearance', '{"appName":"JIO CLUB","tagline":"Color Prediction","theme":"dark","accent":"#7c6cff"}'),
  ('sounds',     '{"enabled":true,"volume":0.5,"tick":true,"win":true,"lose":true}'),
  ('telegram',   '{"link":""}'),
  ('about',      '{"rules":"","support":""}')
on conflict (key) do nothing;

-- ----------------------------------------------------------------------------
-- STEP 19: Storage bucket for deposit screenshots
-- ----------------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('screenshots', 'screenshots', true)
on conflict (id) do nothing;

drop policy if exists "screenshots_read" on storage.objects;
create policy "screenshots_read" on storage.objects for select using (bucket_id = 'screenshots');
drop policy if exists "screenshots_upload" on storage.objects;
create policy "screenshots_upload" on storage.objects for insert with check (bucket_id = 'screenshots' and auth.uid() is not null);

-- ----------------------------------------------------------------------------
-- STEP 20: Realtime
-- ----------------------------------------------------------------------------
alter table public.profiles replica identity full;
alter table public.bets replica identity full;

do $$ begin
  begin alter publication supabase_realtime add table public.results; exception when others then null; end;
  begin alter publication supabase_realtime add table public.profiles; exception when others then null; end;
  begin alter publication supabase_realtime add table public.chats; exception when others then null; end;
  begin alter publication supabase_realtime add table public.notifications; exception when others then null; end;
  begin alter publication supabase_realtime add table public.announcements; exception when others then null; end;
  begin alter publication supabase_realtime add table public.settings; exception when others then null; end;
  begin alter publication supabase_realtime add table public.deposits; exception when others then null; end;
  begin alter publication supabase_realtime add table public.withdrawals; exception when others then null; end;
  begin alter publication supabase_realtime add table public.bets; exception when others then null; end;
end $$;

-- ----------------------------------------------------------------------------
-- STEP 21: Cron — game engine heartbeat (every minute)
-- ----------------------------------------------------------------------------
create extension if not exists pg_cron;

do $$
begin
  if exists (select 1 from cron.job where jobname = 'game-tick') then
    perform cron.unschedule('game-tick');
  end if;
end $$;

select cron.schedule('game-tick', '* * * * *', $tick$select public.tick_game()$tick$);

-- ----------------------------------------------------------------------------
-- DONE. Next:
-- 1) Sign up as admin in the app (any email)
-- 2) Run:  update public.profiles set role='admin' where email='YOUR_ADMIN_EMAIL';
-- ----------------------------------------------------------------------------
