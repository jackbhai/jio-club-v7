import React, { useCallback, useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase.js';
import { toast, Field, Toggle, Modal, Confirm, Empty } from '../../components/ui.jsx';
import { Ic } from '../../lib/icons.jsx';
import { sfx } from '../../lib/sound.js';

/* ============ shared settings loader ============ */
function useSettings() {
  const [data, setData] = useState(null);
  const load = useCallback(async () => {
    const { data: rows } = await supabase.from('settings').select('key, value');
    const d = {};
    rows?.forEach((r) => { d[r.key] = r.value || {}; });
    setData(d);
  }, []);
  useEffect(() => { load(); }, [load]);
  const set = (key, patch) => setData((d) => ({ ...d, [key]: { ...d[key], ...patch } }));
  const save = async (key, msg) => {
    const clean = Object.fromEntries(Object.entries(data[key] || {}).filter(([k, v]) => k !== 'undefined' && v !== undefined));
    const { error } = await supabase.from('settings').upsert({ key, value: clean }, { onConflict: 'key' });
    if (error) { sfx.error(); toast(error.message, 'error'); return false; }
    sfx.cash(); toast(msg || `Saved ${key}`, 'success');
    return true;
  };
  return { data, set, save, load };
}

function Shell({ icon, title, sub, children, saveBtn }) {
  return (
    <div className="card page-enter">
      <div className="card-title"><Ic n={icon} s={18} />{title}</div>
      {sub && <p className="card-sub" style={{ marginBottom: 12 }}>{sub}</p>}
      {children}
      {saveBtn}
    </div>
  );
}

const Row = ({ label, desc, children }) => (
  <div className="setting-row">
    <div><div className="s-label">{label}</div>{desc && <div className="s-desc">{desc}</div>}</div>
    <div className="s-ctrl">{children}</div>
  </div>
);
const NumRow = ({ label, desc, value, onChange, step = 1, min = 0 }) => (
  <Row label={label} desc={desc}>
    <input className="input" type="number" step={step} min={min} value={value ?? ''} onChange={(e) => onChange(e.target.value === '' ? null : Number(e.target.value))} />
  </Row>
);
const SaveBtn = ({ onClick, disabled }) => (
  <button className="btn btn-primary" style={{ marginTop: 14 }} onClick={onClick} disabled={disabled}>
    <Ic n="check" s={15} />Save
  </button>
);

/* ============ 1. FEATURES (1:1 user-panel control) ============ */
export function FeaturesSection() {
  const { data, set, save } = useSettings();
  if (!data) return <div className="spinner"></div>;
  const f = data.features || {};
  return (
    <Shell icon="toggle" title="Features — 1:1 User Panel Control" sub="Yahan on/off karo — user panel mein turant reflect (realtime).">
      <Row label="Deposit" desc="UPI deposit, QR, screenshots, UTR"><Toggle checked={f.deposit !== false} onChange={(v) => set('features', { deposit: v })} /></Row>
      <Row label="Withdrawal" desc="Withdrawal requests"><Toggle checked={f.withdraw !== false} onChange={(v) => set('features', { withdraw: v })} /></Row>
      <Row label="Coupons" desc="Coupon claim box in wallet"><Toggle checked={f.coupons !== false} onChange={(v) => set('features', { coupons: v })} /></Row>
      <Row label="Referral System" desc="Referral links + rank dashboard"><Toggle checked={f.referral !== false} onChange={(v) => set('features', { referral: v })} /></Row>
      <SaveBtn onClick={() => save('features', 'Features saved — user panel updated')} />
    </Shell>
  );
}

/* ============ 2. PAYOUTS ============ */
export function PayoutsSection() {
  const { data, set, save } = useSettings();
  if (!data) return <div className="spinner"></div>;
  const p = data.payouts || {};
  return (
    <Shell icon="percent" title="Payouts" sub="Har bet type ka multiplier. House edge inhi se adjust hoti hai.">
      <NumRow label="Green (×)" value={p.green} onChange={(v) => set('payouts', { green: v })} step="0.5" />
      <NumRow label="Red (×)" value={p.red} onChange={(v) => set('payouts', { red: v })} step="0.5" />
      <NumRow label="Violet (×)" value={p.violet} onChange={(v) => set('payouts', { violet: v })} step="0.5" />
      <NumRow label="Number (×)" value={p.number} onChange={(v) => set('payouts', { number: v })} step="0.5" />
      <NumRow label="Big/Small (×)" value={p.size} onChange={(v) => set('payouts', { size: v })} step="0.5" />
      <SaveBtn onClick={() => save('payouts', 'Payouts saved — live')} />
    </Shell>
  );
}

/* ============ 3. WALLET ============ */
export function WalletSection() {
  const { data, set, save } = useSettings();
  if (!data) return <div className="spinner"></div>;
  const w = data.wallet || {};
  return (
    <Shell icon="wallet" title="Wallet Settings">
      <NumRow label="Minimum Deposit (₹)" value={w.minDeposit} onChange={(v) => set('wallet', { minDeposit: v })} />
      <NumRow label="Minimum Withdrawal (₹)" value={w.minWithdrawal} onChange={(v) => set('wallet', { minWithdrawal: v })} />
      <NumRow label="Maximum Withdrawal (₹)" value={w.maxWithdrawal} onChange={(v) => set('wallet', { maxWithdrawal: v })} />
      <NumRow label="Welcome Bonus (₹, once)" value={w.welcomeBonus} onChange={(v) => set('wallet', { welcomeBonus: v })} />
      <NumRow label="Daily Bet Limit per user (₹)" desc="0 = unlimited · server enforced" value={w.dailyBetLimit ?? 0} onChange={(v) => set('wallet', { dailyBetLimit: v })} />
      <SaveBtn onClick={() => save('wallet', 'Wallet settings saved')} />
    </Shell>
  );
}

/* ============ 4. UPI ACCOUNTS (multi-UPI manager) ============ */
const UPI_ICO = 'upi';
export function UpiSection() {
  const { data } = useSettings();
  const [rows, setRows] = useState(null);
  const [edit, setEdit] = useState(null);
  const [del, setDel] = useState(null);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ label: '', upi_id: '', holder_name: '', status: 'active', is_default: false, sort_order: 0 });

  const load = useCallback(async () => {
    const { data: r } = await supabase.from('upi_accounts').select('*').order('sort_order');
    setRows(r || []);
  }, []);
  useEffect(() => { load(); }, [load]);

  async function act(fn, okMsg) {
    setBusy(true);
    try { await fn(); sfx.cash(); toast(okMsg, 'success'); load(); }
    catch (e) { sfx.error(); toast(e.message, 'error'); }
    finally { setBusy(false); }
  }

  function openNew() { setForm({ label: '', upi_id: '', holder_name: '', status: 'active', is_default: rows?.length === 0, sort_order: rows?.length || 0 }); setEdit({}); }
  function openEdit(a) { setForm({ ...a }); setEdit(a.id); }

  async function submit() {
    if (!form.label.trim() || !form.upi_id.trim()) { toast('Label aur UPI ID required', 'error'); return; }
    const payload = { ...form, label: form.label.trim(), upi_id: form.upi_id.trim(), holder_name: form.holder_name?.trim() || '' };
    if (edit) {
      await act(async () => {
        const { error } = await supabase.from('upi_accounts').update(payload).eq('id', edit);
        if (error) throw new Error(error.message);
      }, 'UPI account updated');
    } else {
      await act(async () => {
        const { error } = await supabase.from('upi_accounts').insert(payload);
        if (error) throw new Error(error.message);
      }, 'UPI account added');
    }
    setEdit(null);
  }

  async function move(a, dir) {
    const sorted = [...rows].sort((x, y) => x.sort_order - y.sort_order);
    const i = sorted.findIndex((x) => x.id === a.id);
    const j = i + dir;
    if (j < 0 || j >= sorted.length) return;
    const aSo = sorted[i].sort_order, bSo = sorted[j].sort_order;
    await act(async () => {
      await supabase.from('upi_accounts').update({ sort_order: bSo }).eq('id', sorted[i].id);
      await supabase.from('upi_accounts').update({ sort_order: aSo }).eq('id', sorted[j].id);
    }, 'Order updated');
  }

  async function makeDefault(a) {
    await act(async () => {
      await supabase.from('upi_accounts').update({ is_default: false }).neq('id', a.id);
      await supabase.from('upi_accounts').update({ is_default: true }).eq('id', a.id);
    }, 'Default UPI changed');
  }

  const sorted = [...(rows || [])].sort((x, y) => x.sort_order - y.sort_order);

  return (
    <div className="page-enter">
      <div className="card">
        <div className="card-title" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ display: 'flex', gap: 8, alignItems: 'center' }}><Ic n={UPI_ICO} s={18} />UPI Accounts (Multi-Payment)</span>
          <button className="btn btn-primary btn-sm" onClick={openNew}><Ic n="plus" s={14} />Add</button>
        </div>
        <p className="card-sub" style={{ marginBottom: 12 }}>
          Users ko sirf <b>active</b> accounts dikhte hain (deposit page pe selector). Default wala pehle select hota hai.
        </p>
        {!rows && <div className="spinner"></div>}
        {rows && rows.length === 0 && <Empty icon={UPI_ICO} msg="Koi UPI account nahi — Add se shuru karo" />}
        {sorted.map((a, i) => (
          <div key={a.id} style={{ display: 'flex', gap: 10, alignItems: 'center', padding: '10px 0', borderBottom: '1px solid var(--border)' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              <button className="icon-btn" style={{ width: 28, height: 28 }} onClick={() => move(a, -1)} disabled={i === 0}><Ic n="chevronDown" s={13} style={{ transform: 'rotate(180deg)' }} /></button>
              <button className="icon-btn" style={{ width: 28, height: 28 }} onClick={() => move(a, 1)} disabled={i === sorted.length - 1}><Ic n="chevronDown" s={13} /></button>
            </div>
            <div style={{ width: 34, height: 34, borderRadius: 10, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--card-2)', color: 'var(--accent)', flexShrink: 0 }}>
              <Ic n={UPI_ICO} s={17} />
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 800, fontSize: '0.9rem', display: 'flex', gap: 6, alignItems: 'center' }}>
                {a.label}
                {a.is_default && <span className="badge badge-active">DEFAULT</span>}
              </div>
              <div className="card-sub" style={{ fontFamily: 'monospace' }}>{a.upi_id}{a.holder_name ? ` · ${a.holder_name}` : ''}</div>
            </div>
            <span className={`badge ${a.status === 'active' ? 'badge-active' : a.status === 'paused' ? 'badge-pending' : 'badge-rejected'}`}>{a.status}</span>
            <button className="btn btn-ghost btn-sm" onClick={() => makeDefault(a)} disabled={a.is_default}><Ic n="star" s={13} /></button>
            <button className="btn btn-ghost btn-sm" onClick={() => openEdit(a)}><Ic n="pencil" s={13} /></button>
            <button className="btn btn-ghost btn-sm" onClick={() => setDel(a)}><Ic n="trash" s={13} /></button>
          </div>
        ))}
      </div>

      {edit !== null && (
        <Modal title={edit ? 'Edit UPI Account' : 'New UPI Account'} icon={UPI_ICO} onClose={() => setEdit(null)}
          footer={<>
            <button className="btn btn-ghost" onClick={() => setEdit(null)}>Cancel</button>
            <button className="btn btn-primary" onClick={submit} disabled={busy}><Ic n="check" s={15} />Save</button>
          </>}>
          <Field label="Label (user ko dikhega)"><input className="input" placeholder="e.g. Primary / Mom's A/C" value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} /></Field>
          <Field label="UPI ID"><input className="input" placeholder="yourname@upi" value={form.upi_id} onChange={(e) => setForm({ ...form, upi_id: e.target.value })} /></Field>
          <Field label="Holder Name (optional)"><input className="input" value={form.holder_name} onChange={(e) => setForm({ ...form, holder_name: e.target.value })} /></Field>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
            <Field label="Status">
              <select className="input" value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}>
                <option value="active">active</option><option value="paused">paused</option><option value="archived">archived</option>
              </select>
            </Field>
            <div style={{ paddingTop: 18 }}><Toggle checked={!!form.is_default} onChange={(v) => setForm({ ...form, is_default: v })} /></div>
          </div>
          <p className="card-sub">Checkbox = Default account</p>
        </Modal>
      )}

      {del && (
        <Confirm title="Delete UPI account?" msg={`${del.label} (${del.upi_id}) delete hoga. Purani deposits ke records impact nahi honge.`}
          onNo={() => setDel(null)}
          onYes={async () => {
            setBusy(true);
            const { error } = await supabase.from('upi_accounts').delete().eq('id', del.id);
            setBusy(false);
            if (error) toast(error.message, 'error'); else { sfx.cash(); toast('Deleted', 'success'); load(); }
            setDel(null);
          }} />
      )}
    </div>
  );
}

