-- ============================================================================
-- PATCH 5 (idempotent): one-way admin chat + historical ledger backfill
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1) Chat: one-way (admin broadcast only). Additive column for admin badge.
-- ----------------------------------------------------------------------------
alter table public.chats add column if not exists is_admin boolean not null default false;

drop policy if exists "chats_insert_own" on public.chats;
drop policy if exists "chats_insert_admin" on public.chats;
create policy "chats_insert_admin" on public.chats for insert
with check (public.is_admin());

create or replace function public.send_chat(p_message text)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_me    public.profiles%rowtype;
  v_chat  jsonb;
  v_len   int;
  v_id    bigint;
  v_isa   boolean;
begin
  if auth.uid() is null then raise exception 'unauthorized'; end if;
  v_isa := public.is_admin();
  if not v_isa then
    raise exception 'Community chat is now admin broadcast only — use Support tab to talk to admin';
  end if;

  select * into v_me from public.profiles where id = auth.uid();
  if not found then raise exception 'profile not found'; end if;

  select value into v_chat from public.settings where key = 'chat';
  v_chat := coalesce(v_chat, '{"enabled":true,"maxMessage":500}'::jsonb);

  v_len := char_length(coalesce(trim(p_message), ''));
  if v_len = 0 then raise exception 'Empty message'; end if;
  if v_len > coalesce((v_chat->>'maxMessage')::int, 500) then
    raise exception 'Message too long (max %)', (v_chat->>'maxMessage');
  end if;

  if exists (select 1 from public.chat_rate r where r.uid = auth.uid() and r.last_at > now() - interval '3 seconds') then
    raise exception 'Slow down — max 1 message per 3 seconds';
  end if;
  insert into public.chat_rate (uid, last_at) values (auth.uid(), now())
  on conflict (uid) do update set last_at = now();

  insert into public.chats (uid, name, rank, message, is_admin)
  values (auth.uid(), split_part(v_me.email, '@', 1), v_me.rank, trim(p_message), v_isa)
  returning id into v_id;

  return jsonb_build_object('ok', true, 'id', v_id);
end
$$;

-- ----------------------------------------------------------------------------
-- 2) Historical ledger backfill + reconciliation
--    For every user: reconstructs stake/payout/deposit/withdraw/coupon events
--    older than their existing ledger, plus an 'opening' entry so that
--    opening + all events = current balance (fully reconciled).
-- ----------------------------------------------------------------------------
create or replace function public.ledger_backfill()
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_user      record;
  v_existing_min timestamptz;
  v_existing_net numeric;
  v_current numeric;
  v_opening numeric;
  v_running numeric;
  v_evt     record;
  v_cnt     int := 0;
  v_users   int := 0;
  v_first_evt timestamptz;
  v_created timestamptz;
begin
  if not public.is_admin() then raise exception 'forbidden'; end if;

  for v_user in select id, balance, created_at from public.profiles where role = 'user'
  loop
    v_current := v_user.balance;

    select min(created_at) into v_existing_min from public.wallet_ledger where uid = v_user.id;
    select coalesce(sum(amount), 0) into v_existing_net from public.wallet_ledger where uid = v_user.id;

    -- collect historical events (only older than existing ledger)
    drop table if exists tmp_evt;
    create temp table tmp_evt on commit drop as
    select * from (
      -- stakes
      select b.created_at as ts, 'stake' as type, -b.amount as amount, 'BET-' || b.id as ref,
             b.period_id || ' ' || b.type || ' ' || b.selection as note
      from public.bets b
      where b.uid = v_user.id and (v_existing_min is null or b.created_at < v_existing_min)
      union all
      -- payouts (win settlements, timed by the result row)
      select coalesce(r.created_at, b.created_at) as ts, 'payout' as type, b.win_amount as amount, b.period_id as ref, 'win' as note
      from public.bets b
      left join public.results r on r.period_id = b.period_id
      where b.uid = v_user.id and b.result = 'win' and b.win_amount > 0
        and (v_existing_min is null or coalesce(r.created_at, b.created_at) < v_existing_min)
      union all
      -- approved deposits
      select coalesce(d.processed_at, d.created_at) as ts, 'deposit' as type, d.amount as amount, 'DEP-' || d.id as ref, 'deposit approved' as note
      from public.deposits d
      where d.uid = v_user.id and d.status = 'approved'
        and (v_existing_min is null or coalesce(d.processed_at, d.created_at) < v_existing_min)
      union all
      -- withdrawal locks
      select w.created_at as ts, 'withdraw_lock' as type, -w.amount as amount, 'WD-' || w.id as ref, w.upi_id as note
      from public.withdrawals w
      where w.uid = v_user.id
        and (v_existing_min is null or w.created_at < v_existing_min)
      union all
      -- approved withdrawals (payment completed)
      select w.processed_at as ts, 'withdraw_paid' as type, 0 as amount, 'WD-' || w.id as ref, 'withdrawal paid (already locked)' as note
      from public.withdrawals w
      where w.uid = v_user.id and w.status = 'approved' and w.processed_at is not null
        and (v_existing_min is null or w.processed_at < v_existing_min)
      union all
      -- rejected withdrawals (refunds)
      select w.processed_at as ts, 'refund' as type, w.amount as amount, 'WD-' || w.id as ref, 'withdrawal rejected + refunded' as note
      from public.withdrawals w
      where w.uid = v_user.id and w.status = 'rejected' and w.processed_at is not null
        and (v_existing_min is null or w.processed_at < v_existing_min)
      union all
      -- coupons
      select cu.created_at as ts, 'coupon' as type, cu.amount as amount, cu.code as ref, 'coupon applied' as note
      from public.coupon_usages cu
      where cu.uid = v_user.id
        and (v_existing_min is null or cu.created_at < v_existing_min)
    ) t
    order by ts, type;

    if not exists (select 1 from tmp_evt) then
      -- no historical events: only add opening if balance is non-zero and ledger is empty
      if v_existing_min is null and v_current <> 0 then
        insert into public.wallet_ledger (uid, type, amount, balance_after, ref, note, created_at)
        values (v_user.id, 'adjust', v_current, v_current, 'OPENING', 'Opening balance (backfill)', v_user.created_at);
        v_cnt := v_cnt + 1;
        v_users := v_users + 1;
      end if;
      continue;
    end if;

    -- opening balance so that: opening + backfill + existing = current
    select (select coalesce(sum(amount), 0) from tmp_evt) into v_running;
    v_opening := v_current - v_existing_net - v_running;

    select min(ts) into v_first_evt from tmp_evt;
    v_created := least(v_first_evt, v_user.created_at) - interval '1 second';

    if v_opening <> 0 then
      insert into public.wallet_ledger (uid, type, amount, balance_after, ref, note, created_at)
      values (v_user.id, 'adjust', v_opening, v_opening, 'OPENING', 'Opening balance (pre-ledger backfill)', v_created);
      v_cnt := v_cnt + 1;
    end if;
    v_running := v_opening;

    for v_evt in select * from tmp_evt
    loop
      v_running := v_running + v_evt.amount;
      insert into public.wallet_ledger (uid, type, amount, balance_after, ref, note, created_at)
      values (v_user.id, v_evt.type, v_evt.amount, v_running, v_evt.ref, v_evt.note, v_evt.ts);
      v_cnt := v_cnt + 1;
    end loop;
    v_users := v_users + 1;
  end loop;

  return jsonb_build_object('ok', true, 'entries_added', v_cnt, 'users_processed', v_users);
end
$$;

-- ----------------------------------------------------------------------------
-- 3) admin_action: add 'backfill-ledger' branch
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
-- DONE
