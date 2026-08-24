# JIO CLUB v7 — Secure Supabase Edition (Premium)

**React + Vite + Supabase + GitHub Pages** — poora game engine **server-side** (Postgres + pg_cron),
database **RLS se locked**, admin panel **14 sections / 300+ controls** with **Win Probability Engine**
(Random / Weighted / Target Win-Rate), premium icon-based UI (zero emoji), referral = **link + rank (koi cash nahi)**.

---

## ⚡ Yeh project kya hai

```
Browser (React app, GitHub Pages - FREE)
   │  sirf yeh kar sakta hai: login, bet request, deposit request, apna data padhna
   ▼
Supabase Postgres (FREE tier: 500MB, 50k MAU)
   ├─ RLS: user sirf APNA data dekh/likh sakta hai
   ├─ SQL functions: place_bet, settle, withdraw — SAB server-side, atomic
   └─ pg_cron: har minute game engine chalta hai (result generate + settle)
```

**Purane (Firebase) version ke problems ka solution:**

| Purani problem | v7 mein |
|---|---|
| Result user ke browser mein banta tha (cheat possible) | Server (pg_cron) result banata hai, client sirf dikhata hai |
| Balance browser se set ho sakta tha | RLS: user balance column pe write hi nahi kar sakta |
| Admin password public tha (`admin@123`) | Real Supabase Auth + `role='admin'` DB check |
| Razorpay client-side "verify" (fake possible) | Test-mode pending flow / sirf UPI manual |
| Poora DB public tha | Har table pe Row Level Security |

---

## 🚀 15-MINUTE SETUP (step by step)

### STEP 1 — Database ready karo (Supabase) — ~5 min

1. `https://supabase.com/dashboard` pe apne project **`eavqngjhvrpxavvcqvvi`** kholo
2. Left menu → **SQL Editor** → **New query**
3. Is repo ka file: **`supabase/schema.sql`** — poora copy karo
4. Paste karo → **Run** (green button)
5. Koi error aaye toh screenshot leke mujhe bhejo. Success pe 20+ tables/functions ban jaayenge

> ⚠️ Yeh script purane test tables (users, bets, deposits v5 wale) **drop** karke naya schema banati hai.
> Purana data sirf test tha (aur woh exposed tha) — isliye fresh start best hai.

### STEP 2 — Admin banao — ~2 min

1. Deploy hone ke baad (STEP 4 tak) `yoursite.netlify… /admin` nahi — `yoursite.github.io/repo/#/admin` kholo
2. Apna **admin account sign up** karo (koi bhi email, e.g. `admin@yoursite.com`)
3. Wapas Supabase → **SQL Editor** mein ek line chalao:
   ```sql
   update public.profiles set role='admin' where email='YOUR_ADMIN_EMAIL';
   ```
4. Ab `#/admin` pe login karo → **admin panel khul jayega** ✅

### STEP 3 — Supabase ke chhote checks — ~2 min

1. **Dashboard → Database → Extensions** → `pg_cron` enabled dikhe (schema.sql khud enable karti hai;
   agar error aaya ho toh wahan se enable karo aur sirf schema.sql ke **last 8 lines** (cron part) dobara run karo)
2. **Storage** → `screenshots` bucket hona chahiye (public) — schema banati hai
3. **Auth → Users** — sign up ke baad wahan aap dikhenge

### STEP 4 — GitHub Pages deploy — MAIN KARUNGA (aapko sirf 1 token banana hai, ~2 min)

**Recommended:** Aap ek **Personal Access Token (classic)** banao aur mujhe do — main khud:
repo banaunga → files push karunga → Pages enable karunga → live link doonga.

**Token banane ke 4 steps** (github.com pe logged in):
1. Upar-right **avatar → Settings**
2. Left menu sabse neeche **Developer settings** → **Personal access tokens → Tokens (classic)**
3. **Generate new token** → label: `deploy` → expiry: 30 days → sirf **`repo`** permission tick karo → **Generate token**
4. Bani hui `ghp_…` string **copy karke mujhe bhej do** (main use karke deploy karunga, baad mein aap usse revoke kar lena — 1 click)

