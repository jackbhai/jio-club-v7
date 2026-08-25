-- ============================================================================
-- JIO CLUB v7 — PATCH 2 (idempotent, ADDITIVE ONLY)
-- betsPerPeriod control, wallet ledger, multi-UPI, private support chat,
-- public links, razorpay dual keys (test/live)
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1) betsPerPeriod — admin-controlled bets per period per user (1 = one, 0 = unlimited)
-- ----------------------------------------------------------------------------
update public.settings
set value = value || '{"betsPerPeriod": 1}'::jsonb
where key = 'game' and not (value ? 'betsPerPeriod');

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
begin
  if auth.uid() is null then raise exception 'unauthorized'; end if;
  if p_type not in ('color','number','size') then raise exception 'invalid bet type'; end if;
  if p_amount is null or p_amount <= 0 then raise exception 'invalid amount'; end if;

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

  -- bets per period cap (0 = unlimited)
  v_cap := coalesce((v_game->>'betsPerPeriod')::int, 1);
  if v_cap > 0 then
    select count(*) into v_cnt from public.bets where uid = auth.uid() and period_id = v_period_id;
    if v_cnt >= v_cap then
      raise exception 'Max % bet(s) allowed per period', v_cap;
    end if;
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

  insert into public.wallet_ledger (uid, type, amount, balance_after, ref, note)
  values (auth.uid(), 'stake', -p_amount, v_bal, 'BET-' || v_bet_id, v_period_id || ' ' || p_type || ' ' || p_selection);

  return jsonb_build_object('ok', true, 'betId', v_bet_id, 'periodId', v_period_id, 'balance', v_bal, 'receipt', 'BET-' || v_bet_id);
end
$$;

-- ----------------------------------------------------------------------------
-- 2) Wallet Ledger — append-only money journal
-- ----------------------------------------------------------------------------
create table if not exists public.wallet_ledger (
  id            bigint generated always as identity primary key,
  uid           uuid not null references public.profiles(id) on delete cascade,
  type          text not null,
  amount        numeric(12,2) not null,
  balance_after numeric(12,2),
  ref           text not null default '',
  note          text not null default '',
  created_at    timestamptz not null default now()
);
create index wallet_ledger_uid_idx on public.wallet_ledger(uid, created_at desc);
create index wallet_ledger_created_idx on public.wallet_ledger(created_at desc);

alter table public.wallet_ledger enable row level security;
drop policy if exists "ledger_select" on public.wallet_ledger;
create policy "ledger_select" on public.wallet_ledger for select
using (uid = auth.uid() or public.is_admin());

-- settle_period: ledger payout entries (rewrite with ledger)
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
    return;
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

  -- ledger: payout entries with balance_after
  insert into public.wallet_ledger (uid, type, amount, balance_after, ref, note)
  select w.uid, 'payout', w.win_total, p.balance, p_period_id, 'win'
  from (
    select uid, sum(win_amount) as win_total
    from public.bets
    where period_id = p_period_id and result = 'win'
    group by uid
  ) w
  join public.profiles p on p.id = w.uid;
end
$$;

-- request_withdrawal: ledger lock entry
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

  insert into public.wallet_ledger (uid, type, amount, balance_after, ref, note)
  values (auth.uid(), 'withdraw_lock', -p_amount, v_bal, 'WD-' || v_id, trim(p_upi));

  return jsonb_build_object('ok', true, 'withdrawalId', v_id, 'balance', v_bal);
end
$$;

-- apply_coupon: ledger entry
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
  insert into public.wallet_ledger (uid, type, amount, balance_after, ref, note)
  values (auth.uid(), 'coupon', c.amount, v_bal, c.code, 'coupon applied');
  insert into public.notifications (uid, title, body)
  values (auth.uid(), 'Coupon Applied', 'Coupon ' || c.code || ' applied: +₹' || c.amount);
  return jsonb_build_object('ok', true, 'amount', c.amount, 'balance', v_bal);
end
$$;

-- claim_welcome_bonus: ledger entry
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
  insert into public.wallet_ledger (uid, type, amount, balance_after, ref, note)
  values (auth.uid(), 'bonus', v_bonus, v_bal, 'WELCOME', 'welcome bonus');
  insert into public.notifications (uid, title, body)
  values (auth.uid(), 'Welcome Bonus', 'Congratulations! ₹' || v_bonus || ' welcome bonus added to your wallet.');
  return jsonb_build_object('ok', true, 'bonus', v_bonus, 'balance', v_bal);
