import React, { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase.js';
import { toast, Field, Toggle, Tabs } from '../../components/ui.jsx';
import { Ic } from '../../lib/icons.jsx';
import { sfx } from '../../lib/sound.js';

const TABS = [
  { id: 'features', label: 'Features', icon: 'toggle' },
  { id: 'payouts', label: 'Payouts', icon: 'percent' },
  { id: 'wallet', label: 'Wallet', icon: 'wallet' },
  { id: 'upi', label: 'UPI', icon: 'upi' },
  { id: 'payments', label: 'Payments', icon: 'card' },
  { id: 'referral', label: 'Referral', icon: 'share' },
  { id: 'community', label: 'Community', icon: 'chat' },
  { id: 'appearance', label: 'Appearance', icon: 'sparkles' },
  { id: 'sounds', label: 'Sounds', icon: 'volume' },
  { id: 'contact', label: 'Contact', icon: 'headset' }
];

const DEF = {
  features: { deposit: true, withdraw: true, coupons: true, referral: true },
  payouts: { green: 2, red: 2, violet: 4.5, number: 9, size: 2 },
  wallet: { minDeposit: 10, minWithdrawal: 200, maxWithdrawal: 100000, welcomeBonus: 0, dailyBetLimit: 50000 },
  upi: { upiId: '', qrText: '', apps: ['GPay', 'PhonePe', 'Paytm', 'Bhimbhi'] },
  payments: { mode: 'upi', razorpayKeyId: '' },
  referral: { enabled: true, thresholds: [
    { rank: 'bronze', min: 0 }, { rank: 'silver', min: 3 }, { rank: 'gold', min: 10 },
    { rank: 'platinum', min: 25 }, { rank: 'diamond', min: 50 }] },
  chat: { enabled: true, maxMessage: 500 },
  notifications: { enabled: true },
  appearance: { appName: 'JIO CLUB', tagline: 'Color Prediction', theme: 'dark', accent: '#7c6cff' },
  sounds: { enabled: true, volume: 0.5, tick: true, win: true, lose: true },
  telegram: { link: '' },
  about: { rules: '', support: '' }
};

export default function Settings() {
  const [data, setData] = useState(null);
  const [tab, setTab] = useState('features');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    (async () => {
      const { data: rows } = await supabase.from('settings').select('key, value');
      const d = {};
      rows?.forEach((r) => { d[r.key] = { ...DEF[r.key], ...(r.value || {}) }; });
      Object.keys(DEF).forEach((k) => { if (!d[k]) d[k] = DEF[k]; });
      setData(d);
    })();
  }, []);

  function set(key, patch) {
    setData((d) => ({ ...d, [key]: { ...d[key], ...patch } }));
  }

  async function save(key, msg) {
    setBusy(true);
    // strip undefined keys (data hygiene)
    const clean = Object.fromEntries(Object.entries(data[key] || {}).filter(([k, v]) => k !== 'undefined' && v !== undefined));
    const { error } = await supabase.from('settings').upsert({ key, value: clean }, { onConflict: 'key' });
    setBusy(false);
    if (error) { sfx.error(); toast(error.message, 'error'); return; }
    sfx.cash(); toast(msg || `Saved ${key}`, 'success');
  }

  if (!data) return <div className="spinner"></div>;

  const N = ({ k, key, label, step = 1, min = 0 }) => (
    <div className="setting-row">
      <div><div className="s-label">{label}</div></div>
      <div className="s-ctrl">
        <input className="input" type="number" step={step} min={min} value={data[k][key] ?? ''}
          onChange={(e) => set(k, { [key]: e.target.value === '' ? null : Number(e.target.value) })} />
      </div>
    </div>
  );
  const T = ({ k, key, label, desc }) => (
    <div className="setting-row">
      <div><div className="s-label">{label}</div>{desc && <div className="s-desc">{desc}</div>}</div>
      <div className="s-ctrl"><Toggle checked={!!data[k][key]} onChange={(v) => set(k, { [key]: v })} /></div>
    </div>
  );

  const Save = ({ k, msg }) => (
    <button className="btn btn-primary" style={{ marginTop: 14 }} disabled={busy} onClick={() => save(k, msg)}>
      <Ic n="check" s={16} />Save {TABS.find((t) => t.id === k)?.label}
    </button>
  );

  return (
    <div>
      <div className="card" style={{ marginBottom: 14 }}>
        <div className="card-title"><Ic n="sliders" s={18} />Admin Settings — 1:1 control of every user-panel feature</div>
        <p className="card-sub">
          Har change <b>instantly live</b> hota hai sab users ke liye (realtime sync). Yahan jo bhi on/off karo — user panel mein turant reflect.
        </p>
      </div>

      <Tabs active={tab} onChange={(t) => { setTab(t); sfx.click(); }} tabs={TABS} />

      {/* FEATURES — 1:1 user panel control */}
      {tab === 'features' && (
        <div className="card page-enter">
          <T k="features" key="deposit" label="Wallet → Deposit" desc="UPI deposit, QR, screenshots, coupon box (deposit tab)" />
          <T k="features" key="withdraw" label="Wallet → Withdraw" desc="Withdrawal requests from users" />
          <T k="features" key="coupons" label="Coupons" desc="Users claim coupon codes" />
          <T k="features" key="referral" label="Referral System" desc="Referral links + rank dashboard in profile" />
          <p className="card-sub" style={{ marginTop: 10, display: 'flex', gap: 6, alignItems: 'flex-start' }}>
            <Ic n="info" s={14} style={{ marginTop: 2, flexShrink: 0 }} />
            Chat, Announcements, Sounds, Ranks aur poora game engine — inke controls apni-apni tab mein hain (Community, Sounds, Referral, Game Control).
          </p>
          <Save k="features" msg="Features saved — user panel updated" />
        </div>
      )}

      {/* PAYOUTS */}
      {tab === 'payouts' && (
        <div className="card page-enter">
          <N k="payouts" key="green" label="Green Payout (×)" step="0.5" />
          <N k="payouts" key="red" label="Red Payout (×)" step="0.5" />
          <N k="payouts" key="violet" label="Violet Payout (×)" step="0.5" />
          <N k="payouts" key="number" label="Number Payout (×)" step="0.5" />
          <N k="payouts" key="size" label="Big/Small Payout (×)" step="0.5" />
          <p className="card-sub" style={{ marginTop: 10 }}>House edge payouts ke saath adjust hoti hai. Win probability ke liye Game Control section use karo.</p>
          <Save k="payouts" />
        </div>
      )}

      {/* WALLET */}
      {tab === 'wallet' && (
        <div className="card page-enter">
          <N k="wallet" key="minDeposit" label="Minimum Deposit (₹)" />
          <N k="wallet" key="minWithdrawal" label="Minimum Withdrawal (₹)" />
          <N k="wallet" key="maxWithdrawal" label="Maximum Withdrawal (₹)" />
          <N k="wallet" key="welcomeBonus" label="Welcome Bonus (₹, once per user)" />
          <div className="setting-row">
            <div><div className="s-label">Daily Bet Limit per user (₹)</div><div className="s-desc">0 = unlimited · server pe enforce hota hai</div></div>
            <div className="s-ctrl">
              <input className="input" type="number" min="0" value={data.wallet.dailyBetLimit ?? 0}
                onChange={(e) => set('wallet', { dailyBetLimit: Number(e.target.value) || 0 })} />
            </div>
          </div>
          <Save k="wallet" />
        </div>
      )}

      {/* UPI */}
      {tab === 'upi' && (
        <div className="card page-enter">
          <div className="setting-row" style={{ alignItems: 'flex-start' }}>
            <div style={{ flex: 1 }}>
              <div className="s-label">Your UPI ID (users pay here)</div>
              <input className="input" style={{ marginTop: 6 }} placeholder="yourname@upi" value={data.upi.upiId}
                onChange={(e) => set('upi', { upiId: e.target.value })} />
            </div>
          </div>
          <div className="setting-row" style={{ alignItems: 'flex-start' }}>
            <div style={{ flex: 1 }}>
              <div className="s-label">UPI Apps (comma separated — shown under QR)</div>
              <input className="input" style={{ marginTop: 6 }} value={(data.upi.apps || []).join(', ')}
                onChange={(e) => set('upi', { apps: e.target.value.split(',').map((s) => s.trim()).filter(Boolean) })} />
            </div>
          </div>
          <p className="card-sub" style={{ margin: '8px 0' }}>QR code auto-generated live from UPI ID + deposit amount (no image upload needed).</p>
          <Save k="upi" />
        </div>
      )}

      {/* PAYMENTS */}
      {tab === 'payments' && (
        <div className="card page-enter">
          <div className="setting-row" style={{ alignItems: 'flex-start' }}>
            <div style={{ flex: 1 }}>
              <div className="s-label">Payment Mode</div>
              <select className="input" style={{ marginTop: 6 }} value={data.payments.mode} onChange={(e) => set('payments', { mode: e.target.value })}>
                <option value="upi">UPI Manual (recommended)</option>
                <option value="razorpay">Razorpay Test Mode</option>
                <option value="both">Both (UPI default)</option>
              </select>
              <div className="s-desc" style={{ marginTop: 6 }}>
                Razorpay = TEST mode only (rzp_test_… keys). Payments land as pending for your approval.
                Production mein Razorpay betting category block karta hai — UPI manual rakho.
              </div>
            </div>
          </div>
          {data.payments.mode !== 'upi' && (
            <div className="setting-row" style={{ alignItems: 'flex-start' }}>
              <div style={{ flex: 1 }}>
                <div className="s-label">Razorpay Test Key ID (rzp_test_…)</div>
                <input className="input" style={{ marginTop: 6 }} placeholder="rzp_test_xxxxxxxx" value={data.payments.razorpayKeyId}
                  onChange={(e) => set('payments', { razorpayKeyId: e.target.value })} />
              </div>
            </div>
          )}
          <Save k="payments" />
        </div>
      )}

      {/* REFERRAL */}
      {tab === 'referral' && (
        <div className="card page-enter">
          <T k="referral" key="enabled" label="Referral System Enabled" desc="Links + rank dashboard for users" />
          <div className="setting-row"><div><div className="s-label">Rank Thresholds (referrals needed)</div></div></div>
          {(data.referral.thresholds || []).map((t, i) => (
            <div key={t.rank} className="setting-row">
              <div><div className="s-label">{t.rank.toUpperCase()}</div></div>
              <div className="s-ctrl">
                <input className="input" style={{ width: 100 }} type="number" min="0" value={t.min}
                  onChange={(e) => {
                    const next = data.referral.thresholds.map((x, j) => j === i ? { ...x, min: Number(e.target.value) || 0 } : x);
                    set('referral', { thresholds: next });
                  }} />
              </div>
            </div>
          ))}
          <p className="card-sub" style={{ margin: '8px 0' }}>After changing thresholds, run “Recompute All Ranks” from Referrals section.</p>
          <Save k="referral" />
        </div>
      )}

      {/* COMMUNITY */}
      {tab === 'community' && (
        <div className="card page-enter">
          <T k="chat" key="enabled" label="Community Chat" desc="Live public chat in user panel" />
          <N k="chat" key="maxMessage" label="Max Message Length (chars)" />
          <T k="notifications" key="enabled" label="Push Notifications" desc="Bell notifications + broadcasts" />
          <div style={{ display: 'flex', gap: 10, marginTop: 14 }}>
            <button className="btn btn-primary" disabled={busy} onClick={() => save('chat')}>
              <Ic n="check" s={15} />Save Chat
            </button>
            <button className="btn btn-ghost" disabled={busy} onClick={() => save('notifications')}>
              <Ic n="check" s={15} />Save Notifications
            </button>
          </div>
        </div>
      )}

      {/* APPEARANCE */}
      {tab === 'appearance' && (
        <div className="card page-enter">
          <div className="setting-row" style={{ alignItems: 'flex-start' }}>
            <div style={{ flex: 1 }}>
              <div className="s-label">App Name</div>
              <input className="input" style={{ marginTop: 6 }} value={data.appearance.appName} onChange={(e) => set('appearance', { appName: e.target.value })} />
            </div>
          </div>
          <div className="setting-row" style={{ alignItems: 'flex-start' }}>
            <div style={{ flex: 1 }}>
              <div className="s-label">Tagline</div>
              <input className="input" style={{ marginTop: 6 }} value={data.appearance.tagline} onChange={(e) => set('appearance', { tagline: e.target.value })} />
            </div>
          </div>
          <div className="setting-row">
            <div><div className="s-label">Accent Color</div></div>
            <div className="s-ctrl">
              <input type="color" value={data.appearance.accent} style={{ width: 46, height: 34, border: 'none', background: 'none' }}
                onChange={(e) => set('appearance', { accent: e.target.value })} />
              <span style={{ fontFamily: 'monospace', fontSize: '0.8rem' }}>{data.appearance.accent}</span>
            </div>
          </div>
          <Save k="appearance" />
        </div>
      )}

      {/* SOUNDS */}
      {tab === 'sounds' && (
        <div className="card page-enter">
          <T k="sounds" key="enabled" label="Sound Effects (global default)" />
          <div className="setting-row">
            <div><div className="s-label">Volume</div></div>
            <div className="s-ctrl">
              <input type="range" min="0" max="1" step="0.05" style={{ width: 160 }} value={data.sounds.volume}
                onChange={(e) => set('sounds', { volume: Number(e.target.value) })} />
              <span style={{ fontSize: '0.8rem', width: 34 }}>{Math.round((data.sounds.volume || 0) * 100)}%</span>
            </div>
          </div>
          <T k="sounds" key="tick" label="Timer Tick (last 5 seconds)" />
          <T k="sounds" key="win" label="Win Jingle" />
          <T k="sounds" key="lose" label="Lose Sound" />
          <Save k="sounds" />
        </div>
      )}

      {/* CONTACT */}
      {tab === 'contact' && (
        <div className="card page-enter">
          <div className="setting-row" style={{ alignItems: 'flex-start' }}>
            <div style={{ flex: 1 }}>
              <div className="s-label">Telegram Support Link</div>
              <input className="input" style={{ marginTop: 6 }} placeholder="https://t.me/yourchannel" value={data.telegram.link}
                onChange={(e) => set('telegram', { link: e.target.value })} />
            </div>
          </div>
          <div className="setting-row" style={{ alignItems: 'flex-start' }}>
            <div style={{ flex: 1 }}>
              <div className="s-label">Game Rules (shown in Profile → About)</div>
              <textarea className="input" style={{ marginTop: 6, minHeight: 110 }} value={data.about.rules}
                onChange={(e) => set('about', { rules: e.target.value })} />
            </div>
          </div>
          <div className="setting-row" style={{ alignItems: 'flex-start' }}>
            <div style={{ flex: 1 }}>
              <div className="s-label">Support Text</div>
              <textarea className="input" style={{ marginTop: 6, minHeight: 80 }} value={data.about.support}
                onChange={(e) => set('about', { support: e.target.value })} />
            </div>
          </div>
          <button className="btn btn-primary" style={{ marginTop: 12 }} disabled={busy} onClick={async () => {
            setBusy(true);
            await Promise.all([
              supabase.from('settings').upsert({ key: 'telegram', value: data.telegram }, { onConflict: 'key' }),
              supabase.from('settings').upsert({ key: 'about', value: data.about }, { onConflict: 'key' })
            ]);
            setBusy(false); sfx.cash(); toast('Contact & About saved', 'success');
          }}>
            <Ic n="check" s={16} />Save Contact & About
          </button>
        </div>
      )}
    </div>
  );
}
