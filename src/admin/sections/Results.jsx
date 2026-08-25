import React, { useCallback, useEffect, useState } from 'react';
import { supabase, rpc } from '../../lib/supabase.js';
import { toast, Empty, SearchInput } from '../../components/ui.jsx';
import { Ic } from '../../lib/icons.jsx';
import { sfx } from '../../lib/sound.js';
import { numColor } from '../../lib/utils.js';

export default function Results() {
  const [rows, setRows] = useState(null);
  const [force, setForce] = useState('');
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const { data } = await supabase.from('results').select('*').order('created_at', { ascending: false }).limit(200);
    setRows(data || []);
  }, []);
  useEffect(() => {
    load();
    const ch = supabase.channel('admin-results')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'results' }, () => load())
      .subscribe();
    const iv = setInterval(load, 15000);
    return () => { supabase.removeChannel(ch); clearInterval(iv); };
  }, [load]);

  const list = (rows || []).filter((r) => !q || r.period_id.includes(q));

  async function applyForce() {
    const n = force === '' ? null : parseInt(force, 10);
    if (n !== null && (isNaN(n) || n < 0 || n > 9)) { toast('Number must be 0-9', 'error'); return; }
    setBusy(true);
    try {
      await rpc('admin_action', { p_action: 'force-result', p_params: { number: n } });
      sfx.cash();
      toast(n === null ? 'Force result cleared — engine wapas normal' : `Next period FORCED to ${n}`, 'success');
      setForce('');
    } catch (e) { toast(e.message, 'error'); }
    finally { setBusy(false); }
  }

  async function settleNow() {
    setBusy(true);
    try {
      await rpc('admin_action', { p_action: 'tick-now' });
      sfx.cash(); toast('Settled!', 'success');
      load();
    } catch (e) { toast(e.message, 'error'); }
    finally { setBusy(false); }
  }

  return (
    <div>
      <div className="card" style={{ marginBottom: 14 }}>
        <div className="card-title"><Ic n="zap" s={17} />Force Next Result + Live Trigger</div>
        <p className="card-sub" style={{ marginBottom: 10 }}>
          Next period ka result fix karo (ek period ke liye). “Settle Now” se latest pending period turant resolve hota hai.
        </p>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          {[0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => (
            <button key={n} className={`num num-sm ${numColor(n)}`} style={{ width: 40, height: 40, outline: force === String(n) ? '3px solid var(--accent)' : 'none' }}
              onClick={() => { setForce(String(n)); sfx.click(); }}>
              {n}
            </button>
          ))}
          <button className="btn btn-ghost" onClick={() => setForce('')} disabled={busy}><Ic n="refresh" s={14} />Clear</button>
          <button className="btn btn-primary" onClick={applyForce} disabled={busy}>
            <Ic n="check" s={15} />{force === '' ? 'Restore Engine' : `Force ${force}`}
          </button>
          <button className="btn btn-success" onClick={settleNow} disabled={busy}>
            <Ic n="bolt" s={15} />Settle Now
          </button>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 10, marginBottom: 12 }}>
        <SearchInput value={q} onChange={setQ} placeholder="Search period ID…" />
        <button className="btn btn-ghost" onClick={load}><Ic n="refresh" s={15} />Refresh</button>
      </div>

      {!rows && <div className="spinner"></div>}
      {rows && list.length === 0 && <Empty icon="dice" msg="No results yet — first period settles within a minute" />}

      {rows && list.length > 0 && (
        <div className="card">
          <div className="card-title" style={{ marginTop: 4 }}><Ic n="list" s={16} />Result Log (full period IDs)</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {list.slice(0, 100).map((r) => (
              <div key={r.period_id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '7px 0', borderBottom: '1px solid var(--border)' }}>
                <div className={`num num-sm ${numColor(r.number)}`} style={{ width: 32, height: 32, flexShrink: 0 }}>{r.number}</div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontFamily: 'monospace', fontSize: '0.82rem', fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.period_id}</div>
                  <div style={{ fontSize: '0.7rem', color: 'var(--text-dim)' }}>{r.color} · {r.size} · {new Date(r.created_at).toLocaleString('en-IN')}</div>
                </div>
                <button className="btn btn-ghost btn-sm" onClick={async () => { await navigator.clipboard?.writeText(r.period_id).catch(() => {}); toast('Period ID copied', 'success'); }}>
                  <Ic n="copy" s={13} />
                </button>
              </div>
            ))}
          </div>
          <div style={{ marginTop: 12, color: 'var(--text-dim)', fontSize: '0.78rem', display: 'flex', gap: 6, alignItems: 'center' }}>
            <Ic n="info" s={12} />{list.length} results shown (latest 200 max)
          </div>
        </div>
      )}
    </div>
  );
}