/* ============ 5. PAYMENTS (Razorpay dual keys + mode) ============ */
export function PaymentsSection() {
  const { data, set, save } = useSettings();
  const [confirmLive, setConfirmLive] = useState(false);
  if (!data) return <div className="spinner"></div>;
  const p = data.payments || {};
  const isLive = p.env === 'live';

  return (
    <Shell icon="card" title="Payments — Razorpay + Mode">
      <Row label="Payment Mode" desc="User wallet mein kya dikhe">
        <select className="input" style={{ width: 190 }} value={p.mode || 'upi'} onChange={(e) => set('payments', { mode: e.target.value })}>
          <option value="upi">UPI Manual (recommended)</option>
          <option value="razorpay">Razorpay only</option>
          <option value="both">Both (UPI default)</option>
        </select>
      </Row>
      <div className="setting-row">
        <div><div className="s-label">Razorpay Environment</div><div className="s-desc">{isLive ? 'LIVE — asli paise! Sirf jab provider ne aapki category approve kar li ho' : 'TEST — practice paise, safe'}</div></div>
        <div className="s-ctrl">
          <button className={`btn btn-sm ${!isLive ? 'btn-primary' : 'btn-ghost'}`} onClick={() => set('payments', { env: 'test' })}><Ic n="wrench" s={13} />Test</button>
          <button className={`btn btn-sm ${isLive ? 'btn-danger' : 'btn-ghost'}`} onClick={() => setConfirmLive(true)}><Ic n="zap" s={13} />LIVE</button>
        </div>
      </div>
      <div style={{ borderTop: '1px solid var(--border-solid)', marginTop: 10, paddingTop: 10 }}>
        <div style={{ fontWeight: 800, fontSize: '0.8rem', marginBottom: 8, color: 'var(--text-dim)', display: 'flex', gap: 6, alignItems: 'center' }}>
          <Ic n="wrench" s={13} />TEST KEYS (rzp_test_…)
        </div>
        <Field label="Test Key ID"><input className="input" placeholder="rzp_test_xxxxxxxx" value={p.testKeyId || ''} onChange={(e) => set('payments', { testKeyId: e.target.value })} /></Field>
        <Field label="Test Key Secret (server verification — client mein nahi jaata)"><input className="input" type="password" placeholder="xxxxxx" value={p.testKeySecret || ''} onChange={(e) => set('payments', { testKeySecret: e.target.value })} /></Field>
      </div>
      <div style={{ borderTop: '1px solid var(--border-solid)', marginTop: 10, paddingTop: 10 }}>
        <div style={{ fontWeight: 800, fontSize: '0.8rem', marginBottom: 8, color: 'var(--danger)', display: 'flex', gap: 6, alignItems: 'center' }}>
          <Ic n="zap" s={13} />LIVE KEYS (rzp_live_…)
        </div>
        <Field label="Live Key ID"><input className="input" placeholder="rzp_live_xxxxxxxx" value={p.liveKeyId || ''} onChange={(e) => set('payments', { liveKeyId: e.target.value })} /></Field>
        <Field label="Live Key Secret (server verification — client mein nahi jaata)"><input className="input" type="password" placeholder="xxxxxx" value={p.liveKeySecret || ''} onChange={(e) => set('payments', { liveKeySecret: e.target.value })} /></Field>
      </div>
      <p className="card-sub" style={{ margin: '10px 0', display: 'flex', gap: 6, alignItems: 'flex-start' }}>
        <Ic n="info" s={14} style={{ marginTop: 2, flexShrink: 0 }} />
        Abhi flow: user pay karta hai → payment ID deposit request mein attach hota hai → aap approve karte ho.
        Full auto-verify (secret se signature check) Edge Function mein Phase 3 mein aayega. Secrets sirf DB mein store hote hain (admin-only).
      </p>
      <SaveBtn onClick={() => save('payments', 'Payment settings saved')} />

      {confirmLive && (
        <Confirm title="Switch to LIVE Razorpay?" icon="zap" danger
          msg="LIVE mode mein REAL paise chalti hain. Confirm karo ki: (1) Razorpay ne aapki business category approve ki hai, (2) Live keys sahi hain, (3) Aapke state mein yeh legal hai."
          yesLabel="Haan, LIVE karo"
          onNo={() => setConfirmLive(false)}
          onYes={async () => { setConfirmLive(false); await save('payments', 'Razorpay → LIVE'); }} />
      )}
    </Shell>
  );
}

