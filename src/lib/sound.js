// WebAudio-based sound engine — zero audio files, pure synth.
// Global defaults aata hai admin ke 'sounds' settings se; user apna apna
// choice device pe (localStorage) save karta hai — woh global se priority pata hai.
let ctx = null;
let enabled = true;
let volume = 0.5;
let defEnabled = true;
let defVolume = 0.5;

function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* private mode */ } }

function ac() {
  if (!ctx) {
    try { ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { /* no audio */ }
  }
  if (ctx && ctx.state === 'suspended') ctx.resume();
  return ctx;
}

function tone(freq, start, dur, type = 'sine', vol = 1) {
  if (!enabled || volume <= 0) return;
  const c = ac();
  if (!c) return;
  try {
    const o = c.createOscillator();
    const g = c.createGain();
    o.type = type;
    o.frequency.value = freq;
    const t0 = c.currentTime + start;
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.linearRampToValueAtTime(Math.min(1, vol * volume), t0 + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g); g.connect(c.destination);
    o.start(t0); o.stop(t0 + dur + 0.05);
  } catch (e) { /* ignore */ }
}

export const sfx = {
  // Admin ke global defaults set karo; user ka saved choice override karta hai.
  init(settings) {
    if (settings) {
      defEnabled = settings.enabled !== false;
      const v = Number(settings.volume);
      defVolume = Number.isFinite(v) && v >= 0 ? v : 0.5;
    }
    this.applyLocal();
  },
  // User ka device-level choice global default pe priority dete hai.
  applyLocal() {
    const s = lsGet('jc-sound');
    const v = lsGet('jc-volume');
    enabled = (s !== null) ? s === '1' : defEnabled;
    const pv = Number(v);
    volume = (v !== null && v !== '' && Number.isFinite(pv) && pv >= 0) ? pv : defVolume;
  },
  setEnabled(v, persist = true) {
    enabled = !!v;
    if (persist) lsSet('jc-sound', v ? '1' : '0');
  },
  setVolume(v, persist = true) {
    volume = Number(v) || 0;
    if (persist) lsSet('jc-volume', String(volume));
  },
  isEnabled: () => enabled,
  getVolume: () => volume,
  click()  { tone(620, 0, 0.05, 'square', 0.12); },
  tick()   { tone(920, 0, 0.045, 'sine', 0.22); },
  win()    { [523, 659, 784, 1047, 1319].forEach((f, i) => tone(f, i * 0.085, 0.28, 'triangle', 0.3)); },
  lose()   { tone(230, 0, 0.2, 'sawtooth', 0.1); tone(165, 0.16, 0.32, 'sawtooth', 0.1); },
  cash()   { [880, 1175, 1568].forEach((f, i) => tone(f, i * 0.06, 0.13, 'sine', 0.24)); },
  notify() { tone(740, 0, 0.12, 'sine', 0.24); tone(988, 0.12, 0.2, 'sine', 0.2); },
  error()  { tone(170, 0, 0.22, 'square', 0.13); },
  flip()   { tone(440, 0, 0.07, 'sine', 0.14); tone(660, 0.07, 0.1, 'sine', 0.14); }
};
