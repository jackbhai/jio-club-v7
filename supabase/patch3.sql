-- ============================================================================
-- JIO CLUB v7 — PATCH 3 (idempotent, ADDITIVE)
-- MFA/TOTP (server-side), self-exclusion, deletion requests, daily deposit limit
-- ============================================================================

create extension if not exists pgcrypto;
create extension if not exists pgcrypto;

-- ----------------------------------------------------------------------------
-- 1) TOTP (RFC 6238) — pure SQL via pgcrypto HMAC-SHA1
-- ----------------------------------------------------------------------------
create or replace function public.totp_code(p_secret text, p_window bigint)
returns int
language plpgsql immutable
as $$
declare
  p_bytes bytea;
  msg     bytea;
  h       bytea;
  off     int;
  code    bigint;
begin
  p_bytes := decode(p_secret, 'hex');
  msg := decode('0000000000000000', 'hex');
  msg := set_byte(msg, 0, ((p_window >> 56) & 255)::int);
  msg := set_byte(msg, 1, ((p_window >> 48) & 255)::int);
  msg := set_byte(msg, 2, ((p_window >> 40) & 255)::int);
  msg := set_byte(msg, 3, ((p_window >> 32) & 255)::int);
  msg := set_byte(msg, 4, ((p_window >> 24) & 255)::int);
  msg := set_byte(msg, 5, ((p_window >> 16) & 255)::int);
  msg := set_byte(msg, 6, ((p_window >> 8) & 255)::int);
  msg := set_byte(msg, 7, ((p_window >> 0) & 255)::int);
  h := extensions.hmac(msg, p_bytes, 'sha1');  -- pgcrypto: hmac(message, key, type)
  off := get_byte(h, 19) & 15;
  code := ((get_byte(h, off) & 127) * 16777216::bigint)
        + ((get_byte(h, off + 1)) * 65536::bigint)
        + ((get_byte(h, off + 2)) * 256::bigint)
        + (get_byte(h, off + 3));
  return (code % 1000000)::int;
end
$$;

create table if not exists public.user_mfa (
  uid        uuid primary key references public.profiles(id) on delete cascade,
  secret     text not null,
  enabled    boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.user_mfa enable row level security;
drop policy if exists "mfa_own" on public.user_mfa;
create policy "mfa_own" on public.user_mfa for all
using (uid = auth.uid()) with check (uid = auth.uid());

create or replace function public.mfa_check_code(p_code text)
returns boolean
language plpgsql stable security definer set search_path = public
as $$
declare
  v_secret text;
  v_now    bigint;
  v_w      bigint;
  v_norm   text;
begin
  if auth.uid() is null then raise exception 'unauthorized'; end if;
  select secret into v_secret from public.user_mfa where uid = auth.uid();
  if not found or v_secret is null then raise exception 'MFA not set up'; end if;
  v_norm := ltrim(rtrim(coalesce(p_code, ''), ' '), '0');
  v_now  := (extract(epoch from now()) / 30)::bigint;
  for v_w in select w from (values (v_now - 1), (v_now), (v_now + 1)) t(w)
  loop
    if ltrim(public.totp_code(v_secret, v_w)::text, '0') = v_norm then
      return true;
    end if;
  end loop;
  return false;
end
$$;

create or replace function public.mfa_setup()
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_sec text;
  v_en  boolean;
  v_email text;
begin
  if auth.uid() is null then raise exception 'unauthorized'; end if;
  select email into v_email from public.profiles where id = auth.uid();
  insert into public.user_mfa (uid, secret, enabled)
  values (auth.uid(), encode(extensions.gen_random_bytes(16), 'hex'), false)
  on conflict (uid) do update set secret = encode(extensions.gen_random_bytes(16), 'hex'), enabled = false, updated_at = now();
  select secret, enabled into v_sec, v_en from public.user_mfa where uid = auth.uid();
  return jsonb_build_object(
    'secret', v_sec,
    'enabled', v_en,
    'otpauth', 'otpauth://totp/JIOCLUB:' || coalesce(v_email, 'user') || '?secret=' || v_sec || '&issuer=JIOCLUB&algorithm=SHA1&digits=6&period=30'
  );
end
$$;

create or replace function public.mfa_enable(p_code text)
returns jsonb
language plpgsql security definer set search_path = public
as $$
begin
  if auth.uid() is null then raise exception 'unauthorized'; end if;
  if not public.mfa_check_code(p_code) then raise exception 'Invalid 6-digit code'; end if;
  update public.user_mfa set enabled = true, updated_at = now() where uid = auth.uid();
  return jsonb_build_object('ok', true, 'enabled', true);
end
$$;

create or replace function public.mfa_disable(p_code text)
returns jsonb
language plpgsql security definer set search_path = public
as $$
begin
  if auth.uid() is null then raise exception 'unauthorized'; end if;
  if not public.mfa_check_code(p_code) then raise exception 'Invalid 6-digit code'; end if;
  update public.user_mfa set enabled = false, updated_at = now() where uid = auth.uid();
  return jsonb_build_object('ok', true, 'enabled', false);
end
$$;

create or replace function public.mfa_verify(p_code text)
returns jsonb
language plpgsql stable security definer set search_path = public
as $$
declare
  v_en boolean;
begin
  if auth.uid() is null then raise exception 'unauthorized'; end if;
  select enabled into v_en from public.user_mfa where uid = auth.uid();
  if not found or v_en = false then
    return jsonb_build_object('ok', true, 'mfa_enabled', false);
  end if;
  if not public.mfa_check_code(p_code) then raise exception 'Invalid 6-digit code'; end if;
  return jsonb_build_object('ok', true, 'mfa_enabled', true);
end
$$;

create or replace function public.mfa_status()
returns jsonb
language plpgsql stable security definer set search_path = public
as $$
declare
  v_en boolean;
  v_has boolean;
begin
  if auth.uid() is null then raise exception 'unauthorized'; end if;
  select enabled into v_en from public.user_mfa where uid = auth.uid();
  v_has := found;
  return jsonb_build_object('has_secret', v_has, 'enabled', coalesce(v_en, false));
end
$$;

-- ----------------------------------------------------------------------------
-- 2) Self-exclusion + deletion requests (additive columns)
-- ----------------------------------------------------------------------------
alter table public.profiles add column if not exists self_excluded boolean not null default false;
alter table public.profiles add column if not exists deletion_requested boolean not null default false;