/* ============ 6. COMMUNITY (chat + notifications) ============ */
export function CommunitySection() {
  const { data, set, save } = useSettings();
  const [busy, setBusy] = useState(false);
  if (!data) return <div className="spinner"></div>;
  const c = data.chat || {};
  const n = data.notifications || {};
  return (
    <div className="page-enter">
      <div className="card" style={{ marginBottom: 14 }}>
        <div className="card-title"><Ic n="chat" s={17} />Community Chat (public)</div>
        <Row label="Public Chat Enabled" desc="User-to-user live chat"><Toggle checked={c.enabled !== false} onChange={(v) => set('chat', { enabled: v })} /></Row>
        <NumRow label="Max Message Length" value={c.maxMessage ?? 500} onChange={(v) => set('chat', { maxMessage: v })} />
        <SaveBtn onClick={() => save('chat', 'Chat settings saved')} />
      </div>
      <div className="card">
        <div className="card-title"><Ic n="bell" s={17} />Notifications</div>
        <Row label="Push/Bell Notifications" desc="User notifications + admin broadcasts"><Toggle checked={n.enabled !== false} onChange={(v) => set('notifications', { enabled: v })} /></Row>
        <SaveBtn onClick={() => save('notifications', 'Notification settings saved')} />
      </div>
    </div>
  );
}