end
$$;

-- admin_action: ledger entries on financial ops (full rewrite, same API)
create or replace function public.admin_action(p_action text, p_params jsonb default '{}'::jsonb)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_uid   uuid;
  v_id    bigint;
  v_str   text;
  v_row   record;
  v_newbal numeric;
  v_out   jsonb := '{}'::jsonb;
begin
  if auth.uid() is null then raise exception 'unauthorized'; end if;
  if not public.is_admin() then raise exception 'forbidden'; end if;

  insert into public.admin_logs (admin_id, action, detail) values (auth.uid(), p_action, p_params);

  if p_action = 'adjust-balance' then
    v_uid := p_params->>'uid';
    select balance + coalesce((p_params->>'delta')::numeric, 0) into v_newbal
    from public.profiles where id = v_uid;
    if not found then raise exception 'user not found'; end if;
    update public.profiles set balance = v_newbal where id = v_uid;
    insert into public.wallet_ledger (uid, type, amount, balance_after, ref, note)
    values (v_uid, 'adjust', coalesce((p_params->>'delta')::numeric, 0), v_newbal, 'ADJ', coalesce(p_params->>'reason', 'manual adjustment'));
    insert into public.notifications (uid, title, body)
    values (v_uid, 'Balance Updated', coalesce(p_params->>'reason', 'Admin adjusted your balance'));
    v_out := jsonb_build_object('balance', v_newbal);

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
    update public.settings set value = value || p_params where key = 'game';
    v_out := jsonb_build_object('saved', true);

  elsif p_action = 'tick-now' then
    perform public.tick_game();
    v_out := jsonb_build_object('ok', true);

  elsif p_action = 'approve-deposit' then
    v_id := (p_params->>'id')::bigint;
    update public.deposits set status='approved', note=coalesce(p_params->>'note',''), processed_at=now()
    where id = v_id and status='pending'
    returning uid, amount into v_row;
    if not found then raise exception 'deposit not found or not pending'; end if;
    update public.profiles set balance = balance + v_row.amount, total_deposits = total_deposits + v_row.amount where id = v_row.uid;
    select balance into v_newbal from public.profiles where id = v_row.uid;
    insert into public.wallet_ledger (uid, type, amount, balance_after, ref, note)
    values (v_row.uid, 'deposit', v_row.amount, v_newbal, 'DEP-' || v_id, 'deposit approved');
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
    for v_str in select jsonb_array_elements_text(coalesce(p_params->'ids','[]'::jsonb))
    loop
      perform public.admin_action('approve-deposit', jsonb_build_object('id', v_str));
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
    select balance into v_newbal from public.profiles where id = v_row.uid;
    insert into public.wallet_ledger (uid, type, amount, balance_after, ref, note)
    values (v_row.uid, 'withdraw_paid', 0, v_newbal, 'WD-' || v_id, 'withdrawal paid (already locked)');
    insert into public.notifications (uid, title, body) values (v_row.uid, 'Withdrawal Processed', '₹' || v_row.amount || ' sent to your UPI.');
    v_out := jsonb_build_object('approved', v_row.amount);

  elsif p_action = 'reject-withdrawal' then
    v_id := (p_params->>'id')::bigint;
    update public.withdrawals set status='rejected', note=coalesce(p_params->>'note','Rejected'), processed_at=now()
    where id = v_id and status='pending'
    returning uid, amount into v_row;
    if not found then raise exception 'withdrawal not found or not pending'; end if;
    update public.profiles set balance = balance + v_row.amount where id = v_row.uid;
    select balance into v_newbal from public.profiles where id = v_row.uid;
    insert into public.wallet_ledger (uid, type, amount, balance_after, ref, note)
    values (v_row.uid, 'refund', v_row.amount, v_newbal, 'WD-' || v_id, 'withdrawal rejected + refunded');
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
-- 3) Multi-UPI accounts
-- ----------------------------------------------------------------------------
create table if not exists public.upi_accounts (
  id          uuid primary key default gen_random_uuid(),
  label       text not null,
  upi_id      text not null unique,
  holder_name text not null default '',
  status      text not null default 'active' check (status in ('active','paused','archived')),
  is_default  boolean not null default false,
  sort_order  int not null default 0,
  created_at  timestamptz not null default now()
);
alter table public.upi_accounts enable row level security;
drop policy if exists "upi_select" on public.upi_accounts;
create policy "upi_select" on public.upi_accounts for select
using (auth.uid() is not null and status = 'active' and (public.is_admin() or true));
drop policy if exists "upi_admin_write" on public.upi_accounts;
create policy "upi_admin_write" on public.upi_accounts for all
using (public.is_admin()) with check (public.is_admin());

