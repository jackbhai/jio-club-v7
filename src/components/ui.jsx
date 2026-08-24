import React, { useEffect, useState } from 'react';
import { Ic, RANK_ICONS } from '../lib/icons.jsx';

/* ---------------- Toasts (global, event-based) ---------------- */
export function toast(msg, type = 'info') {
  window.dispatchEvent(new CustomEvent('jc:toast', { detail: { msg, type, id: Date.now() + Math.random() } }));
}

export function Toasts() {
  const [items, setItems] = useState([]);
  useEffect(() => {
    const on = (e) => {
      const t = e.detail;
      setItems((xs) => [...xs, t].slice(-4));
      setTimeout(() => setItems((xs) => xs.filter((x) => x.id !== t.id)), 3200);
    };
    window.addEventListener('jc:toast', on);
    return () => window.removeEventListener('jc:toast', on);
  }, []);
  const icons = { success: 'checkCircle', error: 'alert', info: 'info' };
  return (
    <div className="toast-zone">
      {items.map((t) => (
        <div key={t.id} className={`toast toast-${t.type}`}>
          <Ic n={icons[t.type]} />
          <span>{t.msg}</span>
        </div>
      ))}
    </div>
  );
}

/* ---------------- Modal ---------------- */
export function Modal({ title, icon, onClose, children, footer }) {
  useEffect(() => {
    const on = (e) => e.key === 'Escape' && onClose && onClose();
    window.addEventListener('keydown', on);
    return () => window.removeEventListener('keydown', on);
  }, [onClose]);
  return (
    <div className="modal-overlay" onClick={(e) => e.target === e.currentTarget && onClose && onClose()}>
      <div className="modal">
        <div className="modal-head">
          <h3>{icon && <Ic n={icon} />}{title}</h3>
          {onClose && <button className="modal-close" onClick={onClose}><Ic n="x" s={17} /></button>}
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  );
}

/* ---------------- Confirm ---------------- */
export function Confirm({ title = 'Are you sure?', msg, onYes, onNo, danger = true, yesLabel = 'Confirm', icon = 'alert' }) {
  return (
    <Modal title={title} icon={icon} onClose={onNo}
      footer={<>
        <button className="btn btn-ghost" onClick={onNo}>Cancel</button>
        <button className={`btn ${danger ? 'btn-danger' : 'btn-primary'}`} onClick={onYes}>{yesLabel}</button>
      </>}>
      <p style={{ color: 'var(--text-dim)', fontSize: '0.92rem', lineHeight: 1.5 }}>{msg}</p>
    </Modal>
  );
}

/* ---------------- Toggle ---------------- */
export function Toggle({ checked, onChange, disabled }) {
  return (
    <label className="toggle">
      <input type="checkbox" checked={!!checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span className="slider" onClick={() => !disabled && onChange(!checked)} />
    </label>
  );
}

/* ---------------- Stat card ---------------- */
export function StatCard({ label, value, sub, tone = '', icon }) {
  return (
    <div className={`stat-card ${tone}`}>
      {icon && <span className="stat-ico"><Ic n={icon} s={26} /></span>}
      <div className="stat-label">{label}</div>
      <div className="stat-value">{value}</div>
      {sub && <div className="stat-sub">{sub}</div>}
    </div>
  );
}

/* ---------------- Rank badge (SVG) ---------------- */
export function RankBadge({ rank, small }) {
  const m = { bronze: 'Bronze', silver: 'Silver', gold: 'Gold', platinum: 'Platinum', diamond: 'Diamond' }[rank] || 'Bronze';
  return (
    <span className={`rank-badge rank-${rank || 'bronze'}`} style={small ? { fontSize: '0.66rem', padding: '2px 8px' } : ''}>
      <Ic n={RANK_ICONS[rank] || 'medal'} s={small ? 11 : 13} /> {m}
    </span>
  );
}

/* ---------------- Table ---------------- */
export function Table({ headers, children }) {
  return (
    <div className="table-wrap" style={{ maxHeight: '62vh' }}>
      <table className="data">
        <thead><tr>{headers.map((h, i) => <th key={i}>{h}</th>)}</tr></thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

/* ---------------- Tabs ---------------- */
export function Tabs({ tabs, active, onChange }) {
  return (
    <div className="tabs">
      {tabs.map((t) => (
        <button key={t.id} className={`tab ${active === t.id ? 'active' : ''}`} onClick={() => onChange(t.id)}>
          {t.icon && <Ic n={t.icon} s={15} />}{t.label}
        </button>
      ))}
    </div>
  );
}

/* ---------------- Field ---------------- */
export function Field({ label, children, hint }) {
  return (
    <div className="form-group">
      {label && <label>{label}</label>}
      {children}
      {hint && <div style={{ fontSize: '0.74rem', color: 'var(--text-dim)', marginTop: 5 }}>{hint}</div>}
    </div>
  );
}

/* ---------------- Empty / Spinner ---------------- */
export function Empty({ icon = 'inbox', msg = 'Nothing here yet' }) {
  return <div className="empty"><div className="empty-icon"><Ic n={icon} s={44} /></div><div>{msg}</div></div>;
}
export function Spinner({ label = 'Loading…' }) {
  return <div className="loading-screen"><div className="spinner"></div><div>{label}</div></div>;
}

/* ---------------- Search input ---------------- */
export function SearchInput({ value, onChange, placeholder = 'Search…' }) {
  return (
    <div style={{ position: 'relative', width: '100%', maxWidth: 320 }}>
      <span style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-dim)', display: 'flex' }}>
        <Ic n="search" s={16} />
      </span>
      <input className="input" style={{ paddingLeft: 36 }} placeholder={placeholder} value={value} onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}

/* ---------------- Confetti burst ---------------- */
export function Confetti({ count = 60 }) {
  const colors = ['#7c6cff', '#00e676', '#ffd75e', '#ff5252', '#00e5ff', '#ff9ecb'];
  const pieces = React.useMemo(() =>
    Array.from({ length: count }, (_, i) => ({
      left: Math.random() * 100,
      delay: Math.random() * 0.7,
      dur: 2.2 + Math.random() * 1.6,
      color: colors[i % colors.length],
      rot: Math.random() * 360
    })), [count]);
  return (
    <>
      {pieces.map((p, i) => (
        <div key={i} className="confetti" style={{
          left: p.left + 'vw', background: p.color,
          animationDuration: p.dur + 's', animationDelay: p.delay + 's',
          transform: `rotate(${p.rot}deg)`
        }} />
      ))}
    </>
  );
}