/* ============ 7. APPEARANCE ============ */
export function AppearanceSection() {
  const { data, set, save } = useSettings();
  if (!data) return <div className="spinner"></div>;
  const a = data.appearance || {};
  return (
    <Shell icon="sparkles" title="Appearance">
      <div className="setting-row" style={{ alignItems: 'flex-start' }}>
        <div style={{ flex: 1 }}>
          <div className="s-label">App Name</div>
          <input className="input" style={{ marginTop: 6 }} value={a.appName} onChange={(e) => set('appearance', { appName: e.target.value })} />
        </div>
      </div>
      <div className="setting-row" style={{ alignItems: 'flex-start' }}>
        <div style={{ flex: 1 }}>
          <div className="s-label">Tagline</div>
          <input className="input" style={{ marginTop: 6 }} value={a.tagline} onChange={(e) => set('appearance', { tagline: e.target.value })} />
        </div>
      </div>
      <Row label="Accent Color">
        <input type="color" value={a.accent || '#7c6cff'} style={{ width: 46, height: 34, border: 'none', background: 'none' }} onChange={(e) => set('appearance', { accent: e.target.value })} />
        <span style={{ fontFamily: 'monospace', fontSize: '0.8rem' }}>{a.accent}</span>
      </Row>
      <SaveBtn onClick={() => save('appearance', 'Appearance saved — live')} />
    </Shell>
  );
}

