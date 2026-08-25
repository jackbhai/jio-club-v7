-- ============================================================================
-- JIO CLUB v7 — PATCH 1 (idempotent, ADDITIVE ONLY — no feature removal)
-- Fixes: V7-003 analytics crash, V7-004 private screenshots, V7-005
-- request_deposit RPC, V7-006 daily bet limit, V7-013 send_chat RPC
-- ============================================================================

-- ----------------------------------------------------------------------------
-- FIX 1 (V7-003): analytics_summary — ORDER BY alias-with-cast bug
-- (order by won::numeric failed: alias+cast resolves as column name)
-- ----------------------------------------------------------------------------
create or replace function public.analytics_summary()
returns jsonb
language plpgsql security definer set search_path = public
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
      group by p.id, p.email, p.rank
      order by sum(b.win_amount) desc limit 10) t),
    'topDepositors', (select coalesce(jsonb_agg(row_to_json(t)), '[]'::jsonb) from (
      select p.email, p.rank, round(sum(d.amount),2)::text as deposited, count(*)::int as txns
      from public.deposits d join public.profiles p on p.id = d.uid
      where d.status='approved'
      group by p.id, p.email, p.rank
      order by sum(d.amount) desc limit 10) t),
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
-- FIX 2 (V7-006): daily per-user bet limit (additive setting + enforcement)
-- ----------------------------------------------------------------------------
-- add dailyBetLimit to wallet settings (default 0 = unlimited, keep existing keys)
update public.settings
set value = value || '{"dailyBetLimit": 50000}'::jsonb
where key = 'wallet' and not (value ? 'dailyBetLimit');

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
begin
  if auth.uid() is null then raise exception 'unauthorized'; end if;
  if p_type not in ('color','number','size') then raise exception 'invalid bet type'; end if;
  if p_amount is null or p_amount <= 0 then raise exception 'invalid amount'; end if;

  select value into v_game from public.settings where key = 'game';
  v_game := coalesce(v_game, '{"duration":60,"minBet":10,"maxBet":10000,"betCloseSeconds":5,"active":true,"maintenance":false,"enableColor":true,"enableNumber":true,"enableSize":true}'::jsonb);
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

  -- daily per-user stake limit (0 = unlimited)
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

  return jsonb_build_object('ok', true, 'betId', v_bet_id, 'periodId', v_period_id, 'balance', v_bal, 'receipt', 'BET-' || v_bet_id);
end
$$;

-- ----------------------------------------------------------------------------
-- FIX 3 (V7-005): request_deposit — server-side validated deposit request
-- (client may NOT set uid/status/screenshot arbitrarily)
-- ----------------------------------------------------------------------------
create or replace function public.request_deposit(p_amount numeric, p_upi_ref text, p_screenshot_url text default '')
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_wallet jsonb;
  v_dep_id bigint;
  v_url    text := coalesce(p_screenshot_url, '');
begin
  if auth.uid() is null then raise exception 'unauthorized'; end if;
  if p_amount is null or p_amount <= 0 then raise exception 'invalid amount'; end if;

  select value into v_wallet from public.settings where key = 'wallet';
  v_wallet := coalesce(v_wallet, '{"minDeposit":10}'::jsonb);

  if p_amount < coalesce((v_wallet->>'minDeposit')::numeric, 10) then
    raise exception 'Minimum deposit is %', (v_wallet->>'minDeposit');
  end if;
  if p_amount > 1000000 then raise exception 'Maximum single deposit is ₹1,000,000'; end if;
  if char_length(coalesce(p_upi_ref,'')) < 4 then raise exception 'Valid UPI transaction reference (UTR) required'; end if;

  -- screenshot must be inside THIS user's storage folder (anti-tamper)
  if v_url is distinct from '' and v_url not like concat('%/', auth.uid()::text, '/%') then
    v_url := '';
  end if;

  insert into public.deposits (uid, amount, upi_ref, screenshot_url, payment_mode, status)
  values (auth.uid(), p_amount, trim(p_upi_ref), v_url, 'upi', 'pending')
  returning id into v_dep_id;

  return jsonb_build_object('ok', true, 'depositId', v_dep_id, 'receipt', 'DEP-' || v_dep_id);
end
$$;

-- ----------------------------------------------------------------------------
-- FIX 4 (V7-013): send_chat — server-side rate limit + identity from profile
-- (client cannot spoof name/rank; 1 message per 3s per user)
-- ----------------------------------------------------------------------------
create table if not exists public.chat_rate (
  uid        uuid primary key references public.profiles(id) on delete cascade,
  last_at    timestamptz not null default now()
);

create or replace function public.send_chat(p_message text)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_me    public.profiles%rowtype;
  v_chat  jsonb;
  v_len   int;
  v_id    bigint;
begin
  if auth.uid() is null then raise exception 'unauthorized'; end if;
  select * into v_me from public.profiles where id = auth.uid();
  if not found then raise exception 'profile not found'; end if;
  if v_me.status <> 'active' then raise exception 'Account blocked'; end if;

  select value into v_chat from public.settings where key = 'chat';
  v_chat := coalesce(v_chat, '{"enabled":true,"maxMessage":500}'::jsonb);
  if coalesce((v_chat->>'enabled')::boolean, true) = false then
    raise exception 'Chat is disabled by admin';
  end if;

  v_len := char_length(coalesce(trim(p_message), ''));
  if v_len = 0 then raise exception 'Empty message'; end if;
  if v_len > coalesce((v_chat->>'maxMessage')::int, 500) then
    raise exception 'Message too long (max %)', (v_chat->>'maxMessage');
  end if;

  -- rate limit: max 1 message per 3 seconds
  if exists (select 1 from public.chat_rate r where r.uid = auth.uid() and r.last_at > now() - interval '3 seconds') then
    raise exception 'Slow down — max 1 message per 3 seconds';
  end if;
  insert into public.chat_rate (uid, last_at) values (auth.uid(), now())
  on conflict (uid) do update set last_at = now();

  insert into public.chats (uid, name, rank, message)
  values (auth.uid(), split_part(v_me.email, '@', 1), v_me.rank, trim(p_message))
  returning id into v_id;

  return jsonb_build_object('ok', true, 'id', v_id);
end
$$;

-- ----------------------------------------------------------------------------
-- FIX 5 (V7-004): screenshots bucket -> PRIVATE + ownership/admin policies
-- (old public URLs stop working immediately — intended)
-- ----------------------------------------------------------------------------
update storage.buckets set public = false where id = 'screenshots';

drop policy if exists "screenshots_read" on storage.objects;
create policy "screenshots_read" on storage.objects for select
using (
  bucket_id = 'screenshots'
  and (
    (auth.uid() is not null and (storage.foldername(name))[1] = auth.uid()::text)
    or public.is_admin()
  )
);

drop policy if exists "screenshots_upload" on storage.objects;
create policy "screenshots_upload" on storage.objects for insert
with check (
  bucket_id = 'screenshots'
  and auth.uid() is not null
  and (storage.foldername(name))[1] = auth.uid()::text
  and coalesce((storage.extension(name)) in ('jpg','jpeg','png'), false)
);

-- ----------------------------------------------------------------------------
-- DONE
-- ============================================================================
