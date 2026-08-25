-- ============================================================================
-- JIO CLUB — Production-grade SECURITY HARDENING (v1)
-- Apply ONCE in the Supabase SQL Editor (single Run). Wrapped in a transaction.
-- ============================================================================
begin;

-- PART 1: rate-limit table + rl_check
create table if not exists public.rl (
  key text primary key,
  hits int not null default 0,
  window_start timestamptz not null default now()
);

create or replace function public.rl_check(p_action text, p_max_calls int, p_window_sec int)
returns void
language plpgsql
as $$
declare
  v_key text := 'rl:' || p_action || ':' || auth.uid()::text;
  v_hits int;
  v_start timestamptz;
begin
  select hits, window_start into v_hits, v_start from public.rl where key = v_key;
  if not found then
    insert into public.rl (key, hits, window_start) values (v_key, 1, now());
    return;
  end if;
  if now() - v_start > make_interval(secs => p_window_sec) then
    update public.rl set hits = 1, window_start = now() where key = v_key;
    return;
  end if;
  update public.rl set hits = hits + 1 where key = v_key;
  select hits into v_hits from public.rl where key = v_key;
  if v_hits > p_max_calls then
    raise exception 'Too many requests. Please slow down.';
  end if;
end
$$;

-- PART 1b: private secrets table (force RLS, no policy -> only postgres/service_role)
create table if not exists public.secrets (
  key text primary key,
  value text not null,
  updated_at timestamptz not null default now()
);

