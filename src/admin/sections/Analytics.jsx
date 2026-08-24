import React, { useEffect, useState } from 'react';
import { rpc } from '../../lib/supabase.js';
import { StatCard, RankBadge, Empty, toast } from '../../components/ui.jsx';
import { Ic } from '../../lib/icons.jsx';
import { money } from '../../lib/utils.js';

export default function Analytics() {
  const [a, setA] = useState(null);

  useEffect(() => {
    rpc('analytics_summary').then(setA).catch((e) => toast(e.message, 'error'));
  }, []);

  if (!a) return <div className="spinner"></div>;

  const totalBets = (a.byType || []).reduce((s, t) => s + t.bets, 0) || 0;

  return (
    <div>
      <div className="stat-grid" style={{ marginBottom: 16 }}>
        <StatCard label="Overall Win Rate" value={(a.winRate ?? 0) + '%'} sub="of settled bets" tone={Number(a.winRate) > 50 ? 'sc-green' : 'sc-red'} icon="trend" />
        <StatCard label="Bets Analyzed" value={totalBets} sub="latest 500 window" tone="sc-blue" icon="target" />
        <StatCard label="14-Day Dep/WD" value={`${money(a.daily?.reduce((s, d) => s + Number(d.deposits), 0) || 0)} / ${money(a.daily?.reduce((s, d) => s + Number(d.withdrawals), 0) || 0)}`} tone="sc-gold" icon="wallet" />
      </div>

      <div className="card" style={{ marginBottom: 14 }}>
        <div className="card-title"><Ic n="calendar" s={17} />Last 14 Days (Deposits / Withdrawals / Bets)</div>
        {a.daily?.length === 0 && <Empty icon="calendar" msg="No activity yet" />}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(130px, 1fr))', gap: 8 }}>
          {a.daily?.map((d) => (
            <div key={d.d} style={{ background: 'var(--card-2)', borderRadius: 12, padding: '10px 12px' }}>
              <div style={{ fontSize: '0.7rem', fontWeight: 800, color: 'var(--text-dim)' }}>{d.d.slice(5)}</div>
              <div style={{ fontSize: '0.82rem', marginTop: 4 }}>
                <span style={{ color: 'var(--success)', fontWeight: 800 }}>↓ {Number(d.deposits).toLocaleString('en-IN')}</span>
                {' · '}
                <span style={{ color: 'var(--danger)', fontWeight: 800 }}>↑ {Number(d.withdrawals).toLocaleString('en-IN')}</span>
              </div>
              <div style={{ fontSize: '0.72rem', color: 'var(--text-dim)' }}>{d.bets} bets</div>
            </div>
          ))}
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 14 }}>
        <div className="card">
          <div className="card-title"><Ic n="target" s={17} />Bets by Type</div>
          {(a.byType || []).map((t) => (
            <div key={t.type} style={{ marginBottom: 12 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem', fontWeight: 700 }}>
                <span>{t.type} ({t.bets})</span>
                <span className="card-sub">staked {money(t.amount)} · paid {money(t.paid)}</span>
              </div>
              <div style={{ height: 8, background: 'var(--card-2)', borderRadius: 99, marginTop: 4, overflow: 'hidden' }}>
                <div style={{ height: '100%', width: (totalBets ? (t.bets / totalBets) * 100 : 0) + '%', background: 'linear-gradient(90deg, var(--accent), var(--accent-2))', borderRadius: 99 }}></div>
              </div>
            </div>
          ))}
          {(a.byColor || []).length > 0 && <div style={{ fontSize: '0.8rem', color: 'var(--text-dim)', marginTop: 8 }}>
            Colors: {a.byColor.map((c) => `${c.selection} ${c.bets} (w ${c.wins})`).join(' · ')}
          </div>}
          {(a.bySize || []).length > 0 && <div style={{ fontSize: '0.8rem', color: 'var(--text-dim)' }}>
            Size: {a.bySize.map((c) => `${c.selection} ${c.bets} (w ${c.wins})`).join(' · ')}
          </div>}
        </div>

        <div className="card">
          <div className="card-title"><Ic n="grid" s={16} />Number Heat (bets → wins)</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 8 }}>
            {[0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => {
              const x = (a.byNumber || []).find((b) => b.selection === String(n));
              const max = Math.max(1, ...(a.byNumber || []).map((b) => b.bets));
              const pct = x ? (x.bets / max) * 100 : 0;
              return (
                <div key={n} style={{ textAlign: 'center', background: `rgba(124,108,255,${0.08 + pct / 250})`, borderRadius: 12, padding: '10px 4px 8px' }}>
                  <div style={{ fontWeight: 900 }}>{n}</div>
                  <div style={{ fontSize: '0.68rem', color: 'var(--text-dim)' }}>{x ? `${x.bets} bets · ${x.wins}w` : '—'}</div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 14, marginTop: 14 }}>
        <div className="card">
          <div className="card-title"><Ic n="trophy" s={17} />Top Winners</div>
          {(a.topWinners || []).length === 0 && <Empty icon="trophy" msg="No wins yet" />}
          {(a.topWinners || []).map((t, i) => (
            <div key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '7px 0', borderBottom: '1px solid var(--border)', fontSize: '0.86rem' }}>
              <span style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
                <Ic n={i === 0 ? 'crown' : 'medal'} s={15} style={{ color: i === 0 ? 'var(--warning)' : 'var(--text-dim)', flexShrink: 0 }} />
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{t.email}</span>
                <RankBadge rank={t.rank} small />
              </span>
              <span style={{ color: 'var(--success)', fontWeight: 800 }}>{money(t.won)}</span>
            </div>
          ))}
        </div>
        <div className="card">
          <div className="card-title"><Ic n="wallet" s={17} />Top Depositors</div>
          {(a.topDepositors || []).length === 0 && <Empty icon="wallet" msg="No approved deposits yet" />}
          {(a.topDepositors || []).map((t, i) => (
            <div key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '7px 0', borderBottom: '1px solid var(--border)', fontSize: '0.86rem' }}>
              <span style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
                <Ic n={i === 0 ? 'crown' : 'medal'} s={15} style={{ color: i === 0 ? 'var(--warning)' : 'var(--text-dim)', flexShrink: 0 }} />
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{t.email}</span>
                <RankBadge rank={t.rank} small />
              </span>
              <span style={{ fontWeight: 800 }}>{money(t.deposited)} <span className="card-sub">({t.txns} txns)</span></span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
