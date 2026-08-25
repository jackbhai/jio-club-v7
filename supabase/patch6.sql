-- ============================================================================
-- PATCH 6 (idempotent): ntfy push notifications for admin + suspicious account flags
-- ============================================================================

create extension if not exists pg_net;

-- notify settings (admin-configurable topic + toggle)
insert into public.settings (key, value)
values ('notify', jsonb_build_object('enabled', true, 'topic', 'jioclub-' || substr(md5(gen_random_uuid()::text), 1, 12)))
on conflict (key) do nothing;

-- notify_admin: pushes to ntfy.sh topic (free, no account needed)
create or replace function public.notify_admin(p_title text, p_body text, p_priority text default 'high')
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_nt jsonb;
  v_topic text;
  v_url text;
begin
  select value into v_nt from public.settings where key = 'notify';
  if coalesce((v_nt->>'enabled')::boolean, false) = false then return; end if;
  v_topic := coalesce(v_nt->>'topic', '');
  if v_topic = '' then return; end if;
  v_url := 'https://ntfy.sh/' || v_topic;
  perform net.http_post(v_url, jsonb_build_object('title', p_title, 'message', p_body, 'priority', coalesce(p_priority, 'high')));
end
$$;

-- request_deposit: notify on new request
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
$$;

-- request_withdrawal: notify on new request
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

  perform public.notify_admin('New Withdrawal Request',
    '₹' || p_amount || ' → ' || trim(p_upi) || ' · user ' || left(auth.uid()::text, 8), 'high');

  return jsonb_build_object('ok', true, 'withdrawalId', v_id, 'balance', v_bal);
end
$$;

-- simpler: return the thread id properly
create or replace function public.support_send(p_thread_id uuid, p_subject text default '', p_category text default 'general', p_body text default '')
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_me    public.profiles%rowtype;
  v_isa   boolean;
  v_msg_id bigint;
  v_tid   uuid;
  v_new   boolean;
begin
  if auth.uid() is null then raise exception 'unauthorized'; end if;
  v_isa := public.is_admin();
  select * into v_me from public.profiles where id = auth.uid();
  if not found then raise exception 'profile not found'; end if;
  if char_length(coalesce(trim(p_body), '')) = 0 then raise exception 'Empty message'; end if;
  if char_length(coalesce(trim(p_body), '')) > 1000 then raise exception 'Message too long (max 1000)'; end if;

  v_new := false;
  if p_thread_id is null then
    if v_isa then raise exception 'Admin cannot create own ticket — reply to user threads'; end if;
    if char_length(coalesce(trim(p_subject), '')) = 0 then raise exception 'Subject required for new topic'; end if;
    insert into public.support_threads (uid, subject, category)
    values (auth.uid(), trim(p_subject), coalesce(p_category, 'general'))
    returning id into v_tid;
    v_new := true;
  else
    if v_isa then
      if not exists (select 1 from public.support_threads where id = p_thread_id) then
        raise exception 'Thread not found';
      end if;
    else
      if not exists (select 1 from public.support_threads where id = p_thread_id and uid = auth.uid()) then
        raise exception 'Thread not found';
      end if;
    end if;
    v_tid := p_thread_id;
  end if;

  if not v_isa and exists (select 1 from public.support_rate r where r.uid = auth.uid() and r.last_at > now() - interval '2 seconds') then
    raise exception 'Slow down — max 1 message per 2 seconds';
  end if;
  insert into public.support_rate (uid, last_at) values (auth.uid(), now())
  on conflict (uid) do update set last_at = now();

  insert into public.support_messages (thread_id, uid, from_admin, body)
  values (v_tid, auth.uid(), v_isa, trim(p_body))
  returning id into v_msg_id;

  update public.support_threads set last_at = now() where id = v_tid;

  if v_new then
    perform public.notify_admin('New Support Ticket',
      '[' || coalesce(p_category, 'general') || '] ' || trim(p_subject) || ' — ' || coalesce(v_me.email, left(auth.uid()::text, 8)), 'high');
  end if;

  return jsonb_build_object('ok', true, 'threadId', v_tid);
end
$$;

-- analytics_summary: add suspicious accounts
create or replace function public.analytics_summary()
returns jsonb
language plpgsql stable security definer set search_path = public
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
      from generate_series((current_date - 13), current_date, interval '1 day') date) t),
    'suspicious', coalesce((
      select jsonb_agg(row_to_json(x)) from (
        select
          case when length(split_part(p.email, '@', 1)) > 2
               then left(split_part(p.email, '@', 1), 2) || '***'
               else split_part(p.email, '@', 1) || '*' end as name,
          p.id as uid,
          round(p.balance, 2)::text as balance,
          array_remove(array[
            case when w24 > 20000 then 'big-win-24h' end,
            case when wstreak >= 5 then 'win-streak-24h' end,
            case when v1h >= 15 then 'high-velocity' end,
            case when d24 > 50000 then 'big-deposits-24h' end
          ], null) as flags,
          round(w24, 2)::text as won24h
        from public.profiles p
        cross join lateral (select coalesce(sum(b.win_amount), 0) as w24,
                              count(*) filter (where b.result = 'win') as wstreak
                       from public.bets b
                       join public.results r on r.period_id = b.period_id
                       where b.uid = p.id and b.result in ('win','lose')
                         and r.created_at > now() - interval '24 hours') s24
        cross join lateral (select count(*) as v1h from public.bets where uid = p.id and created_at > now() - interval '1 hour') lv
        cross join lateral (select coalesce(sum(amount), 0) as d24 from public.deposits where uid = p.id and created_at > now() - interval '24 hours') ld
        where p.role = 'user'
          and (s24.w24 > 20000 or s24.wstreak >= 5 or lv.v1h >= 15 or ld.d24 > 50000)
        order by s24.w24 desc
        limit 20
      ) x
    ), '[]'::jsonb)
  );
end
$$;

-- admin_action: notify on money actions (re-deploy with notify calls)
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
    perform public.notify_admin('Balance Adjusted',
      left(v_uid::text, 8) || ': ' || coalesce(p_params->>'delta','') || ' (' || coalesce(p_params->>'reason','manual') || ') → ' || v_newbal, 'default');
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

  elsif p_action = 'backfill-ledger' then
    v_out := public.ledger_backfill();

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
    perform public.notify_admin('Deposit Approved', '₹' || v_row.amount || ' · user ' || left(v_row.uid::text, 8), 'default');
    v_out := jsonb_build_object('approved', v_row.amount);

  elsif p_action = 'reject-deposit' then
    v_id := (p_params->>'id')::bigint;
    update public.deposits set status='rejected', note=coalesce(p_params->>'note','Rejected'), processed_at=now()
    where id = v_id and status='pending'
    returning uid into v_row;
    if not found then raise exception 'deposit not found or not pending'; end if;
    insert into public.notifications (uid, title, body) values (v_row.uid, 'Deposit Rejected', coalesce(p_params->>'note','Please contact support.'));
    perform public.notify_admin('Deposit Rejected', 'user ' || left(v_row.uid::text, 8) || ' · ' || coalesce(p_params->>'note',''), 'default');
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
    perform public.notify_admin('Withdrawal Paid', '₹' || v_row.amount || ' · user ' || left(v_row.uid::text, 8), 'default');
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
    perform public.notify_admin('Withdrawal Rejected + Refund', '₹' || v_row.amount || ' · user ' || left(v_row.uid::text, 8), 'default');
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

-- DONE
