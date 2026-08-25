-- ============================================================================
-- PATCH 4 (idempotent): screenshot path fix, recompute-ranks type fix,
-- server-side features enforcement, links URL validation, leaderboard RPC
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1) request_deposit: screenshot path ownership pattern was wrong
--    (required '/<uid>/' but paths are '<uid>/<file>')
-- ----------------------------------------------------------------------------
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

  -- features gate (admin toggle)
  if (select coalesce((value->>'deposit')::boolean, true) from public.settings where key = 'features') = false then
    raise exception 'Deposits are currently disabled by admin';
  end if;

  -- screenshot must live inside THIS user's folder: '<uid>/<file>'
  if v_url is distinct from '' and v_url not like (auth.uid()::text || '/%') then
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

-- ----------------------------------------------------------------------------
-- 2) request_withdrawal: features gate
-- ----------------------------------------------------------------------------
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

  return jsonb_build_object('ok', true, 'withdrawalId', v_id, 'balance', v_bal);
end
$$;

-- ----------------------------------------------------------------------------
-- 3) apply_coupon: features gate
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
$$;

-- ----------------------------------------------------------------------------
-- 4) claim_referral: features gate
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

  if (select coalesce((value->>'referral')::boolean, true) from public.settings where key = 'features') = false then
    raise exception 'Referral system is currently disabled';
  end if;

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

-- ----------------------------------------------------------------------------
-- 5) admin_action: recompute-ranks type fix (count(*) is bigint, fn wants int)
--    (full rewrite of admin_action with the fix + features-safe)
-- ----------------------------------------------------------------------------
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
    with rc as (
      select p2.id, count(c.id) as cnt
      from public.profiles p2
      left join public.profiles c on c.referred_by = p2.id
      group by p2.id
    )
    update public.profiles p set
      referral_count = rc.cnt,
      rank = public.rank_for_count(rc.cnt)
    from rc
    where p.id = rc.id;
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
-- 6) public_links: URL must be http(s) — server-side trigger
-- ----------------------------------------------------------------------------
create or replace function public.check_link_url()
returns trigger
language plpgsql
as $$
begin
  if new.url !~ '^https?://' then
    raise exception 'URL must start with http:// or https://';
  end if;
  if new.url like 'javascript:%' or new.url like 'data:%' then
    raise exception 'Invalid URL scheme';
  end if;
  return new;
end
$$;
drop trigger if exists trg_check_link_url on public.public_links;
create trigger trg_check_link_url before insert or update on public.public_links
for each row execute function public.check_link_url();

-- ----------------------------------------------------------------------------
-- 7) Player leaderboard RPC (top winners + top referrers, masked names)
-- ----------------------------------------------------------------------------
create or replace function public.leaderboard_top(p_limit int default 10)
returns jsonb
language plpgsql stable security definer set search_path = public
as $$
begin
  return jsonb_build_object(
    'topWinners', coalesce((
      select jsonb_agg(row_to_json(t)) from (
        select
          case when length(split_part(email, '@', 1)) > 2
               then left(split_part(email, '@', 1), 2) || '***'
               else split_part(email, '@', 1) || '*' end as name,
          rank, total_won::text as won, total_bet::text as bet, referral_code
        from public.profiles
        where status = 'active' and role = 'user' and total_won > 0
        order by total_won desc
        limit greatest(1, coalesce(p_limit, 10))
      ) t
    ), '[]'::jsonb),
    'topReferrers', coalesce((
      select jsonb_agg(row_to_json(t)) from (
        select
          case when length(split_part(email, '@', 1)) > 2
               then left(split_part(email, '@', 1), 2) || '***'
               else split_part(email, '@', 1) || '*' end as name,
          rank, referral_count, referral_code
        from public.profiles
        where status = 'active' and role = 'user' and referral_count > 0
        order by referral_count desc
        limit greatest(1, coalesce(p_limit, 10))
      ) t
    ), '[]'::jsonb)
  );
end
$$;

-- ----------------------------------------------------------------------------
-- DONE
