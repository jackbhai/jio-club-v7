import React, { useEffect, useRef, useState } from 'react';
import { supabase, rpc } from '../lib/supabase.js';
import { toast, Empty } from '../components/ui.jsx';
import { Ic } from '../lib/icons.jsx';
import { sfx } from '../lib/sound.js';
import { timeAgo } from '../lib/utils.js';

const CATEGORIES = [
  { id: 'general', label: 'General', icon: 'chat' },
  { id: 'deposit', label: 'Deposit', icon: 'arrowDown' },
  { id: 'withdrawal', label: 'Withdrawal', icon: 'arrowUp' },
  { id: 'bet', label: 'Bet Dispute', icon: 'target' },
  { id: 'account', label: 'Account', icon: 'user' },
  { id: 'technical', label: 'Technical', icon: 'wrench' }
];

export default function Support({ user }) {
  const [threads, setThreads] = useState(null);
  const [active, setActive] = useState(null); // thread id
  const [msgs, setMsgs] = useState(null);
  const [text, setText] = useState('');
  const [newTopic, setNewTopic] = useState(false);
  const [subject, setSubject] = useState('');
  const [category, setCategory] = useState('general');
  const [busy, setBusy] = useState(false);
  const boxRef = useRef(null);

  const loadThreads = () =>
    rpc('support_threads_list').then((d) => setThreads(d || [])).catch((e) => setThreads([]));

  useEffect(() => { loadThreads(); const iv = setInterval(loadThreads, 15000); return () => clearInterval(iv); }, []);

  useEffect(() => {
    if (!active) return;
    let alive = true;
    const loadMsgs = () => rpc('support_messages', { p_thread_id: active }).then((d) => alive && setMsgs(d || [])).catch(() => {});
    loadMsgs();
    const ch = supabase.channel('support-rt-' + active)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'support_messages', filter: `thread_id=eq.${active}` }, () => loadMsgs())
      .subscribe();
    return () => { alive = false; supabase.removeChannel(ch); };
  }, [active]);

  useEffect(() => {
    boxRef.current?.scrollTo({ top: boxRef.current.scrollHeight, behavior: 'smooth' });
  }, [msgs]);

  async function send() {
    const m = text.trim();
    if (!m) return;
    setBusy(true);
    try {
      await rpc('support_send', { p_thread_id: active, p_body: m });
      setText('');
      const { data } = await rpc('support_messages', { p_thread_id: active });
      setMsgs(data || []);
    } catch (e) {
      sfx.error(); toast(e.message, 'error');
    } finally { setBusy(false); }
  }

  async function createThread() {
    if (!subject.trim()) { toast('Subject likho', 'error'); return; }
    setBusy(true);
    try {
      const res = await rpc('support_send', { p_thread_id: null, p_subject: subject.trim(), p_category: category, p_body: subject.trim() });
      setNewTopic(false); setSubject('');
      setActive(res?.threadId);
      loadThreads();
      toast('Support request bheja gaya', 'success');
    } catch (e) {
      sfx.error(); toast(e.message, 'error');
    } finally { setBusy(false); }
  }

  async function toggleClose() {
    const t = (threads || []).find((x) => x.id === active);
    if (!t) return;
    await rpc('support_close', { p_thread_id: active, p_closed: t.status !== 'closed' }).catch(() => {});
    loadThreads();
  }

  if (!active) {
    return (
      <div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <div style={{ fontWeight: 900, fontSize: '1rem', display: 'flex', gap: 8, alignItems: 'center' }}>
            <Ic n="headset" s={19} />Support Chat
          </div>
          <button className="btn btn-primary btn-sm" onClick={() => { setNewTopic(true); sfx.click(); }}>
            <Ic n="plus" s={14} />New Topic
          </button>
        </div>
        <p className="card-sub" style={{ marginBottom: 14, display: 'flex', gap: 6, alignItems: 'flex-start' }}>
          <Ic n="shieldCheck" s={14} style={{ marginTop: 2, flexShrink: 0 }} />
          Yeh chat sirf aap aur admin ke beech private hai. User-to-user chat yahan nahi hai.
        </p>
        {!threads && <div className="spinner"></div>}
        {threads && threads.length === 0 && <Empty icon="headset" msg="Koi support request nahi — New Topic se shuru karo" />}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {threads?.map((t) => {
            const cat = CATEGORIES.find((c) => c.id === t.category) || CATEGORIES[0];
            return (
              <button key={t.id} className="card" style={{ textAlign: 'left', display: 'flex', gap: 10, alignItems: 'center' }}
                onClick={() => { setActive(t.id); sfx.click(); }}>
                <div style={{ width: 38, height: 38, borderRadius: 11, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--card-2)', color: 'var(--accent)', flexShrink: 0 }}>
                  <Ic n={cat.icon} s={18} />
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 800, fontSize: '0.9rem', overflow: 'hidden', textOverflow: 'ellipsis' }}>{t.subject}</div>
                  <div className="card-sub">{cat.label} · {timeAgo(t.last_at)}</div>
                </div>
                <span className={`badge ${t.status === 'open' ? 'badge-active' : 'badge-rejected'}`}>{t.status}</span>
              </button>
            );
          })}
        </div>

        {newTopic && (
          <div className="card" style={{ marginTop: 12 }}>
            <div className="card-title"><Ic n="plus" s={15} />New Support Topic</div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 12 }}>
              {CATEGORIES.map((c) => (
                <button key={c.id} className={`btn btn-sm ${category === c.id ? 'btn-primary' : 'btn-ghost'}`}
                  onClick={() => { setCategory(c.id); sfx.click(); }}>
                  <Ic n={c.icon} s={13} />{c.label}
                </button>
              ))}
            </div>
            <div className="form-group">
              <label>Subject</label>
              <input className="input" placeholder="e.g. Deposit approve nahi hua" value={subject}
                onChange={(e) => setSubject(e.target.value)} maxLength={80} />
            </div>
            <button className="btn btn-primary btn-block" onClick={createThread} disabled={busy}>
              <Ic n="send" s={15} />Send Request
            </button>
          </div>
        )}
      </div>
    );
  }

  const t = (threads || []).find((x) => x.id === active);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: 'calc(100vh - 220px)', minHeight: 380 }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 10 }}>
        <button className="icon-btn" onClick={() => { setActive(null); setMsgs(null); sfx.click(); }}><Ic n="arrowLeft" s={17} /></button>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 800, fontSize: '0.95rem', overflow: 'hidden', textOverflow: 'ellipsis' }}>{t?.subject}</div>
          <div className="card-sub">{t?.status === 'open' ? 'Open — admin reply karega' : 'Closed — reopen kar sakte ho'}</div>
        </div>
        <button className={`btn btn-sm ${t?.status === 'open' ? 'btn-ghost' : 'btn-success'}`} onClick={toggleClose}>
          {t?.status === 'open' ? 'Close' : 'Reopen'}
        </button>
      </div>
      <div ref={boxRef} style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 8, paddingRight: 4 }}>
        {!msgs && <div className="spinner"></div>}
        {msgs?.map((m) => (
          <div key={m.id} style={{ display: 'flex', justifyContent: m.from_admin ? 'flex-start' : 'flex-end' }}>
            <div style={{ maxWidth: '80%', padding: '8px 12px', borderRadius: m.from_admin ? '2px 12px 12px 12px' : '12px 2px 12px 12px',
              background: m.from_admin ? 'linear-gradient(135deg, rgba(124,108,255,0.18), rgba(124,108,255,0.08))' : 'var(--card-2)',
              border: '1px solid var(--border-solid)' }}>
              <div style={{ fontSize: '0.66rem', fontWeight: 800, color: m.from_admin ? 'var(--accent)' : 'var(--text-dim)', marginBottom: 3 }}>
                {m.from_admin ? 'ADMIN' : 'YOU'} · {timeAgo(m.created_at)}
              </div>
              <div style={{ fontSize: '0.88rem', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{m.body}</div>
            </div>
          </div>
        ))}
      </div>
      <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
        <input className="input" style={{ flex: 1 }} placeholder="Message likho…" value={text} maxLength={1000}
          onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && send()} />
        <button className="btn btn-primary" onClick={send} disabled={busy || !text.trim()}><Ic n="send" s={16} /></button>
      </div>
    </div>
  );
}
