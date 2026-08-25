import React, { useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabase.js';
import { toast, Empty } from '../components/ui.jsx';
import { Ic } from '../lib/icons.jsx';
import { timeAgo } from '../lib/utils.js';

export default function Chat({ game }) {
  const [msgs, setMsgs] = useState(null);
  const boxRef = useRef(null);

  const chatCfg = (game?.chat) || {};
  const chatOn = chatCfg.enabled !== false;

  useEffect(() => {
    (async () => {
      const { data } = await supabase.from('chats').select('*')
        .order('created_at', { ascending: false }).limit(100);
      setMsgs((data || []).reverse());
    })();
    const ch = supabase.channel('chat-live')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'chats' }, (p) => {
        setMsgs((xs) => (xs ? [...xs, p.new].slice(-150) : [p.new]));
      })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, []);

  useEffect(() => {
    boxRef.current?.scrollTo({ top: boxRef.current.scrollHeight, behavior: 'smooth' });
  }, [msgs]);

  if (!chatOn) return <Empty icon="chat" msg="Chat is disabled by admin" />;

  return (
    <div>
      <div className="card" style={{ marginBottom: 12, display: 'flex', gap: 10, alignItems: 'flex-start', background: 'linear-gradient(135deg, rgba(124,108,255,0.1), transparent)' }}>
        <Ic n="megaphone" s={18} style={{ color: 'var(--accent)', flexShrink: 0, marginTop: 2 }} />
        <div>
          <div style={{ fontWeight: 900, fontSize: '0.9rem' }}>Admin Announcements</div>
          <p className="card-sub">Yeh feed sirf admin ke broadcasts ke liye hai (read-only). Admin se baat karne ke liye <b>Support</b> tab use karo.</p>
        </div>
      </div>
      <div className="card">
        <div className="card-title">
          <Ic n="chat" s={18} />Community Feed
          <span className="badge badge-active" style={{ marginLeft: 4 }}><Ic n="radio" s={11} />live</span>
        </div>
        <div className="chat-box" ref={boxRef}>
          {!msgs && <div className="spinner"></div>}
          {msgs?.length === 0 && <Empty icon="megaphone" msg="Abhi koi announcement nahi" />}
          {msgs?.map((m) => (
            <div key={m.id} className="chat-msg">
              <div className="chat-avatar" style={m.is_admin ? { background: 'linear-gradient(135deg, #7c6cff, #00c896)' } : {}}>
                {(m.name || '?')[0].toUpperCase()}
              </div>
              <div className="chat-bubble" style={{ maxWidth: '78%' }}>
                <div className="chat-meta">
                  <b style={{ color: m.is_admin ? 'var(--accent)' : 'var(--text)' }}>{m.is_admin ? 'ADMIN' : m.name}</b>
                  {m.is_admin && <span className="badge badge-active"><Ic n="shieldCheck" s={10} />official</span>}
                  <span>· {timeAgo(m.created_at)}</span>
                </div>
                <div>{m.message}</div>
              </div>
            </div>
          ))}
        </div>
        <div style={{ marginTop: 12, padding: '10px 12px', background: 'var(--card-2)', borderRadius: 10, color: 'var(--text-dim)', fontSize: '0.8rem', display: 'flex', gap: 8, alignItems: 'center' }}>
          <Ic n="lock" s={14} />Read-only feed — aapki messages admin tak <b>Support tab</b> se jaati hain
        </div>
      </div>
    </div>
  );
}
