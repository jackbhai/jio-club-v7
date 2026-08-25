-- ============================================================================
-- JIO CLUB — SECURITY HARDENING (idempotent, wrapped in a transaction)
-- Defense-in-depth:
--   PART A: internal current_user guards on cron-invoked privileged functions
--   PART B: least-privilege EXECUTE grants (revoke anon/authenticated/public)
-- ============================================================================
begin;

-- PART A: internal role guards (defense-in-depth) on privileged cron functions
-- (recreated with a current_user guard so only postgres/service_role can call)

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
  if current_user not in ('postgres','service_role') then
    raise exception 'forbidden: privileged function';
  end if;
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
  if current_user not in ('postgres','service_role') then
    raise exception 'forbidden: privileged function';
  end if;
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
  if current_user not in ('postgres','service_role') then
    raise exception 'forbidden: privileged function';
  end if;
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
-- PART B: least-privilege EXECUTE grants (persistent).
-- Revoke direct EXECUTE from anon/authenticated/public on privileged internal
-- functions; grant only to service_role (postgres/owner keeps it for cron).
-- Client-facing functions (admin_action, admin_secret, is_admin, mfa_*, place_bet,
-- request_*, apply_coupon, claim_*, game_state, leaderboard_top, referral_dashboard,
-- stats_overview, analytics_summary, update_my_profile, send_chat, support_*)
-- KEEP their authenticated grant (they carry internal is_admin()/auth.uid() checks).
do $$
declare
  f record;
  priv_wl text[] := array['settle_period','pick_result','tick_game','ledger_backfill','mfa_check_code','totp_code','notify_admin','rank_for_count','v_thread_ok','check_link_url','rl_check','handle_new_user'];
begin
  for f in select p.oid as oid, p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.prokind in ('f','p') and p.proname = any(priv_wl)
  loop
    execute format('revoke execute on function %s from public',        f.oid::regprocedure);
    execute format('revoke execute on function %s from anon',          f.oid::regprocedure);
    execute format('revoke execute on function %s from authenticated', f.oid::regprocedure);
    execute format('grant  execute on function %s to service_role',    f.oid::regprocedure);
  end loop;
end
$$;

commit;
