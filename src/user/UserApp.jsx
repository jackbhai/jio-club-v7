import React, { useEffect, useState, useCallback, useRef } from 'react';
import { supabase, rpc } from '../lib/supabase.js';
import { Toasts, toast, Modal } from '../components/ui.jsx';
import { Ic } from '../lib/icons.jsx';
import { sfx } from '../lib/sound.js';
import { getTheme, toggleTheme } from '../lib/theme.js';
import { money, timeAgo, cx } from '../lib/utils.js';
import Auth from './Auth.jsx';
import Game from './Game.jsx';
import Wallet from './Wallet.jsx';
import MyBets from './MyBets.jsx';
import Chat from './Chat.jsx';
import Profile from './Profile.jsx';

const NAV = [
  { id: 'game', label: 'Game', ico: 'target' },
  { id: 'wallet', label: 'Wallet', ico: 'wallet' },
  { id: 'bets', label: 'My Bets', ico: 'list' },
  { id: 'chat', label: 'Chat', ico: 'chat' },
  { id: 'profile', label: 'Profile', ico: 'user' }
];

export default function UserApp() {
  const [user, setUser] = useState(null);
  const [profile, setProfile] = useState(null);
  const [game, setGame] = useState(null);
  const [tab, setTab] = useState('game');
  const [notifs, setNotifs] = useState([]);
  const [showNotifs, setShowNotifs] = useState(false);
  const [announce, setAnnounce] = useState(null);
  const [booting, setBooting] = useState(true);
  const [theme, setThemeState] = useState(getTheme());
  const prevBal = useRef(null);
  const [balBump, setBalBump] = useState(false);

  const loadGame = useCallback(async () => {
    try {
      const g = await rpc('game_state');
      setGame(g);
      if (g?.sounds) sfx.init(g.sounds);
    } catch (e) { /* offline */ }
  }, []);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setUser(data.session?.user || null);
      setBooting(false);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => {
      setUser(session?.user || null);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!user) { setProfile(null); setNotifs([]); return; }
    (async () => {
      try {
        const { data: p } = await supabase.from('profiles').select('*').eq('id', user.id).maybeSingle();
        setProfile(p);
        const { data: ns } = await supabase.from('notifications').select('*')
          .or(`uid.eq.${user.id},uid.is.null`).order('created_at', { ascending: false }).limit(30);
        setNotifs(ns || []);
        const { data: an } = await supabase.from('announcements').select('*')
          .eq('active', true).order('created_at', { ascending: false }).limit(1);
        setAnnounce(an?.[0] || null);
      } catch (e) { /* ignore */ }
    })();
    loadGame();
    const iv = setInterval(loadGame, 30000);
    return () => clearInterval(iv);
  }, [user, loadGame]);

  // Realtime
  useEffect(() => {
    if (!user) return;
    const ch = supabase.channel('user-realtime-' + user.id)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'profiles', filter: `id=eq.${user.id}` }, (p) => setProfile(p.new))
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'notifications' }, (p) => {
        setNotifs((n) => [p.new, ...n].slice(0, 30));
        sfx.notify();
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'settings' }, () => loadGame())
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'announcements' }, (p) => {
        if (p.new.active) setAnnounce(p.new);
      })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [user, loadGame]);

  useEffect(() => {
    const b = profile?.balance ?? 0;
    if (prevBal.current !== null && prevBal.current !== b) {
      setBalBump(true);
      setTimeout(() => setBalBump(false), 450);
    }
    prevBal.current = b;
  }, [profile?.balance]);

  useEffect(() => {
    const on = (e) => setThemeState(e.detail);
    window.addEventListener('jc:theme', on);
    return () => window.removeEventListener('jc:theme', on);
  }, []);

  async function markAllRead() {
    if (!notifs.length) return;
    const ids = notifs.filter((n) => !n.read).map((n) => n.id);
    if (ids.length) await supabase.from('notifications').update({ read: true }).in('id', ids);
    setNotifs((ns) => ns.map((n) => ({ ...n, read: true })));
  }

  if (booting) return <div className="loading-screen"><div className="spinner"></div><div>Starting…</div></div>;
  if (!user || !profile) return (<><Auth refCode={new URLSearchParams(window.location.search).get('ref')} /><Toasts /></>);

  const appName = game?.appearance?.appName || 'JIO CLUB';
  const unread = notifs.filter((n) => !n.read).length;
  const features = game?.features || {};

  return (
    <div className="app-shell">
      <Toasts />
      <div className="topbar">
        <div className="brand"><Ic n="dice" s={19} />{appName}</div>
        <div className={`balance-chip ${balBump ? 'bump' : ''}`}>
          <Ic n="coins" s={16} />{money(profile.balance)}
        </div>
        <button className="icon-btn" onClick={() => { sfx.click(); setShowNotifs(true); }} aria-label="Notifications">
          <Ic n="bell" s={18} />{unread > 0 && <span className="dot"></span>}
        </button>
        <button className="icon-btn" onClick={() => { sfx.click(); toggleTheme(); }} aria-label="Theme">
          <Ic n={theme === 'dark' ? 'sun' : 'moon'} s={18} />
        </button>
      </div>

      <div className="content page-enter" key={tab}>
        {announce && (
          <div className={`announce-bar ${announce.priority || 'info'}`}>
            <Ic n="megaphone" s={18} />
            <div>
              <b>{announce.title}</b>
              <div style={{ fontSize: '0.78rem', opacity: 0.85 }}>{announce.body}</div>
            </div>
            <button onClick={() => setAnnounce(null)}><Ic n="x" s={16} /></button>
          </div>
        )}

        {tab === 'game' && <Game game={game} profile={profile} onGame={setGame} />}
        {tab === 'wallet' && <Wallet game={game} profile={profile} user={user} features={features} />}
        {tab === 'bets' && <MyBets user={user} />}
        {tab === 'chat' && <Chat game={game} profile={profile} user={user} />}
        {tab === 'profile' && <Profile game={game} profile={profile} user={user} onProfile={setProfile} features={features} />}
      </div>

      <div className="bottomnav">
        {NAV.map((n) => (
          <button key={n.id} className={cx('nav-item', tab === n.id && 'active')} onClick={() => { sfx.click(); setTab(n.id); }}>
            <span className="nav-ico"><Ic n={n.ico} s={21} /></span>
            {n.label}
          </button>
        ))}
      </div>

      {showNotifs && (
        <Modal title="Notifications" icon="bell" onClose={() => setShowNotifs(false)}>
          {notifs.length === 0 && <EmptyState />}
          {notifs.map((n) => (
            <div key={n.id} className={cx('notif-item', !n.read && 'unread')}>
              <div>
                <div className="n-title">{n.title}</div>
                <div style={{ color: 'var(--text-dim)', fontSize: '0.84rem' }}>{n.body}</div>
                <div className="n-time">{timeAgo(n.created_at)}</div>
              </div>
            </div>
          ))}
          {unread > 0 && (
            <div style={{ marginTop: 14 }}>
              <button className="btn btn-ghost btn-block" onClick={markAllRead}><Ic n="check" s={15} />Mark all as read</button>
            </div>
          )}
        </Modal>
      )}
    </div>
  );
}

function EmptyState() {
  return <div className="empty"><div className="empty-icon"><Ic n="bellOff" s={40} /></div>No notifications yet</div>;
}
