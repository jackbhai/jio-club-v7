-- ============================================================================
-- SECURITY PATCH: atomic Razorpay credit (fixes read-then-write race)
-- Idempotent + atomic (single UPDATE = no lost-update race), idempotent by
-- payment_id so replayed/duplicate webhooks cannot double-credit.
-- Apply in Supabase SQL Editor.
-- ============================================================================
begin;

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

-- least privilege: only postgres/service_role
revoke execute on function public.razorpay_credit(uuid,numeric,text) from public;
revoke execute on function public.razorpay_credit(uuid,numeric,text) from anon;
revoke execute on function public.razorpay_credit(uuid,numeric,text) from authenticated;
grant execute on function public.razorpay_credit(uuid,numeric,text) to service_role;

commit;
