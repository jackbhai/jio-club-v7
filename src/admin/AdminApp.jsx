import React, { useEffect, useState, useCallback } from 'react';
import { supabase, rpc } from '../lib/supabase.js';
import { Toasts, toast, ErrorBoundary } from '../components/ui.jsx';
import { Ic } from '../lib/icons.jsx';
import { sfx } from '../lib/sound.js';
import { applyBranding } from '../lib/branding.js';
import { Brand } from '../components/Brand.jsx';
import { cx } from '../lib/utils.js';
import Dashboard from './sections/Dashboard.jsx';
import UsersSection from './sections/Users.jsx';
import GameControl from './sections/GameControl.jsx';
import Results from './sections/Results.jsx';
import Bets from './sections/Bets.jsx';
import Deposits from './sections/Deposits.jsx';
import Withdrawals from './sections/Withdrawals.jsx';
import Coupons from './sections/Coupons.jsx';
import Referrals from './sections/Referrals.jsx';
import Ledger from './sections/Ledger.jsx';
import SupportInbox from './sections/SupportInbox.jsx';
import {
  FeaturesSection, PayoutsSection, WalletSection, UpiSection,
  PaymentsSection, CommunitySection, AppearanceSection, SoundsSection,
  LinksSection, ContactSection, SecuritySection
} from './sections/AdminSettings.jsx';
import { ChatSection, AnnouncementsSection } from './sections/Community.jsx';
import Analytics from './sections/Analytics.jsx';
import Logs from './sections/Logs.jsx';

const SECTIONS = [
  { id: 'dashboard', label: 'Dashboard', ico: 'layout', group: 'Main' },
  { id: 'users', label: 'Users', ico: 'users', group: 'Main' },
  { id: 'gamecontrol', label: 'Game Control', ico: 'gauge', group: 'Game Engine' },
  { id: 'results', label: 'Results', ico: 'dice', group: 'Game Engine' },
  { id: 'bets', label: 'Bets', ico: 'target', group: 'Game Engine' },
  { id: 'deposits', label: 'Deposits', ico: 'arrowDown', group: 'Money' },
  { id: 'withdrawals', label: 'Withdrawals', ico: 'arrowUp', group: 'Money' },
  { id: 'coupons', label: 'Coupons', ico: 'ticket', group: 'Money' },
  { id: 'ledger', label: 'Wallet Ledger', ico: 'file', group: 'Money' },
  { id: 'referrals', label: 'Referrals & Ranks', ico: 'share', group: 'Growth' },
  { id: 'support', label: 'Support Inbox', ico: 'headset', group: 'Support' },
  { id: 'chat', label: 'Chat Moderation', ico: 'chat', group: 'Support' },
  { id: 'announcements', label: 'Announcements', ico: 'megaphone', group: 'Support' },
  { id: 'analytics', label: 'Analytics', ico: 'chart', group: 'Insights' },
  { id: 'logs', label: 'Admin Logs', ico: 'file', group: 'Insights' },
  { id: 'features', label: 'Features', ico: 'toggle', group: 'Settings' },
  { id: 'payouts', label: 'Payouts', ico: 'percent', group: 'Settings' },
  { id: 'walletset', label: 'Wallet Settings', ico: 'wallet', group: 'Settings' },
  { id: 'upi', label: 'UPI Accounts', ico: 'upi', group: 'Settings' },
  { id: 'payments', label: 'Payments / Razorpay', ico: 'card', group: 'Settings' },
  { id: 'communityset', label: 'Community Settings', ico: 'radio', group: 'Settings' },
  { id: 'branding', label: 'Branding', ico: 'tag', group: 'Settings' },
  { id: 'sounds', label: 'Sounds', ico: 'volume', group: 'Settings' },
  { id: 'links', label: 'Links Directory', ico: 'link', group: 'Settings' },
  { id: 'contact', label: 'Contact & About', ico: 'headset', group: 'Settings' },
  { id: 'security', label: 'Security / 2FA', ico: 'shieldCheck', group: 'Settings' }
];

const GROUPS = ['Main', 'Game Engine', 'Money', 'Growth', 'Support', 'Insights', 'Settings'];

