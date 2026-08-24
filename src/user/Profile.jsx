import React, { useEffect, useState } from 'react';
import { supabase, rpc } from '../lib/supabase.js';
import { toast, Field, StatCard, RankBadge } from '../components/ui.jsx';
import { Ic, RANK_ICONS } from '../lib/icons.jsx';
import { sfx } from '../lib/sound.js';
import { money, fmtDT, copyText } from '../lib/utils.js';
import { getTheme, setTheme } from '../lib/theme.js';

export default function Profile({ game, profile, user, onProfile, features }) {
  const [refd, setRefd] = useState(null);
  const [phone, setPhone] = useState(profile.phone || '');
  const [upi, setUpi] = useState(profile.upi_id || '');
  const [pw, setPw] = useState('');
  const [busy, setBusy] = useState(false);
  const [theme, setThemeState] = useState(getTheme());

  const appName = game?.appearance?.appName || 'JIO CLUB';
  const refLink = `${window.location.origin}${window.location.pathname}?ref=${profile.referral_code}`;
  const referralOn = (game?.referral?.enabled !== false) && features?.referral !== false;

  useEffect(() => {
    rpc('referral_dashboard').then(setRefd).catch(() => {});
  }, [profile.referral_count]);

  useEffect(() => {
    const on = (e) => setThemeState(e.detail);
    window.addEventListener('jc:theme', on);
    return () => window.removeEventListener('jc:theme', on);
  }, []);

  async function saveContact() {
    setBusy(true);
    try {
      await rpc('update_my_profile', { p_phone: phone, p_upi_id: upi });
      sfx.cash(); toast('Profile updated', 'success');
      const { data: p } = await supabase.from('profiles').select('*').eq('id', user.id).single();
      onProfile(p);
    } catch (e) { toast(e.message, 'error'); }
    finally { setBusy(false); }
  }

  async function changePassword() {
    if (pw.length < 6) { toast('New password: min 6 characters', 'error'); return; }
    setBusy(true);
    const { error } = await supabase.auth.updateUser({ password: pw });
    setBusy(false);
    if (error) { sfx.error(); toast(error.message, 'error'); return; }
    setPw('');
    sfx.cash(); toast('Password changed', 'success');
  }

  async function logout() {
    sfx.click();
    await supabase.auth.signOut();
    toast('Logged out. See you soon!', 'info');
  }

  async function shareRef() {
    if (navigator.share) {
      try { await navigator.share({ title: appName, text: `Join me on ${appName}! Use my referral code ${profile.referral_code}`, url: refLink }); return; } catch (e) { /* cancelled */ }
    }
    const ok = await copyText(refLink);
    toast(ok ? 'Referral link copied' : 'Copy failed', ok ? 'success' : 'error');
  }

  const thresholds = refd?.thresholds || [];
  const myRankIdx = thresholds.findIndex((t) => t.rank === profile.rank);
  const nextRank = thresholds[myRankIdx + 1] || null;
  const progress = nextRank
    ? Math.min(100, Math.round(((refd?.count || 0) - (thresholds[myRankIdx]?.min || 0)) / Math.max(1, nextRank.min - (thresholds[myRankIdx]?.min || 0)) * 100))
    : 100;

  return (
    <div>
      {/* User card */}
      <div className="card" style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
        <div className="chat-avatar" style={{ width: 56, height: 56, fontSize: '1.4rem' }}>
          {(profile.email || '?')[0].toUpperCase()}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 900, fontSize: '1.05rem', overflow: 'hidden', textOverflow: 'ellipsis' }}>{profile.email}</div>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginTop: 6, flexWrap: 'wrap' }}>
            <span className={`badge ${profile.status === 'active' ? 'badge-active' : 'badge-blocked'}`}>
              <Ic n={profile.status === 'active' ? 'checkCircle' : 'ban'} s={12} />{profile.status}
            </span>
            {refd && <RankBadge rank={profile.rank} small />}
          </div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontSize: '0.64rem', color: 'var(--text-dim)', fontWeight: 800, letterSpacing: 1 }}>CUSTOMER ID</div>
          <div style={{ fontFamily: 'monospace', fontWeight: 800, fontSize: '0.8rem', marginTop: 2 }}>{(user.id || '').slice(0, 8).toUpperCase()}</div>
        </div>
      </div>

      {/* Referral card */}
      {referralOn && (
        <div className="card" style={{ marginTop: 12, background: 'linear-gradient(135deg, rgba(124,108,255,0.15), rgba(0,200,150,0.09))' }}>
          <div className="card-title"><Ic n="share" s={18} />My Referral</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: '0.7rem', color: 'var(--text-dim)', fontWeight: 800, letterSpacing: 1 }}>YOUR CODE</div>
              <div style={{ fontSize: '1.5rem', fontWeight: 900, letterSpacing: 3, fontFamily: 'monospace' }}>{profile.referral_code}</div>
            </div>
            <button className="btn btn-ghost" onClick={async () => { const ok = await copyText(profile.referral_code); toast(ok ? 'Code copied' : 'Failed', ok ? 'success' : 'error'); }}>
              <Ic n="copy" s={15} />Copy Code
            </button>
          </div>
          <button className="btn btn-primary btn-block" onClick={shareRef}><Ic n="link" s={16} />Share Referral Link</button>

          {refd && (
            <div style={{ marginTop: 16 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8rem', fontWeight: 800, marginBottom: 6 }}>
                <span style={{ display: 'flex', gap: 6, alignItems: 'center' }}><Ic n="users" s={14} />Team: <b>{refd.count}</b> players</span>
                {nextRank && <span style={{ display: 'flex', gap: 5, alignItems: 'center' }}><Ic n="trophy" s={13} />Next: {nextRank.rank} at {nextRank.min}</span>}
              </div>
              <div style={{ height: 10, background: 'var(--card-2)', borderRadius: 99, overflow: 'hidden' }}>
                <div style={{ height: '100%', width: progress + '%', background: 'linear-gradient(90deg, var(--accent), var(--accent-2))', borderRadius: 99, transition: 'width 0.6s' }}></div>
              </div>
              <p style={{ fontSize: '0.73rem', color: 'var(--text-dim)', marginTop: 8 }}>
                Ranks grow with your team size — no cash rewards, pure prestige.
              </p>
              {refd.leaderboard?.length > 0 && (
                <div style={{ marginTop: 12, borderTop: '1px solid var(--border-solid)', paddingTop: 12 }}>
                  <div style={{ fontSize: '0.7rem', fontWeight: 800, color: 'var(--text-dim)', marginBottom: 8, letterSpacing: 1, display: 'flex', gap: 6, alignItems: 'center' }}>
                    <Ic n="trophy" s={13} />TOP REFERRERS
                  </div>
                  {refd.leaderboard.slice(0, 3).map((t, i) => (
                    <div key={t.referral_code + i} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.84rem', padding: '4px 0', alignItems: 'center' }}>
                      <span style={{ display: 'flex', gap: 7, alignItems: 'center' }}>
                        <Ic n={i === 0 ? 'crown' : 'medal'} s={15} style={{ color: i === 0 ? 'var(--warning)' : 'var(--text-dim)' }} />
                        <b style={{ fontFamily: 'monospace' }}>{t.referral_code}</b>
                        <RankBadge rank={t.rank} small />
                      </span>
                      <b>{t.referral_count}</b>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Stats */}
      <div className="stat-grid" style={{ marginTop: 12 }}>
        <StatCard label="Total Deposits" value={money(profile.total_deposits)} tone="sc-green" icon="arrowDown" />
        <StatCard label="Total Withdrawn" value={money(profile.total_withdrawn)} tone="sc-blue" icon="arrowUp" />
        <StatCard label="Total Bets" value={money(profile.total_bet)} tone="sc-gold" icon="target" />
        <StatCard label="Total Won" value={money(profile.total_won)} tone="sc-green" icon="trophy" />
      </div>
      <div className="card-sub" style={{ marginTop: 8, display: 'flex', gap: 6, alignItems: 'center' }}>
        <Ic n="calendar" s={12} />Member since {fmtDT(profile.created_at)}
      </div>

      {/* Contact */}
      <div className="card" style={{ marginTop: 12 }}>
        <div className="card-title"><Ic n="phone" s={17} />Contact Details</div>
        <Field label="Phone">
          <input className="input" placeholder="+91…" value={phone} onChange={(e) => setPhone(e.target.value)} />
        </Field>
        <Field label="UPI ID (for withdrawals)">
          <input className="input" placeholder="yourname@upi" value={upi} onChange={(e) => setUpi(e.target.value)} />
        </Field>
        <button className="btn btn-primary btn-block" onClick={saveContact} disabled={busy}><Ic n="check" s={16} />Save Details</button>
      </div>

      {/* Settings */}
      <div className="card" style={{ marginTop: 12 }}>
        <div className="card-title"><Ic n="sliders" s={17} />Preferences</div>
        <div className="setting-row">
          <div><div className="s-label">Theme</div><div className="s-desc">Light or dark interface</div></div>
          <button className="btn btn-ghost btn-sm" onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}>
            <Ic n={theme === 'dark' ? 'sun' : 'moon'} s={15} />{theme === 'dark' ? 'Dark → Light' : 'Light → Dark'}
          </button>
        </div>
        <div className="setting-row">
          <div><div className="s-label">Sound FX</div><div className="s-desc">Clicks, wins, notifications</div></div>
          <button className="btn btn-ghost btn-sm" onClick={() => { const v = !sfx.isEnabled(); sfx.setEnabled(v); try { localStorage.setItem('jc-sound', v ? '1' : '0'); } catch (e) {} toast(v ? 'Sound ON' : 'Sound OFF', 'info'); }}>
            <Ic n={sfx.isEnabled() ? 'volume' : 'volumeOff'} s={15} />{sfx.isEnabled() ? 'On' : 'Off'}
          </button>
        </div>
        <div className="setting-row">
          <div><div className="s-label">Change Password</div><div className="s-desc">Min 6 characters</div></div>
        </div>
        <Field label="">
          <input className="input" type="password" placeholder="New password" value={pw} onChange={(e) => setPw(e.target.value)} />
        </Field>
        <button className="btn btn-ghost btn-block" onClick={changePassword} disabled={busy || !pw}><Ic n="key" s={15} />Update Password</button>
      </div>

      {/* About */}
      <div className="card" style={{ marginTop: 12 }}>
        <div className="card-title"><Ic n="info" s={16} />About {appName}</div>
        {game?.about?.rules && <p style={{ fontSize: '0.85rem', color: 'var(--text-dim)', lineHeight: 1.6, marginBottom: 10, whiteSpace: 'pre-wrap' }}>{game.about.rules}</p>}
        {game?.telegram?.link && (
          <a className="btn btn-ghost btn-block" style={{ marginBottom: 10 }} href={game.telegram.link} target="_blank" rel="noreferrer">
            <Ic n="send" s={15} />Join Telegram Support
          </a>
        )}
        <p className="card-sub" style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <Ic n="shield" s={12} />v7.0 · 18+ only · Play responsibly
        </p>
      </div>

      <button className="btn btn-danger btn-block" style={{ marginTop: 14 }} onClick={logout}><Ic n="logout" s={16} />Logout</button>
    </div>
  );
}
