-- ============================================================================
-- JIO CLUB v7 — PATCH 9 FINAL (authoritative; apply AFTER all earlier patches)
-- Single source of truth for: admin_action, settle_period, pick_result,
-- tick_game, notify_admin, razorpay_credit, mfa_check_code (rate-limited),
-- toggle_self_exclusion (cooldown+lift), mfa_attempts, secrets storage, and
-- the complete EXECUTE grant surface. Idempotent + transactional (begin/commit). Safe to
-- re-run regardless of which earlier patches ran in which order.
--
-- Design decisions (per final spec):
--  * Access control for privileged functions is enforced EXCLUSIVELY by
--    EXECUTE grants (final block, line-by-line) — NOT by current_user checks
--    inside SECURITY DEFINER bodies (meaningless there: current_user is the
--    owner postgres for every nested definer call). Internal guards removed.
--  * Game logic in settle_period/pick_result/tick_game is UNCHANGED from the
--    current live (schema.sql hardened / patch8) version.
--  * Razorpay key secrets live ONLY in public.secrets (RLS enabled+forced;
--    service_role + owner-postgres policy; NO policy for anon/authenticated/
--    public). Any leftover secrets in public.settings are migrated in and
--    zeroed. Deprecated payment_keys table is drained (was interim home).
--  * secret_get()/secret_set() (SECURITY DEFINER, is_admin()-gated) let the
--    admin panel manage secrets without any client access to the table.
--  * lift-self-exclusion requires self_exclusion_lift_pending = true AND
--    now() >= self_exclusion_until.
-- ============================================================================
begin;

