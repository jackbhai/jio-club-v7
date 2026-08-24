import React, { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase.js';
import { Empty, StatCard } from '../components/ui.jsx';
import { Ic } from '../lib/icons.jsx';
import { money, fmtDT, numColor } from '../lib/utils.js';

const FILTERS = [
  { id: 'all', label: 'All', icon: 'list' },
  { id: 'win', label: 'Wins', icon: 'trophy' },
  { id: 'lose', label: 'Losses', icon: 'x' },
  { id: 'pending', label: 'Pending', icon: 'clock' }
];

export default function MyBets({ user }) {
  const [bets, setBets] = useState(null);
  const [filter, setFilter] = useState('all');

  useEffect(() => {
    (async () => {
      const { data } = await supabase.from('bets').select('*')
        .eq('uid', user.id).order('created_at', { ascending: false }).limit(100);
      setBets(data || []);
    })();
  }, [user.id]);

  const list = (bets || []).filter((b) => filter === 'all' || b.result === filter);
  const settled = (bets || []).filter((b) => b.result !== 'pending');
  const wins = settled.filter((b) => b.result === 'win');
  const total = bets?.reduce((s, b) => s + Number(b.amount), 0) || 0;
  const wonAmt = wins.reduce((s, b) => s + Number(b.win_amount), 0) || 0;
  const net = settled.reduce((s, b) => s + Number(b.win_amount) - Number(b.amount), 0) || 0;

  return (
    <div>
      <div className="stat-grid" style={{ marginBottom: 14 }}>
        <StatCard label="Total Bets" value={bets?.length ?? '…'} sub={money(total) + ' staked'} tone="sc-blue" icon="list" />
        <StatCard label="Wins" value={wins.length} sub={money(wonAmt) + ' won'} tone="sc-green" icon="trophy" />
        <StatCard label="Net P/L" value={net >= 0 ? '+' + money(net) : money(net)} sub="all time" tone={net >= 0 ? 'sc-green' : 'sc-red'} icon="trend" />
        <StatCard label="Pending" value={(bets || []).filter((b) => b.result === 'pending').length} tone="sc-gold" icon="clock" />
      </div>

      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 12 }}>
        {FILTERS.map((f) => (
          <button key={f.id} className={`tab ${filter === f.id ? 'active' : ''}`} style={{ padding: '7px 13px' }} onClick={() => setFilter(f.id)}>
            <Ic n={f.icon} s={14} />{f.label}
          </button>
        ))}
      </div>

      {!bets && <div className="spinner"></div>}
      {bets && list.length === 0 && <Empty icon="target" msg="No bets here yet — place your first bet!" />}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {list.map((b) => (
          <div key={b.id} className="card" style={{ padding: '11px 14px', display: 'flex', alignItems: 'center', gap: 10 }}>
            <div className={`num num-sm ${numColor(parseInt(b.selection, 10) || 0)}`} style={{ width: 34, height: 34, flexShrink: 0, display: 'flex' }}
              title={b.type}>
              {b.type === 'color' ? b.selection[0] : b.type === 'size' ? b.selection[0] : b.selection}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 800, fontSize: '0.9rem' }}>
                {b.type[0].toUpperCase() + b.type.slice(1)}: {b.selection} · {money(b.amount)}
              </div>
              <div className="card-sub" style={{ display: 'flex', gap: 5, alignItems: 'center' }}>
                <Ic n="hash" s={11} />{b.period_id} · {fmtDT(b.created_at)}
              </div>
            </div>
            {b.result === 'pending' ? (
              <span className="badge badge-pending">pending</span>
            ) : (
              <div style={{ textAlign: 'right' }}>
                <span className={`badge badge-${b.result}`}>{b.result}</span>
                <div style={{ fontSize: '0.78rem', fontWeight: 800, color: b.result === 'win' ? 'var(--success)' : 'var(--danger)', marginTop: 3 }}>
                  {b.result === 'win' ? '+' + money(b.win_amount) : '-' + money(b.amount)}
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
