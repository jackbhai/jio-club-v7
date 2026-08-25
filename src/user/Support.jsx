import React, { useEffect, useRef, useState } from 'react';
import { supabase, rpc } from '../lib/supabase.js';
import { toast, Empty } from '../components/ui.jsx';
import { Ic } from '../lib/icons.jsx';
import { sfx } from '../lib/sound.js';
import { t, useT } from '../lib/i18n.js';
import { money, timeAgo, fmtDT } from '../lib/utils.js';

const CATS = [
  { id: 'general', label: 'General', ico: 'chat' },
  { id: 'deposit', label: 'Deposit', ico: 'arrowDown' },
  { id: 'withdrawal', label: 'Withdrawal', ico: 'arrowUp' },
  { id: 'bet', label: 'Bet Dispute', ico: 'target' },
  { id: 'account', label: 'Account', ico: 'user' },
  { id: 'technical', label: 'Technical', ico: 'wrench' }
];

export default function Support({ user, reportBet, onReportDone }) {
  const t = useT();
  const [threads, setThreads] = useState(null);
  const [active, setActive] = useState(null);
  const [msgs, setMsgs] = useState(null);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [subject, setSubject] = useState('');
  const [cat, setCat] = useState('general');
  const [reportInfo, setReportInfo] = useState(null);
  const boxRef = useRef(null);

  const loadThreads = () =>
    rpc('support_threads_list').then((d) => setThreads(d || [])).catch(() => setThreads([]));

  useEffect(() => { loadThreads(); const iv = setInterval(loadThreads, 20000); return () => clearInterval(iv); }, []);

  // Prefill from "Report Issue" (My Bets)
  useEffect(() => {
    if (reportBet) {
      setShowNew(true);
      setCat('bet');
      setSubject(`Bet Issue: BET-${reportBet.id} (period ${reportBet.period_id})`);
      setReportInfo({
        subject: `Bet ${reportBet.type} ${reportBet.selection} · ${money(reportBet.amount)} · Period ${reportBet.period_id} · Result: ${reportBet.result} · ${fmtDT(reportBet.created_at)}`,
        body: `Report issue for bet BET-${reportBet.id}:\nType: ${reportBet.type}\nSelection: ${reportBet.selection}\nAmount: ${money(reportBet.amount)}\nPeriod: ${reportBet.period_id}\nResult: ${reportBet.result}\nWin Amount: ${money(reportBet.win_amount)}\nPlaced: ${fmtDT(reportBet.created_at)}\n\nIssue:`
      });
    }
  }, [reportBet]);

  useEffect(() => {
    if (!active) { setMsgs(null); return; }
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
    if (!m || !active) return;
    setBusy(true);
    const { error } = await rpc('support_send', { p_thread_id: active, p_body: m });
    setBusy(false);
    if (error) { sfx.error(); toast(error.message, 'error'); return; }
    sfx.click();
    setText('');
  }

  async function createTicket() {
    if (!subject.trim()) { toast(t('support.subject') + ' required', 'error'); return; }
    setBusy(true);
    const body = reportInfo ? reportInfo.body : (subject.trim() + '\n\n');
    const { data, error } = await rpc('support_send', { p_thread_id: null, p_subject: subject.trim(), p_category: cat, p_body: body.slice(0, 1000) });
    setBusy(false);
    if (error) { sfx.error(); toast(error.message, 'error'); return; }
    sfx.cash();
    toast(t('support.ticket_opened'), 'success');
    if (onReportDone) onReportDone();
    setReportInfo(null);
    setShowNew(false);
    setSubject('');
    setCat('general');
    loadThreads();
    setActive(data.threadId);
  }

  // ---------- Conversation view ----------
  if (active) {
    const th = (threads || []).find((x) => x.id === active);
    return (
      <div style={{ display: 'flex', flexDirection: 'column', height: 'calc(100vh - 200px)', minHeight: 380 }}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 10 }}>
          <button className="icon-btn" onClick={() => { setActive(null); sfx.click(); }}><Ic n="arrowLeft" s={16} /></button>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: 900, fontSize: '0.92rem', overflow: 'hidden', textOverflow: 'ellipsis' }}>{th?.subject}</div>
            <div className="card-sub" style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <span className={`badge ${th?.status === 'open' ? 'badge-active' : 'badge-rejected'}`}>{th?.status}</span>
              {t('support.private')}
            </div>
          </div>
          {th?.status === 'open' && (
            <button className="btn btn-ghost btn-sm" onClick={async () => {
              await rpc('support_close', { p_thread_id: active, p_closed: true }).catch(() => {});
              loadThreads();
            }}><Ic n="check" s={13} />Close</button>
          )}
        </div>
        <div ref={boxRef} style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 8, paddingRight: 4 }}>
          {!msgs && <div className="spinner"></div>}
          {msgs?.length === 0 && <Empty icon="chat" msg="No messages" />}
          {msgs?.map((m) => (
            <div key={m.id} style={{ display: 'flex', justifyContent: m.from_admin ? 'flex-start' : 'flex-end' }}>
              <div style={{ maxWidth: '82%', padding: '8px 12px', borderRadius: m.from_admin ? '2px 14px 14px 14px' : '14px 2px 14px 14px',
                background: m.from_admin ? 'linear-gradient(135deg, rgba(124,108,255,0.2), rgba(124,108,255,0.08))' : 'var(--card-2)',
                border: '1px solid var(--border-solid)' }}>
                <div style={{ fontSize: '0.66rem', fontWeight: 800, color: m.from_admin ? 'var(--accent)' : 'var(--text-dim)', marginBottom: 3 }}>
                  {m.from_admin ? 'ADMIN' : t('nav.profile')} · {timeAgo(m.created_at)}
                </div>
                <div style={{ fontSize: '0.88rem', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{m.body}</div>
              </div>
            </div>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
          <input className="input" style={{ flex: 1 }} placeholder={t('support.send_reply')} value={text} maxLength={1000}
            onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && send()} />
          <button className="btn btn-primary" onClick={send} disabled={busy || !text.trim()}><Ic n="send" s={16} /></button>
        </div>
      </div>
    );
  }

  // ---------- Ticket list view ----------
  return (
    <div>
      <div className="card" style={{ marginBottom: 12, display: 'flex', gap: 10, alignItems: 'center' }}>
        <div style={{ width: 40, height: 40, borderRadius: 12, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(124,108,255,0.12)', color: 'var(--accent)' }}>
          <Ic n="headset" s={20} />
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 900 }}>{t('support.title')}</div>
          <div className="card-sub">{t('support.private')}</div>
        </div>
        <button className="btn btn-primary btn-sm" onClick={() => { setShowNew(!showNew); setReportInfo(null); sfx.click(); }}>
          <Ic n="plus" s={14} />{t('support.new_ticket')}
        </button>
      </div>

      {showNew && (
        <div className="card" style={{ marginBottom: 12 }}>
          <div className="card-title"><Ic n="plus" s={15} />{t('support.new_ticket')}</div>
          {reportInfo && (
            <div style={{ background: 'rgba(124,108,255,0.08)', border: '1px solid rgba(124,108,255,0.3)', borderRadius: 10, padding: 10, marginBottom: 10 }}>
              <div style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: '0.78rem', fontWeight: 800, color: 'var(--accent)' }}>
                <Ic n="file" s={13} />{t('support.reported')}
              </div>
              <div style={{ fontSize: '0.76rem', color: 'var(--text-dim)', marginTop: 4, whiteSpace: 'pre-wrap' }}>{reportInfo.subject}</div>
            </div>
          )}
          <div className="form-group">
            <label>{t('support.category')}</label>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {CATS.map((c) => (
                <button key={c.id} className={`btn btn-sm ${cat === c.id ? 'btn-primary' : 'btn-ghost'}`} onClick={() => { setCat(c.id); sfx.click(); }}>
                  <Ic n={c.ico} s={13} />{c.label}
                </button>
              ))}
            </div>
          </div>
          <div className="form-group">
            <label>{t('support.subject')}</label>
            <input className="input" placeholder={t('support.subject')} value={subject} onChange={(e) => setSubject(e.target.value)} maxLength={100} />
          </div>
          <button className="btn btn-primary btn-block" onClick={createTicket} disabled={busy}>
            <Ic n="send" s={15} />{t('support.send')}
          </button>
        </div>
      )}

      {!threads && <div className="spinner"></div>}
      {threads && threads.length === 0 && !showNew && <Empty icon="headset" msg={t('support.no_tickets')} />}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {threads?.map((th) => {
          const c = CATS.find((x) => x.id === th.category) || CATS[0];
          return (
            <button key={th.id} className="card" style={{ textAlign: 'left', display: 'flex', gap: 10, alignItems: 'center' }}
              onClick={() => { setActive(th.id); sfx.click(); }}>
              <div style={{ width: 36, height: 36, borderRadius: 10, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--card-2)', color: 'var(--accent)', flexShrink: 0 }}>
                <Ic n={c.ico} s={17} />
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 800, fontSize: '0.88rem', overflow: 'hidden', textOverflow: 'ellipsis' }}>{th.subject}</div>
                <div className="card-sub" style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                  <span className={`badge ${th.status === 'open' ? 'badge-active' : 'badge-rejected'}`}>{th.status}</span>
                  <span>{timeAgo(th.last_at)}</span>
                </div>
              </div>
              <Ic n="chevronRight" s={16} style={{ color: 'var(--text-dim)' }} />
            </button>
          );
        })}
      </div>
    </div>
  );
}