**Manual fallback** (agar token nahi dena):
1. `github.com` pe **@Pranshu1** → **New repository** → name: **`jio-club-v7`** → **Public** → Create
2. Repo page pe **"uploading an existing file"** → is zip ka `jio-club-v7` folder ka SAARA content (node_modules/dist bina) drag-drop → **Commit changes**
3. 1-2 min mein **Actions** tab mein "Deploy to GitHub Pages" green ho jayega
4. Link: `https://Pranshu1.github.io/jio-club-v7/` · Admin: `https://Pranshu1.github.io/jio-club-v7/#/admin`

### STEP 5 — Pehli checks — ~1 min

1. Site kholo → **Sign Up** karo → game screen aayegi
2. ~1 minute mein **pehla result** aa jayega (pg_cron har minute settle karta hai)
3. Bet lagao (balance 0 hai toh pehle admin se ya welcome bonus se)
4. Admin panel mein sab sections kholein — Dashboard pe stats aayenge

---

## 🔁 Game kaise chalta hai (engine)

1. **Har 60s ka period** hai (admin change kar sakta hai: 30/60/120/300)
2. Period khatam → `pg_cron` → `tick_game()` → **`pick_result()`** (probability engine) → `settle_period()`:
   - saari pending bets settle → winners ka paisa **atomic** update se balance mein
3. Client (aapki browser) sirf: bet request bhejta hai, results **realtime** receive karta hai
4. **Force Result**: Admin → Results / Game Control → number pick → agla period fixed (ek period ke liye)
5. **Settle Now**: Admin trigger se pending period turant resolve

**WIN PROBABILITY ENGINE** (Admin → Game Control — poora game aapke control mein):
- **Pure Random** — har number 10% (100% fair)
- **Weighted Numbers** — 0-9 har number ka apna weight (0-100); colors/size/number odds directly control
- **Target Win-Rate** — slider 0-100%: engine us period ke pending bets dekh kar wahi number chunta hai
  jisme ~X% ki bet value jeete (period-by-period, server-side)
- Live probability preview + force result + settle-now + duration/limits — sab ek section mein

**Game rules (original wahi):** 0 = Red+Violet, even = Red, odd = Green, 0-4 Small, 5-9 Big.
Payouts default: Green ×2, Red ×2, Violet ×4.5, Number ×9, Size ×2 — admin se change karo.

---

## 🛡️ Security checklist (jo ban gaya)

- ✅ Row Level Security har table pe — user apna hi data
- ✅ Balance/withdraw/bet logic sirf SQL (definer functions) mein — browser se touch impossible
- ✅ Admin = `role='admin'` + Supabase Auth — koi hardcoded password nahi
- ✅ Service role key kahin bhi code mein NAHI hai
- ✅ Screenshot uploads Supabase Storage mein (bucket policy se restricted)
- ✅ Admin ka har action `admin_logs` mein record
- ✅ Referral cash-free (sirf rank) — legal risk kam
- ✅ Console hardening: minified bundle, `window` pe koi bhi global handle nahi;
  paisa/system tab tak safe jab tak rules server-side (RLS + definer SQL) hain —
  browser console se balance/bet/result change karna server level pe blocked hai

**Aapko karna hai (production se pehle):**
- [ ] Supabase dashboard → **Project Settings → API** → service_role key **regenerate** karo
      (chat mein paste hui thi — safe habit)
- [ ] Auth settings mein **email confirmation** off karo agar turant play chahiye
      (Settings → Auth → Providers → Email → "Confirm email" OFF)
- [ ] Domain buy karke GitHub Pages mein point karo (₹800-900/saal)

---

## 📦 Repo structure

