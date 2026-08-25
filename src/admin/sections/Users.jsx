import React, { useCallback, useEffect, useState } from 'react';
import { supabase, rpc } from '../../lib/supabase.js';
import { Table, Modal, Field, toast, StatCard, Confirm, SearchInput, RankBadge, Empty, Tabs } from '../../components/ui.jsx';
import { Ic } from '../../lib/icons.jsx';
import { sfx } from '../../lib/sound.js';
import { money, fmtDT, exportCSV, numColor } from '../../lib/utils.js';

export default function Users() {
  const [users, setUsers] = useState(null);
  const [q, setQ] = useState('');
  const [view, setView] = useState(null);
  const [detail, setDetail] = useState(null);
  const [detailTab, setDetailTab] = useState('overview');
  const [adj, setAdj] = useState(null);
  const [adjAmt, setAdjAmt] = useState('');
  const [adjReason, setAdjReason] = useState('');
  const [rankSel, setRankSel] = useState(null);
  const [del, setDel] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const { data } = await supabase.from('profiles').select('*').order('created_at', { ascending: false }).limit(500);
    setUsers(data || []);
  }, []);
  useEffect(() => { load(); }, [load]);

  const list = (users || []).filter((u) =>
    !q || u.email?.toLowerCase().includes(q.toLowerCase()) || u.referral_code?.toLowerCase().includes(q.toLowerCase()));

  async function myId() {
    const { data } = await supabase.auth.getSession();
    return data.session?.user?.id || null;
  }

  // Audit trail maintain karo (RPC jaisa hi admin_logs entry)
  async function audit(action, params) {
    try {
      const me = await myId();
      await supabase.from('admin_logs').insert({ admin_id: me, action, detail: params });
    } catch (e) { /* audit best-effort */ }
  }

  async function act(action, params, okMsg) {
    setBusy(true);
    try {
      if (action === 'set-rank') {
        // Direct REST (DB me yeh RPC branch uuid=text bug se toota hai — REST path safe hai)
        const { error } = await supabase.from('profiles').update({ rank: params.rank }).eq('id', params.uid);
        if (error) throw error;
        await audit('set-rank', params);
      } else if (action === 'delete-user') {
        const me = await myId();
        if (params.uid === me) throw new Error('Khud ko delete nahi kar sakte');
        const { data: tgt } = await supabase.from('profiles').select('role').eq('id', params.uid).maybeSingle();
        if (tgt?.role === 'admin') throw new Error('Admin user delete nahi ho sakta');
        const { error } = await supabase.from('profiles').delete().eq('id', params.uid);
        if (error) throw error;
        await audit('delete-user', params);
      } else {
        await rpc('admin_action', { p_action: action, p_params: params });
      }
      sfx.cash(); toast(okMsg, 'success');
      load();
    } catch (e) { sfx.error(); toast(e.message, 'error'); }
    finally { setBusy(false); }
  }

  async function openView(u) {
    setView(u);
    setDetailTab('overview');
    setDetail(null);
    const [bets, deps, wds, team] = await Promise.all([
      supabase.from('bets').select('*').eq('uid', u.id).order('created_at', { ascending: false }).limit(10),
      supabase.from('deposits').select('*').eq('uid', u.id).order('created_at', { ascending: false }).limit(10),
      supabase.from('withdrawals').select('*').eq('uid', u.id).order('created_at', { ascending: false }).limit(10),
      supabase.from('profiles').select('email, rank, referral_count, created_at').eq('referred_by', u.id).limit(50)
    ]);
    setDetail({ bets: bets.data || [], deps: deps.data || [], wds: wds.data || [], team: team.data || [] });
  }

  function doAdjust() {
    const delta = parseFloat(adjAmt);
    if (!delta) { toast('Enter non-zero amount (+/-)', 'error'); return; }
    act('adjust-balance', { uid: adj.id, delta, reason: adjReason || 'Manual adjustment' }, `Balance ${delta > 0 ? '+' : ''}${money(delta)} → user`);
    setAdj(null); setAdjAmt(''); setAdjReason('');
  }

  function doExport() {
    exportCSV(`users-${new Date().toISOString().slice(0, 10)}.csv`,
      ['Email', 'Balance', 'Rank', 'Status', 'RefCode', 'ReferredBy', 'RefCount', 'Deposits', 'Withdrawn', 'Bets', 'Won', 'Created'],
      list.map((u) => [u.email, u.balance, u.rank, u.status, u.referral_code, (u.referred_by || '').slice(0, 8), u.referral_count, u.total_deposits, u.total_withdrawn, u.total_bet, u.total_won, fmtDT(u.created_at)]));
    toast('CSV exported', 'success');
  }

  return (
    <div>
      <div className="stat-grid" style={{ marginBottom: 14 }}>
        <StatCard label="Total Users" value={users?.length ?? '…'} tone="sc-blue" icon="users" />
        <StatCard label="Active" value={users?.filter((u) => u.status === 'active').length ?? '…'} tone="sc-green" icon="checkCircle" />
        <StatCard label="Blocked" value={users?.filter((u) => u.status === 'blocked').length ?? '…'} tone="sc-red" icon="ban" />
        <StatCard label="Total Balance" value={money(users?.reduce((s, u) => s + Number(u.balance), 0) || 0)} tone="sc-gold" icon="coins" />
      </div>

      <div style={{ display: 'flex', gap: 10, marginBottom: 14, flexWrap: 'wrap', alignItems: 'center' }}>
        <SearchInput value={q} onChange={setQ} placeholder="Search email or referral code…" />
        <button className="btn btn-ghost" onClick={load}><Ic n="refresh" s={15} />Refresh</button>
        <button className="btn btn-ghost" onClick={doExport}><Ic n="export" s={15} />Export CSV</button>
      </div>

      {!users && <div className="spinner"></div>}
      {users && list.length === 0 && <Empty icon="users" msg="No users match your search" />}

      {users && list.length > 0 && (
        <Table headers={['Email', 'Balance', 'Rank', 'Status', 'Ref Code', 'Team', 'Deposits', 'Won', 'Joined', 'Actions']}>
          {list.map((u) => (
            <tr key={u.id}>
              <td>
                <b>{u.email}</b>
                {u.self_excluded && <div><span className="badge badge-pending" style={{ marginTop: 3 }}><Ic n="pause" s={10} />self-excluded</span></div>}
                {u.deletion_requested && <div><span className="badge badge-rejected" style={{ marginTop: 3 }}><Ic n="trash" s={10} />deletion requested</span></div>}
              </td>
              <td style={{ fontWeight: 800 }}>{money(u.balance)}</td>
              <td><RankBadge rank={u.rank} small /></td>
              <td><span className={`badge badge-${u.status}`}>{u.status}</span></td>
              <td style={{ fontFamily: 'monospace' }}>{u.referral_code}</td>
              <td>{u.referral_count}</td>
              <td>{money(u.total_deposits)}</td>
              <td>{money(u.total_won)}</td>
              <td>{fmtDT(u.created_at)}</td>
              <td>
                <div style={{ display: 'flex', gap: 5 }}>
                  <button className="btn btn-ghost btn-sm" onClick={() => { openView(u); sfx.click(); }} title="View full profile"><Ic n="eye" s={14} /></button>
                  <button className="btn btn-ghost btn-sm" onClick={() => { setAdj(u); sfx.click(); }} title="Adjust balance"><Ic n="plus" s={14} /></button>
                  <button className="btn btn-ghost btn-sm" onClick={() => { setRankSel({ u, rank: u.rank }); sfx.click(); }} title="Set rank"><Ic n="medal" s={14} /></button>
                  <button className={`btn btn-sm ${u.status === 'active' ? 'btn-danger' : 'btn-success'}`}
                    title={u.status === 'active' ? 'Block' : 'Unblock'}
                    onClick={() => act('set-status', { uid: u.id, status: u.status === 'active' ? 'blocked' : 'active' }, u.status === 'active' ? 'User blocked' : 'User unblocked')}>
                    <Ic n={u.status === 'active' ? 'ban' : 'checkCircle'} s={14} />
                  </button>
                  {u.role !== 'admin' && <button className="btn btn-ghost btn-sm" title="Delete" onClick={() => setDel(u)}><Ic n="trash" s={14} /></button>}
                </div>
              </td>
            </tr>
          ))}
        </Table>
      )}

      {/* USER FULL DETAIL */}
      {view && (
        <Modal title={view.email} icon="user" onClose={() => setView(null)}
          footer={<button className="btn btn-ghost" onClick={() => setView(null)}>Close</button>}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, fontSize: '0.88rem', marginBottom: 14 }}>
            <div><b>Balance:</b> {money(view.balance)}</div>
            <div><b>Rank:</b> <RankBadge rank={view.rank} small /></div>
            <div><b>Status:</b> <span className={`badge badge-${view.status}`}>{view.status}</span></div>
            <div><b>Role:</b> {view.role}</div>
            <div><b>Phone:</b> {view.phone || '—'}</div>
            <div><b>UPI:</b> {view.upi_id || '—'}</div>
            <div><b>Ref code:</b> <span style={{ fontFamily: 'monospace' }}>{view.referral_code}</span></div>
            <div><b>Referred by:</b> {(view.referred_by || '—').slice(0, 8)}</div>
            <div><b>Team size:</b> {view.referral_count}</div>
            <div><b>Joined:</b> {fmtDT(view.created_at)}</div>
            <div><b>Deposits:</b> {money(view.total_deposits)}</div>
            <div><b>Withdrawn:</b> {money(view.total_withdrawn)}</div>
            <div><b>Total bet:</b> {money(view.total_bet)}</div>
            <div><b>Total won:</b> {money(view.total_won)}</div>
          </div>

          <Tabs active={detailTab} onChange={setDetailTab} tabs={[
            { id: 'bets', label: `Bets (${detail?.bets?.length || 0})`, icon: 'target' },
            { id: 'deps', label: `Deposits (${detail?.deps?.length || 0})`, icon: 'arrowDown' },
            { id: 'wds', label: `Withdrawals (${detail?.wds?.length || 0})`, icon: 'arrowUp' },
            { id: 'team', label: `Team (${detail?.team?.length || 0})`, icon: 'users' }
          ]} />

          {!detail && <div className="spinner" style={{ margin: '16px auto' }}></div>}
          {detail && (
            <div style={{ maxHeight: '34vh', overflowY: 'auto' }}>
              {detailTab === 'bets' && (detail.bets.length === 0 ? <Empty icon="target" msg="No bets" /> :
                detail.bets.map((b) => (
                  <div key={b.id} style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '7px 0', borderBottom: '1px solid var(--border)', fontSize: '0.84rem' }}>
                    <span className={`num num-sm ${numColor(parseInt(b.selection, 10) || 0)}`} style={{ width: 26, height: 26, fontSize: '0.68rem' }}>{b.selection}</span>
                    <span style={{ flex: 1 }}>{b.type}: {b.selection} · {money(b.amount)}</span>
                    <span className={`badge badge-${b.result}`}>{b.result}</span>
                  </div>
                )))}
              {detailTab === 'deps' && (detail.deps.length === 0 ? <Empty icon="arrowDown" msg="No deposits" /> :
                detail.deps.map((d) => (
                  <div key={d.id} style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '7px 0', borderBottom: '1px solid var(--border)', fontSize: '0.84rem' }}>
                    <b style={{ flex: 1 }}>{money(d.amount)}</b>
                    <span className="card-sub">{fmtDT(d.created_at)}</span>
                    <span className={`badge badge-${d.status}`}>{d.status}</span>
                  </div>
                )))}
              {detailTab === 'wds' && (detail.wds.length === 0 ? <Empty icon="arrowUp" msg="No withdrawals" /> :
                detail.wds.map((w) => (
                  <div key={w.id} style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '7px 0', borderBottom: '1px solid var(--border)', fontSize: '0.84rem' }}>
                    <b style={{ flex: 1 }}>{money(w.amount)} → {w.upi_id}</b>
                    <span className="card-sub">{fmtDT(w.created_at)}</span>
                    <span className={`badge badge-${w.status}`}>{w.status}</span>
                  </div>
                )))}
              {detailTab === 'team' && (detail.team.length === 0 ? <Empty icon="users" msg="No referred users yet" /> :
                detail.team.map((t) => (
                  <div key={t.email} style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '7px 0', borderBottom: '1px solid var(--border)', fontSize: '0.84rem' }}>
                    <span style={{ flex: 1 }}>{t.email}</span>
                    <RankBadge rank={t.rank} small />
                    <span className="card-sub">{fmtDT(t.created_at)}</span>
                  </div>
                )))}
            </div>
          )}
        </Modal>
      )}

      {/* Adjust balance */}
      {adj && (
        <Modal title={`Adjust Balance — ${adj.email}`} icon="coins" onClose={() => setAdj(null)}
          footer={<>
            <button className="btn btn-ghost" onClick={() => setAdj(null)}>Cancel</button>
            <button className="btn btn-primary" onClick={doAdjust} disabled={busy}><Ic n="check" s={15} />Apply</button>
          </>}>
          <p className="card-sub" style={{ marginBottom: 12 }}>Current balance: <b>{money(adj.balance)}</b></p>
          <Field label="Amount (+ add / − deduct)">
            <input className="input" type="number" placeholder="e.g. 100 or -50" value={adjAmt} onChange={(e) => setAdjAmt(e.target.value)} autoFocus />
          </Field>
          <Field label="Reason (sent to user as notification)">
            <input className="input" placeholder="e.g. Bonus, correction, support" value={adjReason} onChange={(e) => setAdjReason(e.target.value)} />
          </Field>
        </Modal>
      )}

      {/* Set rank */}
      {rankSel && (
        <Modal title={`Set Rank — ${rankSel.u.email}`} icon="medal" onClose={() => setRankSel(null)}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {['bronze', 'silver', 'gold', 'platinum', 'diamond'].map((r) => (
              <button key={r} className={`btn ${rankSel.rank === r ? 'btn-primary' : 'btn-ghost'}`}
                onClick={async () => { await act('set-rank', { uid: rankSel.u.id, rank: r }, `Rank set to ${r}`); setRankSel(null); }}>
                <RankBadge rank={r} />
              </button>
            ))}
          </div>
        </Modal>
      )}

      {del && (
        <Confirm title="Delete user?" icon="trash"
          msg={`This permanently removes ${del.email}, their bets, deposits, withdrawals and chat messages. This cannot be undone.`}
          onNo={() => setDel(null)}
          onYes={async () => { await act('delete-user', { uid: del.id }, 'User deleted'); setDel(null); }} />
      )}
    </div>
  );
}
