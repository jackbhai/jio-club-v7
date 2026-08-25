import React, { useCallback, useEffect, useRef, useState } from 'react';
import { supabase, rpc } from '../../lib/supabase.js';
import { toast, Empty } from '../../components/ui.jsx';
import { Ic } from '../../lib/icons.jsx';
import { sfx } from '../../lib/sound.js';
import { timeAgo } from '../../lib/utils.js';
import { cx } from '../../lib/utils.js';

const CATEGORIES = {
  general: { label: 'General', ico: 'chat' },
  deposit: { label: 'Deposit', ico: 'arrowDown' },
  withdrawal: { label: 'Withdrawal', ico: 'arrowUp' },
  bet: { label: 'Bet Dispute', ico: 'target' },
  account: { label: 'Account', ico: 'user' },
  technical: { label: 'Technical', ico: 'wrench' }
};

export default function SupportInbox() {
  const [threads, setThreads] = useState(null);
  const [active, setActive] = useState(null);
  const [msgs, setMsgs] = useState(null);
  const [text, setText] = useState('');
  const [filter, setFilter] = useState('all');
  const [busy, setBusy] = useState(false);
  const boxRef = useRef(null);

  const load = useCallback(async () => {
    try {
      const d = await rpc('support_threads_list');
      setThreads(d || []);
    } catch (e) { setThreads([]); }
  }, []);
  useEffect(() => { load(); const iv = setInterval(load, 12000); return () => clearInterval(iv); }, [load]);

  useEffect(() => {
    if (!active) return;
    let alive = true;
    const loadMsgs = () => rpc('support_messages', { p_thread_id: active }).then((d) => alive && setMsgs(d || [])).catch(() => {});
    loadMsgs();
    const ch = supabase.channel('admin-support-rt-' + active)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'support_messages', filter: `thread_id=eq.${active}` }, () => loadMsgs())
      .subscribe();
    return () => { alive = false; supabase.removeChannel(ch); };
  }, [active]);

  useEffect(() => {
    boxRef.current?.scrollTo({ top: boxRef.current.scrollHeight, behavior: 'smooth' });
  }, [msgs]);

  const list = (threads || []).filter((t) => filter === 'all' || t.status === filter);
  const openCount = (threads || []).filter((t) => t.status === 'open').length;

  async function reply() {
    const m = text.trim();
    if (!m || !active) return;
    setBusy(true);
    try {
      await rpc('support_send', { p_thread_id: active, p_body: m });
      setText('');
      const d = await rpc('support_messages', { p_thread_id: active });
      setMsgs(d || []);
      load();
    } catch (e) { sfx.error(); toast(e.message, 'error'); }
    finally { setBusy(false); }
  }

  async function toggleClose() {
    const t = (threads || []).find((x) => x.id === active);
    if (!t) return;
    await rpc('support_close', { p_thread_id: active, p_closed: t.status !== 'closed' }).catch(() => {});
    sfx.click();
    load();
  }

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '320px 1fr', gap: 14, height: 'calc(100vh - 150px)', minHeight: 420 }}>
      {/* Thread list */}
      <div className="card" style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <div className="card-title" style={{ marginBottom: 8 }}><Ic n="inbox" s={17} />Inbox <span className="badge badge-pending">{openCount} open</span></div>
        <div style={{ display: 'flex', gap: 5, marginBottom: 10 }}>
          {[['all', 'All'], ['open', 'Open'], ['closed', 'Closed']].map(([id, label]) => (
            <button key={id} className={`tab ${filter === id ? 'active' : ''}`} style={{ padding: '5px 10px', fontSize: '0.78rem' }} onClick={() => setFilter(id)}>{label}</button>
          ))}
        </div>
        <div style={{ flex: 1, overflowY: 'auto' }}>
          {!threads && <div className="spinner"></div>}
          {threads && list.length === 0 && <Empty icon="inbox" msg="Inbox khali hai" />}
          {list?.map((t) => {
            const cat = CATEGORIES[t.category] || CATEGORIES.general;
            return (
              <button key={t.id}
                className={cx('card', active === t.id && 'active')}
                style={{ width: '100%', textAlign: 'left', marginBottom: 8, cursor: 'pointer',
                  border: active === t.id ? '1px solid var(--accent)' : '1px solid var(--border-solid)',
                  background: active === t.id ? 'rgba(124,108,255,0.08)' : 'var(--card-2)' }}
                onClick={() => { setActive(t.id); setMsgs(null); sfx.click(); }}>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <div style={{ width: 30, height: 30, borderRadius: 9, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--card)', color: 'var(--accent)', flexShrink: 0 }}>
                    <Ic n={cat.ico} s={15} />
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 800, fontSize: '0.85rem', overflow: 'hidden', textOverflow: 'ellipsis' }}>{t.subject}</div>
                    <div className="card-sub" style={{ fontSize: '0.72rem' }}>{t.user_email} · {timeAgo(t.last_at)}</div>
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 5, marginTop: 6 }}>
                  <span className={`badge ${t.status === 'open' ? 'badge-active' : 'badge-rejected'}`}>{t.status}</span>
                  <span className="badge badge-pending">{cat.label}</span>
                  <span className="card-sub" style={{ fontSize: '0.7rem', marginLeft: 'auto' }}>{t.user_msgs || 0} user / {t.admin_msgs || 0} admin</span>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Conversation */}
      <div className="card" style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        {!active ? (
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Empty icon="headset" msg="Left se ek thread select karo" />
          </div>
        ) : (
          <>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', paddingBottom: 10, borderBottom: '1px solid var(--border-solid)' }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 800 }}>{(threads || []).find((x) => x.id === active)?.subject}</div>
                <div className="card-sub">{(threads || []).find((x) => x.id === active)?.user_email} · ticket {(active || '').slice(0, 8)}</div>
              </div>
              <button className={`btn btn-sm ${(threads || []).find((x) => x.id === active)?.status === 'open' ? 'btn-ghost' : 'btn-success'}`} onClick={toggleClose}>
                {(threads || []).find((x) => x.id === active)?.status === 'open' ? 'Close Ticket' : 'Reopen'}
              </button>
            </div>
            <div ref={boxRef} style={{ flex: 1, overflowY: 'auto', padding: '12px 4px', display: 'flex', flexDirection: 'column', gap: 8 }}>
              {!msgs && <div className="spinner"></div>}
              {msgs?.map((m) => (
                <div key={m.id} style={{ display: 'flex', justifyContent: m.from_admin ? 'flex-end' : 'flex-start' }}>
                  <div style={{ maxWidth: '75%', padding: '8px 12px', borderRadius: m.from_admin ? '12px 2px 12px 12px' : '2px 12px 12px 12px',
                    background: m.from_admin ? 'linear-gradient(135deg, rgba(124,108,255,0.25), rgba(124,108,255,0.1))' : 'var(--card-2)',
                    border: '1px solid var(--border-solid)' }}>
                    <div style={{ fontSize: '0.66rem', fontWeight: 800, color: m.from_admin ? 'var(--accent)' : 'var(--text-dim)', marginBottom: 3 }}>
                      {m.from_admin ? 'YOU (ADMIN)' : (m.sender_email || 'user').toUpperCase()} · {timeAgo(m.created_at)}
                    </div>
                    <div style={{ fontSize: '0.88rem', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{m.body}</div>
                  </div>
                </div>
              ))}
            </div>
            <div style={{ display: 'flex', gap: 8, paddingTop: 10 }}>
              <input className="input" style={{ flex: 1 }} placeholder="Reply karo… (user ko turant dikhega)" value={text} maxLength={1000}
                onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && reply()} />
              <button className="btn btn-primary" onClick={reply} disabled={busy || !text.trim()}><Ic n="send" s={15} />Reply</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
