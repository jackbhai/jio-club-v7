import React, { useCallback, useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase.js';
import { Table, Empty, SearchInput } from '../../components/ui.jsx';
import { Ic } from '../../lib/icons.jsx';
import { fmtDT } from '../../lib/utils.js';

export default function Logs() {
  const [rows, setRows] = useState(null);
  const [q, setQ] = useState('');

  const load = useCallback(async () => {
    const { data } = await supabase.from('admin_logs').select('*').order('created_at', { ascending: false }).limit(300);
    setRows(data || []);
  }, []);
  useEffect(() => { load(); }, [load]);

  const list = (rows || []).filter((l) => !q || l.action?.toLowerCase().includes(q.toLowerCase()) || JSON.stringify(l.detail).toLowerCase().includes(q.toLowerCase()));

  return (
    <div>
      <div style={{ display: 'flex', gap: 10, marginBottom: 14, flexWrap: 'wrap' }}>
        <SearchInput value={q} onChange={setQ} placeholder="Search action or detail…" />
        <button className="btn btn-ghost" onClick={load}><Ic n="refresh" s={15} />Refresh</button>
      </div>
      <p className="card-sub" style={{ marginBottom: 10, display: 'flex', gap: 6, alignItems: 'center' }}>
        <Ic n="shieldCheck" s={14} />Every admin action is recorded automatically (who, what, when, params). Latest 300 shown.
      </p>
      {!rows && <div className="spinner"></div>}
      {rows && list.length === 0 && <Empty icon="file" msg="No admin actions logged yet" />}
      {rows && list.length > 0 && (
        <Table headers={['Action', 'Detail', 'Admin', 'Time']}>
          {list.map((l) => (
            <tr key={l.id}>
              <td style={{ fontWeight: 800 }}>{l.action}</td>
              <td style={{ fontFamily: 'monospace', fontSize: '0.74rem', maxWidth: 320, overflow: 'hidden', textOverflow: 'ellipsis' }}>{JSON.stringify(l.detail)}</td>
              <td style={{ fontFamily: 'monospace', fontSize: '0.78rem' }}>{(l.admin_id || '').slice(0, 8) || 'system'}</td>
              <td>{fmtDT(l.created_at)}</td>
            </tr>
          ))}
        </Table>
      )}
    </div>
  );
}