/* ============ 8. SOUNDS ============ */
export function SoundsSection() {
  const { data, set, save } = useSettings();
  if (!data) return <div className="spinner"></div>;
  const s = data.sounds || {};
  return (
    <Shell icon="volume" title="Sounds (global default)">
      <Row label="Sound Effects"><Toggle checked={s.enabled !== false} onChange={(v) => set('sounds', { enabled: v })} /></Row>
      <Row label="Volume">
        <input type="range" min="0" max="1" step="0.05" style={{ width: 160 }} value={s.volume ?? 0.5} onChange={(e) => set('sounds', { volume: Number(e.target.value) })} />
        <span style={{ fontSize: '0.8rem', width: 34 }}>{Math.round((s.volume ?? 0.5) * 100)}%</span>
      </Row>
      <Row label="Timer Tick (last 5s)"><Toggle checked={s.tick !== false} onChange={(v) => set('sounds', { tick: v })} /></Row>
      <Row label="Win Jingle"><Toggle checked={s.win !== false} onChange={(v) => set('sounds', { win: v })} /></Row>
      <Row label="Lose Sound"><Toggle checked={s.lose !== false} onChange={(v) => set('sounds', { lose: v })} /></Row>
      <SaveBtn onClick={() => save('sounds', 'Sound settings saved')} />
    </Shell>
  );
}