-- ----------------------------------------------------------------------------
-- (a) admin_action — is_admin() gating, ::uuid casts (V7-BUG-1 fix), atomic
--     adjust-balance, lift-self-exclusion (per spec), lockout guards
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_action(p_action text, p_params jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
    -- PATCH8 (issue 9): atomic single-statement increment (no read-then-write race)
    v_uid := (p_params->>'uid')::uuid;
    update public.profiles set balance = balance + coalesce((p_params->>'delta')::numeric, 0)
    where id = v_uid
    returning balance into v_newbal;
    if not found then raise exception 'user not found'; end if;
    insert into public.wallet_ledger (uid, type, amount, balance_after, ref, note)
    values (v_uid, 'adjust', coalesce((p_params->>'delta')::numeric, 0), v_newbal, 'ADJ', coalesce(p_params->>'reason', 'manual adjustment'));
    insert into public.notifications (uid, title, body)
    values (v_uid, 'Balance Updated', coalesce(p_params->>'reason', 'Admin adjusted your balance'));
    perform public.notify_admin('Balance Adjusted',
      left(v_uid::text, 8) || ': ' || coalesce(p_params->>'delta','') || ' (' || coalesce(p_params->>'reason','manual') || ') → ' || v_newbal, 'default');
    v_out := jsonb_build_object('balance', v_newbal);

  elsif p_action = 'set-status' then
    v_uid := p_params->>'uid';
    -- PATCH9: no self-block / no admin-target block (lockout protection)
    if v_uid = auth.uid() then
      raise exception 'Khud ko block nahi kar sakte';
    end if;
    if exists (select 1 from public.profiles where id = v_uid and role = 'admin') then
      raise exception 'Admin account block database (SQL) se hi karo';
    end if;
    update public.profiles set status = (p_params->>'status') where id = v_uid;
    insert into public.notifications (uid, title, body)
    values (v_uid, 'Account ' || upper(p_params->>'status'),
            case when p_params->>'status' = 'blocked' then 'Your account has been suspended.' else 'Your account has been re-activated.' end);
    v_out := jsonb_build_object('status', p_params->>'status');

  elsif p_action = 'set-rank' then
    update public.profiles set rank = p_params->>'rank' where id = (p_params->>'uid')::uuid;
    v_out := jsonb_build_object('rank', p_params->>'rank');

  elsif p_action = 'set-role' then
    -- PATCH9: no self-demotion, no admin-target role changes (lockout protection)
    if (p_params->>'uid')::uuid = auth.uid() then
      raise exception 'Apne khud ka role change nahi kar sakte';
    end if;
    if exists (select 1 from public.profiles where id = (p_params->>'uid')::uuid and role = 'admin') then
      raise exception 'Admin role change database (SQL) se hi karo';
    end if;
    update public.profiles set role = p_params->>'role' where id = (p_params->>'uid')::uuid;
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
    insert into public.notifications (uid, title, body) values ((p_params->>'uid')::uuid, p_params->>'title', coalesce(p_params->>'body',''));
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
    delete from public.profiles where id = (p_params->>'uid')::uuid and role <> 'admin';
    v_out := jsonb_build_object('deleted', found);

  elsif p_action = 'lift-self-exclusion' then
    -- PATCH9_FINAL: lift only when the user has requested it (lift_pending = true)
    -- AND the configured cooldown has elapsed. Sets self_excluded=false and
    -- self_exclusion_lift_pending=false on success.
    v_uid := (p_params->>'uid')::uuid;
    update public.profiles
    set self_excluded = false, self_exclusion_until = null, self_exclusion_lift_pending = false
    where id = v_uid
      and self_excluded = true
      and self_exclusion_lift_pending = true
      and now() >= self_exclusion_until
    returning id into v_row;
    if not found then
      if exists (select 1 from public.profiles where id = v_uid and self_excluded) then
        raise exception 'Not eligible yet: request pending + cooldown must have elapsed';
      end if;
      raise exception 'User not found or not excluded';
    end if;
    insert into public.notifications (uid, title, body)
    values (v_uid, 'Self-Exclusion Lifted', 'Admin ne aapki self-exclusion utha li hai. Welcome back!');
    v_out := jsonb_build_object('lifted', true);

  else
    v_out := jsonb_build_object('ok', false, 'unknownAction', p_action);
  end if;

  return v_out || jsonb_build_object('ok', true, 'action', p_action);
end
$function$;

-- ----------------------------------------------------------------------------
-- (b) Game engine — EXACT current live logic, current_user guards removed
--     (access enforced by the final grant block: service_role/postgres only)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.settle_period(p_period_id text, p_number integer)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
$function$;
CREATE OR REPLACE FUNCTION public.pick_result(p_period_id text)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
$function$;
CREATE OR REPLACE FUNCTION public.tick_game()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
$function$;

-- ----------------------------------------------------------------------------
-- (b-2) notify_admin — unchanged from current live (patch6)
-- ----------------------------------------------------------------------------
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

-- ----------------------------------------------------------------------------
-- (c) razorpay_credit — EXACTLY as patch_atomic_razorpay.sql
--     (pg_advisory_xact_lock + atomic single UPDATE + idempotent by payment_id)
-- ----------------------------------------------------------------------------
create or replace function public.razorpay_credit(p_uid uuid, p_amount numeric, p_payment_id text)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_dep    bigint;
  v_newbal numeric;
begin
  -- defense-in-depth: only postgres/service_role may call
  if current_user not in ('postgres','service_role') then
    raise exception 'forbidden: privileged function';
  end if;

  if p_amount is null or p_amount <= 0 then raise exception 'invalid amount'; end if;
  if p_payment_id is null or p_payment_id = '' then raise exception 'missing payment id'; end if;

  -- idempotency: one credit per payment id (replay-safe)
  if exists (select 1 from public.deposits where upi_ref = p_payment_id and payment_mode = 'razorpay') then
    return jsonb_build_object('ok', true, 'already', true);
  end if;

  -- row lock to serialize concurrent credits for the same user
  if not exists (select 1 from public.profiles where id = p_uid) then
    raise exception 'user not found';
  end if;
  perform pg_advisory_xact_lock(hashtext('razorpay:' || p_uid::text));

  update public.profiles
  set balance = balance + p_amount, total_deposits = total_deposits + p_amount
  where id = p_uid
  returning balance into v_newbal;
  if not found then raise exception 'user not found'; end if;

  insert into public.deposits (uid, amount, upi_ref, payment_mode, status, processed_at, note)
  values (p_uid, p_amount, p_payment_id, 'razorpay', 'approved', now(), 'razorpay auto-verified')
  returning id into v_dep;

  insert into public.wallet_ledger (uid, type, amount, balance_after, ref, note)
  values (p_uid, 'deposit', p_amount, v_newbal, 'DEP-' || v_dep, 'razorpay ' || p_payment_id);

  insert into public.notifications (uid, title, body)
  values (p_uid, 'Deposit Approved', '₹' || p_amount || ' added to your wallet (Razorpay, auto-verified).');

  return jsonb_build_object('ok', true, 'balance', v_newbal, 'depositId', v_dep, 'receipt', 'DEP-' || v_dep);
end
$$;

-- ----------------------------------------------------------------------------
-- (d) public.secrets — single source of truth for Razorpay key SECRETS
--     RLS enabled + FORCED. Policy for service_role + owner (postgres) only.
--     No policy exists for anon / authenticated / public => denied.
--     (postgres is in the policy because FORCE RLS would otherwise lock the
--      owner out of SQL-editor maintenance; it is the DB admin role.)
-- ----------------------------------------------------------------------------
create table if not exists public.secrets (
  key        text primary key,
  value      text not null default '',
  updated_at timestamptz not null default now()
);
alter table public.secrets enable row level security;
alter table public.secrets force row level security;
drop policy if exists "secrets_service" on public.secrets;
create policy "secrets_service" on public.secrets for all
using (current_user in ('service_role','postgres'))
with check (current_user in ('service_role','postgres'));

-- admin-panel accessors (SECURITY DEFINER + is_admin() gate; no client RLS
-- access to the table itself)
create or replace function public.secret_get(p_key text)
returns text
language plpgsql stable security definer set search_path = public
as $$
declare v text;
begin
  if not public.is_admin() then raise exception 'forbidden'; end if;
  select value into v from public.secrets where key = p_key;
  return coalesce(v, '');
end
$$;

create or replace function public.secret_set(p_key text, p_value text)
returns boolean
language plpgsql security definer set search_path = public
as $$
begin
  if not public.is_admin() then raise exception 'forbidden'; end if;
  insert into public.secrets (key, value)
  values (p_key, coalesce(p_value, ''))
  on conflict (key) do update
    set value = coalesce(p_value, ''), updated_at = now();
  return true;
end
$$;

-- profiles columns required by lift-self-exclusion (additive, idempotent)
alter table public.profiles add column if not exists self_exclusion_until timestamptz;
alter table public.profiles add column if not exists self_exclusion_lift_pending boolean not null default false;

-- settings seed for cooldown config (idempotent)
insert into public.settings (key, value) values ('self_exclusion', '{"cooldownHours":24}'::jsonb)
on conflict (key) do nothing;

-- mfa_attempts table (required by mfa_check_code rate limiting; idempotent)
create table if not exists public.mfa_attempts (
  uid          uuid primary key references auth.users(id) on delete cascade,
  window_start timestamptz not null default now(),
  count        int not null default 0,
  locked_until timestamptz,
  updated_at   timestamptz not null default now()
);
alter table public.mfa_attempts enable row level security;
drop policy if exists "mfa_attempts_own" on public.mfa_attempts;

-- mfa_check_code WITH rate limiting (5 fails / 5 min => 15 min lockout)
create or replace function public.mfa_check_code(p_code text)
returns boolean
language plpgsql stable security definer set search_path = public
as $$
declare
  v_secret text;
  v_now    bigint;
  v_w      bigint;
  v_norm   text;
  v_locked boolean;
  v_cnt    int;
  v_until  timestamptz;
begin
  if auth.uid() is null then raise exception 'unauthorized'; end if;
  select secret into v_secret from public.user_mfa where uid = auth.uid();
  if not found or v_secret is null then raise exception 'MFA not set up'; end if;

  select (locked_until is not null and now() < locked_until), count
    into v_locked, v_cnt from public.mfa_attempts where uid = auth.uid();
  if v_locked then
    select locked_until into v_until from public.mfa_attempts where uid = auth.uid();
    raise exception 'Too many attempts — locked until % (support se contact karo)', to_char(v_until, 'HH24:MI:SS');
  end if;

  v_norm := ltrim(rtrim(coalesce(p_code, ''), ' '), '0');
  v_now  := (extract(epoch from now()) / 30)::bigint;
  for v_w in select w from (values (v_now - 1), (v_now), (v_now + 1)) t(w)
  loop
    if ltrim(public.totp_code(v_secret, v_w)::text, '0') = v_norm then
      delete from public.mfa_attempts where uid = auth.uid();  -- reset on success
      return true;
    end if;
  end loop;

  insert into public.mfa_attempts (uid, window_start, count)
  values (auth.uid(), now(), 1)
  on conflict (uid) do update
    set window_start = case when now() - mfa_attempts.window_start > interval '5 minutes'
                            then now() else mfa_attempts.window_start end,
        count        = case when now() - mfa_attempts.window_start > interval '5 minutes'
                            then 1 else mfa_attempts.count + 1 end,
        locked_until = case when (case when now() - mfa_attempts.window_start > interval '5 minutes'
                                       then 1 else mfa_attempts.count + 1 end) >= 5
                            then now() + interval '15 minutes' else mfa_attempts.locked_until end,
        updated_at   = now();
  return false;
end
$$;

-- toggle_self_exclusion (ON instant; OFF deferred = cooldown + admin lift)
create or replace function public.toggle_self_exclusion()
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_ex    boolean;
  v_hours numeric;
begin
  if auth.uid() is null then raise exception 'unauthorized'; end if;
  select self_excluded into v_ex from public.profiles where id = auth.uid();

  if not v_ex then
    update public.profiles
    set self_excluded = true, self_exclusion_until = null, self_exclusion_lift_pending = false
    where id = auth.uid();
    insert into public.notifications (uid, title, body)
    values (auth.uid(), 'Self-Exclusion ON', 'Betting, deposits aur withdrawals band. Support se contact karke reactivate karo.');
    return jsonb_build_object('ok', true, 'self_excluded', true);
  end if;

  select coalesce((value->>'cooldownHours')::numeric, 24) into v_hours
  from public.settings where key = 'self_exclusion';
  if v_hours < 24 then v_hours := 24; end if;
  if v_hours > 72 then v_hours := 72; end if;

  update public.profiles
  set self_exclusion_until = now() + make_interval(hours => v_hours::int),
      self_exclusion_lift_pending = true
  where id = auth.uid();
  insert into public.notifications (uid, title, body)
  values (auth.uid(), 'Self-Exclusion Lift Requested',
          'Aapne self-exclusion OFF ki request ki. ' || v_hours || 'h cooldown ke baad admin approve karega.');
  return jsonb_build_object('ok', true, 'self_excluded', true, 'lift_pending', true,
    'message', 'Cooldown ' || v_hours || 'h + admin approval chahiye');
end
$$;

-- legacy global_chat lockdown (was: Allow all for anon) — idempotent no-op if already dropped
drop policy if exists "Allow all for anon" on public.global_chat;

-- ----------------------------------------------------------------------------
-- (d-2) Secret migration — idempotent, never overwrites a non-empty stored
--       secret with an empty one, zero-out only after safe migration.
-- ----------------------------------------------------------------------------
insert into public.secrets (key, value)
values
  ('razorpay_test_key_secret', coalesce((select value->>'testKeySecret' from public.settings where key='payments'), '')),
  ('razorpay_live_key_secret', coalesce((select value->>'liveKeySecret' from public.settings where key='payments'), ''))
on conflict (key) do update
  set value = case when excluded.value <> '' then excluded.value else public.secrets.value end,
      updated_at = case when excluded.value <> '' then now() else public.secrets.updated_at end;

-- zero secrets out of the (public-readable) settings table
update public.settings
set value = value - 'testKeySecret' - 'liveKeySecret'
where key = 'payments';

-- drain deprecated interim table payment_keys into secrets, then blank it
do $drain$
begin
  if exists (select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
             where c.relname = 'payment_keys' and n.nspname = 'public') then
    execute $drain_sql$
      insert into public.secrets (key, value)
      select case when env = 'test' then 'razorpay_test_key_secret' else 'razorpay_live_key_secret' end,
             key_secret
      from public.payment_keys
      where key_secret <> ''
      on conflict (key) do update
        set value = case when excluded.value <> '' then excluded.value else public.secrets.value end,
            updated_at = case when excluded.value <> '' then now() else public.secrets.updated_at end
    $drain_sql$;
    execute 'update public.payment_keys set key_secret = '''' where key_secret <> '''';';
  end if;
end
$drain$;

-- ----------------------------------------------------------------------------
-- (e) FINAL EXHAUSTIVE GRANT BLOCK — the only authority on EXECUTE surface.
--     Does not rely on any earlier REVOKE/GRANT block: revokes everything
--     from every role first, then grants exactly the matrix below,
--     line by line (auditable). postgres (owner) retains implicit execute.
--
--     ROLE MATRIX
--     - service_role : ALL functions (edge functions run as service_role)
--     - authenticated: client RPCs the UI calls (each internally gated by
--                      auth.uid()/is_admin()) + secret_get/secret_set
--     - anon         : pre-auth public reads + is_admin (used by RLS policies)
--     - public       : NOTHING
--     - NOT granted to anon/authenticated (service_role/postgres only):
--          settle_period, pick_result, tick_game, notify_admin,
--          razorpay_credit, mfa_check_code, totp_code, rank_for_count(2x),
--          rl_check, v_thread_ok, ledger_backfill, handle_new_user,
--          admin_secret
-- ----------------------------------------------------------------------------
revoke execute on all functions in schema public from public;
revoke execute on all functions in schema public from anon;
revoke execute on all functions in schema public from authenticated;
revoke execute on all functions in schema public from service_role;

-- service_role: ALL
grant execute on function public.admin_action(text,jsonb) to service_role;
grant execute on function public.admin_secret(text,text,text) to service_role;
grant execute on function public.analytics_summary() to service_role;
grant execute on function public.apply_coupon(text) to service_role;
grant execute on function public.check_link_url() to service_role;
grant execute on function public.claim_referral(text) to service_role;
grant execute on function public.claim_welcome_bonus() to service_role;
grant execute on function public.game_state() to service_role;
grant execute on function public.handle_new_user() to service_role;
grant execute on function public.is_admin() to service_role;
grant execute on function public.leaderboard_top(integer) to service_role;
grant execute on function public.ledger_backfill() to service_role;
grant execute on function public.mfa_check_code(text) to service_role;
grant execute on function public.mfa_disable(text) to service_role;
grant execute on function public.mfa_enable(text) to service_role;
grant execute on function public.mfa_setup() to service_role;
grant execute on function public.mfa_status() to service_role;
grant execute on function public.mfa_verify(text) to service_role;
grant execute on function public.notify_admin(text,text,text) to service_role;
grant execute on function public.pick_result(text) to service_role;
grant execute on function public.place_bet(text,text,numeric) to service_role;
grant execute on function public.rank_for_count(integer) to service_role;
grant execute on function public.rank_for_count(bigint) to service_role;
grant execute on function public.razorpay_credit(uuid,numeric,text) to service_role;
grant execute on function public.referral_dashboard() to service_role;
grant execute on function public.request_deletion(boolean) to service_role;
grant execute on function public.request_deposit(numeric,text,text) to service_role;
grant execute on function public.request_withdrawal(numeric,text) to service_role;
grant execute on function public.rl_check(text,integer,integer) to service_role;
grant execute on function public.send_chat(text) to service_role;
grant execute on function public.secret_get(text) to service_role;
grant execute on function public.secret_set(text,text) to service_role;
grant execute on function public.settle_period(text,integer) to service_role;
grant execute on function public.stats_overview() to service_role;
grant execute on function public.support_close(uuid,boolean) to service_role;
grant execute on function public.support_messages(uuid) to service_role;
grant execute on function public.support_send(uuid,text,text,text) to service_role;
grant execute on function public.support_threads_list() to service_role;
grant execute on function public.tick_game() to service_role;
grant execute on function public.toggle_self_exclusion() to service_role;
grant execute on function public.totp_code(text,bigint) to service_role;
grant execute on function public.update_my_profile(text,text,text) to service_role;
grant execute on function public.v_thread_ok(uuid,boolean) to service_role;

-- authenticated: client RPCs only
grant execute on function public.admin_action(text,jsonb) to authenticated;
grant execute on function public.analytics_summary() to authenticated;
grant execute on function public.apply_coupon(text) to authenticated;
grant execute on function public.check_link_url() to authenticated;
grant execute on function public.claim_referral(text) to authenticated;
grant execute on function public.claim_welcome_bonus() to authenticated;
grant execute on function public.game_state() to authenticated;
grant execute on function public.is_admin() to authenticated;
grant execute on function public.leaderboard_top(integer) to authenticated;
grant execute on function public.mfa_disable(text) to authenticated;
grant execute on function public.mfa_enable(text) to authenticated;
grant execute on function public.mfa_setup() to authenticated;
grant execute on function public.mfa_status() to authenticated;
grant execute on function public.mfa_verify(text) to authenticated;
grant execute on function public.place_bet(text,text,numeric) to authenticated;
grant execute on function public.referral_dashboard() to authenticated;
grant execute on function public.request_deletion(boolean) to authenticated;
grant execute on function public.request_deposit(numeric,text,text) to authenticated;
grant execute on function public.request_withdrawal(numeric,text) to authenticated;
grant execute on function public.secret_get(text) to authenticated;
grant execute on function public.secret_set(text,text) to authenticated;
grant execute on function public.send_chat(text) to authenticated;
grant execute on function public.stats_overview() to authenticated;
grant execute on function public.support_close(uuid,boolean) to authenticated;
grant execute on function public.support_messages(uuid) to authenticated;
grant execute on function public.support_send(uuid,text,text,text) to authenticated;
grant execute on function public.support_threads_list() to authenticated;
grant execute on function public.toggle_self_exclusion() to authenticated;
grant execute on function public.update_my_profile(text,text,text) to authenticated;

-- anon: pre-auth reads only
grant execute on function public.is_admin() to anon;
grant execute on function public.game_state() to anon;
grant execute on function public.leaderboard_top(integer) to anon;
grant execute on function public.referral_dashboard() to anon;

-- future functions: deny by default (re-stated here for authority)
alter default privileges in schema public revoke execute on functions from public;
alter default privileges in schema public revoke execute on functions from anon;
alter default privileges in schema public revoke execute on functions from authenticated;
alter default privileges in schema public revoke execute on functions from service_role;

commit;
