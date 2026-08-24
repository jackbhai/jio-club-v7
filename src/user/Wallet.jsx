import React, { useEffect, useState } from 'react';
import { supabase, rpc } from '../lib/supabase.js';
import { toast, Field, Tabs, Empty } from '../components/ui.jsx';
import { Ic } from '../lib/icons.jsx';
import { sfx } from '../lib/sound.js';
import { money, fmtDT, copyText } from '../lib/utils.js';
import QRCode from 'qrcode';

export default function Wallet({ game, profile, user, features }) {
  const [tab, setTab] = useState('deposit');
  const [amount, setAmount] = useState('');
  const [ref, setRef] = useState('');
  const [shot, setShot] = useState(null);
  const [shotUrl, setShotUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [coupon, setCoupon] = useState('');
  const [upiId, setUpiId] = useState(profile.upi_id || '');
  const [historyTab, setHistoryTab] = useState('deposits');
  const [history, setHistory] = useState(null);
  const [qr, setQr] = useState('');

  const g = game || {};
  const wallet = g.wallet || {};
  const upi = g.upi || {};
  const payments = g.payments || {};
  const appName = g.appearance?.appName || 'JIO CLUB';
  const amt = parseFloat(amount) || 0;
  const depositOn = features?.deposit !== false;
  const withdrawOn = features?.withdraw !== false;
  const couponsOn = features?.coupons !== false;

  useEffect(() => { setUpiId(profile?.upi_id || ''); }, [profile?.upi_id]);

  useEffect(() => {
    if (!upi.upiId || amt <= 0 || !depositOn) { setQr(''); return; }
    const s = `upi://pay?pa=${encodeURIComponent(upi.upiId)}&pn=${encodeURIComponent(appName)}&am=${amt}&cu=INR&tn=${encodeURIComponent(appName + ' deposit ' + (ref || ''))}`;
    QRCode.toDataURL(s, { width: 240, margin: 1, color: { dark: '#171c2e' } }).then(setQr).catch(() => setQr(''));
  }, [upi.upiId, amt, ref, appName, depositOn]);

  async function loadHistory() {
    const [dep, wd] = await Promise.all([
      supabase.from('deposits').select('*').eq('uid', user.id).order('created_at', { ascending: false }).limit(40),
      supabase.from('withdrawals').select('*').eq('uid', user.id).order('created_at', { ascending: false }).limit(40)
    ]);
    setHistory({ deposits: dep.data || [], withdrawals: wd.data || [] });
  }
  useEffect(() => { loadHistory(); }, [user.id, tab]);

  async function onDeposit() {
    if (amt < (wallet.minDeposit || 10)) { toast(`Minimum deposit ₹${wallet.minDeposit || 10}`, 'error'); return; }
    if (!ref.trim()) { toast('Enter UPI transaction reference (UTR)', 'error'); return; }
    setBusy(true); sfx.click();
    try {
      let screenshot = '';
      if (shot) {
        const path = `${user.id}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${shot.type.includes('png') ? 'png' : 'jpg'}`;
        const { error: uErr } = await supabase.storage.from('screenshots').upload(path, shot, { contentType: shot.type || 'image/jpeg' });
        if (uErr) throw new Error('Screenshot upload failed: ' + uErr.message);
        const { data } = supabase.storage.from('screenshots').getPublicUrl(path);
        screenshot = data.publicUrl;
      }
      const { error } = await supabase.from('deposits').insert({
        uid: user.id, amount: amt, upi_ref: ref.trim(), screenshot_url: screenshot, payment_mode: 'upi', status: 'pending'
      });
      if (error) throw new Error(error.message);
      sfx.cash();
      toast('Deposit submitted! Admin will verify shortly', 'success');
      setAmount(''); setRef(''); setShot(null); setShotUrl('');
      loadHistory();
    } catch (e) {
      sfx.error(); toast(e.message, 'error');
    } finally { setBusy(false); }
  }

  async function onRazorpay() {
    if (amt <= 0) { toast('Enter amount', 'error'); return; }
    setBusy(true);
    try {
      if (!window.Razorpay) {
        await new Promise((res, rej) => {
          const s = document.createElement('script');
          s.src = 'https://checkout.razorpay.com/v1/checkout.js';
          s.onload = res; s.onerror = () => rej(new Error('Razorpay load failed'));
          document.body.appendChild(s);
        });
      }
      const rzp = new window.Razorpay({
        key: payments.razorpayKeyId,
        amount: Math.round(amt * 100),
        currency: 'INR',
        name: appName,
        description: 'Wallet Deposit (test mode)',
        prefill: { email: profile.email },
        handler: async (resp) => {
          try {
            const { error } = await supabase.from('deposits').insert({
              uid: user.id, amount: amt, upi_ref: resp.razorpay_payment_id || '',
              payment_mode: 'razorpay', status: 'pending',
              note: 'Razorpay test mode — admin approval required'
            });
            if (error) throw new Error(error.message);
            sfx.cash();
            toast('Payment received — pending admin approval', 'success');
            setAmount('');
            loadHistory();
          } catch (e) { toast(e.message, 'error'); }
          finally { setBusy(false); }
        },
        theme: { color: '#7c6cff' }
      });
      rzp.on('payment.failed', (r) => { setBusy(false); toast('Payment failed: ' + (r.error?.description || 'try again'), 'error'); });
      rzp.open();
    } catch (e) {
      setBusy(false); sfx.error(); toast(e.message, 'error');
    }
  }

  async function onWithdraw() {
    if (amt < (wallet.minWithdrawal || 200)) { toast(`Minimum withdrawal ₹${wallet.minWithdrawal || 200}`, 'error'); return; }
    if (!upiId.trim()) { toast('Enter UPI ID', 'error'); return; }
    setBusy(true); sfx.click();
    try {
      const res = await rpc('request_withdrawal', { p_amount: amt, p_upi: upiId });
      sfx.cash();
      toast(`Withdrawal ${money(amt)} submitted — balance ${money(res.balance)}`, 'success');
      setAmount('');
      loadHistory();
    } catch (e) {
      sfx.error(); toast(e.message, 'error');
    } finally { setBusy(false); }
  }

  async function onCoupon() {
    if (!coupon.trim()) { toast('Enter coupon code', 'error'); return; }
    setBusy(true);
    try {
      const res = await rpc('apply_coupon', { p_code: coupon });
      sfx.win();
      toast(`Coupon applied: +${money(res.amount)} → balance ${money(res.balance)}`, 'success');
      setCoupon('');
    } catch (e) {
      sfx.error(); toast(e.message, 'error');
    } finally { setBusy(false); }
  }

  function pickShot(e) {
    const f = e.target.files?.[0];
    if (!f) return;
    if (f.size > 4 * 1024 * 1024) { toast('Screenshot max 4MB', 'error'); return; }
    setShot(f);
    setShotUrl(URL.createObjectURL(f));
  }

  const histRows = historyTab === 'deposits' ? history?.deposits : history?.withdrawals;

  return (
    <div>
      <div className="card" style={{ background: 'linear-gradient(135deg, rgba(124,108,255,0.18), rgba(0,200,150,0.1))', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: '0.7rem', fontWeight: 800, textTransform: 'uppercase', letterSpacing: 1, color: 'var(--text-dim)' }}>
            <Ic n="wallet" s={13} />Available Balance
          </div>
          <div style={{ fontSize: '2rem', fontWeight: 900, letterSpacing: -1, marginTop: 2 }}>{money(profile.balance)}</div>
        </div>
        <div style={{ width: 52, height: 52, borderRadius: 16, background: 'rgba(124,108,255,0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--accent)' }}>
          <Ic n="coins" s={28} />
        </div>
      </div>

      <div style={{ marginTop: 12 }}>
        <Tabs active={tab} onChange={(t) => { setTab(t); sfx.click(); }} tabs={[
          { id: 'deposit', label: 'Deposit', icon: 'arrowDown' },
          { id: 'withdraw', label: 'Withdraw', icon: 'arrowUp' },
          { id: 'history', label: 'History', icon: 'history' }
        ]} />

        {tab === 'deposit' && (
          <div className="card page-enter">
            {!depositOn ? <DisabledNote label="Deposits are currently disabled by admin" /> : (
              <>
                <Field label={`Amount (min ₹${wallet.minDeposit || 10})`}>
                  <input className="input" type="number" inputMode="numeric" placeholder="Enter amount" value={amount}
                    onChange={(e) => setAmount(e.target.value)} />
                </Field>
                <div style={{ display: 'flex', gap: 8, marginBottom: 14, flexWrap: 'wrap' }}>
                  {[100, 500, 1000, 5000].map((q) => (
                    <button key={q} className="btn btn-ghost btn-sm" onClick={() => { setAmount(String(q)); sfx.click(); }}>₹{q}</button>
                  ))}
                </div>

                {payments.mode === 'razorpay' && payments.razorpayKeyId ? (
                  <button className="btn btn-primary btn-block" onClick={onRazorpay} disabled={busy}>
                    <Ic n="zap" s={16} />{busy ? 'Please wait…' : 'Pay Now with Razorpay (test mode)'}
                  </button>
                ) : (
                  <>
                    {upi.upiId && (
                      <div style={{ textAlign: 'center', marginBottom: 14 }}>
                        <div style={{ fontWeight: 800, marginBottom: 6 }}>Send {amt ? money(amt) : 'amount'} to UPI ID:</div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, justifyContent: 'center' }}>
                          <input className="input" style={{ width: 190, textAlign: 'center', fontWeight: 800 }} readOnly value={upi.upiId} />
                          <button className="btn btn-ghost btn-sm" onClick={async () => { await copyText(upi.upiId); toast('UPI ID copied', 'success'); }}><Ic n="copy" s={14} /></button>
                        </div>
                        {qr && <img src={qr} alt="UPI QR" style={{ width: 170, height: 170, margin: '12px auto 0', display: 'block', borderRadius: 14, background: '#fff', padding: 10 }} />}
                        <div style={{ color: 'var(--text-dim)', fontSize: '0.74rem', marginTop: 8, display: 'flex', gap: 5, justifyContent: 'center', alignItems: 'center' }}>
                          <Ic n="qr" s={12} />Scan with {upi.apps?.join(', ') || 'any UPI app'}
                        </div>
                      </div>
                    )}
                    <Field label="UPI Transaction Ref (UTR)">
                      <input className="input" placeholder="e.g. 415223344556" value={ref} onChange={(e) => setRef(e.target.value)} />
                    </Field>
                    <Field label="Payment Screenshot (recommended)">
                      <input type="file" accept="image/*" onChange={pickShot} />
                      {shotUrl && <img src={shotUrl} alt="shot" style={{ maxHeight: 110, borderRadius: 10, marginTop: 8 }} />}
                    </Field>
                    <button className="btn btn-primary btn-block" onClick={onDeposit} disabled={busy}>
                      <Ic n="checkCircle" s={16} />{busy ? 'Submitting…' : 'I Have Paid — Submit for Approval'}
                    </button>
                  </>
                )}

                {couponsOn && (
                  <div style={{ marginTop: 16, paddingTop: 14, borderTop: '1px solid var(--border-solid)', display: 'flex', gap: 8 }}>
                    <div style={{ position: 'relative', flex: 1 }}>
                      <span style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-dim)', display: 'flex' }}><Ic n="ticket" s={16} /></span>
                      <input className="input" style={{ paddingLeft: 36 }} placeholder="Coupon code (e.g. PRA100)" value={coupon}
                        onChange={(e) => setCoupon(e.target.value.toUpperCase())} />
                    </div>
                    <button className="btn btn-ghost" onClick={onCoupon} disabled={busy}><Ic n="gift" s={16} />Apply</button>
                  </div>
                )}
              </>
            )}
          </div>
        )}

        {tab === 'withdraw' && (
          <div className="card page-enter">
            {!withdrawOn ? <DisabledNote label="Withdrawals are currently disabled by admin" /> : (
              <>
                <Field label={`Amount (min ₹${wallet.minWithdrawal || 200}, max ₹${wallet.maxWithdrawal || 100000})`}>
                  <input className="input" type="number" inputMode="numeric" placeholder="Enter amount" value={amount}
                    onChange={(e) => setAmount(e.target.value)} />
                </Field>
                <div style={{ display: 'flex', gap: 8, marginBottom: 14, flexWrap: 'wrap' }}>
                  <button className="btn btn-ghost btn-sm" onClick={() => setAmount(String(Math.floor(profile.balance || 0)))}><Ic n="zap" s={13} />Full {money(profile.balance)}</button>
                </div>
                <Field label="Your UPI ID">
                  <input className="input" placeholder="yourname@upi" value={upiId} onChange={(e) => setUpiId(e.target.value)} />
                </Field>
                <button className="btn btn-success btn-block" onClick={onWithdraw} disabled={busy}>
                  <Ic n="arrowUp" s={16} />{busy ? 'Submitting…' : `Request Withdrawal${amt ? ' · ' + money(amt) : ''}`}
                </button>
                <p className="card-sub" style={{ marginTop: 10, display: 'flex', gap: 6, alignItems: 'flex-start' }}>
                  <Ic n="info" s={14} style={{ marginTop: 2, flexShrink: 0 }} />
                  Balance locks instantly and is released on approval. Typical processing: a few hours.
                </p>
              </>
            )}
          </div>
        )}

        {tab === 'history' && (
          <div className="card page-enter">
            <Tabs active={historyTab} onChange={setHistoryTab} tabs={[
              { id: 'deposits', label: `Deposits (${history?.deposits?.length || 0})`, icon: 'arrowDown' },
              { id: 'withdrawals', label: `Withdrawals (${history?.withdrawals?.length || 0})`, icon: 'arrowUp' }
            ]} />
            {!history && <div className="spinner" style={{ margin: '20px auto' }}></div>}
            {history && (!histRows || histRows.length === 0) && <Empty icon="inbox" msg={`No ${historyTab} yet`} />}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {histRows?.map((h) => (
                <div key={h.id} className="card" style={{ padding: '11px 14px', display: 'flex', alignItems: 'center', gap: 10 }}>
                  <div style={{ width: 36, height: 36, borderRadius: 11, display: 'flex', alignItems: 'center', justifyContent: 'center',
                    background: historyTab === 'deposits' ? 'rgba(46,230,168,0.12)' : 'rgba(255,107,107,0.1)',
                    color: historyTab === 'deposits' ? 'var(--success)' : 'var(--danger)' }}>
                    <Ic n={historyTab === 'deposits' ? 'arrowDown' : 'arrowUp'} s={17} />
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 800 }}>{money(h.amount)} {h.payment_mode === 'razorpay' && <span className="badge badge-active" style={{ marginLeft: 6 }}>Razorpay</span>}</div>
                    <div className="card-sub">{fmtDT(h.created_at)}{h.note ? ' · ' + h.note : ''}</div>
                    {historyTab === 'deposits' && h.screenshot_url && (
                      <a href={h.screenshot_url} target="_blank" rel="noreferrer" className="card-sub" style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }}>
                        <Ic n="image" s={12} />view screenshot
                      </a>
                    )}
                  </div>
                  <span className={`badge badge-${h.status}`}>{h.status}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function DisabledNote({ label }) {
  return (
    <div style={{ display: 'flex', gap: 12, alignItems: 'center', padding: '18px 6px', color: 'var(--text-dim)' }}>
      <Ic n="ban" s={30} />
      <div>
        <div style={{ fontWeight: 800, color: 'var(--text)' }}>Currently unavailable</div>
        <div className="card-sub">{label}. Please check back later.</div>
      </div>
    </div>
  );
}