/* ============ 9. LINKS (Telegram/WhatsApp/social directory) ============ */
const PLATFORMS = [
  { id: 'telegram', label: 'Telegram', ico: 'send' },
  { id: 'whatsapp', label: 'WhatsApp', ico: 'chat' },
  { id: 'discord', label: 'Discord', ico: 'users' },
  { id: 'instagram', label: 'Instagram', ico: 'image' },
  { id: 'youtube', label: 'YouTube', ico: 'play' },
  { id: 'website', label: 'Website', ico: 'globe' },
  { id: 'custom', label: 'Custom', ico: 'link' }
];
export function LinksSection() {
  const [rows, setRows] = useState(null);
  const [edit, setEdit] = useState(null);
  const [del, setDel] = useState(null);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ platform: 'telegram', title: '', description: '', url: '', active: true, pinned: false, sort_order: 0 });

  const load = useCallback(async () => {
    const { data: r } = await supabase.from('public_links').select('*').order('pinned', { ascending: false }).order('sort_order');
    setRows(r || []);
  }, []);
  useEffect(() => { load(); }, [load]);

  async function act(fn, okMsg) {
    setBusy(true);
    try { await fn(); sfx.cash(); toast(okMsg, 'success'); load(); }
    catch (e) { sfx.error(); toast(e.message, 'error'); }
    finally { setBusy(false); }
  }
  function openNew() { setForm({ platform: 'telegram', title: '', description: '', url: '', active: true, pinned: false, sort_order: rows?.length || 0 }); setEdit({}); }
  function openEdit(l) { setForm({ ...l }); setEdit(l.id); }
  async function submit() {
    if (!form.title.trim() || !form.url.trim()) { toast('Title aur URL required', 'error'); return; }
    if (!/^https?:\/\//i.test(form.url.trim())) { toast('URL https:// se shuru hona chahiye (javascript: rejected)', 'error'); return; }
    const payload = { ...form, title: form.title.trim(), url: form.url.trim(), description: form.description?.trim() || '' };
    if (edit) await act(async () => {
      const { error } = await supabase.from('public_links').update(payload).eq('id', edit);
      if (error) throw new Error(error.message);
    }, 'Link updated');
    else await act(async () => {
      const { error } = await supabase.from('public_links').insert(payload);
      if (error) throw new Error(error.message);
    }, 'Link added');
    setEdit(null);
  }
  async function toggleActive(l) {
    await act(() => supabase.from('public_links').update({ active: !l.active }).eq('id', l.id), l.active ? 'Link hidden' : 'Link live');
  }
  async function togglePin(l) {
    await act(() => supabase.from('public_links').update({ pinned: !l.pinned }).eq('id', l.id), l.pinned ? 'Unpinned' : 'Pinned');
  }
  async function move(l, dir) {
    const sorted = [...rows].filter((x) => !x.pinned).sort((a, b) => a.sort_order - b.sort_order);
    const i = sorted.findIndex((x) => x.id === l.id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= sorted.length) return;
    await act(async () => {
      await supabase.from('public_links').update({ sort_order: sorted[j].sort_order }).eq('id', sorted[i].id);
      await supabase.from('public_links').update({ sort_order: sorted[i].sort_order }).eq('id', sorted[j].id);
    }, 'Order updated');
  }

  return (
    <div className="page-enter">
      <div className="card">
        <div className="card-title" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ display: 'flex', gap: 8, alignItems: 'center' }}><Ic n="link" s={18} />Official Links (Telegram/WhatsApp/etc)</span>
            <button className="btn btn-primary btn-sm" onClick={openNew}><Ic n="plus" s={14} />Add Link</button>
        </div>
        <p className="card-sub" style={{ marginBottom: 12 }}>Users ko Profile → About mein dikhte hain. Pinned links sabse upar. Sirf http(s) URLs allowed.</p>
        {!rows && <div className="spinner"></div>}
        {rows && rows.length === 0 && <Empty icon="link" msg="Koi link nahi — Add se shuru karo" />}
        {rows?.map((l) => {
          const pf = PLATFORMS.find((p) => p.id === l.platform) || PLATFORMS[6];
          return (
            <div key={l.id} style={{ display: 'flex', gap: 10, alignItems: 'center', padding: '10px 0', borderBottom: '1px solid var(--border)' }}>
              <div style={{ width: 34, height: 34, borderRadius: 10, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--card-2)', color: 'var(--accent)', flexShrink: 0 }}>
                <Ic n={pf.ico} s={17} />
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 800, fontSize: '0.9rem', display: 'flex', gap: 6, alignItems: 'center' }}>
                  {l.title}
                  {l.pinned && <Ic n="star" s={13} style={{ color: 'var(--warning)' }} />}
                </div>
                <div className="card-sub" style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{l.url}</div>
              </div>
              <span className={`badge ${l.active ? 'badge-active' : 'badge-rejected'}`}>{l.active ? 'live' : 'hidden'}</span>
              <button className="btn btn-ghost btn-sm" onClick={() => togglePin(l)}><Ic n="star" s={13} /></button>
              <button className="btn btn-ghost btn-sm" onClick={() => move(l, -1)}><Ic n="chevronDown" s={13} style={{ transform: 'rotate(180deg)' }} /></button>
              <button className="btn btn-ghost btn-sm" onClick={() => move(l, 1)}><Ic n="chevronDown" s={13} /></button>
              <button className="btn btn-ghost btn-sm" onClick={() => openEdit(l)}><Ic n="pencil" s={13} /></button>
              <button className="btn btn-ghost btn-sm" onClick={() => setDel(l)}><Ic n="trash" s={13} /></button>
            </div>
          );
        })}
      </div>

      {edit !== null && (
        <Modal title={edit ? 'Edit Link' : 'New Link'} icon="link" onClose={() => setEdit(null)}
          footer={<>
            <button className="btn btn-ghost" onClick={() => setEdit(null)}>Cancel</button>
            <button className="btn btn-primary" onClick={submit} disabled={busy}><Ic n="check" s={15} />Save</button>
          </>}>
          <Field label="Platform">
            <select className="input" value={form.platform} onChange={(e) => setForm({ ...form, platform: e.target.value })}>
              {PLATFORMS.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
            </select>
          </Field>
          <Field label="Title"><input className="input" placeholder="e.g. Official Support Group" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} /></Field>
          <Field label="Description (optional)"><input className="input" placeholder="e.g. 24x7 support" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></Field>
          <Field label="URL (https://)"><input className="input" placeholder="https://t.me/…" value={form.url} onChange={(e) => setForm({ ...form, url: e.target.value })} /></Field>
          <div style={{ display: 'flex', gap: 20 }}>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}><Toggle checked={!!form.active} onChange={(v) => setForm({ ...form, active: v })} /><span style={{ fontSize: '0.85rem', fontWeight: 700 }}>Active</span></div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}><Toggle checked={!!form.pinned} onChange={(v) => setForm({ ...form, pinned: v })} /><span style={{ fontSize: '0.85rem', fontWeight: 700 }}>Pinned</span></div>
          </div>
        </Modal>
      )}

      {del && (
        <Confirm title="Delete link?" msg={`${del.title} remove hoga (users ko nahi dikhega).`}
          onNo={() => setDel(null)}
          onYes={async () => {
            setBusy(true);
            const { error } = await supabase.from('public_links').delete().eq('id', del.id);
            setBusy(false);
            if (error) toast(error.message, 'error'); else { sfx.cash(); toast('Deleted', 'success'); load(); }
            setDel(null);
          }} />
      )}
    </div>
  );
}

