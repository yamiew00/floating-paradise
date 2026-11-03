// 全部音效都用 Web Audio 即時合成，不需要音檔。
// 手機瀏覽器規定要在玩家第一次點擊後才能出聲，所以要先呼叫 unlockAudio()。

let ac = null;
let out = null;
let noiseBuf = null;
let muted = false;
try { muted = localStorage.getItem('prism.muted') === '1'; } catch {}

const VOLUME = 0.55;

export function unlockAudio() {
  if (!ac) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    ac = new AC();
    const comp = ac.createDynamicsCompressor();
    out = ac.createGain();
    out.gain.value = muted ? 0 : VOLUME;
    out.connect(comp);
    comp.connect(ac.destination);
    noiseBuf = ac.createBuffer(1, ac.sampleRate, ac.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  if (ac.state === 'suspended') ac.resume();
}

export function suspendAudio(on) {
  if (!ac) return;
  if (on) ac.suspend(); else ac.resume();
}

export function toggleMute() {
  muted = !muted;
  if (out) out.gain.value = muted ? 0 : VOLUME;
  try { localStorage.setItem('prism.muted', muted ? '1' : '0'); } catch {}
  return muted;
}

export const isMuted = () => muted;

function envelope(g, t0, vol, attack, dur) {
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(vol, t0 + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
}

function tone(freq, dur, { type = 'sine', vol = 0.3, to = 0, delay = 0, attack = 0.004 } = {}) {
  if (!ac || muted) return;
  const t0 = ac.currentTime + delay;
  const o = ac.createOscillator();
  const g = ac.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t0);
  if (to) o.frequency.exponentialRampToValueAtTime(to, t0 + dur);
  envelope(g, t0, vol, attack, dur);
  o.connect(g);
  g.connect(out);
  o.start(t0);
  o.stop(t0 + dur + 0.02);
}

function noise(dur, { vol = 0.3, freq = 1200, to = 0, q = 1, type = 'bandpass', delay = 0 } = {}) {
  if (!ac || muted) return;
  const t0 = ac.currentTime + delay;
  const s = ac.createBufferSource();
  const f = ac.createBiquadFilter();
  const g = ac.createGain();
  s.buffer = noiseBuf;
  f.type = type;
  f.Q.value = q;
  f.frequency.setValueAtTime(freq, t0);
  if (to) f.frequency.exponentialRampToValueAtTime(to, t0 + dur);
  envelope(g, t0, vol, 0.003, dur);
  s.connect(f);
  f.connect(g);
  g.connect(out);
  s.start(t0);
  s.stop(t0 + dur + 0.02);
}

// 連擊音階：五聲音階一路往上爬，越連越高
const SCALE = [0, 2, 4, 7, 9];
function comboFreq(c, base) {
  const i = Math.min(c, 15);
  return base * 2 ** ((SCALE[i % 5] + 12 * Math.floor(i / 5)) / 12);
}

export const sfx = {
  dash(p) {
    noise(0.25, { vol: 0.22 + p * 0.2, freq: 600, to: 3200, q: 0.8 });
    tone(180, 0.18, { type: 'triangle', to: 420 + p * 320, vol: 0.16 });
  },
  kill(c) {
    const f = comboFreq(c - 1, 392);
    tone(f, 0.14, { type: 'square', vol: 0.1 });
    tone(f * 2, 0.22, { type: 'triangle', vol: 0.13 });
    tone(120, 0.16, { type: 'sine', to: 45, vol: 0.45 });
    noise(0.12, { vol: 0.35, freq: 2600, to: 400, q: 0.7 });
  },
  clang() {
    tone(880, 0.25, { type: 'square', vol: 0.07, to: 620 });
    tone(1320, 0.3, { type: 'triangle', vol: 0.1 });
    noise(0.08, { vol: 0.3, freq: 4000, q: 2 });
  },
  hurt() {
    tone(220, 0.35, { type: 'sawtooth', to: 70, vol: 0.2 });
    noise(0.3, { vol: 0.4, freq: 900, to: 150, type: 'lowpass' });
  },
  bounce(v) {
    tone(260, 0.1, { type: 'sine', to: 540, vol: 0.05 + 0.1 * v });
  },
  deny() {
    tone(150, 0.1, { type: 'square', vol: 0.07 });
    tone(118, 0.12, { type: 'square', vol: 0.07, delay: 0.08 });
  },
  charge() {
    tone(1046, 0.08, { type: 'sine', vol: 0.05 });
  },
  spawn() {
    tone(300, 0.3, { type: 'sine', to: 620, vol: 0.035 });
  },
  pop() {
    tone(520, 0.08, { type: 'triangle', to: 260, vol: 0.06 });
  },
  windup() {
    tone(140, 0.6, { type: 'sawtooth', to: 280, vol: 0.05 });
  },
  shoot() {
    tone(720, 0.15, { type: 'triangle', to: 300, vol: 0.07 });
  },
  parry() {
    tone(1568, 0.12, { type: 'triangle', vol: 0.12 });
    noise(0.05, { vol: 0.2, freq: 5000, q: 3 });
  },
  milestone(c) {
    tone(comboFreq(c, 784), 0.4, { type: 'triangle', vol: 0.14 });
    noise(0.4, { vol: 0.12, freq: 6000, type: 'highpass' });
  },
  wave() {
    [0, 4, 7].forEach((s, i) => tone(523 * 2 ** (s / 12), 0.25, { type: 'triangle', vol: 0.09, delay: i * 0.07 }));
  },
  clear() {
    [0, 4, 7, 12].forEach((s, i) => tone(523 * 2 ** (s / 12), 0.35, { type: 'square', vol: 0.06, delay: i * 0.08 }));
    noise(0.6, { vol: 0.1, freq: 7000, type: 'highpass', delay: 0.2 });
  },
  heal() {
    [0, 7, 12].forEach((s, i) => tone(659 * 2 ** (s / 12), 0.3, { type: 'sine', vol: 0.12, delay: i * 0.06 }));
  },
  die() {
    tone(330, 0.9, { type: 'sawtooth', to: 40, vol: 0.22 });
    noise(0.8, { vol: 0.4, freq: 1500, to: 100, type: 'lowpass' });
  },

  // ---- 浮島樂園 ----
  coin(i = 0) {
    const f = comboFreq(i % 10, 1046);
    tone(f, 0.09, { type: 'square', vol: 0.03 });
    tone(f * 1.5, 0.14, { type: 'sine', vol: 0.05, delay: 0.05 });
  },
  squeak() {
    tone(700 + Math.random() * 300, 0.12, { type: 'sine', to: 1400, vol: 0.07 });
  },
  tap() {
    tone(880, 0.05, { type: 'triangle', vol: 0.05 });
  },
  build() {
    [0, 4, 7, 12, 16].forEach((s, i) => tone(523 * 2 ** (s / 12), 0.3, { type: 'triangle', vol: 0.09, delay: i * 0.07 }));
    noise(0.5, { vol: 0.08, freq: 6000, type: 'highpass', delay: 0.3 });
  },
  whoosh() {
    noise(0.35, { vol: 0.12, freq: 400, to: 2400, q: 0.7 });
  },

  // ---- 鋼球滑道 ----
  // 落地的悶響，衝擊越大越重
  land(v = 1) {
    const k = Math.min(1, v);
    tone(140, 0.22, { type: 'sine', to: 45, vol: 0.18 + k * 0.25 });
    noise(0.14, { vol: 0.1 + k * 0.2, freq: 700, to: 120, type: 'lowpass' });
  },
  launch() {
    tone(260, 0.3, { type: 'triangle', to: 720, vol: 0.06 });
    noise(0.3, { vol: 0.08, freq: 800, to: 3000, q: 0.8 });
  },
};
