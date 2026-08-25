# JIO CLUB v7 — Security Audit & Hardening Report

**Scope:** Full codebase security audit + hardening (Supabase backend + React frontend).
**Date:** 2026-08-25
**Approach:** Least privilege, atomic transactions, strict validation, defense-in-depth.

---

## 1. Executive summary

A complete security audit was performed across the Supabase backend (Postgres RLS, RPC/SECURITY DEFINER functions, storage, secrets) and the React frontend. The **critical privilege-escalation hole** (unprotected `SECURITY DEFINER` RPCs) was **confirmed, fixed, and verified with adversarial testing**. A **minor race condition** in the Razorpay credit path was fixed with an atomic, idempotent server-side function.

**This is not "100% secure."** Below is an accurate list of what was fixed, what was verified, and the residual risks that remain.

---

## 2. Vulnerabilities found & fixed

### VULN-1 — CRITICAL: Unprotected `SECURITY DEFINER` RPCs (privilege escalation / fund tampering)

**Finding:** `settle_period()`, `pick_result()`, `tick_game()`, `ledger_backfill()`, `mfa_check_code()`, `totp_code()`, `notify_admin()`, `rl_check()`, `rank_for_count()`, `v_thread_ok()`, `check_link_url()`, `handle_new_user()` were `SECURITY DEFINER` (bypass RLS) and **world-executable** (granted to `public`/`anon`/`authenticated`). Any logged-in (or even anonymous) client could call `settle_period(period, number)` directly via PostgREST RPC to **rig any period's result** and credit arbitrary balances, or call `ledger_backfill()` / `mfa_check_code()` / `totp_code()` to abuse internals.

**Fix (defense-in-depth, both layers):**
1. **Least-privilege EXECUTE grants** — `revoke execute ... from public, anon, authenticated` on all privileged internal functions; `grant execute ... to service_role` only. `postgres` (owner, runs pg_cron) keeps it.
2. **Internal role guard** — the 3 cron-invoked privileged functions (`settle_period`, `pick_result`, `tick_game`) were recreated with an internal guard:
   ```sql
   if current_user not in ('postgres','service_role') then
     raise exception 'forbidden: privileged function';
   end if;
   ```
   This is defense-in-depth: even if EXECUTE grants are ever mistakenly widened, only `postgres`/`service_role` can run them.

**Verified (adversarial):** Anonymous and `authenticated` calls to `settle_period`, `tick_game`, `ledger_backfill`, `mfa_check_code`, `totp_code`, `rl_check` → **`permission denied`** / not executable. `service_role`/`postgres` retain access (cron + service calls still work).

**Files:** `supabase/security_hardening.sql` (applied to live), and the same guard + revoke block is now **appended to `supabase/schema.sql`** so fresh deploys are secure by default.

### VULN-2 — MEDIUM/HIGH: Razorpay credit read-then-write race (lost update / double credit)

**Finding:** The `razorpay-pay` edge function did a **read-then-write**: `GET /profiles` (read balance) → compute `newBal` → `PATCH /profiles`. Two concurrent captured payments for the same user could both read the same balance and both write `balance+amount`, **losing one credit** (or, if not idempotent, double-crediting on webhook replay).

**Fix:** New **atomic, idempotent** server-side RPC `razorpay_credit(uid, amount, payment_id)`:
- **Single atomic `UPDATE ... SET balance = balance + amount`** (no read-then-write → no lost update).
- **Idempotent by `payment_id`** (replayed/duplicate webhooks cannot double-credit).
- **`pg_advisory_xact_lock`** per user to serialize concurrent credits.
- `SECURITY DEFINER` + internal `current_user` guard + `revoke` from `public/anon/authenticated`, `grant` to `service_role` only.

**Files:** `supabase/patch_atomic_razorpay.sql` (applied to live, verified revoked from anon/authenticated), `supabase/functions/razorpay-pay/index.ts` (now calls the atomic RPC).

> Note: the updated `razorpay-pay` edge function must be redeployed (Supabase Dashboard → Edge Functions → Deploy, or `supabase functions deploy razorpay-pay`). The atomic SQL function is already live; the edge function source is updated in-repo and just needs a redeploy.

---

## 3. What was verified (adversarial testing)

Tested as **anonymous**, **authenticated non-admin**, and **admin**:

| Attack | Result |
|---|---|
| Anon calls `settle_period` / `tick_game` / `pick_result` / `ledger_backfill` / `mfa_check_code` / `totp_code` / `rl_check` | **Blocked** (permission denied) |
| Authenticated non-admin calls privileged RPCs | **Blocked** |
| `razorpay_credit` callable by anon/authenticated | **Blocked** (service_role only) |
| Client writes balances/roles/results directly | **Blocked by RLS** (no client write policy on `profiles.balance`, `role`, `results`) |
| Admin functions called by non-admin | **Blocked** (internal `is_admin()` + role guard) |

---

## 4. Residual risks (NOT eliminated — be aware)

These are **not** fully eliminable in this architecture and require operational/structural action:

1. **Razorpay edge function needs redeploy** to pick up the atomic RPC (see VULN-2). Until redeployed, the old read-then-write code is live.
2. **Secret key rotation** — the `service_role` key was shared in chat during setup. **Rotate it** (Supabase → Project Settings → API → Regenerate). Rotate Razorpay keys if the old `liveKeySecret` was ever set.
3. **RLS is the core control** — if a policy is ever misconfigured, data is exposed. Keep the security block in `schema.sql` as the single source of truth and re-run on every deploy.
4. **`settings` table is readable by all authenticated users** — it must **never** hold secrets (the Razorpay secrets were moved to the private `secrets` table for this reason). Keep secrets only in the `secrets` table (service-role-only) or env vars.
5. **pg_cron / edge functions run as privileged roles** — any bug or SQL-injection in a privileged function is a privilege-escalation path. Keep privileged functions strict (parameterized, input-validated, guarded).
6. **No MFA on the Supabase dashboard / admin login** — enable MFA on the Supabase org and on the admin account (dashboard → Auth → MFA).
7. **No server-side rate limiting on the PostgREST RPCs** (Supabase doesn't rate-limit RPCs by default). The in-app rate-limiting is client-side only and bypassable. For production, add Supabase rate limiting / API gateway limits or a `rl_check` gate in each sensitive RPC.

---

## 5. Admin panel — 1:1 control + 250+ features

The admin panel now has **1:1 control over every user-panel feature** and **250+ admin controls** across 14 sections (Dashboard, Users, Deposits, Withdrawals, Bets, Results, Coupons, Referrals & Ranks, Chat Moderation, Announcements & Broadcast, Analytics, Admin Logs, Settings, and the new **Game Control**). Every user-facing feature (bets, deposits, withdrawals, chat, coupons, referral, announcements, notifications, theme, sounds, app name/logo) is controllable from the admin panel. See `README.md` for the full feature matrix.

---

## 6. Files changed in this hardening

| File | Change |
|---|---|
| `supabase/security_hardening.sql` | **NEW** — defense-in-depth hardening (guards + least-privilege grants). Applied to live. |
| `supabase/schema.sql` | Security block (guards + revoke/grant) appended so fresh deploys are secure by default. |
| `supabase/patch_atomic_razorpay.sql` | **NEW** — atomic, idempotent `razorpay_credit` RPC. Applied to live. |
| `supabase/functions/razorpay-pay/index.ts` | Now calls the atomic `razorpay_credit` RPC (needs redeploy). |

---

## 7. Verification commands (re-run anytime)

```sql
-- Confirm privileged functions are NOT executable by anon/authenticated:
select p.proname,
  has_function_privilege('anon', p.oid::regprocedure::regprocedure, 'EXECUTE') as anon,
  has_function_privilege('authenticated', p.oid::regprocedure::regprocedure, 'EXECUTE') as auth,
  has_function_privilege('service_role', p.oid::regprocedure::regprocedure, 'EXECUTE') as svc
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname='public'
  and p.proname in ('settle_period','pick_result','tick_game','ledger_backfill',
                    'mfa_check_code','totp_code','rl_check','notify_admin','razorpay_credit')
order by p.proname;
-- Expected: anon=false, auth=false, svc=true for all privileged functions.
```

---

**Bottom line:** The critical privilege-escalation hole and the Razorpay race are fixed and verified at the backend. Residual risks (razorpay redeploy, key rotation, MFA, RPC rate limiting) are listed above and need operational follow-up. This is a strong hardening, not a guarantee of "100% secure."
