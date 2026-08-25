import React, { useCallback, useEffect, useState } from 'react';
import { supabase, rpc } from '../../lib/supabase.js';
import { toast, Modal, Field, Empty, RankBadge, Confirm } from '../../components/ui.jsx';
import { Ic } from '../../lib/icons.jsx';
import { sfx } from '../../lib/sound.js';
import { fmtDT, timeAgo } from '../../lib/utils.js';

/* ================= CHAT MODERATION ================= */
export function ChatSection() {
  const [msgs, setMsgs] = useState(null);
  const [del, setDel] = useState(null);
  const [busy, setBusy] = useState(false);
  const [text, setText] = useState('');

  const load = useCallback(async () => {
    const { data } = await supabase.from('chats').select('*').order('created_at', { ascending: false }).limit(300);
    setMsgs(data || []);
  }, []);
  useEffect(() => { load(); const iv = setInterval(load, 10000); return () => clearInterval(iv); }, [load]);

  async function sendBroadcast() {
    const m = text.trim();
    if (!m) return;
    setBusy(true);
    const { error } = await rpc('send_chat', { p_message: m });
    setBusy(false);
    if (error) { sfx.error(); toast(error.message, 'error'); return; }
    sfx.cash();
    toast('Broadcast posted — users ko turant dikhega', 'success');
    setText('');
    load();
  }

  async function clearAll() {
    setBusy(true);
    try {
      await rpc('admin_action', { p_action: 'clear-chat' });
      sfx.cash(); toast('Chat cleared', 'success');
      load();
    } catch (e) { toast(e.message, 'error'); }
    finally { setBusy(false); }
  }

  return (
    <div>
      {/* One-way: sirf admin post kar sakta hai */}
      <div className="card" style={{ marginBottom: 14, background: 'linear-gradient(135deg, rgba(124,108,255,0.1), transparent)' }}>
        <div className="card-title"><Ic n="megaphone" s={17} />Post Broadcast (users ko live dikhega)</div>
        <div style={{ display: 'flex', gap: 8 }}>
          <input className="input" style={{ flex: 1 }} placeholder="e.g. Aaj raat 9 baje maintenance — sab bets safe hain"
            maxLength={500} value={text} onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && sendBroadcast()} />
          <button className="btn btn-primary" onClick={sendBroadcast} disabled={busy || !text.trim()}>
            <Ic n="send" s={15} />Post
          </button>
        </div>
        <p className="card-sub" style={{ marginTop: 8 }}>Users sirf read kar sakte hain — unki replies <b>Support Inbox</b> mein aati hain.</p>
      </div>

      <div style={{ display: 'flex', gap: 10, marginBottom: 14 }}>
        <button className="btn btn-ghost" onClick={load}><Ic n="refresh" s={15} />Refresh</button>
        <button className="btn btn-danger" onClick={() => setDel({ all: true })} disabled={busy}><Ic n="trash" s={15} />Clear Entire Chat</button>
      </div>
      {!msgs && <div className="spinner"></div>}
      {msgs && msgs.length === 0 && <Empty icon="chat" msg="Chat is empty — upar se pehla broadcast post karo" />}
      {msgs && msgs.length > 0 && (
        <div className="card">
          {msgs.map((m) => (
            <div key={m.id} style={{ display: 'flex', gap: 10, padding: '9px 0', borderBottom: '1px solid var(--border)', alignItems: 'flex-start' }}>
              <div className="chat-avatar" style={{ width: 32, height: 32, fontSize: '0.8rem', background: m.is_admin ? 'linear-gradient(135deg,#7c6cff,#00c896)' : '' }}>{(m.name || '?')[0].toUpperCase()}</div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 2, flexWrap: 'wrap' }}>
                  <b style={{ fontSize: '0.86rem', color: m.is_admin ? 'var(--accent)' : '' }}>{m.is_admin ? 'ADMIN' : m.name}</b>
                  {m.is_admin && <span className="badge badge-active"><Ic n="shieldCheck" s={10} />official</span>}
                  {!m.is_admin && <RankBadge rank={m.rank} small />}
                  <span style={{ color: 'var(--text-dim)', fontSize: '0.72rem' }}>{timeAgo(m.created_at)} · UID {m.uid.slice(0, 6)}</span>
                </div>
                <div style={{ fontSize: '0.9rem', wordBreak: 'break-word' }}>{m.message}</div>
              </div>
              <button className="btn btn-ghost btn-sm" onClick={() => setDel({ msg: m })}><Ic n="trash" s={14} /></button>
            </div>
          ))}
        </div>
      )}

      {del?.msg && (
        <Confirm title="Delete message?" icon="trash" msg={`"${del.msg.message}"`}
          onNo={() => setDel(null)}
          onYes={async () => {
            try {
              await rpc('admin_action', { p_action: 'delete-chat', p_params: { id: del.msg.id } });
              sfx.cash(); toast('Message deleted', 'success'); load();
            } catch (e) { toast(e.message, 'error'); }
            setDel(null);
          }} />
      )}
      {del?.all && (
        <Confirm title="Clear entire chat?" icon="alert" msg="ALL messages from ALL users will be deleted. This is public and immediate."
          onNo={() => setDel(null)}
          onYes={async () => { await clearAll(); setDel(null); }} />
      )}
    </div>
  );
}

