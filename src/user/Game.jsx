import React, { useEffect, useRef, useState, useCallback } from 'react';
import { supabase, rpc } from '../lib/supabase.js';
import { Modal, toast, Confetti } from '../components/ui.jsx';
import { Ic } from '../lib/icons.jsx';
import { sfx } from '../lib/sound.js';
import { money, numColor } from '../lib/utils.js';

const QUICK_AMTS = [10, 50, 100, 500];
const MULTS = [1, 5, 10, 20];

function isWin(bet, r) {
  if (bet.type === 'color') {
    if (bet.selection === 'Green') return r.color === 'Green' || r.color === 'Red+Violet';
    if (bet.selection === 'Red') return r.color === 'Red' || r.color === 'Red+Violet';
    if (bet.selection === 'Violet') return r.color === 'Red+Violet';
  }
  if (bet.type === 'number') return String(r.number) === String(bet.selection);
  if (bet.type === 'size') return r.size === bet.selection;
  return false;
}

function payoutFor(bet, payouts) {
  if (bet.type === 'color') return payouts[bet.selection.toLowerCase()] || 0;
  if (bet.type === 'number') return payouts.number || 0;
  return payouts.size || 0;
}

export default function Game({ game, profile, onGame }) {
  const [now, setNow] = useState(Date.now());
  const [results, setResults] = useState(game?.lastResults || []);
  const [bet, setBet] = useState(null);
  const [amount, setAmount] = useState('');
  const [mult, setMult] = useState(1);
  const [busy, setBusy] = useState(false);
  const [announce, setAnnounce] = useState(null);
  const [confetti, setConfetti] = useState(false);
  const [myBet, setMyBet] = useState(null);
  const lastTickSec = useRef(-1);

  const g = game || {};
  const gameCfg = g.game || {};
  const payouts = g.payouts || {};
  const durMs = (gameCfg.duration || 60) * 1000;
  const closeMs = (gameCfg.betCloseSeconds || 5) * 1000;
  const periodStart = g.periodStart || Math.floor(Date.now() / durMs) * durMs;
  const periodId = g.periodId || 'P' + Math.floor(periodStart / 1000);
  const remaining = periodStart + durMs - now;
  const bettingOpen = remaining > closeMs && gameCfg.active !== false && gameCfg.maintenance !== true;
  const paused = gameCfg.active === false || gameCfg.maintenance === true;

  useEffect(() => { if (game?.lastResults) setResults(game.lastResults); }, [game?.lastResults]);

  useEffect(() => {
    const iv = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(iv);
  }, []);

  const totalMs = Math.max(1, Math.min(remaining, durMs));
  const secLeft = Math.max(0, Math.ceil(remaining / 1000));
  const progress = totalMs / durMs;
  const C = 2 * Math.PI * 56;

  useEffect(() => {
    if (bettingOpen && secLeft <= 5 && secLeft > 0 && lastTickSec.current !== secLeft && gameCfg.maintenance !== true) {
      lastTickSec.current = secLeft;
      if (g.sounds?.tick !== false) sfx.tick();
    }
    if (secLeft > 5) lastTickSec.current = -1;
  }, [secLeft, bettingOpen]);

  const refetch = useCallback(() => {
    rpc('game_state').then(onGame).catch(() => {});
  }, [onGame]);
  useEffect(() => { if (remaining < -2500) refetch(); }, [remaining, refetch]);

  useEffect(() => {
    if (!profile) return;
    const ch = supabase.channel('game-realtime-' + profile.id)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'results' }, (p) => {
        const r = p.new;
        sfx.flip();
        if (myBet && myBet.periodId === r.period_id) {
          const won = isWin(myBet, r);
          const winAmt = won ? myBet.amount * payoutFor(myBet, payouts) : 0;
          setTimeout(() => {
            setAnnounce({ number: r.number, color: r.color, size: r.size, won, amount: myBet.amount, winAmount: winAmt });
            if (won) { if (g.sounds?.win !== false) sfx.win(); setConfetti(true); setTimeout(() => setConfetti(false), 3800); }
            else if (g.sounds?.lose !== false) sfx.lose();
          }, 650);
          setTimeout(refetch, 900);
        } else {
          setResults((xs) => [r, ...xs].slice(0, 50));
        }
      })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [profile?.id, myBet, payouts, refetch]);

  useEffect(() => {
    if (myBet && game?.periodId && myBet.periodId !== game.periodId) {
      setMyBet(null);
      lastTickSec.current = -1;
    }
  }, [game?.periodId]);

  function openBet(type, selection) {
    if (!bettingOpen) { toast('Betting closed — wait for next period', 'error'); return; }
    if (myBet) { toast('You already have a bet in this period', 'info'); return; }
    sfx.click();
    setBet({ type, selection });
    setAmount('');
    setMult(1);
  }

  const amt = Math.round((parseFloat(amount) || 0) * mult * 100) / 100;

  async function placeBet() {
    if (!bet || !amt || amt <= 0) { toast('Enter bet amount', 'error'); return; }
    if (amt > (profile.balance || 0)) { toast('Insufficient balance', 'error'); sfx.error(); return; }
    setBusy(true); sfx.click();
    try {
      const res = await rpc('place_bet', { p_type: bet.type, p_selection: bet.selection, p_amount: amt });
      setMyBet({ type: bet.type, selection: bet.selection, amount: amt, periodId: res.periodId });
      setBet(null);
      sfx.cash();
      toast(`Bet placed: ${bet.selection} — ${money(amt)}`, 'success');
    } catch (e) {
      sfx.error();
      toast(e.message, 'error');
    } finally { setBusy(false); }
  }

  return (
    <div>
      {confetti && <Confetti />}

      {/* Period + Timer */}
      <div className="card" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: 14 }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.68rem', fontWeight: 800, letterSpacing: 1.2, textTransform: 'uppercase', color: 'var(--text-dim)' }}>
            <Ic n="hash" s={12} />Current Period
          </div>
          <div style={{ fontSize: '1.08rem', fontWeight: 900, fontFamily: 'monospace', letterSpacing: 1, marginTop: 4 }}>{periodId}</div>
          <div style={{ fontSize: '0.72rem', color: 'var(--text-dim)', marginTop: 4, display: 'flex', gap: 5, alignItems: 'center' }}>
            <Ic n="clock" s={12} />{gameCfg.duration || 60}s period
          </div>
        </div>
        <div className={`timer-ring ${secLeft <= 5 && bettingOpen ? 'warning' : ''}`}>
          <svg width="132" height="132" viewBox="0 0 132 132">
            <defs>
              <linearGradient id="ringGrad" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0" stopColor="#7c6cff" />
                <stop offset="1" stopColor="#00c896" />
              </linearGradient>
            </defs>
            <circle className="ring-bg" cx="66" cy="66" r="56" fill="none" strokeWidth="9" />
            <circle className="ring-fg" cx="66" cy="66" r="56" fill="none" strokeWidth="9" strokeLinecap="round"
              strokeDasharray={C} strokeDashoffset={C * (1 - progress)} />
          </svg>
          <div className="timer-center">
            <div className="timer-sec">{bettingOpen ? secLeft : '—'}</div>
            <div className="timer-label"><Ic n="timer" s={11} />left</div>
          </div>
        </div>
      </div>

      {paused && (
        <div className="betting-closed" style={{ marginTop: 12 }}>
          <Ic n="wrench" s={15} />
          {gameCfg.maintenance ? 'Under maintenance — back soon' : 'Game paused by admin'}
        </div>
      )}
      {!bettingOpen && !paused && (
        <div className="betting-closed" style={{ marginTop: 12 }}>
          <Ic n="lock" s={14} />Betting closed — result coming…
        </div>
      )}

      {/* Numbers */}
      <div className="card" style={{ marginTop: 12 }}>
        <div className="card-title"><Ic n="dice" s={18} />Pick a Number</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 10 }}>
          {[0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => (
            <button key={n} className={`num ${numColor(n)}`}
              style={gameCfg.enableNumber === false ? { opacity: 0.35 } : {}}
              onClick={() => openBet('number', String(n))}>
              {n}
            </button>
          ))}
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--text-dim)', fontSize: '0.68rem', fontWeight: 700, marginTop: 10, padding: '0 4px' }}>
          <span>Red — even</span>
          <span>0 — Red+Violet</span>
          <span>Green — odd</span>
        </div>
      </div>

      {/* Colors */}
      <div className="card" style={{ marginTop: 12 }}>
        <div className="card-title"><Ic n="tag" s={17} />Pick a Color</div>
        <div style={{ display: 'flex', gap: 10, opacity: gameCfg.enableColor === false ? 0.35 : 1 }}>
          <button className="bet-color-btn bet-green" onClick={() => openBet('color', 'Green')}>Green<small><Ic n="percent" s={11} />{payouts.green ?? 2}×</small></button>
          <button className="bet-color-btn bet-violet" onClick={() => openBet('color', 'Violet')}>Violet<small><Ic n="percent" s={11} />{payouts.violet ?? 4.5}×</small></button>
          <button className="bet-color-btn bet-red" onClick={() => openBet('color', 'Red')}>Red<small><Ic n="percent" s={11} />{payouts.red ?? 2}×</small></button>
        </div>
      </div>

      {/* Size */}
      <div className="card" style={{ marginTop: 12 }}>
        <div className="card-title"><Ic n="swap" s={17} />Big or Small</div>
        <div style={{ display: 'flex', gap: 10, opacity: gameCfg.enableSize === false ? 0.35 : 1 }}>
          <button className="bet-size" onClick={() => openBet('size', 'Big')}>BIG (5-9)<small><Ic n="percent" s={11} />{payouts.size ?? 2}×</small></button>
          <button className="bet-size" onClick={() => openBet('size', 'Small')}>SMALL (0-4)<small><Ic n="percent" s={11} />{payouts.size ?? 2}×</small></button>
        </div>
      </div>

      {/* Last 50 */}
      <div className="card" style={{ marginTop: 12 }}>
        <div className="card-title"><Ic n="history" s={17} />Last 50 Results</div>
        {results.length === 0 && <div className="empty"><div className="empty-icon"><Ic n="clock" s={40} /></div>First result coming soon…</div>}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(10, 1fr)', gap: 6 }}>
          {results.slice(0, 50).map((r) => (
            <div key={r.period_id} className={`num num-sm ${numColor(r.number)}`}>{r.number}</div>
          ))}
        </div>
      </div>

      {myBet && (
        <div className="card" style={{ marginTop: 12, borderColor: 'rgba(124,108,255,0.5)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 800 }}>
            <Ic n="clock" s={15} />Your bet this period:
            <span className="badge badge-pending">{myBet.selection} · {money(myBet.amount)}</span>
          </div>
        </div>
      )}

      {/* Bet modal */}
      {bet && (
        <Modal title={`Bet on ${bet.selection}`} icon="target" onClose={() => setBet(null)}
          footer={<>
            <button className="btn btn-ghost" onClick={() => setBet(null)}>Cancel</button>
            <button className="btn btn-primary" onClick={placeBet} disabled={busy}>
              <Ic n="check" s={16} />{busy ? 'Placing…' : `Place Bet · ${amt ? money(amt) : '—'}`}
            </button>
          </>}>
          <div className="form-group">
            <label>Amount (₹)</label>
            <input className="input" type="number" inputMode="numeric" placeholder={`Min ${gameCfg.minBet || 10}`}
              value={amount} onChange={(e) => setAmount(e.target.value)} autoFocus />
          </div>
          <div style={{ display: 'flex', gap: 8, marginBottom: 10, flexWrap: 'wrap' }}>
            {QUICK_AMTS.map((q) => (
              <button key={q} className="btn btn-ghost btn-sm" onClick={() => { setAmount(String(q)); sfx.click(); }}>₹{q}</button>
            ))}
            <button className="btn btn-ghost btn-sm" onClick={() => setAmount(String(Math.max(0, Math.floor((profile.balance || 0) / mult))))}><Ic n="zap" s={13} />MAX</button>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            {MULTS.map((m) => (
              <button key={m} className={`btn btn-sm ${mult === m ? 'btn-primary' : 'btn-ghost'}`} style={{ flex: 1 }}
                onClick={() => { setMult(m); sfx.click(); }}>{m}×</button>
            ))}
          </div>
          <div style={{ marginTop: 12, display: 'flex', justifyContent: 'space-between', fontWeight: 800 }}>
            <span style={{ color: 'var(--text-dim)' }}>Potential win</span>
            <span style={{ color: 'var(--success)' }}>{amt ? money(amt * payoutFor(bet, payouts)) : '—'}</span>
          </div>
          <div style={{ marginTop: 4, display: 'flex', justifyContent: 'space-between', fontSize: '0.8rem', color: 'var(--text-dim)' }}>
            <span>Available: {money(profile.balance)}</span>
            <span>Payout ×{payoutFor(bet, payouts)}</span>
          </div>
        </Modal>
      )}

      {/* Result announcement */}
      {announce && (
        <div className="result-overlay" onClick={() => setAnnounce(null)}>
          <div className="result-card">
            <div className={`result-num ${numColor(announce.number)}`}>{announce.number}</div>
            <div className="result-title">
              {announce.won
                ? <span className="result-win"><Ic n="trophy" s={26} />You WON {money(announce.winAmount)}!</span>
                : <span className="result-lose"><Ic n="x" s={26} />You lost {money(announce.amount)}</span>}
            </div>
            <div className="result-meta">{announce.color} · {announce.size}</div>
            <div className="result-meta" style={{ marginTop: 10, fontSize: '0.78rem', opacity: 0.7 }}>tap anywhere to continue</div>
          </div>
        </div>
      )}
    </div>
  );
}
