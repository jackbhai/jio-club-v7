import React, { useCallback, useEffect, useState } from 'react';
import { supabase, rpc } from '../../lib/supabase.js';
import { Table, Modal, Field, toast, Tabs, Empty, Confirm, SearchInput } from '../../components/ui.jsx';
import { Ic } from '../../lib/icons.jsx';
import { sfx } from '../../lib/sound.js';
import { money, fmtDT, exportCSV } from '../../lib/utils.js';

export default function Deposits() {
  const [rows, setRows] = useState(null);
  const [tab, setTab] = useState('pending');
  const [reject, setReject] = useState(null);
  const [note, setNote] = useState('');
  const [del, setDel] = useState(null);
  const [sel, setSel] = useState({});
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const { data } = await supabase.from('deposits').select('*').order('created_at', { ascending: false }).limit(500);
    setRows(data || []);
  }, []);
  useEffect(() => { load(); const iv = setInterval(load, 12000); return () => clearInterval(iv); }, [load]);

  const byTab = (rows || []).filter((d) => tab === 'all' || d.status === tab)
    .filter((d) => !q || d.upi_ref?.toLowerCase().includes(q.toLowerCase()));

  async function act(action, params, okMsg) {
    setBusy(true);
    try {
      await rpc('admin_action', { p_action: action, p_params: params });
      sfx.cash(); toast(okMsg, 'success');
      setSel({});
      load();
    } catch (e) { sfx.error(); toast(e.message, 'error'); }
    finally { setBusy(false); }
  }

  function approve(d) { act('approve-deposit', { id: d.id }, `Deposit ${money(d.amount)} approved`); }

  // V7-004 fix: private bucket → admin ko bhi signed URL se hi dikhana hai
  async function viewShot(path) {
    if (!path) return;
    const { data, error } = await supabase.storage.from('screenshots').createSignedUrl(path, 300);
    if (error) { toast('Screenshot open failed: ' + error.message, 'error'); return; }
    window.open(data.signedUrl, '_blank', 'noopener');
  }
  function bulkApprove() {
    const ids = Object.entries(sel).filter(([k, v]) => v).map(([k]) => Number(k));
    if (!ids.length) { toast('Select deposits first', 'error'); return; }
    act('bulk-approve-deposits', { ids }, `${ids.length} deposits bulk-approved`);
  }
  function doExport() {
    exportCSV(`deposits-${tab}.csv`, ['ID', 'UID', 'Amount', 'Mode', 'Status', 'UPI Ref', 'Note', 'Screenshot', 'Created', 'Processed'],
      byTab.map((d) => [d.id, d.uid, d.amount, d.payment_mode, d.status, d.upi_ref, d.note, d.screenshot_url, fmtDT(d.created_at), fmtDT(d.processed_at)]));
    toast('CSV exported', 'success');
  }

  const selCount = Object.values(sel).filter(Boolean).length;

  return (
    <div>
      <div style={{ display: 'flex', gap: 10, marginBottom: 12, flexWrap: 'wrap', alignItems: 'center' }}>
        <SearchInput value={q} onChange={setQ} placeholder="Search UPI ref…" />
        <button className="btn btn-ghost" onClick={doExport}><Ic n="export" s={15} />Export CSV</button>
        {selCount > 0 && (
          <button className="btn btn-success" onClick={bulkApprove}><Ic n="check" s={15} />Approve Selected ({selCount})</button>
        )}
      </div>

      <Tabs active={tab} onChange={setTab} tabs={[
        { id: 'pending', label: 'Pending', icon: 'clock' },
        { id: 'approved', label: 'Approved', icon: 'checkCircle' },
        { id: 'rejected', label: 'Rejected', icon: 'x' },
        { id: 'all', label: 'All', icon: 'list' }
      ]} />

      {!rows && <div className="spinner"></div>}
      {rows && byTab.length === 0 && <Empty icon="inbox" msg={`No ${tab} deposits`} />}

      {rows && byTab.length > 0 && (
        <Table headers={[
          <input key="ck" type="checkbox"
            checked={byTab.length > 0 && byTab.every((d) => sel[d.id])}
            onChange={(e) => { const m = {}; byTab.forEach((d) => m[d.id] = e.target.checked); setSel(m); }} />,
          'Amount', 'Mode', 'Status', 'UPI Ref', 'Screenshot', 'Note', 'Date', 'Actions'
        ]}>
          {byTab.map((d) => (
            <tr key={d.id}>
              <td>{tab === 'pending' && <input type="checkbox" checked={!!sel[d.id]} onChange={(e) => setSel({ ...sel, [d.id]: e.target.checked })} />}</td>
              <td style={{ fontWeight: 900 }}>{money(d.amount)}</td>
              <td>{d.payment_mode === 'razorpay' ? <span style={{ display: 'inline-flex', gap: 5, alignItems: 'center' }}><Ic n="zap" s={13} />Razorpay</span> : 'UPI'}</td>
              <td><span className={`badge badge-${d.status}`}>{d.status}</span></td>
              <td style={{ fontFamily: 'monospace', fontSize: '0.8rem' }}>{d.upi_ref || '—'}</td>
              <td>{d.screenshot_url ? <button onClick={() => viewShot(d.screenshot_url)} title="View (signed URL, 5 min)"><Ic n="image" s={16} /></button> : '—'}</td>
              <td style={{ maxWidth: 140, overflow: 'hidden', textOverflow: 'ellipsis' }}>{d.note || '—'}</td>
              <td>{fmtDT(d.created_at)}</td>
              <td>
                <div style={{ display: 'flex', gap: 5 }}>
                  {d.status === 'pending' && (
                    <>
                      <button className="btn btn-success btn-sm" title="Approve" onClick={() => approve(d)} disabled={busy}><Ic n="check" s={14} /></button>
                      <button className="btn btn-danger btn-sm" title="Reject" onClick={() => { setReject(d); setNote(''); sfx.click(); }} disabled={busy}><Ic n="x" s={14} /></button>
                    </>
                  )}
                  {d.status !== 'pending' && <button className="btn btn-ghost btn-sm" title="Delete" onClick={() => setDel(d)}><Ic n="trash" s={14} /></button>}
                </div>
              </td>
            </tr>
          ))}
        </Table>
      )}

      {reject && (
        <Modal title="Reject deposit" icon="x" onClose={() => setReject(null)}
          footer={<>
            <button className="btn btn-ghost" onClick={() => setReject(null)}>Cancel</button>
            <button className="btn btn-danger" onClick={() => { act('reject-deposit', { id: reject.id, note }, 'Deposit rejected'); setReject(null); }} disabled={busy}>
              Reject {money(reject.amount)}
            </button>
          </>}>
          <p className="card-sub" style={{ marginBottom: 10 }}>UID {reject.uid?.slice(0, 8)} · ref {reject.upi_ref || '—'}</p>
          <Field label="Reason (sent to user)">
            <input className="input" placeholder="e.g. Amount mismatch, invalid screenshot" value={note} onChange={(e) => setNote(e.target.value)} />
          </Field>
        </Modal>
      )}

      {del && (
        <Confirm title="Delete deposit record?" icon="trash" msg={`Remove this ${money(del.amount)} ${del.status} record? User balance is NOT affected.`}
          onNo={() => setDel(null)}
          onYes={async () => { await act('delete-deposit', { id: del.id }, 'Deleted'); setDel(null); }} />
      )}
    </div>
  );
}