/* ================= ANNOUNCEMENTS + BROADCAST ================= */
export function AnnouncementsSection() {
  const [rows, setRows] = useState(null);
  const [form, setForm] = useState({ title: '', body: '', priority: 'info' });
  const [edit, setEdit] = useState(null);
  const [del, setDel] = useState(null);
  const [bc, setBc] = useState(false);
  const [bcForm, setBcForm] = useState({ title: '', body: '' });
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const { data } = await supabase.from('announcements').select('*').order('created_at', { ascending: false }).limit(100);
    setRows(data || []);
  }, []);
  useEffect(() => { load(); }, [load]);

  async function act(action, params, okMsg) {
    setBusy(true);
    try {
      await rpc('admin_action', { p_action: action, p_params: params });
      sfx.cash(); toast(okMsg, 'success');
      load();
    } catch (e) { sfx.error(); toast(e.message, 'error'); }
    finally { setBusy(false); }
  }

  function submitNew() {
    if (!form.title.trim() || !form.body.trim()) { toast('Title and message required', 'error'); return; }
    act('add-announcement', { ...form }, 'Announcement published');
    setForm({ title: '', body: '', priority: 'info' });
  }

  return (
    <div>
      <div className="card" style={{ marginBottom: 14 }}>
        <div className="card-title"><Ic n="megaphone" s={17} />New Announcement (shows to all users)</div>
        <div style={{ display: 'grid', gridTemplateColumns: '2fr 3fr 1fr auto', gap: 10, alignItems: 'end' }}>
          <Field label="Title">
            <input className="input" placeholder="e.g. Happy Weekend!" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
          </Field>
          <Field label="Message">
            <input className="input" placeholder="Announcement text…" value={form.body} onChange={(e) => setForm({ ...form, body: e.target.value })} />
          </Field>
          <Field label="Type">
            <select className="input" value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value })}>
              <option value="info">Info</option>
              <option value="success">Success</option>
              <option value="warning">Warning</option>
            </select>
          </Field>
          <button className="btn btn-primary" onClick={submitNew} disabled={busy}><Ic n="send" s={15} />Publish</button>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 14, display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: 240 }}>
          <div className="s-label" style={{ fontWeight: 800, display: 'flex', gap: 7, alignItems: 'center' }}><Ic n="bell" s={16} />Push Notification (all users)</div>
          <div className="s-desc" style={{ fontSize: '0.78rem' }}>Instant bell notification on every user's app</div>
        </div>
        <button className="btn btn-primary" onClick={() => { setBc(true); sfx.click(); }}><Ic n="send" s={15} />Compose Broadcast</button>
      </div>

      {!rows && <div className="spinner"></div>}
      {rows && rows.length === 0 && <Empty icon="megaphone" msg="No announcements yet" />}
      {rows && rows.length > 0 && (
        <div className="card">
          {rows.map((a) => (
            <div key={a.id} style={{ display: 'flex', gap: 10, alignItems: 'center', padding: '10px 0', borderBottom: '1px solid var(--border)' }}>
              <Ic n="megaphone" s={17} style={{ color: a.priority === 'warning' ? 'var(--warning)' : a.priority === 'success' ? 'var(--success)' : 'var(--info)' }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <b style={{ fontSize: '0.9rem' }}>{a.title}</b>
                <div style={{ color: 'var(--text-dim)', fontSize: '0.82rem' }}>{a.body}</div>
                <div style={{ color: 'var(--text-dim)', fontSize: '0.72rem', marginTop: 2 }}>{fmtDT(a.created_at)}</div>
              </div>
              <span className={`badge ${a.active ? 'badge-active' : 'badge-blocked'}`}>{a.active ? 'active' : 'hidden'}</span>
              <button className="btn btn-ghost btn-sm" onClick={() => setEdit({ ...a })}><Ic n="pencil" s={14} /></button>
              <button className="btn btn-ghost btn-sm" onClick={() => setDel(a)}><Ic n="trash" s={14} /></button>
            </div>
          ))}
        </div>
      )}

      {edit && (
        <Modal title="Edit Announcement" icon="pencil" onClose={() => setEdit(null)}
          footer={<>
            <button className="btn btn-ghost" onClick={() => setEdit(null)}>Cancel</button>
            <button className="btn btn-primary" disabled={busy}
              onClick={async () => { await act('update-announcement', { id: edit.id, title: edit.title, body: edit.body, priority: edit.priority, active: !edit.active }, 'Announcement updated'); setEdit(null); }}>
              <Ic n="check" s={15} />{edit.active ? 'Hide' : 'Show'} + Save
            </button>
          </>}>
          <Field label="Title">
            <input className="input" value={edit.title} onChange={(e) => setEdit({ ...edit, title: e.target.value })} />
          </Field>
          <Field label="Message">
            <textarea className="input" value={edit.body} onChange={(e) => setEdit({ ...edit, body: e.target.value })} />
          </Field>
          <Field label="Type">
            <select className="input" value={edit.priority} onChange={(e) => setEdit({ ...edit, priority: e.target.value })}>
              <option value="info">Info</option>
              <option value="success">Success</option>
              <option value="warning">Warning</option>
            </select>
          </Field>
        </Modal>
      )}

      {bc && (
        <Modal title="Broadcast Notification" icon="bell" onClose={() => setBc(false)}
          footer={<>
            <button className="btn btn-ghost" onClick={() => setBc(false)}>Cancel</button>
            <button className="btn btn-primary" disabled={busy}
              onClick={async () => {
                if (!bcForm.title.trim()) { toast('Title required', 'error'); return; }
                await act('broadcast', { title: bcForm.title, body: bcForm.body }, 'Broadcast sent to all users');
                setBc(false); setBcForm({ title: '', body: '' });
              }}>
              <Ic n="send" s={15} />Send to Everyone
            </button>
          </>}>
          <Field label="Title">
            <input className="input" placeholder="e.g. Big Update!" value={bcForm.title} onChange={(e) => setBcForm({ ...bcForm, title: e.target.value })} />
          </Field>
          <Field label="Message">
            <textarea className="input" placeholder="Notification text…" value={bcForm.body} onChange={(e) => setBcForm({ ...bcForm, body: e.target.value })} />
          </Field>
        </Modal>
      )}

      {del && (
        <Confirm title="Delete announcement?" icon="trash" msg={`"${del.title}" will be removed for all users.`}
          onNo={() => setDel(null)}
          onYes={async () => { await act('delete-announcement', { id: del.id }, 'Announcement deleted'); setDel(null); }} />
      )}
    </div>
  );
}
