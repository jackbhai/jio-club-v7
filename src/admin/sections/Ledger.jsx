import React, { useCallback, useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase.js';
import { Table, Empty, SearchInput, StatCard, Tabs } from '../../components/ui.jsx';
import { Ic } from '../../lib/icons.jsx';
import { money, fmtDT, exportCSV } from '../../lib/utils.js';

const TYPE_META = {
  stake: { label: 'Stake (bet)', color: 'var(--danger)' },
  payout: { label: 'Payout (win)', color: 'var(--success)' },
  deposit: { label: 'Deposit', color: 'var(--success)' },
  withdraw_lock: { label: 'Withdraw Lock', color: 'var(--warning)' },
  withdraw_paid: { label: 'Withdraw Paid', color: 'var(--info)' },
  refund: { label: 'Refund', color: 'var(--success)' },
  adjust: { label: 'Adjust', color: 'var(--info)' },
  coupon: { label: 'Coupon', color: 'var(--accent)' },
  bonus: { label: 'Bonus', color: 'var(--accent)' }
};

export default function Ledger() {
  const [rows, setRows] = useState(null);
  const [q, setQ] = useState('');
  const [tab, setTab] = useState('all');

  const load = useCallback(async () => {
    const { data } = await supabase.from('wallet_ledger').select('*')
      .order('created_at', { ascending: false }).limit(500);
    setRows(data || []);
  }, []);
  useEffect(() => { load(); const iv = setInterval(load, 15000); return () => clearInterval(iv); }, [load]);

  const list = (rows || [])
    .filter((r) => tab === 'all' || r.type === tab)
    .filter((r) => !q || r.ref?.toLowerCase().includes(q.toLowerCase()) || r.uid?.toLowerCase().startsWith(q.toLowerCase()));

  const credits = list.filter((r) => r.amount > 0).reduce((s, r) => s + Number(r.amount), 0);
  const debits = list.filter((r) => r.amount < 0).reduce((s, r) => s + Number(r.amount), 0);

  function doExport() {
    exportCSV('wallet-ledger.csv', ['Time', 'UID', 'Type', 'Amount', 'BalanceAfter', 'Ref', 'Note'],
      list.map((r) => [fmtDT(r.created_at), r.uid, r.type, r.amount, r.balance_after, r.ref, r.note]));
  }

  return (
    <div>
      <div className="stat-grid" style={{ marginBottom: 14 }}>
        <StatCard label="Ledger Entries (500)" value={rows?.length ?? '…'} tone="sc-violet" icon="file" />
        <StatCard label="Total Credits" value={money(credits)} tone="sc-green" icon="arrowDown" />
        <StatCard label="Total Debits" value={money(debits)} tone="sc-red" icon="arrowUp" />
        <StatCard label="Net" value={money(credits + debits)} tone="sc-gold" icon="trend" />
      </div>

      <div style={{ display: 'flex', gap: 10, marginBottom: 12, flexWrap: 'wrap' }}>
        <SearchInput value={q} onChange={setQ} placeholder="Search ref (BET-123, DEP-5…) or UID prefix…" />
        <button className="btn btn-ghost" onClick={load}><Ic n="refresh" s={15} />Refresh</button>
        <button className="btn btn-ghost" onClick={doExport}><Ic n="export" s={15} />Export CSV</button>
      </div>

      <Tabs active={tab} onChange={setTab} tabs={[
        { id: 'all', label: 'All', icon: 'list' },
        { id: 'stake', label: 'Stakes', icon: 'target' },
        { id: 'payout', label: 'Payouts', icon: 'trophy' },
        { id: 'deposit', label: 'Deposits', icon: 'arrowDown' },
        { id: 'refund', label: 'Refunds', icon: 'refresh' },
        { id: 'adjust', label: 'Adjusts', icon: 'sliders' }
      ]} />

      {!rows && <div className="spinner"></div>}
      {rows && list.length === 0 && <Empty icon="file" msg="Abhi koi ledger entries nahi (naye transactions pe auto-record honge)" />}

      {rows && list.length > 0 && (
        <Table headers={['Time', 'User', 'Type', 'Amount', 'Balance After', 'Ref', 'Note']}>
          {list.map((r) => {
            const m = TYPE_META[r.type] || { label: r.type, color: 'var(--text-dim)' };
            return (
              <tr key={r.id}>
                <td>{fmtDT(r.created_at)}</td>
                <td style={{ fontFamily: 'monospace', fontSize: '0.78rem' }}>{r.uid.slice(0, 8)}</td>
                <td><span style={{ fontWeight: 800, color: m.color }}>{m.label}</span></td>
                <td style={{ fontWeight: 800, color: r.amount >= 0 ? 'var(--success)' : 'var(--danger)' }}>
                  {r.amount >= 0 ? '+' : ''}{money(r.amount, false)}
                </td>
                <td>{r.balance_after != null ? money(r.balance_after) : '—'}</td>
                <td style={{ fontFamily: 'monospace', fontSize: '0.78rem' }}>{r.ref || '—'}</td>
                <td style={{ maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.note || '—'}</td>
              </tr>
            );
          })}
        </Table>
      )}
      <p className="card-sub" style={{ marginTop: 10, display: 'flex', gap: 6, alignItems: 'flex-start' }}>
        <Ic n="shieldCheck" s={14} style={{ marginTop: 2, flexShrink: 0 }} />
        Append-only journal: har money event (stake, payout, deposit, refund, adjust, bonus, coupon) yahan record hota hai — reconciliation ke liye.
      </p>
    </div>
  );
}
