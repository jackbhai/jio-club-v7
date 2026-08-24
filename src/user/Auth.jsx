import React, { useState } from 'react';
import { supabase, rpc } from '../lib/supabase.js';
import { toast, Field } from '../components/ui.jsx';
import { Ic } from '../lib/icons.jsx';
import { sfx } from '../lib/sound.js';

export default function Auth({ refCode }) {
  const [mode, setMode] = useState('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [ref, setRef] = useState(refCode || '');
  const [busy, setBusy] = useState(false);

  async function onLogin(e) {
    e?.preventDefault();
    if (!email || !password) { toast('Enter email and password', 'error'); return; }
    setBusy(true); sfx.click();
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setBusy(false);
    if (error) { sfx.error(); toast(error.message, 'error'); return; }
    sfx.cash();
    toast('Welcome back!', 'success');
  }

  async function onSignup(e) {
    e?.preventDefault();
    if (!email || !password) { toast('Enter email and password', 'error'); return; }
    if (password.length < 6) { toast('Password: minimum 6 characters', 'error'); return; }
    setBusy(true); sfx.click();
    const { data, error } = await supabase.auth.signUp({ email, password });
    setBusy(false);
    if (error) { sfx.error(); toast(error.message, 'error'); return; }
    if (data.session) {
      try {
        const b = await rpc('claim_welcome_bonus');
        if (b && Number(b.bonus) > 0) toast(`Welcome bonus ₹${b.bonus} added!`, 'success');
      } catch (err) { /* optional */ }
      if (ref) {
        try { await rpc('claim_referral', { p_code: ref }); toast('Referral code applied', 'success'); }
        catch (err) { toast('Referral: ' + err.message, 'info'); }
      }
      sfx.win();
      toast('Account created!', 'success');
    } else {
      toast('Signup email sent — confirm, then login', 'info');
      setMode('login');
    }
  }

  async function onForgot(e) {
    e?.preventDefault();
    if (!email) { toast('Enter your email', 'error'); return; }
    setBusy(true);
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: window.location.origin + window.location.pathname
    });
    setBusy(false);
    if (error) { sfx.error(); toast(error.message, 'error'); }
    else { sfx.cash(); toast('Reset link sent to ' + email, 'success'); }
  }

  return (
    <div className="auth-wrap">
      <div className="auth-card">
        <div className="auth-logo">
          <div className="logo-badge"><Ic n="dice" s={38} /></div>
          <h1>JIO CLUB</h1>
          <p>Color Prediction — Play, Win, Climb Ranks</p>
        </div>
        <div className="card" style={{ padding: 22 }}>
          <div className="tabs">
            <button className={`tab ${mode === 'login' ? 'active' : ''}`} onClick={() => { setMode('login'); sfx.click(); }}>
              <Ic n="user" s={15} />Login
            </button>
            <button className={`tab ${mode === 'signup' ? 'active' : ''}`} onClick={() => { setMode('signup'); sfx.click(); }}>
              <Ic n="userPlus" s={15} />Sign Up
            </button>
          </div>
          <form onSubmit={mode === 'forgot' ? onForgot : mode === 'signup' ? onSignup : onLogin}>
            <Field label="Email">
              <input className="input" type="email" placeholder="you@example.com" value={email}
                onChange={(e) => setEmail(e.target.value)} autoComplete="email" required />
            </Field>
            {mode === 'signup' && (
              <Field label="Referral Code (optional)">
                <input className="input" placeholder="ABC123" value={ref} onChange={(e) => setRef(e.target.value.toUpperCase())} maxLength={8} />
              </Field>
            )}
            {mode !== 'forgot' && (
              <Field label="Password">
                <input className="input" type="password" placeholder="••••••••" value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete={mode === 'signup' ? 'new-password' : 'current-password'} required />
              </Field>
            )}
            <button className="btn btn-primary btn-block" type="submit" disabled={busy} style={{ marginTop: 6 }}>
              {busy ? 'Please wait…' : mode === 'login' ? <><Ic n="logout" s={16} style={{ transform: 'rotate(180deg)' }} />Login</>
                : mode === 'signup' ? <><Ic n="rocket" s={16} />Create Account</>
                : <><Ic n="mail" s={16} />Send Reset Link</>}
            </button>
          </form>
          <div style={{ textAlign: 'center', marginTop: 14, fontSize: '0.85rem', color: 'var(--text-dim)' }}>
            {mode === 'login' && (
              <span>Forgot password?{' '}
                <a href="#" onClick={(e) => { e.preventDefault(); setMode('forgot'); sfx.click(); }}>Reset it</a>
              </span>
            )}
            {mode === 'forgot' && (
              <a href="#" onClick={(e) => { e.preventDefault(); setMode('login'); sfx.click(); }}>
                <Ic n="arrowLeft" s={13} /> Back to login
              </a>
            )}
            {mode === 'signup' && <span>New here? Great — signup takes 10 seconds.</span>}
          </div>
        </div>
        <p style={{ textAlign: 'center', color: 'var(--text-dim)', fontSize: '0.72rem', marginTop: 14, display: 'flex', gap: 6, justifyContent: 'center', alignItems: 'center' }}>
          <Ic n="shield" s={12} /> Play responsibly. 18+ only.
        </p>
      </div>
    </div>
  );
}
