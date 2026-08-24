import React, { useCallback, useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase.js';
import { Table, Tabs, Empty, SearchInput, StatCard } from '../../components/ui.jsx';
import { Ic } from '../../lib/icons.jsx';
import { money, fmtDT, numColor, exportCSV } from '../../lib/utils.js';

export default function Bets() {
  const [rows, setRows] = useState(null);
  const [tab, setTab] = useState('all');
  const [type, setType] = useState('all');
  const [q, setQ] = useState('');

  const load = useCallback(async () => {
    const { data } = await supabase.from('bets').select('*').order('created_at', { ascending: false }).limit(500);
    setRows(data || []);
  }, []);
  useEffect(() => { load(); const iv = setInterval(load, 12000); return () => clearInterval(iv); }, [load]);

  const list = (rows || [])
    .filter((b) => tab === 'all' || b.result === tab)
    .filter((b) => type === 'all' || b.type === type)
    .filter((b) => !q || b.period_id?.includes(q) || b.uid?.startsWith(q));

  const settled = (rows || []).filter((b) => b.result !== 'pending');
  const winRate = settled.length ? Math.round(100 * settled.filter((b) => b.result === 'win').length / settled.length) : 0;

  function doExport() {
    exportCSV('bets.csv', ['ID', 'UID', 'Period', 'Type', 'Selection', 'Amount', 'Payout', 'Result', 'WinAmount', 'Created'],
      list.map((b) => [b.id, b.uid, b.period_id, b.type, b.selection, b.amount, b.payout, b.result, b.win_amount, fmtDT(b.created_at)]));
  }

  return (
    <div>
      <div className="stat-grid" style={{ marginBottom: 14 }}>
        <StatCard label="Bets (500 latest)" value={rows?.length ?? '…'} tone="sc-blue" icon="target" />
        <StatCard label="Pending" value={(rows || []).filter((b) => b.result === 'pending').length} tone="sc-gold" icon="clock" />
        <StatCard label="Win Rate" value={winRate + '%'} sub="of settled" tone={winRate > 50 ? 'sc-green' : 'sc-red'} icon="trend" />
        <StatCard label="Staked" value={money(rows?.reduce((s, b) => s + Number(b.amount), 0) || 0)} tone="sc-gold" icon="coins" />
      </div>

      <div style={{ display: 'flex', gap: 10, marginBottom: 12, flexWrap: 'wrap', alignItems: 'center' }}>
        <SearchInput value={q} onChange={setQ} placeholder="Search period or UID prefix…" />
        <select className="input" style={{ width: 140 }} value={type} onChange={(e) => setType(e.target.value)}>
          <option value="all">All types</option>
          <option value="color">Color</option>
          <option value="number">Number</option>
          <option value="size">Size</option>
        </select>
        <button className="btn btn-ghost" onClick={load}><Ic n="refresh" s={15} />Refresh</button>
        <button className="btn btn-ghost" onClick={doExport}><Ic n="export" s={15} />Export CSV</button>
      </div>

      <Tabs active={tab} onChange={setTab} tabs={[
        { id: 'all', label: 'All', icon: 'list' },
        { id: 'pending', label: 'Pending', icon: 'clock' },
        { id: 'win', label: 'Wins', icon: 'trophy' },
        { id: 'lose', label: 'Losses', icon: 'x' }
      ]} />

      {!rows && <div className="spinner"></div>}
      {rows && list.length === 0 && <Empty icon="target" msg="No bets match" />}

      {rows && list.length > 0 && (
        <Table headers={['Period', 'User', 'Bet', 'Amount', 'Payout', 'Result', 'Win Amt', 'Time']}>
          {list.map((b) => (
            <tr key={b.id}>
              <td style={{ fontFamily: 'monospace', fontSize: '0.8rem' }}>{b.period_id}</td>
              <td style={{ fontFamily: 'monospace', fontSize: '0.8rem' }}>{b.uid.slice(0, 8)}</td>
              <td>
                <span className={`num num-sm ${numColor(parseInt(b.selection, 10) || 0)}`} style={{ display: 'inline-flex', width: 26, height: 26, fontSize: '0.72rem', verticalAlign: 'middle', marginRight: 6 }}>
                  {b.type === 'number' ? b.selection : b.selection[0]}
                </span>
                {b.selection}
              </td>
              <td style={{ fontWeight: 800 }}>{money(b.amount)}</td>
              <td>×{b.payout || 0}</td>
              <td><span className={`badge badge-${b.result}`}>{b.result}</span></td>
              <td>{b.win_amount ? <b style={{ color: 'var(--success)' }}>{money(b.win_amount)}</b> : '—'}</td>
              <td>{fmtDT(b.created_at)}</td>
            </tr>
          ))}
        </Table>
      )}
    </div>
  );
}
