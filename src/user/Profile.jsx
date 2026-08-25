import React, { useEffect, useState } from 'react';
import { supabase, rpc } from '../lib/supabase.js';
import { toast, Field, StatCard, RankBadge, Toggle } from '../components/ui.jsx';
import { Ic, RANK_ICONS } from '../lib/icons.jsx';
import { sfx } from '../lib/sound.js';
import { money, fmtDT, copyText } from '../lib/utils.js';
import { t, useT } from '../lib/i18n.js';
import { getTheme, setTheme } from '../lib/theme.js';

const PLATFORM_ICO = {
  telegram: 'send', whatsapp: 'chat', discord: 'users', instagram: 'image',
  youtube: 'play', website: 'globe', custom: 'link'
};

export default function Profile({ game, profile, user, onProfile, features }) {
  const t = useT();
  const [refd, setRefd] = useState(null);
  const [phone, setPhone] = useState(profile.phone || '');
  const [upi, setUpi] = useState(profile.upi_id || '');
  const [pw, setPw] = useState('');
  const [busy, setBusy] = useState(false);
  const [theme, setThemeState] = useState(getTheme());
  const [links, setLinks] = useState([]);
  const [vol, setVol] = useState(() => sfx.getVolume());
  const [sndOn, setSndOn] = useState(() => sfx.isEnabled());

  const appName = game?.appearance?.appName || 'JIO CLUB';
  const refLink = `${window.location.origin}${window.location.pathname}?ref=${profile.referral_code}`;
  const referralOn = (game?.referral?.enabled !== false) && features?.referral !== false;

  useEffect(() => {
    rpc('referral_dashboard').then(setRefd).catch(() => {});
  }, [profile.referral_count]);

  // Links directory (admin se manage hote hain) — profile me cards ke roop me
  useEffect(() => {
    supabase.from('public_links').select('*').eq('active', true)
      .order('pinned', { ascending: false })
      .order('sort_order')
      .then(({ data }) => setLinks(data || []))
      .catch(() => setLinks([]));
  }, []);

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

  async function toggleExclusion() {
    setBusy(true);
    const { data, error } = await rpc('toggle_self_exclusion');
    setBusy(false);
    if (error) { sfx.error(); toast(error.message, 'error'); return; }
    sfx.click();
    toast(data.self_excluded ? 'Self-Exclusion ON — betting/withdraw band' : 'Self-Exclusion OFF — welcome back', 'info');
    onProfile({ ...profile, self_excluded: data.self_excluded });
  }

  async function requestDeletion() {
    setBusy(true);
    const { error } = await rpc('request_deletion', { p_confirmed: true });
    setBusy(false);
    if (error) { sfx.error(); toast(error.message, 'error'); return; }
    sfx.cash();
    toast('Deletion request submitted — admin review karega', 'info');
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

      {/* Links directory — cards (admin panel > Links Directory se manage) */}
      {links.length > 0 && (
        <div className="card" style={{ marginTop: 12 }}>
          <div className="card-title"><Ic n="link" s={17} />Links</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(210px, 1fr))', gap: 10 }}>
            {links.map((l) => (
              <a key={l.id} href={l.url} target="_blank" rel="noreferrer"
                onClick={() => sfx.click()}
                style={{
                  display: 'flex', alignItems: 'center', gap: 10, padding: '12px 12px',
                  borderRadius: 12, textDecoration: 'none',
                  background: 'rgba(124,108,255,0.08)', border: '1px solid rgba(124,108,255,0.22)',
                  transition: 'transform .15s ease, box-shadow .15s ease'
                }}
                onMouseEnter={(e) => { e.currentTarget.style.transform = 'translateY(-2px)'; e.currentTarget.style.boxShadow = '0 6px 18px rgba(0,0,0,0.18)'; }}
                onMouseLeave={(e) => { e.currentTarget.style.transform = ''; e.currentTarget.style.boxShadow = ''; }}>
                <span style={{
                  width: 38, height: 38, borderRadius: 10, flexShrink: 0,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  background: 'linear-gradient(135deg, rgba(124,108,255,0.25), rgba(0,200,150,0.18))',
                  color: 'var(--accent, #7c6cff)'
                }}><Ic n={PLATFORM_ICO[l.platform] || 'link'} s={18} /></span>
                <span style={{ minWidth: 0, flex: 1 }}>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 5, fontWeight: 800, fontSize: '0.86rem', color: 'var(--text, #fff)' }}>
                    {l.pinned && <Ic n="star" s={11} style={{ color: 'var(--gold, #f5b301)', flexShrink: 0 }} />}
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{l.title}</span>
                  </span>
                  {l.description && (
                    <span style={{ display: 'block', fontSize: '0.72rem', color: 'var(--text-dim)', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{l.description}</span>
                  )}
                </span>
                <Ic n="external" s={13} style={{ color: 'var(--text-dim)', flexShrink: 0 }} />
              </a>
            ))}
          </div>
        </div>
      )}

      {/* Referral card */}
      {referralOn && (
        <div className="card" style={{ marginTop: 12, background: 'linear-gradient(135deg, rgba(124,108,255,0.15), rgba(0,200,150,0.09))' }}>
          <div className="card-title"><Ic n="share" s={18} />My Referral</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: '0.7rem', color: 'var(--text-dim)', fontWeight: 800, letterSpacing: 1 }}>{t('profile.your_code')}</div>
              <div style={{ fontSize: '1.5rem', fontWeight: 900, letterSpacing: 3, fontFamily: 'monospace' }}>{profile.referral_code}</div>
            </div>
            <button className="btn btn-ghost" onClick={async () => { const ok = await copyText(profile.referral_code); toast(ok ? 'Code copied' : 'Failed', ok ? 'success' : 'error'); }}>
              <Ic n="copy" s={15} />Copy Code
            </button>
          </div>
          <button className="btn btn-primary btn-block" onClick={shareRef}><Ic n="link" s={16} />{t('profile.share_link')}</button>

          {refd && (
            <div style={{ marginTop: 16 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8rem', fontWeight: 800, marginBottom: 6 }}>
                <span style={{ display: 'flex', gap: 6, alignItems: 'center' }}><Ic n="users" s={14} />{t('profile.team')}: <b>{refd.count}</b></span>
                {nextRank && <span style={{ display: 'flex', gap: 5, alignItems: 'center' }}><Ic n="trophy" s={13} />{t('profile.next_rank')}: {nextRank.rank} at {nextRank.min}</span>}
              </div>
              <div style={{ height: 10, background: 'var(--card-2)', borderRadius: 99, overflow: 'hidden' }}>
                <div style={{ height: '100%', width: progress + '%', background: 'linear-gradient(90deg, var(--accent), var(--accent-2))', borderRadius: 99, transition: 'width 0.6s' }}></div>
              </div>
              <p style={{ fontSize: '0.73rem', color: 'var(--text-dim)', marginTop: 8 }}>
                {t('profile.rank_note')}
              </p>
              {refd.leaderboard?.length > 0 && (
                <div style={{ marginTop: 12, borderTop: '1px solid var(--border-solid)', paddingTop: 12 }}>
                  <div style={{ fontSize: '0.7rem', fontWeight: 800, color: 'var(--text-dim)', marginBottom: 8, letterSpacing: 1, display: 'flex', gap: 6, alignItems: 'center' }}>
                    <Ic n="trophy" s={13} />{t('profile.top_referrers')}
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
        <StatCard label={t('profile.deposits')} value={money(profile.total_deposits)} tone="sc-green" icon="arrowDown" />
        <StatCard label={t('profile.withdrawn')} value={money(profile.total_withdrawn)} tone="sc-blue" icon="arrowUp" />
        <StatCard label={t('profile.total_bets')} value={money(profile.total_bet)} tone="sc-gold" icon="target" />
        <StatCard label={t('profile.total_won')} value={money(profile.total_won)} tone="sc-green" icon="trophy" />
      </div>
      <div className="card-sub" style={{ marginTop: 8, display: 'flex', gap: 6, alignItems: 'center' }}>
        <Ic n="calendar" s={12} />Member since {fmtDT(profile.created_at)}
      </div>

      {/* Self-exclusion notice */}
      {profile.self_excluded && (
        <div className="card" style={{ marginTop: 12, borderColor: 'rgba(255,200,87,0.5)', background: 'linear-gradient(135deg, rgba(255,200,87,0.1), transparent)' }}>
          <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
            <Ic n="pause" s={20} style={{ color: 'var(--warning)', flexShrink: 0, marginTop: 2 }} />
            <div>
              <div style={{ fontWeight: 900, color: 'var(--warning)' }}>Self-Exclusion Active</div>
              <p className="card-sub">Betting, deposits aur withdrawals band hain. Neeche toggle se OFF kar sakte ho (ya Support se help lo).</p>
            </div>
          </div>
        </div>
      )}

      {/* Responsible Play */}
      <div className="card" style={{ marginTop: 12 }}>
        <div className="card-title"><Ic n="shield" s={17} />{t('profile.responsible')}</div>
        <div className="setting-row">
          <div>
            <div className="s-label">{t('profile.self_excl')}</div>
            <div className="s-desc">{t('profile.self_excl_sub')}</div>
          </div>
          <Toggle checked={!!profile.self_excluded} onChange={toggleExclusion} disabled={busy} />
        </div>
        <div className="setting-row">
          <div>
            <div className="s-label">{t('profile.del_request')}</div>
            <div className="s-desc">{t('profile.del_sub')}</div>
          </div>
          {!profile.deletion_requested ? (
            <button className="btn btn-ghost btn-sm" style={{ color: 'var(--danger)' }} onClick={() => {
              if (window.confirm('Account deletion request submit karo? (Balance safe rahega review tak)')) requestDeletion();
            }} disabled={busy}>
              <Ic n="trash" s={13} />Request
            </button>
          ) : (
            <span className="badge badge-pending">{t('profile.del_request')}</span>
          )}
        </div>
      </div>

      {/* Contact */}
      <div className="card" style={{ marginTop: 12 }}>
        <div className="card-title"><Ic n="phone" s={17} />{t('profile.contact')}</div>
        <Field label="Phone">
          <input className="input" placeholder="+91…" value={phone} onChange={(e) => setPhone(e.target.value)} />
        </Field>
        <Field label="UPI ID (for withdrawals)">
          <input className="input" placeholder="yourname@upi" value={upi} onChange={(e) => setUpi(e.target.value)} />
        </Field>
        <button className="btn btn-primary btn-block" onClick={saveContact} disabled={busy}><Ic n="check" s={16} />{t('profile.save')}</button>
      </div>

      {/* Settings */}
      <div className="card" style={{ marginTop: 12 }}>
        <div className="card-title"><Ic n="sliders" s={17} />{t('profile.preferences')}</div>
        <div className="setting-row">
          <div><div className="s-label">{t('profile.theme')}</div><div className="s-desc">{t('profile.theme_sub')}</div></div>
          <button className="btn btn-ghost btn-sm" onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}>
            <Ic n={theme === 'dark' ? 'sun' : 'moon'} s={15} />{theme === 'dark' ? 'Dark → Light' : 'Light → Dark'}
          </button>
        </div>
        <div className="setting-row">
          <div><div className="s-label">{t('profile.sound')}</div><div className="s-desc">{t('profile.sound_sub')}</div></div>
          <button className="btn btn-ghost btn-sm" onClick={() => {
            const v = !sfx.isEnabled();
            sfx.setEnabled(v);
            setSndOn(v);
            sfx.click();
            toast(v ? 'Sound ON' : 'Sound OFF', 'info');
          }}>
            <Ic n={sndOn ? 'volume' : 'volumeOff'} s={15} />{sndOn ? 'On' : 'Off'}
          </button>
        </div>
        <div className="setting-row">
          <div><div className="s-label">Volume</div><div className="s-desc">Aapke device ka sound level</div></div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, width: 165 }}>
            <input type="range" min="0" max="1" step="0.05"
              value={vol} onChange={(e) => { const v = Number(e.target.value); sfx.setVolume(v); setVol(v); }}
              onMouseUp={() => sfx.click()} onTouchEnd={() => sfx.click()}
              style={{ flex: 1 }} />
            <span style={{ fontSize: '0.75rem', width: 36, textAlign: 'right', color: 'var(--text-dim)', fontWeight: 700 }}>{Math.round(vol * 100)}%</span>
          </div>
        </div>
        <div className="setting-row">
          <div><div className="s-label">{t('profile.change_pw')}</div><div className="s-desc">{t('profile.change_pw_sub')}</div></div>
        </div>
        <Field label="">
          <input className="input" type="password" placeholder="New password" value={pw} onChange={(e) => setPw(e.target.value)} />
        </Field>
        <button className="btn btn-ghost btn-block" onClick={changePassword} disabled={busy || !pw}><Ic n="key" s={15} />{t('profile.update_pw')}</button>
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

      <button className="btn btn-danger btn-block" style={{ marginTop: 14 }} onClick={logout}><Ic n="logout" s={16} />{t('profile.logout')}</button>
    </div>
  );
}
