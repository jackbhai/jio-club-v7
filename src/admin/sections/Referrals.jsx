import React, { useCallback, useEffect, useState } from 'react';
import { supabase, rpc } from '../../lib/supabase.js';
import { toast, Table, StatCard, RankBadge, Toggle } from '../../components/ui.jsx';
import { Ic } from '../../lib/icons.jsx';
import { sfx } from '../../lib/sound.js';
import { fmtDT } from '../../lib/utils.js';

const RANKS = ['bronze', 'silver', 'gold', 'platinum', 'diamond'];

export default function Referrals() {
  const [rows, setRows] = useState(null);
  const [refCfg, setRefCfg] = useState(null);
  const [thresholds, setThresholds] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);

  const load = useCallback(async () => {
    setErr(null);
    try {
      const [users, cfg] = await Promise.all([
        supabase.from('profiles').select('*').order('referral_count', { ascending: false }).limit(200),
        supabase.from('settings').select('value').eq('key', 'referral').maybeSingle()
      ]);
      if (users.error) throw new Error(users.error.message);
      setRows(users.data || []);
      setRefCfg(cfg.data?.value);
      setThresholds(cfg.data?.value?.thresholds);
    } catch (e) {
      setErr(e.message || 'Failed to load referral data');
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  const withTeam = (rows || []).filter((u) => u.referral_count > 0);

  async function saveThresholds(next) {
    setBusy(true);
    const v = { ...refCfg, thresholds: next };
    const { error } = await supabase.from('settings').update({ value: v }).eq('key', 'referral');
    setBusy(false);
    if (error) { sfx.error(); toast(error.message, 'error'); return; }
    sfx.cash(); toast('Rank thresholds saved', 'success');
    load();
  }

  async function recompute() {
    setBusy(true);
    try {
      await rpc('admin_action', { p_action: 'recompute-ranks' });
      sfx.win(); toast('All ranks recomputed from team sizes', 'success');
      load();
    } catch (e) { toast(e.message, 'error'); }
    finally { setBusy(false); }
  }

  function setThreshold(rank, min) {
    const next = (thresholds || []).map((t) => t.rank === rank ? { ...t, min: parseInt(min, 10) || 0 } : t);
    setThresholds(next);
  }

  if (err) {
    return (
      <div className="card" style={{ textAlign: 'center', padding: 34, border: '1px solid rgba(229,72,77,0.4)' }}>
        <div style={{ marginBottom: 10, color: 'var(--danger)' }}><Ic n="alert" s={38} /></div>
        <div style={{ fontWeight: 800, marginBottom: 6 }}>Referral data load nahi hua</div>
        <div style={{ color: 'var(--text-dim)', fontSize: '0.82rem', marginBottom: 14 }}>{err}</div>
        <button className="btn btn-primary btn-sm" onClick={load}><Ic n="refresh" s={14} />Retry</button>
      </div>
    );
  }

  return (
    <div>
      {rows === null && <div className="spinner"></div>}
      <div className="stat-grid" style={{ marginBottom: 14 }}>
        <StatCard label="Active Referrals" value={(rows || []).filter((u) => u.referred_by).length} sub="users who joined via code" tone="sc-blue" icon="share" />
        <StatCard label="Top Referrer" value={withTeam[0]?.referral_code || '—'} sub={withTeam[0] ? withTeam[0].email : 'no teams yet'} tone="sc-gold" icon="crown" />
        <StatCard label="Total Referrals" value={(rows || []).reduce((s, u) => s + u.referral_count, 0)} tone="sc-green" icon="users" />
        <StatCard label="System" value={refCfg?.enabled === false ? 'OFF' : 'ON'} sub="no cash rewards — rank only" tone={refCfg?.enabled === false ? 'sc-red' : 'sc-green'} icon="shieldCheck" />
      </div>

      <div className="card" style={{ marginBottom: 14 }}>
        <div className="card-title"><Ic n="medal" s={17} />Rank Thresholds (referrals needed)</div>
        <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          {RANKS.map((r) => {
            const t = (thresholds || []).find((x) => x.rank === r);
            return (
              <div key={r} style={{ textAlign: 'center' }}>
                <RankBadge rank={r} />
                <input className="input" style={{ width: 80, marginTop: 8, textAlign: 'center' }}
                  type="number" value={t?.min ?? 0}
                  onChange={(e) => setThreshold(r, e.target.value)} />
              </div>
            );
          })}
          <button className="btn btn-primary" onClick={() => saveThresholds(thresholds)} disabled={busy}><Ic n="check" s={15} />Save</button>
          <button className="btn btn-ghost" onClick={recompute} disabled={busy}><Ic n="refresh" s={15} />Recompute All Ranks</button>
        </div>
        <p className="card-sub" style={{ marginTop: 10 }}>
          Referrals earn <b>no cash</b> — only rank prestige (badges, leaderboard). Thresholds apply live; use “Recompute” after edits.
        </p>
      </div>

      <div className="card" style={{ marginBottom: 14 }}>
        <div className="card-title"><Ic n="share" s={17} />Referral System</div>
        <div className="setting-row">
          <div>
            <div className="s-label">Enable Referral Links</div>
            <div className="s-desc">Turn off to disable signup referral codes & dashboard</div>
          </div>
          <Toggle checked={refCfg?.enabled !== false} disabled={!refCfg}
            onChange={async (v) => {
              const { error } = await supabase.from('settings').update({ value: { ...refCfg, enabled: v } }).eq('key', 'referral');
              if (error) toast(error.message, 'error'); else { sfx.click(); toast(v ? 'Referrals enabled' : 'Referrals disabled', 'info'); load(); }
            }} />
        </div>
      </div>

      <div className="card">
        <div className="card-title"><Ic n="trophy" s={17} />Leaderboard — Top Referrers</div>
        {withTeam.length === 0 && <Empty icon="flame" msg="No referral teams yet — share the app!" />}
        {withTeam.length > 0 && (
          <Table headers={['#', 'Code', 'Email', 'Team Size', 'Rank', 'Joined']}>
            {withTeam.slice(0, 50).map((u, i) => (
              <tr key={u.id}>
                <td style={{ fontWeight: 900, display: 'flex' }}><Ic n={i === 0 ? 'crown' : i < 3 ? 'medal' : 'hash'} s={16} style={{ color: i === 0 ? 'var(--warning)' : 'var(--text-dim)' }} /></td>
                <td style={{ fontFamily: 'monospace', fontWeight: 800 }}>{u.referral_code}</td>
                <td>{u.email}</td>
                <td style={{ fontWeight: 900 }}>{u.referral_count}</td>
                <td><RankBadge rank={u.rank} small /></td>
                <td>{fmtDT(u.created_at)}</td>
              </tr>
            ))}
          </Table>
        )}
      </div>
    </div>
  );
}
