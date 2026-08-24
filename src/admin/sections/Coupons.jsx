import React, { useCallback, useEffect, useState } from 'react';
import { supabase, rpc } from '../../lib/supabase.js';
import { Table, Modal, Field, toast, Empty, Confirm, Toggle } from '../../components/ui.jsx';
import { Ic } from '../../lib/icons.jsx';
import { sfx } from '../../lib/sound.js';
import { money, fmtDT } from '../../lib/utils.js';

export default function Coupons() {
  const [rows, setRows] = useState(null);
  const [create, setCreate] = useState(false);
  const [form, setForm] = useState({ code: '', amount: '', minBalance: '', maxUses: '', expiresAt: '' });
  const [del, setDel] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const { data } = await supabase.from('coupons').select('*').order('created_at', { ascending: false });
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

  function submit() {
    const code = form.code.trim().toUpperCase();
    const amount = parseFloat(form.amount);
    if (!code) { toast('Enter code', 'error'); return; }
    if (!amount || amount <= 0) { toast('Enter valid amount', 'error'); return; }
    act('add-coupon', {
      code, amount,
      minBalance: form.minBalance || 0,
      maxUses: form.maxUses || 0,
      expiresAt: form.expiresAt || null
    }, `Coupon ${code} created`);
    setCreate(false);
    setForm({ code: '', amount: '', minBalance: '', maxUses: '', expiresAt: '' });
  }

  return (
    <div>
      <div style={{ display: 'flex', gap: 10, marginBottom: 14 }}>
        <button className="btn btn-primary" onClick={() => { setCreate(true); sfx.click(); }}><Ic n="plus" s={16} />New Coupon</button>
        <button className="btn btn-ghost" onClick={load}><Ic n="refresh" s={15} />Refresh</button>
      </div>

      {!rows && <div className="spinner"></div>}
      {rows && rows.length === 0 && <Empty icon="ticket" msg="No coupons yet — create one!" />}

      {rows && rows.length > 0 && (
        <Table headers={['Code', 'Bonus', 'Min Balance', 'Uses', 'Expires', 'Active', 'Created', 'Actions']}>
          {rows.map((c) => (
            <tr key={c.code}>
              <td style={{ fontFamily: 'monospace', fontWeight: 900 }}>{c.code}</td>
              <td style={{ fontWeight: 800, color: 'var(--success)' }}>+{money(c.amount)}</td>
              <td>{money(c.min_balance)}</td>
              <td>{c.used_count} / {c.max_uses || '∞'}</td>
              <td>{c.expires_at ? fmtDT(c.expires_at) : 'Never'}</td>
              <td>
                <Toggle checked={c.active} onChange={(v) => act('update-coupon', { code: c.code, active: v }, `Coupon ${v ? 'enabled' : 'disabled'}`)} />
              </td>
              <td>{fmtDT(c.created_at)}</td>
              <td><button className="btn btn-ghost btn-sm" onClick={() => setDel(c)}><Ic n="trash" s={14} /></button></td>
            </tr>
          ))}
        </Table>
      )}

      {create && (
        <Modal title="New Coupon" icon="ticket" onClose={() => setCreate(false)}
          footer={<>
            <button className="btn btn-ghost" onClick={() => setCreate(false)}>Cancel</button>
            <button className="btn btn-primary" onClick={submit} disabled={busy}><Ic n="check" s={15} />Create</button>
          </>}>
          <Field label="Code">
            <input className="input" placeholder="e.g. WELCOME200" value={form.code}
              onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })} />
          </Field>
          <Field label="Bonus Amount (₹)">
            <input className="input" type="number" placeholder="200" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} />
          </Field>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <Field label="Min Balance (0 = none)">
              <input className="input" type="number" placeholder="0" value={form.minBalance} onChange={(e) => setForm({ ...form, minBalance: e.target.value })} />
            </Field>
            <Field label="Max Uses (0 = unlimited)">
              <input className="input" type="number" placeholder="0" value={form.maxUses} onChange={(e) => setForm({ ...form, maxUses: e.target.value })} />
            </Field>
          </div>
          <Field label="Expires (optional)">
            <input className="input" type="datetime-local" value={form.expiresAt} onChange={(e) => setForm({ ...form, expiresAt: e.target.value })} />
          </Field>
        </Modal>
      )}

      {del && (
        <Confirm title="Delete coupon?" icon="trash" msg={`Coupon ${del.code} (+${money(del.amount)}) will be deleted and users can no longer use it.`}
          onNo={() => setDel(null)}
          onYes={async () => { await act('delete-coupon', { code: del.code }, 'Coupon deleted'); setDel(null); }} />
      )}
    </div>
  );
}
