import React, { useEffect, useState, useCallback, useRef } from 'react';
import { supabase, rpc } from '../lib/supabase.js';
import { Toasts, toast, Modal, ErrorBoundary } from '../components/ui.jsx';
import { Ic } from '../lib/icons.jsx';
import { sfx } from '../lib/sound.js';
import { getTheme, toggleTheme } from '../lib/theme.js';
import { money, timeAgo, cx } from '../lib/utils.js';
import { t, useT, toggleLang, getLang } from '../lib/i18n.js';
import { applyBranding } from '../lib/branding.js';
import { Brand } from '../components/Brand.jsx';
import Auth from './Auth.jsx';
import Game from './Game.jsx';
import Wallet from './Wallet.jsx';
import MyBets from './MyBets.jsx';
import Chat from './Chat.jsx';
import Support from './Support.jsx';
import Profile from './Profile.jsx';

// In-app browsers (WhatsApp/Telegram/GPay/FB/IG) — yahan payment iframes
// aksar block ho jaate hain ("This content is blocked"). Banner se user
// ko real browser me kholne ke liye batate hain.
const IN_APP = (() => {
  const ua = typeof navigator !== 'undefined' ? navigator.userAgent : '';
  if (/WhatsApp/i.test(ua)) return 'WhatsApp';
  if (/Telegram/i.test(ua)) return 'Telegram';
  if (/GPay|googlepay|Gpay\//i.test(ua)) return 'GPay';
  if (/FB_IAB|FBAV|; FB\/|Facebook/i.test(ua)) return 'Facebook';
  if (/Instagram/i.test(ua)) return 'Instagram';
  return null;
})();

export default function UserApp() {
  const t = useT();
  const [user, setUser] = useState(null);
  const [profile, setProfile] = useState(null);
  const [game, setGame] = useState(null);
  const [tab, setTab] = useState('game');
  const [notifs, setNotifs] = useState([]);
  const [showNotifs, setShowNotifs] = useState(false);
  const [announce, setAnnounce] = useState(null);
  const [booting, setBooting] = useState(true);
  const [theme, setThemeState] = useState(getTheme());
  const [installEvt, setInstallEvt] = useState(null);
  const [showInstall, setShowInstall] = useState(false);
  const [hideInAppBanner, setHideInAppBanner] = useState(false);
  const [reportBet, setReportBet] = useState(null);
  const prevBal = useRef(null);
  const [balBump, setBalBump] = useState(false);

  const loadGame = useCallback(async () => {
    try {
      const g = await rpc('game_state');
      setGame(g);
      if (g?.sounds) sfx.init(g.sounds);
      applyBranding(g?.appearance);
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

  // Balance bump animation
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

  // PWA install prompt
  useEffect(() => {
    const on = (e) => { e.preventDefault(); setInstallEvt(e); setShowInstall(true); };
    const onInstalled = () => { setShowInstall(false); setInstallEvt(null); toast('App installed!', 'success'); };
    window.addEventListener('beforeinstallprompt', on);
    window.addEventListener('appinstalled', onInstalled);
    return () => { window.removeEventListener('beforeinstallprompt', on); window.removeEventListener('appinstalled', onInstalled); };
  }, []);

  const doInstall = async () => {
    if (!installEvt) return;
    installEvt.prompt();
    try { await installEvt.userChoice; } catch (e) { /* ignore */ }
    setShowInstall(false);
    setInstallEvt(null);
  };

  async function markAllRead() {
    if (!notifs.length) return;
    const ids = notifs.filter((n) => !n.read).map((n) => n.id);
    if (ids.length) await supabase.from('notifications').update({ read: true }).in('id', ids);
    setNotifs((ns) => ns.map((n) => ({ ...n, read: true })));
  }

  if (booting) return <div className="loading-screen"><div className="spinner"></div><div>Starting…</div></div>;
  if (!user || !profile) return (<><Auth refCode={new URLSearchParams(window.location.search).get('ref')} /><Toasts /></>);

  const NAV = [
    { id: 'game', label: t('nav.game'), ico: 'target' },
    { id: 'wallet', label: t('nav.wallet'), ico: 'wallet' },
    { id: 'bets', label: t('nav.bets'), ico: 'list' },
    { id: 'chat', label: t('nav.chat'), ico: 'chat' },
    { id: 'support', label: t('nav.support'), ico: 'headset' },
    { id: 'profile', label: t('nav.profile'), ico: 'user' }
  ];

  // Operator (admin) account cannot play
  if (profile.role === 'admin') {
    return (
      <div className="app-shell">
        <Toasts />
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
          <div className="card" style={{ maxWidth: 420, width: '100%', textAlign: 'center', padding: 30 }}>
            <div style={{ width: 58, height: 58, borderRadius: 16, margin: '0 auto 14px', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(124,108,255,0.15)', color: 'var(--accent)' }}>
              <Ic n="shield" s={30} />
            </div>
            <div style={{ fontWeight: 900, fontSize: '1.15rem', marginBottom: 8 }}>{t('operator.title')}</div>
            <p style={{ color: 'var(--text-dim)', fontSize: '0.88rem', lineHeight: 1.5, marginBottom: 16 }}>{t('operator.sub')}</p>
            <a className="btn btn-primary btn-block" href="#/admin"><Ic n="sliders" s={16} />{t('operator.open_admin')}</a>
            <button className="btn btn-ghost btn-block" style={{ marginTop: 10 }}
              onClick={async () => { await supabase.auth.signOut(); toast('Logged out', 'info'); }}>
              <Ic n="logout" s={15} />{t('profile.logout')}
            </button>
          </div>
        </div>
      </div>
    );
  }

  const appName = game?.appearance?.appName || 'JIO CLUB';
  const unread = notifs.filter((n) => !n.read).length;
  const features = game?.features || {};

  return (
    <div className="app-shell">
      <Toasts />
      {/* Install banner */}
      {showInstall && installEvt && (
        <div style={{ position: 'fixed', bottom: 90, left: '50%', transform: 'translateX(-50%)', zIndex: 70, width: 'min(92%, 460px)' }}>
          <div className="card" style={{ display: 'flex', gap: 10, alignItems: 'center', borderColor: 'rgba(124,108,255,0.5)', boxShadow: 'var(--shadow)' }}>
            <Ic n="rocket" s={22} style={{ color: 'var(--accent)' }} />
            <div style={{ flex: 1, fontSize: '0.84rem', fontWeight: 700 }}>{t('install.banner')}</div>
            <button className="btn btn-primary btn-sm" onClick={doInstall}>{t('install.prompt')}</button>
            <button className="icon-btn" style={{ width: 30, height: 30 }} onClick={() => setShowInstall(false)}><Ic n="x" s={14} /></button>
          </div>
        </div>
      )}

      {/* Topbar */}
      <div className="topbar">
        <div className="brand"><Brand app={game?.appearance} s={16} />{appName}</div>
        <div className={`balance-chip ${balBump ? 'bump' : ''}`}>
          <Ic n="coins" s={15} />{money(profile.balance)}
        </div>
        <button className="icon-btn" onClick={() => { sfx.click(); setShowNotifs(true); }} aria-label="Notifications">
          <Ic n="bell" s={17} />{unread > 0 && <span className="dot"></span>}
        </button>
        <button className="icon-btn" onClick={() => { sfx.click(); toggleLang(); }} aria-label="Language" style={{ fontSize: '0.72rem', fontWeight: 900, letterSpacing: 0 }}>
          {getLang() === 'en' ? 'हिं' : 'EN'}
        </button>
        <button className="icon-btn" onClick={() => { sfx.click(); toggleTheme(); }} aria-label="Theme">
          <Ic n={theme === 'dark' ? 'sun' : 'moon'} s={17} />
        </button>
      </div>

      {/* In-app browser warning — payments yahan break hote hain */}
      {IN_APP && !hideInAppBanner && (
        <div style={{
          margin: '10px 14px 0', padding: '10px 12px', borderRadius: 12,
          display: 'flex', gap: 10, alignItems: 'center',
          background: 'rgba(255,200,87,0.12)', border: '1px solid rgba(255,200,87,0.45)'
        }}>
          <Ic n="info" s={18} style={{ color: 'var(--warning)', flexShrink: 0 }} />
          <div style={{ flex: 1, fontSize: '0.8rem', lineHeight: 1.45, color: 'var(--text)' }}>
            Aap <b>{IN_APP}</b> ke andar page khole ho — <b>payment yahan block ho sakti hai</b>.
            Upar <b>menu (⋮ / ...)</b> → <b>"Open in browser"</b> dabao.
          </div>
          <button className="icon-btn" style={{ width: 28, height: 28 }} onClick={() => setHideInAppBanner(true)}><Ic n="x" s={13} /></button>
        </div>
      )}

      <div className="content page-enter" key={tab}>
        {announce && (
          <div className={`announce-bar ${announce.priority || 'info'}`}>
            <Ic n="megaphone" s={17} />
            <div>
              <b>{announce.title}</b>
              <div style={{ fontSize: '0.78rem', opacity: 0.85 }}>{announce.body}</div>
            </div>
            <button onClick={() => setAnnounce(null)}><Ic n="x" s={15} /></button>
          </div>
        )}

        <ErrorBoundary label={NAV.find(n => n.id === tab)?.label || tab}>
        {tab === 'game' && <Game game={game} profile={profile} onGame={setGame} />}
        {tab === 'wallet' && <Wallet game={game} profile={profile} user={user} features={features} />}
        {tab === 'bets' && <MyBets user={user} onReport={(bet) => { setReportBet(bet); setTab('support'); }} />}
        {tab === 'chat' && <Chat game={game} />}
        {tab === 'support' && <Support user={user} reportBet={reportBet} onReportDone={() => setReportBet(null)} />}
        {tab === 'profile' && <Profile game={game} profile={profile} user={user} onProfile={setProfile} features={features} />}
        </ErrorBoundary>
      </div>

      {/* Bottom nav */}
      <div className="bottomnav">
        {NAV.map((n) => (
          <button key={n.id} className={cx('nav-item', tab === n.id && 'active')} onClick={() => { sfx.click(); setTab(n.id); }}>
            <span className="nav-ico"><Ic n={n.ico} s={20} /></span>
            {n.label}
          </button>
        ))}
      </div>

      {/* Notifications modal */}
      {showNotifs && (
        <Modal title={t('notifs.title')} icon="bell" onClose={() => setShowNotifs(false)}>
          {notifs.length === 0 && <div className="empty"><div className="empty-icon"><Ic n="bellOff" s={38} /></div>{t('notifs.empty')}</div>}
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
              <button className="btn btn-ghost btn-block" onClick={markAllRead}><Ic n="check" s={14} />{t('notifs.mark_all')}</button>
            </div>
          )}
        </Modal>
      )}
    </div>
  );
}