-- seed default account from existing UPI setting (once)
insert into public.upi_accounts (label, upi_id, holder_name, is_default, sort_order)
select 'Primary', u.value->>'upiId', coalesce(u.value->>'holder',''), true, 0
from public.settings u
where u.key = 'upi' and coalesce(u.value->>'upiId','') <> ''
  and not exists (select 1 from public.upi_accounts);

-- ----------------------------------------------------------------------------
-- 4) Private support chat (user <-> admin only)
-- ----------------------------------------------------------------------------
create table if not exists public.support_threads (
  id         uuid primary key default gen_random_uuid(),
  uid        uuid not null references public.profiles(id) on delete cascade,
  subject    text not null default '',
  category   text not null default 'general' check (category in ('general','deposit','withdrawal','bet','account','technical')),
  status     text not null default 'open' check (status in ('open','closed')),
  last_at    timestamptz not null default now(),
  created_at timestamptz not null default now()
);
create table if not exists public.support_messages (
  id          bigint generated always as identity primary key,
  thread_id   uuid not null references public.support_threads(id) on delete cascade,
  uid         uuid not null references public.profiles(id) on delete cascade,
  from_admin  boolean not null default false,
  body        text not null check (char_length(body) between 1 and 1000),
  created_at  timestamptz not null default now()
);
create index support_messages_thread_idx on public.support_messages(thread_id, created_at);

alter table public.support_threads enable row level security;
alter table public.support_messages enable row level security;
alter table public.support_threads replica identity full;
alter table public.support_messages replica identity full;

drop policy if exists "sth_select" on public.support_threads;
create policy "sth_select" on public.support_threads for select
using (uid = auth.uid() or public.is_admin());
drop policy if exists "sth_admin_write" on public.support_threads;
create policy "sth_admin_write" on public.support_threads for all
using (public.is_admin()) with check (public.is_admin());

drop policy if exists "stm_select" on public.support_messages;
create policy "stm_select" on public.support_messages for select
using (
  public.is_admin()
  or exists (select 1 from public.support_threads t where t.id = thread_id and t.uid = auth.uid())
);
-- user insert happens via send_support RPC (definer) — no direct insert policy

do $$ begin
  begin alter publication supabase_realtime add table public.support_messages; exception when others then null; end;
  begin alter publication supabase_realtime add table public.support_threads; exception when others then null; end;
end $$;

create table if not exists public.support_rate (
  uid     uuid primary key references public.profiles(id) on delete cascade,
  last_at timestamptz not null default now()
);

create or replace function public.support_threads_list()
returns jsonb
language plpgsql stable security definer set search_path = public
as $$
begin
  if auth.uid() is null then raise exception 'unauthorized'; end if;
  if public.is_admin() then
    return (
      select coalesce(jsonb_agg(row_to_json(x)), '[]'::jsonb) from (
        select t.id, t.uid, p.email as user_email, t.subject, t.category, t.status, t.last_at, t.created_at,
               (select count(*) from public.support_messages m where m.thread_id = t.id and m.from_admin) as admin_msgs,
               (select count(*) from public.support_messages m where m.thread_id = t.id and not m.from_admin) as user_msgs
        from public.support_threads t
        left join public.profiles p on p.id = t.uid
        order by t.last_at desc limit 100
      ) x
    );
  end if;
  return (
    select coalesce(jsonb_agg(row_to_json(x)), '[]'::jsonb) from (
      select t.id, t.subject, t.category, t.status, t.last_at, t.created_at
      from public.support_threads t
      where t.uid = auth.uid()
      order by t.last_at desc limit 30
    ) x
  );
end
$$;

create or replace function public.support_send(p_thread_id uuid, p_subject text default '', p_category text default 'general', p_body text default '')
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_thread uuid;
  v_is_admin boolean;