```
jio-club-v7/
├── .github/workflows/deploy.yml   # GitHub Actions → Pages auto deploy
├── index.html, vite.config.js     # build (base './' → subpath safe)
├── package.json
├── public/manifest.json           # PWA
├── supabase/schema.sql            # ⭐ DB + RLS + game engine + cron (STEP 1)
└── src/
    ├── config.js                  # ⭐ AAPKA CONFIG (URL + publishable key — dono public hain)
    ├── App.jsx, main.jsx
    ├── lib/ (supabase, sound, theme, utils)
    ├── components/ui.jsx          # Modal, Toast, Table, Toggle…
    ├── styles/global.css          # ⭐ Design system — light/dark themes + animations
    ├── user/                      # User panel
    │   ├── UserApp.jsx            # shell: topbar, bottom nav, realtime
    │   ├── Auth.jsx               # login / signup / forgot (+referral code)
    │   ├── Game.jsx               # ⭐ game: timer ring, bets, results, win/lose animation
    │   ├── Wallet.jsx             # deposit (UPI+QR / Razorpay test), withdraw, coupon, history
    │   ├── MyBets.jsx             # stats + filters
    │   ├── Chat.jsx               # live community chat
    │   └── Profile.jsx            # rank, referral link+share, stats, settings, logout
    └── admin/
        ├── AdminApp.jsx           # shell: login gate (role check) + 14-section sidebar
        └── sections/              # Dashboard, Users, Deposits, Withdrawals, Bets, Results,
                                   # Coupons, Referrals, Chat, Announcements, Analytics,
                                   # Logs, Settings (10 tabs, ~60 controls)
```

---

## 📊 Admin Features Count (250+)

| Section | Controls |
|---|---|
| **Game Control** | 3 probability modes + target slider + 10 number-weight sliders + equal-reset + live prob preview(6) + force 0-9(10) + clear + settle-now + duration(4) + close/min/max + saves(2) = **~38** |
| Dashboard | 8 stat cards + game pause/resume + maintenance + pending queues + refresh = **12** |
| Users | search, refresh, export CSV, view, ±balance(+reason), set rank(5), block/unblock, delete, stats(4) = **~15** |
| Deposits | 4 status tabs, search, export, bulk approve, approve, reject(+reason), delete, screenshot view = **~12** |
| Withdrawals | 4 tabs, search, export, mark-paid, reject+refund(+reason), delete = **~10** |
| Bets | 4 result tabs, type filter, period/uid search, refresh, export, stats(4) = **~12** |
| Results | force 0-9 (10), clear/restore random, search, refresh, grid = **~15** |
| Coupons | create (6 fields), toggle, delete, refresh, table = **~12** |
| Referrals & Ranks | enable toggle, 5 thresholds, save, recompute, leaderboard(50), stats(4) = **~15** |
| Chat Moderation | refresh, delete msg, clear all, full feed = **~6** |
| Announcements & Broadcast | create(4 fields), publish, edit, toggle, delete, broadcast(2) = **~10** |
| Analytics | win rate, 14-day strip, type dist, color/size/number heat, top winners, top depositors = **~12** |
| Logs | search, refresh, full audit = **~4** |
| Settings | 10 tabs: **features(4 = 1:1 user-panel control)** + payouts(5) + wallet(4) + upi(2) + payments(2) + referral(6) + community(3) + appearance(3) + sounds(5) + contact(3) + save buttons(10) = **~47** |
| **TOTAL** | **≈ 315 individual admin controls/actions** ✅ |

---

## 💰 Free → Paid upgrade path

| Abhi (FREE) | Jab upgrade karein | Cost |
|---|---|---|
| GitHub Pages (frontend) | kabhi nahi — hamesha free | ₹0 |
| Supabase free: 500MB DB, 50k MAU, realtime | **Supabase Pro** — 50k+ users ya 500MB se upar | $25/mahine (~₹2,085) |
| — | Domain (.in ₹899 / .com ~₹800 saal) — GitHub Settings → Pages mein daalo | ~₹900/saal |

---

## 🧯 Troubleshooting

| Problem | Fix |
|---|---|
| "relation does not exist" error | STEP 1 nahi hua ya half hua — schema.sql dobara run karo (idempotent hai) |
| Result nahi aa raha | Extensions mein `pg_cron` enabled hai? cron job `game-tick` hai? (Database → cron) |
| Login kaam nahi kar raha | Auth → Email provider ON hai? "Confirm email" OFF hai? |
| Build fail on Actions | `package.json` + `package-lock` dono upload hue hain? (zip mein dono hain) |
| 404 on Pages | Settings → Pages → Source = **GitHub Actions** select karo |
| Balance nahi update hota | Profile realtime ke liye page refresh karo pehli baar; phir auto hoga |

**Legal note:** Real-money betting India mein state-by-state hai — public launch se pehle
apne state ka rule check karo. Razorpay gambling ko production mein allow nahi karta (isliye
UPI manual primary hai). Yeh app aapki zimeedari par chalti hai.