-- PART 2: rate-limited money functions (exact original bodies + rl_check gate)
CREATE OR REPLACE FUNCTION public.apply_coupon(p_code text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  c     public.coupons%rowtype;
  v_bal numeric;
  v_p   public.profiles%rowtype;
begin
  if auth.uid() is null then raise exception 'unauthorized'; end if;
  perform public.rl_check('apply_coupon', 10, 60);

  if (select coalesce((value->>'coupons')::boolean, true) from public.settings where key = 'features') = false then
    raise exception 'Coupons are currently disabled by admin';
  end if;

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
  insert into public.wallet_ledger (uid, type, amount, balance_after, ref, note)
  values (auth.uid(), 'coupon', c.amount, v_bal, c.code, 'coupon applied');
  insert into public.notifications (uid, title, body)
  values (auth.uid(), 'Coupon Applied', 'Coupon ' || c.code || ' applied: +₹' || c.amount);
  return jsonb_build_object('ok', true, 'amount', c.amount, 'balance', v_bal);
end
$function$;


CREATE OR REPLACE FUNCTION public.place_bet(p_type text, p_selection text, p_amount numeric)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_game        jsonb;
  v_wallet      jsonb;
  v_dur         int;
  v_now         bigint;
  v_period_start bigint;
  v_period_id   text;
  v_bal         numeric;
  v_bet_id      bigint;
  v_daily_limit numeric;
  v_today_stake numeric;
  v_cap         int;
  v_cnt         int;
  v_self        boolean;
begin
  if auth.uid() is null then raise exception 'unauthorized'; end if;
  perform public.rl_check('place_bet', 30, 60);
  if p_type not in ('color','number','size') then raise exception 'invalid bet type'; end if;
  if p_amount is null or p_amount <= 0 then raise exception 'invalid amount'; end if;

  select self_excluded into v_self from public.profiles where id = auth.uid();
  if v_self then raise exception 'Account is self-excluded — contact support to reactivate'; end if;

  select value into v_game from public.settings where key = 'game';
  v_game := coalesce(v_game, '{"duration":60,"minBet":10,"maxBet":10000,"betCloseSeconds":5,"active":true,"maintenance":false,"enableColor":true,"enableNumber":true,"enableSize":true,"betsPerPeriod":1}'::jsonb);
  select value into v_wallet from public.settings where key = 'wallet';
  v_wallet := coalesce(v_wallet, '{"dailyBetLimit":0}'::jsonb);

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

  v_cap := coalesce((v_game->>'betsPerPeriod')::int, 1);
  if v_cap > 0 then
    select count(*) into v_cnt from public.bets where uid = auth.uid() and period_id = v_period_id;
    if v_cnt >= v_cap then
      raise exception 'Max % bet(s) allowed per period', v_cap;
    end if;
  end if;

  v_daily_limit := coalesce((v_wallet->>'dailyBetLimit')::numeric, 0);
  if v_daily_limit > 0 then
    select coalesce(sum(amount), 0) into v_today_stake
    from public.bets
    where uid = auth.uid() and created_at::date = current_date;
    if v_today_stake + p_amount > v_daily_limit then
      raise exception 'Daily bet limit ₹% reached (today: ₹%)', v_daily_limit, v_today_stake;
    end if;
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

  insert into public.wallet_ledger (uid, type, amount, balance_after, ref, note)
  values (auth.uid(), 'stake', -p_amount, v_bal, 'BET-' || v_bet_id, v_period_id || ' ' || p_type || ' ' || p_selection);

  return jsonb_build_object('ok', true, 'betId', v_bet_id, 'periodId', v_period_id, 'balance', v_bal, 'receipt', 'BET-' || v_bet_id);
end
$function$;


CREATE OR REPLACE FUNCTION public.request_deposit(p_amount numeric, p_upi_ref text, p_screenshot_url text DEFAULT ''::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_wallet jsonb;
  v_dep_id bigint;
  v_url    text := coalesce(p_screenshot_url, '');
  v_self   boolean;
  v_dl     numeric;
  v_today  numeric;
begin
  if auth.uid() is null then raise exception 'unauthorized'; end if;
  perform public.rl_check('request_deposit', 20, 60);
  if p_amount is null or p_amount <= 0 then raise exception 'invalid amount'; end if;

  select self_excluded into v_self from public.profiles where id = auth.uid();
  if v_self then raise exception 'Account is self-excluded — contact support to reactivate'; end if;

  select value into v_wallet from public.settings where key = 'wallet';
  v_wallet := coalesce(v_wallet, '{"minDeposit":10,"dailyDepositLimit":0}'::jsonb);

  if p_amount < coalesce((v_wallet->>'minDeposit')::numeric, 10) then
    raise exception 'Minimum deposit is %', (v_wallet->>'minDeposit');
  end if;
  if p_amount > 1000000 then raise exception 'Maximum single deposit is ₹1,000,000'; end if;
  if char_length(coalesce(p_upi_ref,'')) < 4 then raise exception 'Valid UPI transaction reference (UTR) required'; end if;

  v_dl := coalesce((v_wallet->>'dailyDepositLimit')::numeric, 0);
  if v_dl > 0 then
    select coalesce(sum(amount), 0) into v_today
    from public.deposits
    where uid = auth.uid() and created_at::date = current_date and status in ('pending','approved');
    if v_today + p_amount > v_dl then
      raise exception 'Daily deposit limit ₹% reached (today: ₹%)', v_dl, v_today;
    end if;
  end if;

  if (select coalesce((value->>'deposit')::boolean, true) from public.settings where key = 'features') = false then
    raise exception 'Deposits are currently disabled by admin';
  end if;

  if v_url is distinct from '' and v_url not like (auth.uid()::text || '/%') then
    v_url := '';
  end if;

  insert into public.deposits (uid, amount, upi_ref, screenshot_url, payment_mode, status)
  values (auth.uid(), p_amount, trim(p_upi_ref), v_url, 'upi', 'pending')
  returning id into v_dep_id;

  insert into public.wallet_ledger (uid, type, amount, balance_after, ref, note)
  values (auth.uid(), 'deposit_pending', 0, (select balance from public.profiles where id = auth.uid()), 'DEP-' || v_dep_id, p_amount::text);

  perform public.notify_admin('New Deposit Request',
    '₹' || p_amount || ' · UTR ' || trim(p_upi_ref) || ' · user ' || left(auth.uid()::text, 8), 'high');

  return jsonb_build_object('ok', true, 'depositId', v_dep_id, 'receipt', 'DEP-' || v_dep_id);
end
$function$;


CREATE OR REPLACE FUNCTION public.request_withdrawal(p_amount numeric, p_upi text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_wallet jsonb;
  v_bal    numeric;
  v_id     bigint;
  v_self   boolean;
begin
  if auth.uid() is null then raise exception 'unauthorized'; end if;
  perform public.rl_check('request_withdrawal', 10, 60);
  if p_amount is null or p_amount <= 0 then raise exception 'invalid amount'; end if;
  if p_upi is null or char_length(trim(p_upi)) < 5 then raise exception 'valid UPI ID required'; end if;

  select self_excluded into v_self from public.profiles where id = auth.uid();
  if v_self then raise exception 'Account is self-excluded — contact support to reactivate'; end if;

  if (select coalesce((value->>'withdraw')::boolean, true) from public.settings where key = 'features') = false then
    raise exception 'Withdrawals are currently disabled by admin';
  end if;

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

  insert into public.wallet_ledger (uid, type, amount, balance_after, ref, note)
  values (auth.uid(), 'withdraw_lock', -p_amount, v_bal, 'WD-' || v_id, trim(p_upi));

  perform public.notify_admin('New Withdrawal Request',
    '₹' || p_amount || ' → ' || trim(p_upi) || ' · user ' || left(auth.uid()::text, 8), 'high');

  return jsonb_build_object('ok', true, 'withdrawalId', v_id, 'balance', v_bal);
end
$function$;
-- PART 3: admin_secret (private secrets read/write; admin-only)
create or replace function public.admin_secret(p_action text, p_key text default null, p_value text default null)
returns jsonb
language plpgsql security definer set search_path = public
as $$
begin
  if not public.is_admin() then raise exception 'forbidden'; end if;
  if p_action = 'get' then
    return coalesce(
      (select jsonb_build_object('key', key, 'value', value) from public.secrets where key = p_key),
      jsonb_build_object('key', p_key, 'value', null)
    );
  elsif p_action = 'set' then
    if p_value is null then
      delete from public.secrets where key = p_key;
    else
      insert into public.secrets (key, value) values (p_key, p_value)
      on conflict (key) do update set value = excluded.value, updated_at = now();
    end if;
    return jsonb_build_object('ok', true, 'key', p_key);
  else
    raise exception 'unknown action';
  end if;
end
$$;

-- PART 4: least-privilege execute grants. Revoke from anon/authenticated/public,
-- re-grant ONLY the client-facing whitelist. Internal/privileged functions stay
-- executable only by postgres (owner) + service_role.
do $$
declare
  f record;
  auth_wl text[] := array['admin_action','admin_secret','analytics_summary','apply_coupon','claim_referral','claim_welcome_bonus','game_state','is_admin','leaderboard_top','mfa_disable','mfa_enable','mfa_setup','mfa_status','mfa_verify','place_bet','referral_dashboard','request_deletion','request_deposit','request_withdrawal','send_chat','stats_overview','support_close','support_messages','support_send','support_threads_list','toggle_self_exclusion','update_my_profile'];
  anon_wl text[] := array['game_state','is_admin','leaderboard_top','referral_dashboard'];
begin
  for f in select p.oid as oid, p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.prokind in ('f','p')
  loop
    execute format('revoke execute on function %s from public',        f.oid::regprocedure);
    execute format('revoke execute on function %s from anon',          f.oid::regprocedure);
    execute format('revoke execute on function %s from authenticated', f.oid::regprocedure);
    execute format('grant  execute on function %s to service_role',    f.oid::regprocedure);
    if f.proname = any(auth_wl) then
      execute format('grant execute on function %s to authenticated', f.oid::regprocedure);
    end if;
    if f.proname = any(anon_wl) then
      execute format('grant execute on function %s to anon', f.oid::regprocedure);
    end if;
  end loop;
end
$$;

-- PART 5: force RLS on every public table (defense-in-depth)
do $$
declare t record;
begin
  for t in select c.oid, c.relrowsecurity
           from pg_class c join pg_namespace n on n.oid = c.relnamespace
           where n.nspname = 'public' and c.relkind = 'r'
  loop
    if not t.relrowsecurity then
      execute format('alter table %s enable row level security', t.oid::regclass);
    end if;
    execute format('alter table %s force row level security', t.oid::regclass);
  end loop;
end
$$;

-- PART 6: migrate secrets out of the public-readable settings table
insert into public.secrets (key, value)
select 'razorpay_live_key_id', value->>'liveKeyId'      from public.settings where key='payments' and coalesce(value->>'liveKeyId','')    <> ''
union all select 'razorpay_live_key_secret', value->>'liveKeySecret' from public.settings where key='payments' and coalesce(value->>'liveKeySecret','') <> ''
union all select 'razorpay_test_key_id', value->>'testKeyId'      from public.settings where key='payments' and coalesce(value->>'testKeyId','')    <> ''
union all select 'razorpay_test_key_secret', value->>'testKeySecret' from public.settings where key='payments' and coalesce(value->>'testKeySecret','') <> ''
on conflict (key) do nothing;

update public.settings set value = jsonb_set(value,'{liveKeySecret}','""'::jsonb)  where key='payments' and coalesce(value->>'liveKeySecret','') <> '';
update public.settings set value = jsonb_set(value,'{liveKeyId}','""'::jsonb)      where key='payments' and coalesce(value->>'liveKeyId','')    <> '';
update public.settings set value = jsonb_set(value,'{testKeySecret}','""'::jsonb)  where key='payments' and coalesce(value->>'testKeySecret','') <> '';
update public.settings set value = jsonb_set(value,'{testKeyId}','""'::jsonb)      where key='payments' and coalesce(value->>'testKeyId','')    <> '';
update public.settings set value = jsonb_set(value,'{razorpayKeyId}','""'::jsonb)  where key='payments' and coalesce(value->>'razorpayKeyId','') <> '';

-- PART 7: drop legacy/test artifacts
drop function if exists public.t_a();
drop function if exists public.t_b();
drop function if exists public.t_c();
drop function if exists public.t_d();
drop function if exists public.t_e();
drop function if exists public.t_f();
drop function if exists public.t_lit();
drop function if exists public.t_v1();
drop function if exists public.t_v2();
drop function if exists public.t_v3();
drop table if exists public.admin cascade;

-- force RLS on rl + secrets (idempotent)
alter table public.rl enable row level security;
alter table public.rl force row level security;
alter table public.secrets enable row level security;
alter table public.secrets force row level security;

commit;