begin
  if auth.uid() is null then raise exception 'unauthorized'; end if;
  v_is_admin := public.is_admin();
  if char_length(coalesce(trim(p_body), '')) = 0 then raise exception 'Empty message'; end if;
  if char_length(coalesce(trim(p_body), '')) > 1000 then raise exception 'Message too long (max 1000)'; end if;

  if v_thread_ok(p_thread_id, v_is_admin) then
    v_thread := p_thread_id;
  elsif p_thread_id is null and not v_is_admin then
    if char_length(coalesce(trim(p_subject), '')) = 0 then raise exception 'Subject required for new topic'; end if;
    insert into public.support_threads (uid, subject, category)
    values (auth.uid(), trim(p_subject), coalesce(p_category, 'general'))
    returning id into v_thread;
  else
    raise exception 'Thread not found';
  end if;

  -- rate limit user messages (1 per 2s)
  if not v_is_admin and exists (select 1 from public.support_rate r where r.uid = auth.uid() and r.last_at > now() - interval '2 seconds') then
    raise exception 'Slow down — max 1 message per 2 seconds';
  end if;
  insert into public.support_rate (uid, last_at) values (auth.uid(), now())
  on conflict (uid) do update set last_at = now();

  insert into public.support_messages (thread_id, uid, from_admin, body)
  values (v_thread, auth.uid(), v_is_admin, trim(p_body));
  update public.support_threads set last_at = now() where id = v_thread;

  return jsonb_build_object('ok', true, 'threadId', v_thread);
end
$$;

-- helper: is this thread accessible?
create or replace function public.v_thread_ok(p_thread_id uuid, p_is_admin boolean)
returns boolean
language sql stable security definer set search_path = public
as $$
  select case
    when p_thread_id is null then false
    when p_is_admin then exists (select 1 from public.support_threads where id = p_thread_id)
    else exists (select 1 from public.support_threads where id = p_thread_id and uid = auth.uid())
  end
$$;

create or replace function public.support_messages(p_thread_id uuid)
returns jsonb
language plpgsql stable security definer set search_path = public
as $$
declare
  v_is_admin boolean;
begin
  if auth.uid() is null then raise exception 'unauthorized'; end if;
  v_is_admin := public.is_admin();
  if not public.v_thread_ok(p_thread_id, v_is_admin) then raise exception 'Thread not found'; end if;
  return (
    select coalesce(jsonb_agg(row_to_json(m)), '[]'::jsonb) from (
      select m.id, m.uid, p.email as sender_email, m.from_admin, m.body, m.created_at
      from public.support_messages m
      left join public.profiles p on p.id = m.uid
      where m.thread_id = p_thread_id
      order by m.created_at asc limit 200
    ) m
  );
end
$$;

create or replace function public.support_close(p_thread_id uuid, p_closed boolean)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_is_admin boolean;
begin
  if auth.uid() is null then raise exception 'unauthorized'; end if;
  v_is_admin := public.is_admin();
  if not public.v_thread_ok(p_thread_id, v_is_admin) then raise exception 'Thread not found'; end if;
  if v_is_admin then
    update public.support_threads set status = case when p_closed then 'closed' else 'open' end where id = p_thread_id;
  elsif not exists (select 1 from public.support_threads where id = p_thread_id and uid = auth.uid()) then
    raise exception 'forbidden';
  else
    update public.support_threads set status = case when p_closed then 'closed' else 'open' end where id = p_thread_id;
  end if;
  return jsonb_build_object('ok', true);
end
$$;

-- ----------------------------------------------------------------------------
-- 5) Public links directory (Telegram/WhatsApp/social)
-- ----------------------------------------------------------------------------
create table if not exists public.public_links (
  id          uuid primary key default gen_random_uuid(),
  platform    text not null default 'telegram',
  title       text not null,
  description text not null default '',
  url         text not null,
  active      boolean not null default true,
  pinned      boolean not null default false,
  sort_order  int not null default 0,
  created_at  timestamptz not null default now()
);
alter table public.public_links enable row level security;
drop policy if exists "plinks_select" on public.public_links;
create policy "plinks_select" on public.public_links for select
using (auth.uid() is not null and (active = true or public.is_admin()));
drop policy if exists "plinks_admin_write" on public.public_links;
create policy "plinks_admin_write" on public.public_links for all
using (public.is_admin()) with check (public.is_admin());

-- ----------------------------------------------------------------------------
-- 6) Razorpay dual keys (test + live) — additive settings
-- ----------------------------------------------------------------------------
update public.settings
set value = value || '{"env":"test","testKeyId":"","testKeySecret":"","liveKeyId":"","liveKeySecret":""}'::jsonb
where key = 'payments';

-- ----------------------------------------------------------------------------
-- DONE