create or replace function public.toggle_self_exclusion()
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_ex boolean;
begin
  if auth.uid() is null then raise exception 'unauthorized'; end if;
  update public.profiles set self_excluded = not self_excluded where id = auth.uid()
  returning self_excluded into v_ex;
  if v_ex then
    insert into public.notifications (uid, title, body)
    values (auth.uid(), 'Self-Exclusion ON', 'Betting, deposits aur withdrawals band. Support se contact karke reactivate karo.');
  else
    insert into public.notifications (uid, title, body)
    values (auth.uid(), 'Self-Exclusion OFF', 'Wapas khel sakte ho. Play responsibly.');
  end if;
  return jsonb_build_object('ok', true, 'self_excluded', v_ex);
end
$$;

create or replace function public.request_deletion(p_confirmed boolean)
returns jsonb
language plpgsql security definer set search_path = public
as $$
begin
  if auth.uid() is null then raise exception 'unauthorized'; end if;
  if p_confirmed = false then raise exception 'Confirmation required'; end if;
  update public.profiles set deletion_requested = true where id = auth.uid() and role = 'user';
  update public.profiles set self_excluded = true where id = auth.uid();
  insert into public.notifications (uid, title, body)
  values (auth.uid(), 'Deletion Requested', 'Account deletion request received. Admin review karega — balance zero nahi hoga jab tak review complete.');
  return jsonb_build_object('ok', true);
end
$$;

-- self-exclusion enforcement: place_bet
create or replace function public.place_bet(p_type text, p_selection text, p_amount numeric)
returns jsonb
language plpgsql security definer set search_path = public
as $$
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
$$;

-- request_deposit: self-exclusion + daily deposit limit
create or replace function public.request_deposit(p_amount numeric, p_upi_ref text, p_screenshot_url text default '')
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_wallet jsonb;
  v_dep_id bigint;
  v_url    text := coalesce(p_screenshot_url, '');
  v_self   boolean;
  v_dl     numeric;
  v_today  numeric;
begin
  if auth.uid() is null then raise exception 'unauthorized'; end if;
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

  if v_url is distinct from '' and v_url not like concat('%/', auth.uid()::text, '/%') then
    v_url := '';
  end if;

  insert into public.deposits (uid, amount, upi_ref, screenshot_url, payment_mode, status)
  values (auth.uid(), p_amount, trim(p_upi_ref), v_url, 'upi', 'pending')
  returning id into v_dep_id;

  insert into public.wallet_ledger (uid, type, amount, balance_after, ref, note)
  values (auth.uid(), 'deposit_pending', 0, (select balance from public.profiles where id = auth.uid()), 'DEP-' || v_dep_id, p_amount::text);

  return jsonb_build_object('ok', true, 'depositId', v_dep_id, 'receipt', 'DEP-' || v_dep_id);
end
$$;

-- request_withdrawal: self-exclusion
create or replace function public.request_withdrawal(p_amount numeric, p_upi text)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_wallet jsonb;
  v_bal    numeric;
  v_id     bigint;
  v_self   boolean;
begin
  if auth.uid() is null then raise exception 'unauthorized'; end if;
  if p_amount is null or p_amount <= 0 then raise exception 'invalid amount'; end if;
  if p_upi is null or char_length(trim(p_upi)) < 5 then raise exception 'valid UPI ID required'; end if;

  select self_excluded into v_self from public.profiles where id = auth.uid();
  if v_self then raise exception 'Account is self-excluded — contact support to reactivate'; end if;

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

  return jsonb_build_object('ok', true, 'withdrawalId', v_id, 'balance', v_bal);
end
$$;

-- wallet settings: dailyDepositLimit seed
update public.settings
set value = value || '{"dailyDepositLimit": 0}'::jsonb
where key = 'wallet' and not (value ? 'dailyDepositLimit');

-- ----------------------------------------------------------------------------
-- DONE
