import React, { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase.js';
import { Empty, StatCard, Modal, toast } from '../components/ui.jsx';
import { Ic } from '../lib/icons.jsx';
import { sfx } from '../lib/sound.js';
import { t, useT } from '../lib/i18n.js';
import { money, fmtDT, numColor, copyText } from '../lib/utils.js';

export default function MyBets({ user, onReport }) {
  const t = useT();
  const [bets, setBets] = useState(null);
  const [filter, setFilter] = useState('all');
  const [receipt, setReceipt] = useState(null);

  const FILTERS = [
    { id: 'all', label: t('bets.all'), icon: 'list' },
    { id: 'win', label: t('bets.wins_tab'), icon: 'trophy' },
    { id: 'lose', label: t('bets.losses'), icon: 'x' },
    { id: 'pending', label: t('bets.pending'), icon: 'clock' }
  ];

  useEffect(() => {
    (async () => {
      const { data } = await supabase.from('bets').select('*')
        .eq('uid', user.id).order('created_at', { ascending: false }).limit(100);
      setBets(data || []);
    })();
    const ch = supabase.channel('mybets-rt-' + user.id)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'bets', filter: `uid=eq.${user.id}` }, () => {
        supabase.from('bets').select('*').eq('uid', user.id).order('created_at', { ascending: false }).limit(100)
          .then(({ data }) => setBets(data || []));
      })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [user.id]);

  const list = (bets || []).filter((b) => filter === 'all' || b.result === filter);
  const settled = (bets || []).filter((b) => b.result !== 'pending');
  const wins = settled.filter((b) => b.result === 'win');
  const total = (bets || []).reduce((s, b) => s + Number(b.amount), 0) || 0;
  const wonAmt = wins.reduce((s, b) => s + Number(b.win_amount), 0) || 0;
  const net = settled.reduce((s, b) => s + Number(b.win_amount) - Number(b.amount), 0) || 0;

  return (
    <div>
      <div className="stat-grid" style={{ marginBottom: 14 }}>
        <StatCard label={t('bets.total')} value={bets?.length ?? '…'} sub={money(total)} tone="sc-blue" icon="list" />
        <StatCard label={t('bets.wins')} value={wins.length} sub={money(wonAmt)} tone="sc-green" icon="trophy" />
        <StatCard label={t('bets.net')} value={net >= 0 ? '+' + money(net) : money(net)} tone={net >= 0 ? 'sc-green' : 'sc-red'} icon="trend" />
        <StatCard label={t('bets.pending')} value={(bets || []).filter((b) => b.result === 'pending').length} tone="sc-gold" icon="clock" />
      </div>

      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 12 }}>
        {FILTERS.map((f) => (
          <button key={f.id} className={`tab ${filter === f.id ? 'active' : ''}`} style={{ padding: '7px 13px' }}
            onClick={() => { setFilter(f.id); sfx.click(); }}>
            <Ic n={f.icon} s={14} />{f.label}
          </button>
        ))}
      </div>

      {!bets && <div className="spinner"></div>}
      {bets && list.length === 0 && <Empty icon="target" msg={t('bets.no_bets')} />}

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
              <span className="badge badge-pending">{t('bets.pending').toLowerCase()}</span>
            ) : (
              <div style={{ textAlign: 'right' }}>
                <span className={`badge badge-${b.result}`}>{b.result}</span>
                <div style={{ fontSize: '0.78rem', fontWeight: 800, color: b.result === 'win' ? 'var(--success)' : 'var(--danger)', marginTop: 3 }}>
                  {b.result === 'win' ? '+' + money(b.win_amount) : '-' + money(b.amount)}
                </div>
              </div>
            )}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <button className="icon-btn" style={{ width: 32, height: 32 }} title={t('bets.receipt')}
                onClick={() => { setReceipt(b); sfx.click(); }}><Ic n="file" s={14} /></button>
              {onReport && (
                <button className="icon-btn" style={{ width: 32, height: 32 }} title={t('bets.report')}
                  onClick={() => { sfx.click(); onReport(b); }}><Ic n="alert" s={14} /></button>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Receipt modal */}
      {receipt && (
        <Modal title={t('bets.receipt_title')} icon="file" onClose={() => setReceipt(null)}
          footer={<>
            <button className="btn btn-ghost" onClick={async () => { await copyText(`Bet Receipt BET-${receipt.id}: ${receipt.type} ${receipt.selection}, ${money(receipt.amount)}, period ${receipt.period_id}, result ${receipt.result}, win ${money(receipt.win_amount)}, ${fmtDT(receipt.created_at)}`); toast('Copied', 'success'); }}>
              <Ic n="copy" s={14} />Copy
            </button>
            <button className="btn btn-primary" onClick={() => setReceipt(null)}><Ic n="check" s={15} />{t('common.confirm')}</button>
          </>}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, fontSize: '0.88rem' }}>
            <div><b>{t('bets.period')}:</b> <span style={{ fontFamily: 'monospace', fontSize: '0.8rem' }}>{receipt.period_id}</span></div>
            <div><b>{t('bets.type')}:</b> {receipt.type} {receipt.selection}</div>
            <div><b>{t('bets.amount')}:</b> {money(receipt.amount)}</div>
            <div><b>{t('bets.result')}:</b> <span className={`badge badge-${receipt.result}`}>{receipt.result}</span></div>
            <div><b>{t('bets.win_amount')}:</b> {money(receipt.win_amount)}</div>
            <div><b>{t('bets.time')}:</b> {fmtDT(receipt.created_at)}</div>
            <div style={{ gridColumn: '1 / -1', borderTop: '1px solid var(--border-solid)', paddingTop: 8 }}>
              <b>Receipt ID:</b> <span style={{ fontFamily: 'monospace', fontSize: '0.82rem' }}>BET-{receipt.id}</span>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
