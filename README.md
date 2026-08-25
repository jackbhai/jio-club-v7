# JIO CLUB v7 — Secure Supabase Edition

**React + Vite + Supabase + GitHub Pages** — poora game engine **server-side** (Postgres + pg_cron),
database **Row Level Security** se locked, 25-section admin panel with **Win Probability Engine**
(Random / Weighted / Target Win-Rate), premium icon-based UI (zero emoji, light+dark themes),
referral = **link + rank only (koi cash reward nahi)**.

---

## Live Site

| | URL |
|---|---|
| **User panel** | https://jackbhai.github.io/jio-club-v7/ |
| **Admin panel** | https://jackbhai.github.io/jio-club-v7/#/admin |
| **GitHub repo** | github.com/jackbhai/jio-club-v7 (auto-deploy on every push) |
| **Database** | Supabase project `eavqngjhvrpxavvcqvvi` (region ap-south-1, Postgres 17) |

Admin login: admin email + password (Supabase Auth) + optional 2FA (TOTP, admin panel se enable).

---

## Architecture

```
Browser (React app, GitHub Pages - FREE)
   |  sirf yeh kar sakta hai: login, bet request, deposit request, apna data padhna
   v
Supabase Postgres (FREE tier: 500MB, 50k MAU)
   |- RLS: user sirf APNA data dekh/likh sakta hai; admin RLS policies se
   |- SQL functions (SECURITY DEFINER, EXECUTE locked): place_bet, tick_game,
   |  settle_period, pick_result, admin_action, razorpay_credit ...
   |- pg_cron "game-tick": har minute result + settlement (server-side)
   `- Edge Function "razorpay-pay": order create + HMAC verify + atomic credit
```

**Sab kuch server-side hai.** Browser me balance, result, ya payout change karne ka
koi raasta nahi — rules RLS + locked SQL functions me hain (console se tamper-proof).

---

## Features (current)

### User panel
- 60s Wingo-style periods: Green/Red/Violet + Big/Small + Number bets
- Wallet: UPI deposit (QR + screenshot + UTR), withdrawal requests, coupons, full ledger
- Game: live timer ring, 5-4-3-2-1 countdown, win/lose animations, sound effects
  (per-user volume slider + sound on/off, device pe save)
- MyBets with stats + filters, bet receipts, report-issue on any bet
- Live community chat, announcements, notifications (bell + ntfy push alerts)
- Referral: link + code, team count, rank progression (bronze to diamond) — **no cash**
- **Profile: Links directory cards** (Telegram/WhatsApp/etc — admin se manage)
- PWA install, Hindi/English (user panel), light/dark themes
- Responsible play: self-exclusion toggle, account deletion request
- Multi-bet control (admin se limit: `betsPerPeriod`), daily bet/deposit limits (server enforced)

### Admin panel (25 sections)
- **Main:** Dashboard (stats + quick game pause/maintenance), Users (search/CSV/balance adjust/rank/block/delete/detail view)
- **Game Engine:** Game Control (win-probability engine + force + settle-now), Results, Bets
- **Money:** Deposits, Withdrawals, Coupons, Wallet Ledger (full audit of every balance change)
- **Growth:** Referrals & Ranks (thresholds, recompute, leaderboard)
- **Support:** Support Inbox (private user chats), Chat Moderation, Announcements + Broadcast
- **Insights:** Analytics (win-rate, 14-day trend, distribution heat, top winners/depositors), Admin Logs
- **Settings (1:1 user-panel control):** Features, Payouts, Wallet, UPI Accounts (multi),
  Payments/Razorpay (test+live keys), Community, **Branding** (app name, logo upload, monogram,
  colors, favicon — live preview), Sounds, **Links Directory**, Contact & About, **Security/2FA**

**Toggles instantly save** — flip karte hi live (realtime user panel me reflect).

### Game engine
- **Pure Random** — har number 10% (100% fair)
- **Weighted Numbers** — 0-9 har number ka apna weight (0-100)
- **Target Win-Rate** — 0-100%: engine us period ke pending bets dekh ke wahi result
  chunta hai jisme ~X% ki bet value jeete (server-side, period-by-period)
- Force next result (0-9), Settle Now, duration/betClose/min/max controls, live probability preview
- Rules: 0 = Red+Violet, even = Red, odd = Green, 0-4 Small, 5-9 Big
- Default payouts: Green x2, Red x2, Violet x4.5, Number x9, Size x2 (admin se change)

---

## Security (applied + verified)

- RLS har table pe; user apna hi data
- Privileged RPCs (`settle_period`, `pick_result`, `tick_game`, `admin_action`, etc.)
  se `anon`/`authenticated` ka EXECUTE **revoke** — sirf service_role call kar sakta hai
  (live pe verified: public calls rejected)
- Internal `current_user` guards on cron-invoked functions (defense-in-depth)
- `razorpay_credit` — atomic + idempotent (payment_id de-dup, advisory lock):
  double-deposit / replay / race condition safe
- Razorpay server-side HMAC verify (edge function), client-side verify kabhi nahi
- Admin 2FA (TOTP) server-side; admin ka har action `admin_logs` me
- `admin_action` me `uuid` type-cast fix (rank/role/delete/notify)
- Service-role key / management tokens repo me **nahi** hain; sirf publishable (public) key
- URL scheme validation trigger on public_links (javascript:/data: blocked)

**Rotation reminder (best practice):** chat me share hue tokens (GitHub PAT, Supabase
management token, service_role key) baad me regenerate kar lena:
- GitHub: github.com/settings/tokens -> Revoke
- Supabase: Dashboard -> Project Settings -> API -> Regenerate / service_role regenerate

---

## Changelog (recent)

| Ver | Change |
|---|---|
| v7.6 | Toggle double-fire bug fixed (value do baar flip hoti thi) — saare toggles single-fire + instant save |
| v7.5 | Admin set-rank / delete-user safe REST path + self/admin delete guards + audit log |
| v7.4 | Profile me Links cards; per-user volume slider + sound persistence; instant-save admin toggles; `admin_action` uuid=text DB patch |
| v7.3 | Security hardening: privileged RPCs lock, atomic `razorpay_credit`, audit report |
| v7.2 | Full site branding control (name, logo, monogram, colors, favicon, live preview) |
| v7.1 | Bet receipts, report issue, Hindi/English, PWA, suspicious accounts, ntfy push, i18n |
| v7.0 | One-way admin chat, ledger backfill, multi-bet control, multi-UPI, private support, links directory, wallet ledger, Razorpay dual keys, self-exclusion, 2FA |

---

## Repo structure

```
jio-club-v7/
├── .github/workflows/deploy.yml   # GitHub Actions -> Pages auto deploy (on push)
├── index.html, vite.config.js     # build (base './' -> subpath safe)
├── package.json, package-lock.json
├── SECURITY_AUDIT_REPORT.md
├── public/                        # PWA manifest, icons
├── supabase/
│   ├── schema.sql                 # full baseline schema + RLS + engine + hardening
│   ├── patch1..7.sql              # incremental patches (live DB par applied)
│   ├── patch_atomic_razorpay.sql  # atomic razorpay_credit RPC
│   ├── patch_admin_action_uuid_fix.sql  # uuid=text fix (applied)
│   ├── security_hardening.sql     # EXECUTE revokes + current_user guards
│   └── functions/razorpay-pay/    # edge function (v4 live: atomic credit)
└── src/
    ├── config.js                  # Supabase URL + publishable key (dono public hain)
    ├── lib/                       # supabase client, sound engine, i18n, icons, theme
    ├── components/                # UI kit (Toggle, Modal, Table, Toast, RankBadge, Brand)
    ├── styles/                    # design system: light/dark themes, animations
    ├── user/                      # UserApp, Auth, Game, Wallet, MyBets, Chat, Support, Profile
    └── admin/                     # AdminApp + 25 sections
