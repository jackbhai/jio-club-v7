import React, { useCallback, useEffect, useState } from 'react';
import { supabase, rpc } from '../../lib/supabase.js';
import { StatCard, toast, Toggle, Empty } from '../../components/ui.jsx';
import { Ic } from '../../lib/icons.jsx';
import { sfx } from '../../lib/sound.js';
import { money, timeAgo } from '../../lib/utils.js';

export default function Dashboard() {
  const [stats, setStats] = useState(null);
  const [pendDep, setPendDep] = useState([]);
  const [pendWd, setPendWd] = useState([]);
  const [gameCfg, setGameCfg] = useState(null);

  const load = useCallback(async () => {
    try {
      const s = await rpc('stats_overview');
      setStats(s);
      const [d, w, cfg] = await Promise.all([
        supabase.from('deposits').select('*').eq('status', 'pending').order('created_at', { ascending: false }).limit(8),
        supabase.from('withdrawals').select('*').eq('status', 'pending').order('created_at', { ascending: false }).limit(8),
        supabase.from('settings').select('value').eq('key', 'game').maybeSingle()
      ]);
      setPendDep(d.data || []);
      setPendWd(w.data || []);
      setGameCfg(cfg.data?.value);
    } catch (e) { toast(e.message, 'error'); }
  }, []);

  useEffect(() => { load(); const iv = setInterval(load, 15000); return () => clearInterval(iv); }, [load]);

  async function toggleGame(key) {
    if (!gameCfg) return;
    const next = { ...gameCfg, [key]: !gameCfg[key] };
    sfx.click();
    const { error } = await supabase.from('settings').update({ value: next }).eq('key', 'game');
    if (error) {
      // V7-017 fix: error pe local state rollback + visible error
      toast('Update failed: ' + error.message, 'error');
      load();
      return;
    }
    setGameCfg(next);
    toast(key === 'active' ? (next.active ? 'Game RESUMED' : 'Game PAUSED') : (next.maintenance ? 'Maintenance ON' : 'Maintenance OFF'), next.maintenance || !next.active ? 'info' : 'success');
    load();
  }

  async function viewShot(path) {
    if (!path) return;
    const { data, error } = await supabase.storage.from('screenshots').createSignedUrl(path, 300);
    if (error) { toast('Screenshot open failed: ' + error.message, 'error'); return; }
    window.open(data.signedUrl, '_blank', 'noopener');
  }

  if (!stats) return <div className="spinner"></div>;

  return (
    <div>
      {/* Quick game controls */}
      <div className="card" style={{ display: 'flex', gap: 22, alignItems: 'center', flexWrap: 'wrap', marginBottom: 16 }}>
        <div style={{ fontWeight: 900, display: 'flex', gap: 8, alignItems: 'center' }}><Ic n="zap" s={18} />Quick Controls</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
          <Toggle checked={gameCfg?.active !== false} onChange={() => toggleGame('active')} />
          <span style={{ fontWeight: 700, fontSize: '0.88rem' }}>Game Active</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
          <Toggle checked={gameCfg?.maintenance === true} onChange={() => toggleGame('maintenance')} />
          <span style={{ fontWeight: 700, fontSize: '0.88rem' }}>Maintenance Mode</span>
        </div>
        <div style={{ color: 'var(--text-dim)', fontSize: '0.8rem', display: 'flex', gap: 6, alignItems: 'center' }}>
          <Ic n="clock" s={13} />Period {gameCfg?.duration || 60}s · Min bet ₹{gameCfg?.minBet || 10}
        </div>
      </div>

      {/* Stats */}
      <div className="stat-grid">
        <StatCard label="Total Users" value={stats.totalUsers} sub={`+${stats.todayUsers} today · ${stats.blockedUsers} blocked`} tone="sc-blue" icon="users" />
        <StatCard label="Total Deposits" value={money(stats.totalDeposits)} sub={`Today: ${money(stats.todayDeposits)}`} tone="sc-green" icon="arrowDown" />
        <StatCard label="Total Withdrawn" value={money(stats.totalWithdrawn)} tone="sc-red" icon="arrowUp" />
        <StatCard label="House Revenue" value={money(stats.revenue)} sub="deposits − withdrawals − payouts" tone="sc-gold" icon="trend" />
        <StatCard label="Pending Deposits" value={stats.pendingDeposits?.count || 0} sub={money(stats.pendingDeposits?.amount || 0)} tone="sc-gold" icon="inbox" />
        <StatCard label="Pending Withdrawals" value={stats.pendingWithdrawals?.count || 0} sub={money(stats.pendingWithdrawals?.amount || 0)} tone="sc-gold" icon="inbox" />
        <StatCard label="Total Bets" value={stats.totalBets} sub={`${stats.todayBets} today · ${stats.pendingBets} pending`} icon="target" />
        <StatCard label="Total Paid Out" value={money(stats.totalPaidOut)} sub={`Staked: ${money(stats.totalBetAmount)}`} tone="sc-red" icon="coins" />
      </div>

      {/* Pending queues */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))', gap: 16, marginTop: 16 }}>
        <div className="card">
          <div className="card-title">
            <Ic n="arrowDown" s={17} />Pending Deposits
            <span className="badge badge-pending">{pendDep.length}</span>
          </div>
          {pendDep.length === 0 && <Empty icon="checkCircle" msg="All clear" />}
          {pendDep.map((d) => (
            <div key={d.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 0', borderBottom: '1px solid var(--border)' }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 800 }}>{money(d.amount)} {d.payment_mode === 'razorpay' && <span className="badge badge-active">RZP</span>}</div>
                <div className="card-sub">{d.uid?.slice(0, 8)} · {timeAgo(d.created_at)} · ref: {d.upi_ref || '—'}</div>
              </div>
              {d.screenshot_url && <button className="btn btn-ghost btn-sm" onClick={() => viewShot(d.screenshot_url)}><Ic n="image" s={15} /></button>}
            </div>
          ))}
          <a className="btn btn-ghost btn-block" style={{ marginTop: 10 }} href="#/admin" onClick={(e) => { e.preventDefault(); window.dispatchEvent(new CustomEvent('jc:goto', { detail: 'deposits' })); }}>
            Review all deposits <Ic n="chevronRight" s={14} />
          </a>
        </div>

        <div className="card">
          <div className="card-title">
            <Ic n="arrowUp" s={17} />Pending Withdrawals
            <span className="badge badge-pending">{pendWd.length}</span>
          </div>
          {pendWd.length === 0 && <Empty icon="checkCircle" msg="All clear" />}
          {pendWd.map((w) => (
            <div key={w.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 0', borderBottom: '1px solid var(--border)' }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 800 }}>{money(w.amount)}</div>
                <div className="card-sub">{w.upi_id} · {timeAgo(w.created_at)}</div>
              </div>
            </div>
          ))}
          <a className="btn btn-ghost btn-block" style={{ marginTop: 10 }} href="#/admin" onClick={(e) => { e.preventDefault(); window.dispatchEvent(new CustomEvent('jc:goto', { detail: 'withdrawals' })); }}>
            Review all withdrawals <Ic n="chevronRight" s={14} />
          </a>
        </div>
      </div>
    </div>
  );
}