function AdminLogin() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);

  async function login(e) {
    e.preventDefault();
    setBusy(true);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setBusy(false);
    if (error) { sfx.error(); toast(error.message, 'error'); }
  }

  return (
    <div className="auth-wrap">
      <Toasts />
      <div className="auth-card">
        <div className="auth-logo">
          <div className="logo-badge" style={{ background: 'linear-gradient(135deg,#e5484d,#7c6cff)' }}><Ic n="shield" s={38} /></div>
          <h1>ADMIN CONTROL</h1>
          <p>Authorized administrators only</p>
        </div>
        <form className="card" style={{ padding: 22 }} onSubmit={login}>
          <div className="form-group">
            <label>Admin Email</label>
            <input className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
          </div>
          <div className="form-group">
            <label>Password</label>
            <input className="input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
          </div>
          <button className="btn btn-primary btn-block" disabled={busy}>
            <Ic n="lock" s={16} />{busy ? 'Checking…' : 'Login'}
          </button>
          <p style={{ textAlign: 'center', color: 'var(--text-dim)', fontSize: '0.75rem', marginTop: 12 }}>
            <a href="#/"><Ic n="arrowLeft" s={12} /> Back to user panel</a>
          </p>
        </form>
      </div>
    </div>
  );
}

export default function AdminApp() {
  const [user, setUser] = useState(null);
  const [profile, setProfile] = useState(null);
  const [checking, setChecking] = useState(true);
  const [section, setSection] = useState('dashboard');
  const [drawer, setDrawer] = useState(false);
  // MFA gate
  const [mfaState, setMfaState] = useState('loading'); // loading | needed | passed
  const [mfaCode, setMfaCode] = useState('');
  const [mfaBusy, setMfaBusy] = useState(false);
  const [mfaErr, setMfaErr] = useState('');

  const loadProfile = useCallback(async (uid) => {
    const { data } = await supabase.from('profiles').select('*').eq('id', uid).maybeSingle();
    setProfile(data);
  }, []);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      const u = data.session?.user;
      setUser(u);
      if (u) loadProfile(u.id); else setChecking(false);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => {
      const u = session?.user;
      setUser(u);
      if (u) loadProfile(u.id); else { setProfile(null); setChecking(false); }
    });
    return () => sub.subscription.unsubscribe();
  }, [loadProfile]);

  useEffect(() => { if (user) setChecking(false); }, [user]);

  // MFA check on admin login
  useEffect(() => {
    if (!user || !profile || profile.role !== 'admin') return;
    const cached = Number(sessionStorage.getItem('jc2fa') || 0);
    if (Date.now() - cached < 30 * 60 * 1000) { setMfaState('passed'); return; }
    supabase.rpc('mfa_status').then((d) => {
      if (d.data?.enabled) setMfaState('needed');
      else setMfaState('passed');
    }).catch(() => setMfaState('passed'));
  }, [user, profile]);

  async function verifyMfa() {
    if (mfaCode.length !== 6) { setMfaErr('6 digits daalo'); return; }
    setMfaBusy(true); setMfaErr('');
    const { data, error } = await supabase.rpc('mfa_verify', { p_code: mfaCode });
    setMfaBusy(false);
    if (error) { setMfaErr(error.message); sfx.error(); return; }
    sessionStorage.setItem('jc2fa', String(Date.now()));
    setMfaState('passed');
    sfx.cash();
    toast('2FA verified — session 30 min', 'success');
  }

  const [app, setApp] = useState(null);
  useEffect(() => {
    rpc('game_state').then((d) => { if (d?.appearance) { setApp(d.appearance); applyBranding(d.appearance); } }).catch(() => {});
  }, []);

  useEffect(() => {
    const on = (e) => setSection(e.detail);
    window.addEventListener('jc:goto', on);
    return () => window.removeEventListener('jc:goto', on);
  }, []);

  if (checking) return <div className="loading-screen"><div className="spinner"></div><div>Verifying admin access…</div></div>;
  if (!user || !profile || profile.role !== 'admin') return <AdminLogin />;

  // MFA gate screen
  if (profile.role === 'admin' && mfaState === 'needed') {
    return (
      <div className="auth-wrap">
        <Toasts />
        <div className="auth-card" style={{ maxWidth: 380 }}>
          <div className="card" style={{ padding: 26, textAlign: 'center' }}>
            <div style={{ width: 58, height: 58, borderRadius: 16, margin: '0 auto 14px', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(46,230,168,0.12)', color: 'var(--success)' }}>
              <Ic n="shieldCheck" s={30} />
            </div>
            <div style={{ fontWeight: 900, fontSize: '1.1rem', marginBottom: 6 }}>Two-Factor Authentication</div>
            <p style={{ color: 'var(--text-dim)', fontSize: '0.84rem', lineHeight: 1.5, marginBottom: 16 }}>
              Apne authenticator app (Google Authenticator / Aegis) mein current 6-digit code daalo.
            </p>
            <input className="input" style={{ textAlign: 'center', letterSpacing: 8, fontSize: '1.3rem', fontWeight: 900 }}
              inputMode="numeric" maxLength={6} placeholder="••••••" value={mfaCode}
              onChange={(e) => setMfaCode(e.target.value.replace(/\D/g, ''))}
              onKeyDown={(e) => e.key === 'Enter' && verifyMfa()} autoFocus />
            {mfaErr && <div style={{ color: 'var(--danger)', fontSize: '0.8rem', marginTop: 8, fontWeight: 700 }}>{mfaErr}</div>}
            <button className="btn btn-primary btn-block" style={{ marginTop: 14 }} onClick={verifyMfa} disabled={mfaBusy || mfaCode.length !== 6}>
              <Ic n="lock" s={15} />{mfaBusy ? 'Verifying…' : 'Verify & Continue'}
            </button>
            <a href="#/" style={{ display: 'inline-block', marginTop: 14, fontSize: '0.78rem', color: 'var(--text-dim)' }}>
              <Ic n="arrowLeft" s={12} /> Back
            </a>
          </div>
        </div>
      </div>
    );
  }

  const sec = SECTIONS.find((s) => s.id === section);
  const mfaOn = mfaState === 'passed' && Number(sessionStorage.getItem('jc2fa') || 0) > 0;

  const renderSection = () => {
    switch (section) {
      case 'dashboard': return <Dashboard profile={profile} />;
      case 'users': return <UsersSection />;
      case 'gamecontrol': return <GameControl />;
      case 'results': return <Results />;
      case 'bets': return <Bets />;
      case 'deposits': return <Deposits />;
      case 'withdrawals': return <Withdrawals />;
      case 'coupons': return <Coupons />;
      case 'ledger': return <Ledger />;
      case 'referrals': return <Referrals />;
      case 'support': return <SupportInbox />;
      case 'chat': return <ChatSection />;
      case 'announcements': return <AnnouncementsSection />;
      case 'analytics': return <Analytics />;
      case 'logs': return <Logs />;
      case 'features': return <FeaturesSection />;
      case 'payouts': return <PayoutsSection />;
      case 'walletset': return <WalletSection />;
      case 'upi': return <UpiSection />;
      case 'payments': return <PaymentsSection />;
      case 'communityset': return <CommunitySection />;
      case 'branding': return <BrandingSection />;
      case 'sounds': return <SoundsSection />;
      case 'links': return <LinksSection />;
      case 'contact': return <ContactSection />;
      case 'security': return <SecuritySection />;
      default: return <Dashboard profile={profile} />;
    }
  };

  return (
    <div className="admin-shell">
      <Toasts />
      <div className={cx('admin-sidebar', drawer && 'open')}>
        <div className="brand"><Brand app={app} s={15} /><span style={{marginLeft:6}}>{app?.appName || "JIO CLUB"} <span style={{fontSize:'0.66rem',opacity:0.55}}>ADMIN</span></span></div>
        {GROUPS.map((group) => (
          <div key={group}>
            <div className="side-label">{group}</div>
            {SECTIONS.filter((s) => s.group === group).map((s) => (
              <button key={s.id}
                className={cx('side-item', section === s.id && 'active')}
                onClick={() => { sfx.click(); setSection(s.id); setDrawer(false); }}>
                <span className="s-ico"><Ic n={s.ico} s={18} /></span>{s.label}
              </button>
            ))}
          </div>
        ))}
        <div style={{ flex: 1 }}></div>
        <div className="side-label">Account</div>
        <button className="side-item" onClick={async () => { await supabase.auth.signOut(); toast('Admin logged out', 'info'); }}>
          <span className="s-ico"><Ic n="logout" s={18} /></span>Logout
        </button>
        <a className="side-item" href="#/">
          <span className="s-ico"><Ic n="user" s={18} /></span>User Panel
        </a>
      </div>

      <div className="admin-main">
        <div className="admin-topbar">
          <button className="icon-btn admin-menu-btn" onClick={() => setDrawer(true)}><Ic n="menu" s={18} /></button>
          <h1><Ic n={sec?.ico} s={24} />{sec?.label}</h1>
          <div className="spacer"></div>
          <button className="badge badge-pending" style={{ cursor: 'pointer' }} onClick={() => setSection('security')} title="2FA status — click to manage">
            <Ic n="shieldCheck" s={12} />2FA {mfaOn ? 'ON' : '…'}
          </button>
          <span className="badge badge-active"><Ic n="user" s={12} />{profile.email}</span>
        </div>
        <div className="page-enter" key={section}>
          <ErrorBoundary label={sec?.label}>
            {renderSection()}
          </ErrorBoundary>
        </div>
      </div>
    </div>
  );
}