```

---

## Fresh setup (agar naye project me banani ho)

1. Supabase project banao -> **SQL Editor** me `supabase/schema.sql` run karo
   (idempotent hai), phir `patch1..7.sql`, `patch_atomic_razorpay.sql`,
   `patch_admin_action_uuid_fix.sql` order me run karo
2. `src/config.js` me apna Supabase URL + publishable key daalo
3. GitHub repo push karo (Actions auto-deploy karta hai) -> Pages enable
4. Site pe sign up karo, phir ek line:
   `update public.profiles set role='admin' where email='AAPKA_EMAIL';`
5. Cron job `game-tick` auto-ban jata hai; pehla result 1 minute me aayega

## Free -> Paid upgrade path

| Abhi (FREE) | Jab upgrade karein | Cost |
|---|---|---|
| GitHub Pages | kabhi nahi — hamesha free | Rs 0 |
| Supabase free (500MB DB, 50k MAU) | Pro: 50k+ users ya 500MB se upar | $25/mahine |
| - | Custom domain (.in/.com) — GitHub Settings -> Pages | ~Rs 900/saal |

## Troubleshooting

| Problem | Fix |
|---|---|
| "operator does not exist: uuid = text" | `patch_admin_action_uuid_fix.sql` apply karo (live pe already done) |
| Result nahi aa raha | Supabase cron me `game-tick` active hai? |
| Toggles "work nahi kar rahe" purane jaisa lagta hai | Hard refresh (Ctrl+Shift+R / cache clear) — naya bundle load karo |
| Login nahi ho raha | Auth -> Email provider ON, "Confirm email" OFF |
| 404 on Pages | GitHub repo Settings -> Pages -> Source: GitHub Actions |
| Sound nahi | Profile -> Sound ON + Volume slider; admin ke global sounds bhi ON hon chahiye |

**Legal note:** Real-money betting India me state-by-state hai — public launch se pehle
apne state ka rule check karo. Razorpay gambling category production me allow nahi karta
(isliye UPI manual primary flow hai). Yeh app aapki zimmedari par chalti hai.
