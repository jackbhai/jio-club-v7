import React, { useEffect, useRef, useState } from 'react';
import { supabase, rpc } from '../lib/supabase.js';
import { sfx } from '../lib/sound.js';
import { toast, RankBadge, Empty } from '../components/ui.jsx';
import { Ic } from '../lib/icons.jsx';
import { timeAgo } from '../lib/utils.js';

export default function Chat({ game, profile, user }) {
  const [msgs, setMsgs] = useState(null);
  const [text, setText] = useState('');
  const boxRef = useRef(null);

  const chatCfg = (game?.chat) || {};
  const maxLen = chatCfg.maxMessage || 500;
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

  async function send() {
    const m = text.trim();
    if (!m) return;
    if (m.length > maxLen) { toast(`Max ${maxLen} characters`, 'error'); return; }
    sfx.click();
    // V7-013 fix: server RPC — rate limit (1 msg / 3s) + name/rank server se
    try {
      await rpc('send_chat', { p_message: m });
      setText('');
    } catch (e) {
      sfx.error();
      toast(e.message, 'error');
    }
  }

  if (!chatOn) return <Empty icon="chat" msg="Chat is disabled by admin" />;

  return (
    <div>
      <div className="card">
        <div className="card-title">
          <Ic n="chat" s={18} />Community Chat
          <span className="badge badge-active" style={{ marginLeft: 4 }}><Ic n="radio" s={11} />live</span>
        </div>
        <div className="chat-box" ref={boxRef}>
          {!msgs && <div className="spinner"></div>}
          {msgs?.length === 0 && <Empty icon="chat" msg="Be the first to say hi!" />}
          {msgs?.map((m) => (
            <div key={m.id} className="chat-msg">
              <div className="chat-avatar">{(m.name || '?')[0].toUpperCase()}</div>
              <div className="chat-bubble" style={{ maxWidth: '78%' }}>
                <div className="chat-meta">
                  <b style={{ color: 'var(--text)' }}>{m.name}</b>
                  <RankBadge rank={m.rank} small />
                  <span>· {timeAgo(m.created_at)}</span>
                </div>
                <div>{m.message}</div>
              </div>
            </div>
          ))}
        </div>
        <div className="chat-input-row">
          <input className="input" style={{ flex: 1 }} placeholder="Type a message…" value={text}
            maxLength={maxLen}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && send()} />
          <button className="btn btn-primary" onClick={send} disabled={!text.trim()}><Ic n="send" s={16} />Send</button>
        </div>
      </div>
      <p className="card-sub" style={{ textAlign: 'center', marginTop: 10, display: 'flex', gap: 6, justifyContent: 'center', alignItems: 'center' }}>
        <Ic n="shieldCheck" s={13} />Be respectful. No spam — admin moderates.
      </p>
    </div>
  );
}
