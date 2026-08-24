import React, { useCallback, useEffect, useState } from 'react';
import { supabase, rpc } from '../../lib/supabase.js';
import { Table, Modal, Field, toast, Tabs, Empty, Confirm, SearchInput } from '../../components/ui.jsx';
import { Ic } from '../../lib/icons.jsx';
import { sfx } from '../../lib/sound.js';
import { money, fmtDT, exportCSV } from '../../lib/utils.js';

export default function Withdrawals() {
  const [rows, setRows] = useState(null);
  const [tab, setTab] = useState('pending');
  const [reject, setReject] = useState(null);
  const [note, setNote] = useState('');
  const [del, setDel] = useState(null);
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const { data } = await supabase.from('withdrawals').select('*').order('created_at', { ascending: false }).limit(500);
    setRows(data || []);
  }, []);
  useEffect(() => { load(); const iv = setInterval(load, 12000); return () => clearInterval(iv); }, [load]);

  const byTab = (rows || []).filter((w) => tab === 'all' || w.status === tab)
    .filter((w) => !q || w.upi_id?.toLowerCase().includes(q.toLowerCase()));

  async function act(action, params, okMsg) {
    setBusy(true);
    try {
      await rpc('admin_action', { p_action: action, p_params: params });
      sfx.cash(); toast(okMsg, 'success');
      load();
    } catch (e) { sfx.error(); toast(e.message, 'error'); }
    finally { setBusy(false); }
  }

  function doExport() {
    exportCSV(`withdrawals-${tab}.csv`, ['ID', 'UID', 'Amount', 'UPI ID', 'Status', 'Note', 'Created', 'Processed'],
      byTab.map((w) => [w.id, w.uid, w.amount, w.upi_id, w.status, w.note, fmtDT(w.created_at), fmtDT(w.processed_at)]));
    toast('CSV exported', 'success');
  }

  return (
    <div>
      <div style={{ display: 'flex', gap: 10, marginBottom: 12, flexWrap: 'wrap' }}>
        <SearchInput value={q} onChange={setQ} placeholder="Search UPI ID…" />
        <button className="btn btn-ghost" onClick={doExport}><Ic n="export" s={15} />Export CSV</button>
      </div>

      <Tabs active={tab} onChange={setTab} tabs={[
        { id: 'pending', label: 'Pending', icon: 'clock' },
        { id: 'approved', label: 'Processed', icon: 'checkCircle' },
        { id: 'rejected', label: 'Rejected', icon: 'x' },
        { id: 'all', label: 'All', icon: 'list' }
      ]} />

      {!rows && <div className="spinner"></div>}
      {rows && byTab.length === 0 && <Empty icon="inbox" msg={`No ${tab} withdrawals`} />}

      {rows && byTab.length > 0 && (
        <Table headers={['Amount', 'UPI ID', 'Status', 'Note', 'Requested', 'Actions']}>
          {byTab.map((w) => (
            <tr key={w.id}>
              <td style={{ fontWeight: 900 }}>{money(w.amount)}</td>
              <td style={{ fontFamily: 'monospace', fontSize: '0.84rem' }}>{w.upi_id}</td>
              <td><span className={`badge badge-${w.status}`}>{w.status}</span></td>
              <td style={{ maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis' }}>{w.note || '—'}</td>
              <td>{fmtDT(w.created_at)}</td>
              <td>
                <div style={{ display: 'flex', gap: 5 }}>
                  {w.status === 'pending' && (
                    <>
                      <button className="btn btn-success btn-sm" title="Mark as paid"
                        onClick={() => act('approve-withdrawal', { id: w.id }, `Withdrawal ${money(w.amount)} processed — now pay via UPI`)} disabled={busy}>
                        <Ic n="check" s={14} />Mark Paid
                      </button>
                      <button className="btn btn-danger btn-sm" title="Reject + refund"
                        onClick={() => { setReject(w); setNote(''); sfx.click(); }} disabled={busy}>
                        <Ic n="x" s={14} />Reject
                      </button>
                    </>
                  )}
                  {w.status === 'rejected' && <button className="btn btn-ghost btn-sm" onClick={() => setDel(w)}><Ic n="trash" s={14} /></button>}
                </div>
              </td>
            </tr>
          ))}
        </Table>
      )}

      <p className="card-sub" style={{ marginTop: 10, display: 'flex', gap: 6, alignItems: 'flex-start' }}>
        <Ic n="info" s={14} style={{ marginTop: 2, flexShrink: 0 }} />
        Flow: user requests → balance locks instantly → you pay via UPI → “Mark Paid” (or reject = auto refund to user).
      </p>

      {reject && (
        <Modal title="Reject + refund withdrawal" icon="x" onClose={() => setReject(null)}
          footer={<>
            <button className="btn btn-ghost" onClick={() => setReject(null)}>Cancel</button>
            <button className="btn btn-danger" onClick={() => { act('reject-withdrawal', { id: reject.id, note }, `${money(reject.amount)} refunded to user`); setReject(null); }} disabled={busy}>
              Reject & Refund
            </button>
          </>}>
          <p className="card-sub" style={{ marginBottom: 10 }}>{money(reject.amount)} → {reject.upi_id}</p>
          <Field label="Reason (sent to user)">
            <input className="input" placeholder="e.g. Suspicious activity" value={note} onChange={(e) => setNote(e.target.value)} />
          </Field>
        </Modal>
      )}

      {del && (
        <Confirm title="Delete withdrawal record?" icon="trash" msg="Only rejected records should be deleted. This does not move money."
          onNo={() => setDel(null)}
          onYes={async () => { await act('delete-withdrawal', { id: del.id }, 'Deleted'); setDel(null); }} />
      )}
    </div>
  );
}
