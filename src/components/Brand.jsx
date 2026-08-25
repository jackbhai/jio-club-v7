import React from 'react';
import { Ic } from '../lib/icons.jsx';

// Brand logo: uploaded logo image > monogram text > default dice icon
export function Brand({ app, s = 18, className = '' }) {
  if (app?.logoUrl) {
    return (
      <img
        src={app.logoUrl}
        alt="logo"
        className={className}
        style={{ width: s + 8, height: s + 8, borderRadius: 7, objectFit: 'cover', flexShrink: 0 }}
      />
    );
  }
  if (app?.logoText) {
    return (
      <span
        className={className}
        style={{
          width: s + 10, height: s + 10, borderRadius: 7, flexShrink: 0,
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          background: 'linear-gradient(135deg, var(--accent), var(--accent-2))',
          color: '#fff', fontWeight: 900, fontSize: s * 0.62, letterSpacing: 0.5,
          boxShadow: '0 2px 8px rgba(124,108,255,0.4)'
        }}
      >
        {app.logoText.slice(0, 2).toUpperCase()}
      </span>
    );
  }
  return <Ic n="dice" s={s} className={className} />;
}
