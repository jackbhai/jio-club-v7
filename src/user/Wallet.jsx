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
  const minDep = wallet.minDeposit || 10;
  const minWd = wallet.minWithdrawal || 200;
  const maxWd = wallet.maxWithdrawal || 100000;
  const depositOn = features?.deposit !== false;
  const withdrawOn = features?.withdraw !== false;
  const couponsOn = features?.coupons !== false;
  const depositValid = amt >= minDep && amt <= 1000000;
  const withdrawValid = amt >= minWd && amt <= maxWd && upiId.trim().length >= 5 && amt <= (profile.balance || 0);

  // ---- Multi-UPI (admin-managed accounts) ----
  const [upiAccounts, setUpiAccounts] = useState(null);
  const [selUpi, setSelUpi] = useState('');
  useEffect(() => {
    supabase.from('upi_accounts').select('*').eq('status', 'active').order('sort_order')
      .then(({ data }) => setUpiAccounts(data || []));
  }, []);
  const activeUpi = (upiAccounts || []).filter((a) => a.status === 'active');
  const selAcc = activeUpi.find((a) => a.id === selUpi) || activeUpi.find((a) => a.is_default) || activeUpi[0];
  const upiDisplayId = selAcc ? selAcc.upi_id : (upi.upiId || '');
  const upiDisplayLabel = selAcc ? selAcc.label : 'Primary';
  // Razorpay env (admin toggle: test/live)
  const rzpEnv = payments.env === 'live' ? 'live' : 'test';
  const rzpKeyId = rzpEnv === 'live' ? payments.liveKeyId : payments.testKeyId;

  useEffect(() => { setUpiId(profile?.upi_id || ''); }, [profile?.upi_id]);

  // QR sirf VALID amount pe generate (V7-009 fix)
  useEffect(() => {
    if (!upiDisplayId || !depositValid || !depositOn) { setQr(''); return; }
    const s = `upi://pay?pa=${encodeURIComponent(upiDisplayId)}&pn=${encodeURIComponent(appName)}&am=${amt}&cu=INR&tn=${encodeURIComponent(appName + ' deposit ' + (ref || ''))}`;
    QRCode.toDataURL(s, { width: 240, margin: 1, color: { dark: '#171c2e' } }).then(setQr).catch(() => setQr(''));
  }, [upiDisplayId, amt, ref, appName, depositOn, depositValid]);

  async function loadHistory() {
    const [dep, wd] = await Promise.all([
      supabase.from('deposits').select('*').eq('uid', user.id).order('created_at', { ascending: false }).limit(40),
      supabase.from('withdrawals').select('*').eq('uid', user.id).order('created_at', { ascending: false }).limit(40)
    ]);
    setHistory({ deposits: dep.data || [], withdrawals: wd.data || [] });
  }
  useEffect(() => { loadHistory(); }, [user.id, tab]);

  async function onDeposit() {
    if (!depositValid) { toast(`Minimum deposit ₹${minDep}`, 'error'); return; }
    if (!ref.trim()) { toast('Enter UPI transaction reference (UTR)', 'error'); return; }
    setBusy(true); sfx.click();
    try {
      let shotPath = '';
      if (shot) {
        const ext = shot.type === 'image/png' ? 'png' : 'jpg';
        shotPath = `${user.id}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
        const { error: uErr } = await supabase.storage.from('screenshots').upload(shotPath, shot, { contentType: shot.type || 'image/jpeg' });
        if (uErr) throw new Error('Screenshot upload failed: ' + uErr.message);
      }
      // V7-005 fix: server-side validated RPC (amount/UTR/ownership)
      const res = await rpc('request_deposit', { p_amount: amt, p_upi_ref: ref.trim(), p_screenshot_url: shotPath });
      sfx.cash();
      toast(`Deposit ${res?.receipt || ''} submitted! Admin will verify shortly`, 'success');
      setAmount(''); setRef(''); setShot(null); setShotUrl('');
      loadHistory();
    } catch (e) {
      sfx.error(); toast(e.message, 'error');
    } finally { setBusy(false); }
  }

  // V7-004 fix: private bucket → signed URL se screenshot view
  async function viewShot(path) {
    if (!path) return;
    const { data, error } = await supabase.storage.from('screenshots').createSignedUrl(path, 300);
    if (error) { toast('Screenshot open failed', 'error'); return; }
    window.open(data.signedUrl, '_blank', 'noopener');
  }

  async function onRazorpay() {
    if (amt <= 0 || !rzpKeyId) { toast('Enter amount', 'error'); return; }
    setBusy(true);
    try {
      // 1) Server-side order creation (Edge Function — secret key sirf server pe)
      const { data: ord, error: ordErr } = await supabase.functions.invoke('razorpay-pay', {
        body: { action: 'create-order', amount: amt, env: rzpEnv }
      });
      if (ordErr || ord?.error) throw new Error(ord?.error || ordErr.message || 'Order create failed');

      if (!window.Razorpay) {
        await new Promise((res, rej) => {
          const s = document.createElement('script');
          s.src = 'https://checkout.razorpay.com/v1/checkout.js';
          s.onload = res; s.onerror = () => rej(new Error('Razorpay load failed'));
          document.body.appendChild(s);
        });
      }
      const rzp = new window.Razorpay({
        key: rzpKeyId,
        order_id: ord.order_id,
        amount: Math.round((ord.amount ?? amt) * 100),
        currency: 'INR',
        name: appName,
        description: 'Wallet Deposit' + (rzpEnv === 'live' ? '' : ' (test mode)'),
        prefill: { email: profile.email },
        handler: async (resp) => {
          try {
            // 2) Server-side signature verification (HMAC-SHA256 with secret — client nahi kar sakta)
            const { data: ver, error: verErr } = await supabase.functions.invoke('razorpay-pay', {
              body: { action: 'verify', order_id: ord.order_id, payment_id: resp.razorpay_payment_id, signature: resp.razorpay_signature }
            });
            if (verErr || ver?.error) {
              // fallback: pending deposit (manual admin approval)
              const { error } = await supabase.from('deposits').insert({
                uid: user.id, amount: amt, upi_ref: resp.razorpay_payment_id || '',
                payment_mode: 'razorpay', status: 'pending',
                note: 'auto-verify failed — manual review'
              });
              if (error) throw new Error(error.message);
              toast('Payment recorded — pending admin approval', 'info');
            } else {
              sfx.win();
              toast(`Payment VERIFIED — ${money(ver.amount)} added!`, 'success');
            }
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

                {payments.mode === 'razorpay' && rzpKeyId ? (
                  <button className="btn btn-primary btn-block" onClick={onRazorpay} disabled={busy || amt <= 0}>
                    <Ic n="zap" s={16} />{busy ? 'Please wait…' : `Pay Now with Razorpay (${rzpEnv === 'live' ? 'LIVE' : 'test mode'})`}
                  </button>
                ) : (
                  <>
                    {amt > 0 && !depositValid && (
                      <div className="betting-closed" style={{ marginBottom: 12 }}>
                        <Ic n="alert" s={15} />Enter amount between ₹{minDep} and ₹10,00,000
                      </div>
                    )}
                    {activeUpi.length > 1 && (
                      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 12 }}>
                        {activeUpi.map((a) => (
                          <button key={a.id}
                            className={`btn btn-sm ${selAcc?.id === a.id ? 'btn-primary' : 'btn-ghost'}`}
                            onClick={() => { setSelUpi(a.id); sfx.click(); }}>
                            <Ic n="upi" s={13} />{a.label}
                          </button>
                        ))}
                      </div>
                    )}
                    {upiDisplayId && (
                      <div style={{ textAlign: 'center', marginBottom: 14 }}>
                        <div style={{ fontWeight: 800, marginBottom: 6 }}>
                          {depositValid ? `Send ${money(amt)} to ${upiDisplayLabel}:` : 'UPI ID (QR unlocks on valid amount):'}
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, justifyContent: 'center' }}>
                          <input className="input" style={{ width: 190, textAlign: 'center', fontWeight: 800 }} readOnly value={upiDisplayId} />
                          <button className="btn btn-ghost btn-sm" onClick={async () => { await copyText(upiDisplayId); toast('UPI ID copied', 'success'); }}><Ic n="copy" s={14} /></button>
                        </div>
                        {selAcc?.holder_name && <div style={{ fontSize: '0.72rem', color: 'var(--text-dim)', marginTop: 5 }}>A/c: {selAcc.holder_name}</div>}
                        {qr && <img src={qr} alt="UPI QR" style={{ width: 170, height: 170, margin: '12px auto 0', display: 'block', borderRadius: 14, background: '#fff', padding: 10 }} />}
                        {qr && <div style={{ color: 'var(--text-dim)', fontSize: '0.74rem', marginTop: 8, display: 'flex', gap: 5, justifyContent: 'center', alignItems: 'center' }}>
                          <Ic n="qr" s={12} />Scan with {upi.apps?.join(', ') || 'any UPI app'}
                        </div>}
                      </div>
                    )}
                    <Field label="UPI Transaction Ref (UTR)">
                      <input className="input" placeholder="e.g. 415223344556" value={ref} onChange={(e) => setRef(e.target.value)} />
                    </Field>
                    <Field label="Payment Screenshot (recommended)">
                      <input type="file" accept="image/png,image/jpeg" onChange={pickShot} />
                      {shotUrl && <img src={shotUrl} alt="shot" style={{ maxHeight: 110, borderRadius: 10, marginTop: 8 }} />}
                    </Field>
                    <button className="btn btn-primary btn-block" onClick={onDeposit} disabled={busy || !depositValid || !ref.trim()}>
                      <Ic n="checkCircle" s={16} />{busy ? 'Submitting…' : 'I Have Paid — Submit for Approval'}
                    </button>
                    <p className="card-sub" style={{ marginTop: 8, display: 'flex', gap: 5, alignItems: 'center' }}>
                      <Ic n="lock" s={12} />Screenshot private storage mein jaata hai — sirf aap aur admin dekh sakte hain.
                    </p>
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
                {amt > 0 && !withdrawValid && (
                  <div className="betting-closed" style={{ marginBottom: 12 }}>
                    <Ic n="alert" s={15} />
                    {amt > (profile.balance || 0) ? 'Insufficient balance'
                      : amt < minWd ? `Minimum withdrawal ₹${minWd}`
                      : amt > maxWd ? `Maximum withdrawal ₹${maxWd}`
                      : 'Valid UPI ID required'}
                  </div>
                )}
                <button className="btn btn-success btn-block" onClick={onWithdraw} disabled={busy || !withdrawValid}>
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
                      <button onClick={() => viewShot(h.screenshot_url)} className="card-sub" style={{ display: 'inline-flex', gap: 4, alignItems: 'center', color: 'var(--accent)', fontWeight: 700, marginTop: 3 }}>
                        <Ic n="image" s={12} />view screenshot
                      </button>
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
