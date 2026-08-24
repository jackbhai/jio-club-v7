import React, { useCallback, useEffect, useState } from 'react';
import { supabase, rpc } from '../../lib/supabase.js';
import { toast, Field, StatCard } from '../../components/ui.jsx';
import { Ic } from '../../lib/icons.jsx';
import { sfx } from '../../lib/sound.js';
import { numColor } from '../../lib/utils.js';

const MODES = [
  { id: 'random', icon: 'dice', title: 'Pure Random', desc: '100% fair — sab numbers 10% equal chance. House edge sirf payout se.' },
  { id: 'weighted', icon: 'sliders2', title: 'Weighted Numbers', desc: 'Har number ka apna probability weight rakho — colors/size/number odds control.' },
  { id: 'target', icon: 'crosshair', title: 'Target Win-Rate', desc: 'Engine pending bets dekhke aise result chunta hai ki ~X% bet value jeete (period-by-period).' }
];

export default function GameControl() {
  const [gameCfg, setGameCfg] = useState(null);
  const [results, setResults] = useState([]);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const [cfg, res] = await Promise.all([
      supabase.from('settings').select('value').eq('key', 'game').maybeSingle(),
      supabase.from('results').select('*').order('created_at', { ascending: false }).limit(5)
    ]);
    setGameCfg(cfg.data?.value || null);
    setResults(res.data || []);
  }, []);
  useEffect(() => { load(); const ch = supabase.channel('gc-results')
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'results' }, () => load()).subscribe();
    return () => supabase.removeChannel(ch); }, [load]);

  const g = gameCfg || {};
  const mode = g.winMode || 'random';
  const target = Number(g.winTarget ?? 0.5);
  const weights = g.numberWeights && g.numberWeights.length === 10 ? g.numberWeights : [10, 10, 10, 10, 10, 10, 10, 10, 10, 10];
  const totalW = weights.reduce((s, w) => s + Math.max(0, Number(w)), 0) || 1;

  function set(key, value) {
    setGameCfg((d) => ({ ...d, [key]: value }));
  }

  async function save(msg) {
    setBusy(true);
    const { error } = await supabase.from('settings').update({ value: gameCfg }).eq('key', 'game');
    setBusy(false);
    if (error) { sfx.error(); toast(error.message, 'error'); return; }
    sfx.cash(); toast(msg || 'Game settings saved — live abhi', 'success');
  }

  async function settleNow() {
    setBusy(true);
    try {
      await rpc('admin_action', { p_action: 'tick-now' });
      sfx.cash(); toast('Settled! Latest period resolve ho gaya', 'success');
      load();
    } catch (e) { toast(e.message, 'error'); }
    finally { setBusy(false); }
  }

  async function forceResult(n) {
    setBusy(true);
    try {
      await rpc('admin_action', { p_action: 'force-result', p_params: { number: n } });
      sfx.cash();
      toast(n === null ? 'Force cleared — normal engine wapas' : `NEXT period FORCED to ${n}`, 'success');
      setGameCfg((d) => ({ ...d, forceNextResult: n }));
    } catch (e) { toast(e.message, 'error'); }
    finally { setBusy(false); }
  }

  /* ---- probability preview (client-computed) ---- */
  const prob = (() => {
    if (mode === 'target') {
      return [
        { label: 'Period Win-Rate (server-managed)', pct: Math.round(target * 100) },
        { label: 'Har bet type ka chance', pct: Math.round(target * 100) }
      ];
    }
    const w = weights.map((x) => Math.max(0, Number(x)) / totalW);
    const P = (idxs) => idxs.reduce((s, i) => s + (w[i] || 0), 0) * 100;
    return [
      { label: 'Green wins', pct: P([0, 1, 3, 5, 7, 9]) },
      { label: 'Red wins', pct: P([0, 2, 4, 6, 8]) },
      { label: 'Violet wins', pct: P([0]) },
      { label: 'Any single number', pct: 100 / 10 },
      { label: 'Big (5-9)', pct: P([5, 6, 7, 8, 9]) },
      { label: 'Small (0-4)', pct: P([0, 1, 2, 3, 4]) }
    ];
  })();

  if (!gameCfg) return <div className="spinner"></div>;

  return (
    <div>
      {/* Top stats */}
      <div className="stat-grid" style={{ marginBottom: 16 }}>
        <StatCard label="Engine" value={mode === 'random' ? 'Random' : mode === 'weighted' ? 'Weighted' : 'Target %'} sub={mode === 'target' ? `~${Math.round(target * 100)}% win-rate` : 'server-side (pg_cron)'} tone="sc-violet" icon="gauge" />
        <StatCard label="Period" value={`${g.duration || 60}s`} sub={`close last ${g.betCloseSeconds || 5}s`} tone="sc-blue" icon="clock" />
        <StatCard label="Last 5 Results" value={results.slice(0, 5).map((r) => r.number).join(' ') || '—'} tone="sc-gold" icon="dice" />
        <StatCard label="Force Next" value={g.forceNextResult ?? 'OFF'} sub={g.forceNextResult ?? 'auto (engine)'} tone={g.forceNextResult != null ? 'sc-red' : ''} icon="zap" />
      </div>

      {/* WIN PROBABILITY ENGINE */}
      <div className="card" style={{ marginBottom: 14 }}>
        <div className="card-title"><Ic n="gauge" s={18} />Win Probability Engine</div>
        <p className="card-sub" style={{ marginBottom: 14 }}>
          Engine har period ka result <b>server pe</b> decide karta hai. Mode choose karo — change turant agle period se apply hota hai.
        </p>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          {MODES.map((m) => (
            <div key={m.id} className={`mode-card ${mode === m.id ? 'selected' : ''}`} onClick={() => { set('winMode', m.id); sfx.click(); }}>
              <div className="mc-title"><Ic n={m.icon} s={18} />{m.title}</div>
              <div className="mc-desc">{m.desc}</div>
            </div>
          ))}
        </div>

        {mode === 'target' && (
          <div style={{ marginTop: 16 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
              <span style={{ fontWeight: 800, display: 'flex', gap: 7, alignItems: 'center' }}><Ic n="crosshair" s={16} />Target Win-Rate</span>
              <b style={{ color: 'var(--accent)', fontSize: '1.2rem' }}>{Math.round(target * 100)}%</b>
            </div>
            <input type="range" min="0" max="100" value={Math.round(target * 100)} style={{ width: '100%' }}
              onChange={(e) => set('winTarget', Number(e.target.value) / 100)} />
            <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--text-dim)', fontSize: '0.72rem', fontWeight: 700, marginTop: 4 }}>
              <span>0% = har bet lose (full house)</span><span>50%</span><span>100% = sab jeet (freebie)</span>
            </div>
          </div>
        )}

        {mode === 'weighted' && (
          <div style={{ marginTop: 16 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
              <span style={{ fontWeight: 800, display: 'flex', gap: 7, alignItems: 'center' }}><Ic n="sliders2" s={16} />Number Weights (0-100)</span>
              <button className="btn btn-ghost btn-sm" onClick={() => set('numberWeights', [10, 10, 10, 10, 10, 10, 10, 10, 10, 10])}>
                <Ic n="refresh" s={13} />Equal
              </button>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: '0 18px' }}>
              {[0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => (
                <div key={n} className="weight-row">
                  <div className={`num num-sm w-num ${numColor(n)}`}>{n}</div>
                  <input type="range" min="0" max="100" value={weights[n]}
                    onChange={(e) => set('numberWeights', weights.map((w, i) => (i === n ? Number(e.target.value) : w)))} />
                  <span className="w-val">{weights[n]}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Live probability preview */}
        <div style={{ marginTop: 18, padding: 14, background: 'var(--card-2)', borderRadius: 12 }}>
          <div style={{ fontWeight: 800, fontSize: '0.82rem', marginBottom: 12, display: 'flex', gap: 7, alignItems: 'center', color: 'var(--text-dim)' }}>
            <Ic n="chart" s={15} />LIVE PROBABILITY PREVIEW (current config)
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(210px, 1fr))', gap: 10 }}>
            {prob.map((p) => (
              <div key={p.label} className="prob-bar" style={{ marginBottom: 0 }}>
                <div className="pb-head"><span>{p.label}</span><b>{p.pct.toFixed(1)}%</b></div>
                <div className="pb-track"><div className="pb-fill" style={{ width: Math.min(100, p.pct) + '%' }} /></div>
              </div>
            ))}
          </div>
        </div>

        <button className="btn btn-primary" style={{ marginTop: 16 }} disabled={busy} onClick={() => save('Probability engine saved')}>
          <Ic n="check" s={16} />Save Engine Settings
        </button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 14 }}>
        {/* Force + live trigger */}
        <div className="card">
          <div className="card-title"><Ic n="zap" s={17} />Force Next Result</div>
          <p className="card-sub" style={{ marginBottom: 12 }}>Agla period fixed number hoga (ek period ke liye). Engine clear kar deta hai use.</p>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {[0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => (
              <button key={n} className={`num num-sm ${numColor(n)}`} style={{ width: 38, height: 38, outline: g.forceNextResult === n ? '3px solid var(--accent)' : 'none' }}
                onClick={() => forceResult(n)} disabled={busy}>
                {n}
              </button>
            ))}
            <button className="btn btn-ghost btn-sm" style={{ alignSelf: 'center' }} onClick={() => forceResult(null)} disabled={busy}>
              <Ic n="refresh" s={14} />Clear
            </button>
          </div>
          <div style={{ borderTop: '1px solid var(--border-solid)', marginTop: 14, paddingTop: 14 }}>
            <button className="btn btn-success btn-block" onClick={settleNow} disabled={busy}>
              <Ic n="bolt" s={16} />Settle Latest Period Now
            </button>
            <p className="card-sub" style={{ marginTop: 8, display: 'flex', gap: 6, alignItems: 'flex-start' }}>
              <Ic n="info" s={13} style={{ marginTop: 2, flexShrink: 0 }} />
              Normal mein pg_cron har minute khud settle karta hai. Yeh button jab tak period pending rahe use karo.
            </p>
          </div>
        </div>

        {/* Period & limits */}
        <div className="card">
          <div className="card-title"><Ic n="clock" s={17} />Period & Limits</div>
          <div className="setting-row">
            <div><div className="s-label">Duration (seconds)</div></div>
            <div className="s-ctrl">
              {[30, 60, 120, 300].map((d) => (
                <button key={d} className={`btn btn-sm ${g.duration === d ? 'btn-primary' : 'btn-ghost'}`} onClick={() => set('duration', d)}>{d}s</button>
              ))}
            </div>
          </div>
          <div className="setting-row">
            <div><div className="s-label">Betting closes (last seconds)</div></div>
            <div className="s-ctrl">
              <input className="input" style={{ width: 90 }} type="number" min="1" max="30" value={g.betCloseSeconds ?? 5}
                onChange={(e) => set('betCloseSeconds', Number(e.target.value) || 5)} />
            </div>
          </div>
          <div className="setting-row">
            <div><div className="s-label">Minimum bet (₹)</div></div>
            <div className="s-ctrl">
              <input className="input" style={{ width: 110 }} type="number" min="1" value={g.minBet ?? 10}
                onChange={(e) => set('minBet', Number(e.target.value) || 10)} />
            </div>
          </div>
          <div className="setting-row">
            <div><div className="s-label">Maximum bet (₹)</div></div>
            <div className="s-ctrl">
              <input className="input" style={{ width: 110 }} type="number" min="1" value={g.maxBet ?? 10000}
                onChange={(e) => set('maxBet', Number(e.target.value) || 10000)} />
            </div>
          </div>
          <button className="btn btn-primary" style={{ marginTop: 12 }} disabled={busy} onClick={() => save('Period settings saved')}>
            <Ic n="check" s={16} />Save
          </button>
        </div>
      </div>
    </div>
  );
}