/* ============ 10. CONTACT ============ */
export function ContactSection() {
  const { data, set, save } = useSettings();
  const [busy, setBusy] = useState(false);
  if (!data) return <div className="spinner"></div>;
  const t = data.telegram || {};
  const a = data.about || {};
  return (
    <Shell icon="headset" title="Contact & About">
      <div className="setting-row" style={{ alignItems: 'flex-start' }}>
        <div style={{ flex: 1 }}>
          <div className="s-label">Legacy Telegram Support Link</div>
          <input className="input" style={{ marginTop: 6 }} placeholder="https://t.me/…" value={t.link} onChange={(e) => set('telegram', { link: e.target.value })} />
        </div>
      </div>
      <div className="setting-row" style={{ alignItems: 'flex-start' }}>
        <div style={{ flex: 1 }}>
          <div className="s-label">Game Rules (Profile → About mein dikhega)</div>
          <textarea className="input" style={{ marginTop: 6, minHeight: 110 }} value={a.rules} onChange={(e) => set('about', { rules: e.target.value })} />
        </div>
      </div>
      <div className="setting-row" style={{ alignItems: 'flex-start' }}>
        <div style={{ flex: 1 }}>
          <div className="s-label">Support Text</div>
          <textarea className="input" style={{ marginTop: 6, minHeight: 80 }} value={a.support} onChange={(e) => set('about', { support: e.target.value })} />
        </div>
      </div>
      <button className="btn btn-primary" style={{ marginTop: 14 }} disabled={busy} onClick={async () => {
        setBusy(true);
        await Promise.all([
          supabase.from('settings').upsert({ key: 'telegram', value: data.telegram }, { onConflict: 'key' }),
          supabase.from('settings').upsert({ key: 'about', value: data.about }, { onConflict: 'key' })
        ]);
        setBusy(false); sfx.cash(); toast('Contact & About saved', 'success');
      }}><Ic n="check" s={15} />Save</button>
    </Shell>
  );
}
