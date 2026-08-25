import React, { useEffect, useState, useCallback } from 'react';
import { supabase } from '../lib/supabase.js';
import { Toasts, toast, ErrorBoundary } from '../components/ui.jsx';
import { Ic } from '../lib/icons.jsx';
import { sfx } from '../lib/sound.js';
import { cx } from '../lib/utils.js';
import Dashboard from './sections/Dashboard.jsx';
import GameControl from './sections/GameControl.jsx';
import Users from './sections/Users.jsx';
import Deposits from './sections/Deposits.jsx';
import Withdrawals from './sections/Withdrawals.jsx';
import Bets from './sections/Bets.jsx';
import Results from './sections/Results.jsx';
import Coupons from './sections/Coupons.jsx';
import Referrals from './sections/Referrals.jsx';
import { ChatSection, AnnouncementsSection } from './sections/Community.jsx';
import Analytics from './sections/Analytics.jsx';
import Logs from './sections/Logs.jsx';
import Settings from './sections/Settings.jsx';

const SECTIONS = [
  { id: 'dashboard', label: 'Dashboard', ico: 'layout', group: 'Main' },
  { id: 'users', label: 'Users', ico: 'users', group: 'Main' },
  { id: 'gamecontrol', label: 'Game Control', ico: 'gauge', group: 'Game Engine' },
  { id: 'results', label: 'Results', ico: 'dice', group: 'Game Engine' },
  { id: 'bets', label: 'Bets', ico: 'target', group: 'Game Engine' },
  { id: 'deposits', label: 'Deposits', ico: 'arrowDown', group: 'Money' },
  { id: 'withdrawals', label: 'Withdrawals', ico: 'arrowUp', group: 'Money' },
  { id: 'coupons', label: 'Coupons', ico: 'ticket', group: 'Money' },
  { id: 'referrals', label: 'Referrals & Ranks', ico: 'share', group: 'Growth' },
  { id: 'chat', label: 'Chat Moderation', ico: 'chat', group: 'Community' },
  { id: 'announcements', label: 'Announcements', ico: 'megaphone', group: 'Community' },
  { id: 'analytics', label: 'Analytics', ico: 'chart', group: 'Insights' },
  { id: 'logs', label: 'Admin Logs', ico: 'file', group: 'Insights' },
  { id: 'settings', label: 'Settings', ico: 'sliders', group: 'System' }
];

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

  // Dashboard quick-links
  useEffect(() => {
    const on = (e) => setSection(e.detail);
    window.addEventListener('jc:goto', on);
    return () => window.removeEventListener('jc:goto', on);
  }, []);

  if (checking) return <div className="loading-screen"><div className="spinner"></div><div>Verifying admin access…</div></div>;
  if (!user || !profile || profile.role !== 'admin') return <AdminLogin />;

  const sec = SECTIONS.find((s) => s.id === section);

  return (
    <div className="admin-shell">
      <Toasts />
      <div className={cx('admin-sidebar', drawer && 'open')}>
        <div className="brand"><Ic n="shield" s={20} />ADMIN v7</div>
        {['Main', 'Game Engine', 'Money', 'Growth', 'Community', 'Insights', 'System'].map((group) => (
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
          <span className="badge badge-active"><Ic n="user" s={12} />{profile.email}</span>
        </div>
        <div className="page-enter" key={section}>
          <ErrorBoundary label={sec?.label}>
            {section === 'dashboard' && <Dashboard profile={profile} />}
            {section === 'users' && <Users />}
            {section === 'gamecontrol' && <GameControl />}
            {section === 'results' && <Results />}
            {section === 'bets' && <Bets />}
            {section === 'deposits' && <Deposits />}
            {section === 'withdrawals' && <Withdrawals />}
            {section === 'coupons' && <Coupons />}
            {section === 'referrals' && <Referrals />}
            {section === 'chat' && <ChatSection />}
            {section === 'announcements' && <AnnouncementsSection />}
            {section === 'analytics' && <Analytics />}
            {section === 'logs' && <Logs />}
            {section === 'settings' && <Settings />}
          </ErrorBoundary>
        </div>
      </div>
    </div>
  );
}
