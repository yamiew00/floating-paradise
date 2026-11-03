import { sfx, unlockAudio, suspendAudio, toggleMute, isMuted } from './audio.js';
import { Ads } from './ads.js';

const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');

// ================= 參數（想調手感就改這裡） =================
const N = 7;                        // 島嶼邊長（格）
const TW = 64, TH = 32;             // 等角格子的寬、高
const DEPTH = 22;                   // 島嶼厚度
const RX = TW / Math.SQRT2;         // 世界 1 單位在畫面上的水平長度
const RY = TH / Math.SQRT2;         // 世界 1 單位在畫面上的垂直長度
const MAX_HP = 3;
const MAX_CHARGES = 3;
const CHARGE_TIME = 1.0;            // 衝刺自動回充 1 格的秒數
const DASH_MIN = 6, DASH_MAX = 17;  // 衝刺初速（格/秒）
const FRICTION = 3.0;
const KILL_SPEED = 3.6;             // 速度高於這個值撞到敵人才算擊倒
const PLAYER_R = 0.28;
const AIM_MIN = 16, AIM_MAX = 120;  // 拖曳距離（CSS px）
const AIM_SLOW = 0.2;               // 瞄準時的時間流速
const COMBO_TIME = 2.2;

const ENEMY = {
  blob:  { r: 0.30, hp: 1, score: 100, color: '#ff5d8f', dark: '#b8325f' },
  horn:  { r: 0.32, hp: 1, score: 200, color: '#ffa53d', dark: '#b8661a' },
  eye:   { r: 0.30, hp: 1, score: 150, color: '#b77bff', dark: '#6f3fc0' },
  shell: { r: 0.40, hp: 2, score: 300, color: '#4fe39a', dark: '#228a5a' },
};

const TILE_A = [36, 48, 94], TILE_B = [44, 58, 110], GLOW = [127, 246, 255];
const SIDE_L = [26, 33, 74], SIDE_R = [18, 23, 56];
const FONT = 'system-ui, -apple-system, "PingFang TC", "Microsoft JhengHei", sans-serif';

// ================= 小工具 =================
const rand = (a, b) => a + Math.random() * (b - a);
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const isoX = (x, y) => ((x - y) * TW) / 2;
const isoY = (x, y) => ((x + y) * TH) / 2;
const easeOutBack = t => 1 + 2.9 * (t - 1) ** 3 + 1.9 * (t - 1) ** 2;
const mix = (a, b, t) =>
  `rgb(${(a[0] + (b[0] - a[0]) * t) | 0},${(a[1] + (b[1] - a[1]) * t) | 0},${(a[2] + (b[2] - a[2]) * t) | 0})`;

function vibrate(p) {
  try { navigator.vibrate?.(p); } catch {}
}

const store = {
  get(k, d) {
    try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; }
  },
  set(k, v) {
    try { localStorage.setItem(k, JSON.stringify(v)); } catch {}
  },
};

// ================= 畫面尺寸 =================
let W = 0, H = 0, DPR = 1, viewScale = 1, safeTop = 0, bg = null;
const safeEl = document.getElementById('safe');

function resize() {
  DPR = Math.min(window.devicePixelRatio || 1, 2);
  W = window.innerWidth;
  H = window.innerHeight;
  canvas.width = Math.round(W * DPR);
  canvas.height = Math.round(H * DPR);
  canvas.style.width = W + 'px';
  canvas.style.height = H + 'px';
  viewScale = Math.min((W - 24) / (N * TW), (H * 0.58) / (N * TH + DEPTH));
  safeTop = parseFloat(getComputedStyle(safeEl).paddingTop) || 0;
  bg = ctx.createRadialGradient(W / 2, H * 0.45, 0, W / 2, H * 0.45, Math.max(W, H) * 0.8);
  bg.addColorStop(0, '#1d2452');
  bg.addColorStop(1, '#080a18');
}
window.addEventListener('resize', resize);
resize();

// ================= 遊戲狀態 =================
let mode = 'title'; // title | play | dead
let paused = false;
let time = 0;
let player;
let enemies = [], bullets = [], spawns = [], particles = [], texts = [], rings = [], trails = [];
let score = 0, best = store.get('prism.best', 0), newBest = false;
let wave = 0, waveQueue = [], spawnTimer = 0, nextWaveT = 0;
let combo = 0, comboTimer = 0, bestCombo = 0;
let revived = false, hasDashed = false, deadT = 0, overShown = false;
let hitstop = 0, trauma = 0, punch = 0, timeScale = 1, slowmo = 0;
let flashA = 0, flashColor = '#fff', rimFlash = 0, scorePop = 0, comboPop = 0, heartPop = 0, denyT = 0;
let banner = null, shakeX = 0, shakeY = 0, camLead = 0, titleRingT = 0;
const tileGlow = new Float32Array(N * N);
const motes = Array.from({ length: 36 }, () => ({ x: Math.random(), y: Math.random(), s: rand(0.6, 2), v: rand(0.005, 0.02) }));

function resetGame() {
  player = {
    x: N / 2, y: N / 2, vx: 0, vy: 0, fx: 1, fy: 0,
    hp: MAX_HP, charges: MAX_CHARGES, chargeT: 0, invuln: 0,
    squash: 0, dashing: false, trailT: 0, dead: false,
  };
  enemies = []; bullets = []; spawns = []; particles = []; texts = []; rings = []; trails = [];
  score = 0; newBest = false; combo = 0; comboTimer = 0; bestCombo = 0;
  wave = 0; waveQueue = []; spawnTimer = 0; nextWaveT = 0.8;
  revived = false; hasDashed = false; deadT = 0; overShown = false;
  hitstop = 0; slowmo = 0; banner = null;
  tileGlow.fill(0);
}
resetGame();

// ================= 特效 =================
const addTrauma = v => { trauma = Math.min(1, trauma + v); };
function screenFlash(color, a) { flashColor = color; flashA = Math.max(flashA, a); }
const makeRing = (x, y, max, str) => ({ x, y, r: 0, max, str, speed: max / 0.45 });

function burst(x, y, z, n, color, speed, o = {}) {
  const px = isoX(x, y), py = isoY(x, y) - z;
  const directed = o.dirX !== undefined;
  const base = directed ? Math.atan2(isoY(o.dirX, o.dirY), isoX(o.dirX, o.dirY)) : 0;
  const spread = directed ? (o.spread ?? 0.8) : Math.PI;
  for (let i = 0; i < n && particles.length < 500; i++) {
    const a = base + rand(-spread, spread);
    const s = speed * rand(0.35, 1);
    const life = (o.life ?? 0.5) * rand(0.6, 1.2);
    particles.push({
      x: px, y: py,
      vx: Math.cos(a) * s, vy: Math.sin(a) * s * (o.flat ?? 0.7) - (o.up ?? 0),
      life, max: life, size: (o.size ?? 3) * rand(0.6, 1.3), color,
      grav: o.grav ?? 0, drag: o.drag ?? 4, kind: o.kind ?? 'dot',
      rot: rand(0, 6), vr: rand(-12, 12),
    });
  }
}

function addText(x, y, text, color = '#fff', size = 18, life = 0.9) {
  texts.push({ x: isoX(x, y), y: isoY(x, y) - 40, text, color, size, life, max: life });
}

function showBanner(text, sub = '', max = 1.4) {
  banner = { text, sub, t: 0, max };
}

// ================= 輸入：按住往後拉，放開衝刺 =================
const aim = { on: false, id: null, sx: 0, sy: 0, x: 0, y: 0 };

canvas.addEventListener('pointerdown', e => {
  unlockAudio();
  if (mode !== 'play' || aim.on || player.dead) return;
  aim.on = true;
  aim.id = e.pointerId;
  aim.sx = aim.x = e.clientX;
  aim.sy = aim.y = e.clientY;
  try { canvas.setPointerCapture(e.pointerId); } catch {}
});
canvas.addEventListener('pointermove', e => {
  if (aim.on && e.pointerId === aim.id) { aim.x = e.clientX; aim.y = e.clientY; }
});
canvas.addEventListener('pointerup', e => {
  if (aim.on && e.pointerId === aim.id) release();
});
canvas.addEventListener('pointercancel', e => {
  if (e.pointerId === aim.id) aim.on = false;
});

// 把螢幕上的拖曳向量轉成世界座標的衝刺方向
function aimVector() {
  const dx = aim.sx - aim.x, dy = aim.sy - aim.y;
  const len = Math.hypot(dx, dy);
  if (len < AIM_MIN) return null;
  const wx = dx / TW + dy / TH, wy = dy / TH - dx / TW;
  const wl = Math.hypot(wx, wy) || 1;
  return { x: wx / wl, y: wy / wl, power: clamp((len - AIM_MIN) / (AIM_MAX - AIM_MIN), 0, 1) };
}

function release() {
  const v = aimVector();
  aim.on = false;
  if (v && mode === 'play' && !player.dead) tryDash(v);
}

function tryDash(v) {
  const p = player;
  if (p.charges <= 0) {
    denyT = 0.35;
    sfx.deny();
    vibrate(20);
    return;
  }
  p.charges--;
  const sp = DASH_MIN + (DASH_MAX - DASH_MIN) * v.power;
  p.vx = v.x * sp;
  p.vy = v.y * sp;
  p.fx = v.x;
  p.fy = v.y;
  p.squash = 0.45;
  hasDashed = true;
  addTrauma(0.12 + 0.18 * v.power);
  punch = Math.max(punch, 0.015 + 0.02 * v.power);
  burst(p.x, p.y, 4, 10, '#b4f0ff', 140, { dirX: -v.x, dirY: -v.y, life: 0.35 });
  rings.push(makeRing(p.x, p.y, 1.2, 0.5));
  sfx.dash(v.power);
  vibrate(8);
}

// ================= 波次 =================
function buildWave(n) {
  const count = Math.min(3 + Math.floor(n * 1.6), 28);
  const list = [];
  for (let i = 0; i < count; i++) {
    const r = Math.random();
    let t = 'blob';
    if (n >= 4 && r < 0.15) t = 'shell';
    else if (n >= 3 && r < 0.35) t = 'eye';
    else if (n >= 2 && r < 0.6) t = 'horn';
    list.push(t);
  }
  return list;
}

function startWave(n) {
  wave = n;
  waveQueue = buildWave(n);
  spawnTimer = 0.4;
  showBanner(`第 ${n} 波`, n === 1 ? '撞穿它們！' : '');
  sfx.wave();
}

function waveClear() {
  const bonus = wave * 100;
  score += bonus;
  scorePop = 1;
  slowmo = 0.6;
  nextWaveT = 1.8;
  player.charges = MAX_CHARGES;
  showBanner('清除！', `+${bonus}`);
  rings.push(makeRing(player.x, player.y, 6, 1));
  sfx.clear();
  vibrate([10, 40, 10]);
  if (wave % 3 === 0 && player.hp < MAX_HP) {
    player.hp++;
    heartPop = 1;
    addText(player.x, player.y, '+1 ♥', '#ff8fa3', 22, 1.2);
    sfx.heal();
  }
}

function spawnPoint() {
  for (let i = 0; i < 30; i++) {
    const x = rand(0.7, N - 0.7), y = rand(0.7, N - 0.7);
    if (Math.hypot(x - player.x, y - player.y) > 2.4) return { x, y };
  }
  return { x: rand(0.7, N - 0.7), y: rand(0.7, N - 0.7) };
}

function updateWaves(dt) {
  if (nextWaveT > 0) {
    nextWaveT -= dt;
    if (nextWaveT <= 0) startWave(wave + 1);
  } else if (waveQueue.length) {
    spawnTimer -= dt;
    if (spawnTimer <= 0 && enemies.length + spawns.length < 3 + wave) {
      spawns.push({ ...spawnPoint(), type: waveQueue.shift(), t: 0.9, max: 0.9 });
      spawnTimer = Math.max(0.3, 1.1 - wave * 0.06);
      sfx.spawn();
    }
  } else if (!enemies.length && !spawns.length) {
    waveClear();
  }
}

// ================= 實體 =================
function makeEnemy(type, x, y) {
  const d = ENEMY[type];
  return {
    type, x, y, vx: 0, vy: 0, r: d.r, hp: d.hp, score: d.score,
    t: rand(0.6, 1.6), state: 'move', dx: 0, dy: 0,
    flash: 0, hitCd: 0, age: 0, wob: rand(0, 6), dead: false,
  };
}

function bounceInside(o, r, damp) {
  let hit = false;
  if (o.x < r) { o.x = r; o.vx = Math.abs(o.vx) * damp; hit = true; }
  else if (o.x > N - r) { o.x = N - r; o.vx = -Math.abs(o.vx) * damp; hit = true; }
  if (o.y < r) { o.y = r; o.vy = Math.abs(o.vy) * damp; hit = true; }
  else if (o.y > N - r) { o.y = N - r; o.vy = -Math.abs(o.vy) * damp; hit = true; }
  return hit;
}

function steer(e, tx, ty, dt, k) {
  const a = Math.min(1, k * dt);
  e.vx += (tx - e.vx) * a;
  e.vy += (ty - e.vy) * a;
}

function updatePlayer(dt) {
  const p = player;
  if (p.dead) return;
  if (p.charges < MAX_CHARGES) {
    p.chargeT += dt;
    if (p.chargeT >= CHARGE_TIME) { p.chargeT = 0; p.charges++; sfx.charge(); }
  } else {
    p.chargeT = 0;
  }

  p.x += p.vx * dt;
  p.y += p.vy * dt;
  const k = Math.exp(-FRICTION * dt);
  p.vx *= k;
  p.vy *= k;
  const sp = Math.hypot(p.vx, p.vy);
  if (bounceInside(p, PLAYER_R, 0.85) && sp > 2) {
    addTrauma(0.08 + (sp / DASH_MAX) * 0.15);
    rimFlash = 1;
    p.squash = -0.3;
    sfx.bounce(Math.min(1, sp / 10));
    burst(p.x, p.y, 2, 6, '#bff8ff', 90, { life: 0.3 });
    rings.push(makeRing(p.x, p.y, 1, 0.35));
    vibrate(6);
  }
  p.dashing = sp > KILL_SPEED;
  if (sp > 0.6) { p.fx = p.vx / sp; p.fy = p.vy / sp; }
  if (aim.on) {
    const v = aimVector();
    if (v) { p.fx = v.x; p.fy = v.y; }
  }
  p.squash += -p.squash * Math.min(1, dt * 12);
  p.invuln = Math.max(0, p.invuln - dt);
  if (p.dashing) {
    p.trailT -= dt;
    if (p.trailT <= 0) {
      p.trailT = 0.018;
      trails.push({ x: p.x, y: p.y, vx: p.vx, vy: p.vy, life: 0.22, max: 0.22 });
    }
  }
}

function updateEnemy(e, dt) {
  e.age += dt;
  e.flash -= dt;
  e.hitCd -= dt;
  e.wob += dt * 6;
  const dx = player.x - e.x, dy = player.y - e.y;
  const d = Math.hypot(dx, dy) || 1;
  const ux = dx / d, uy = dy / d;
  const lvl = Math.min(wave, 12);

  switch (e.type) {
    case 'blob': {
      const sp = 0.8 + lvl * 0.06;
      steer(e, ux * sp, uy * sp, dt, 4);
      break;
    }
    case 'shell': {
      const sp = 0.55 + lvl * 0.03;
      steer(e, ux * sp, uy * sp, dt, 3);
      break;
    }
    case 'horn': {
      e.t -= dt;
      if (e.state === 'move') {
        steer(e, ux * 0.6, uy * 0.6, dt, 3);
        if (e.t <= 0 && d < 3.6) {
          e.state = 'wind'; e.t = 0.7; e.dx = ux; e.dy = uy;
          sfx.windup();
        }
      } else if (e.state === 'wind') {
        e.vx *= 0.8; e.vy *= 0.8;
        if (e.t <= 0) {
          e.state = 'charge'; e.t = 0.55;
          e.vx = e.dx * 7.5; e.vy = e.dy * 7.5;
        }
      } else if (e.state === 'charge') {
        if (Math.random() < dt * 30) burst(e.x, e.y, 2, 1, '#ffcf99', 40, { life: 0.3 });
        if (e.t <= 0) { e.state = 'move'; e.t = rand(1.2, 2); }
      }
      break;
    }
    case 'eye': {
      e.t -= dt;
      const want = d < 2.2 ? -0.5 : d > 3.5 ? 0.4 : 0;
      steer(e, ux * want, uy * want, dt, 2);
      if (e.t <= 0 && mode === 'play') {
        const bs = 2.6 + lvl * 0.08;
        bullets.push({ x: e.x + ux * 0.3, y: e.y + uy * 0.3, vx: ux * bs, vy: uy * bs, r: 0.12, life: 6 });
        e.t = Math.max(1.4, 2.6 - lvl * 0.08);
        sfx.shoot();
      }
      break;
    }
  }

  e.x += e.vx * dt;
  e.y += e.vy * dt;
  if (bounceInside(e, e.r, 0.9) && e.state === 'charge') addTrauma(0.05);
}

function separateEnemies() {
  for (let i = 0; i < enemies.length; i++) {
    for (let j = i + 1; j < enemies.length; j++) {
      const a = enemies[i], b = enemies[j];
      const dx = b.x - a.x, dy = b.y - a.y;
      const d = Math.hypot(dx, dy), min = a.r + b.r;
      if (d > 0 && d < min) {
        const push = (min - d) / 2, nx = dx / d, ny = dy / d;
        a.x -= nx * push; a.y -= ny * push;
        b.x += nx * push; b.y += ny * push;
      }
    }
  }
}

const comboMult = () => Math.min(1 + Math.floor(combo / 3), 8);

function hitEnemy(e, nx, ny) {
  const p = player;
  if (e.hitCd > 0) return;
  e.hp--;
  e.flash = 0.1;
  e.hitCd = 0.15;
  if (e.hp > 0) {
    // 硬殼：把玩家彈開，敵人被擊退
    const dot = p.vx * nx + p.vy * ny;
    p.vx = (p.vx - 2 * dot * nx) * 0.95;
    p.vy = (p.vy - 2 * dot * ny) * 0.95;
    p.x = e.x - nx * (e.r + PLAYER_R + 0.01);
    p.y = e.y - ny * (e.r + PLAYER_R + 0.01);
    e.vx = nx * 5;
    e.vy = ny * 5;
    p.charges = Math.min(MAX_CHARGES, p.charges + 1);
    p.squash = -0.35;
    hitstop = Math.max(hitstop, 0.07);
    addTrauma(0.3);
    punch = Math.max(punch, 0.03);
    burst(e.x, e.y, 14, 14, '#ffffff', 260, { kind: 'spark', life: 0.3 });
    addText(e.x, e.y, '裂！', '#b9ffd9', 18);
    sfx.clang();
    vibrate(15);
    return;
  }
  killEnemy(e);
}

function killEnemy(e) {
  const p = player;
  e.dead = true;
  combo++;
  comboTimer = COMBO_TIME;
  bestCombo = Math.max(bestCombo, combo);
  comboPop = 1;
  const mult = comboMult();
  const pts = e.score * mult;
  score += pts;
  scorePop = 1;
  p.charges = Math.min(MAX_CHARGES, p.charges + 1);
  p.vx *= 0.92;
  p.vy *= 0.92;

  const c = Math.min(combo, 12);
  hitstop = Math.max(hitstop, 0.05 + c * 0.006);
  addTrauma(0.22 + c * 0.03);
  punch = Math.max(punch, 0.035 + c * 0.003);
  const col = ENEMY[e.type].color;
  burst(e.x, e.y, 12, 14 + c, col, 280, { kind: 'shard', life: 0.7, grav: 420, up: 120, size: 4 });
  burst(e.x, e.y, 12, 10, '#ffffff', 380, { kind: 'spark', life: 0.25, dirX: p.vx, dirY: p.vy, spread: 0.6 });
  rings.push(makeRing(e.x, e.y, 1.6 + c * 0.08, 0.9));
  addText(e.x, e.y, `+${pts}`, mult > 1 ? '#ffe66d' : '#ffffff', 18 + Math.min(mult, 6) * 2);
  sfx.kill(combo);
  vibrate(12 + c * 2);
  if (combo % 5 === 0) {
    screenFlash('#ffffff', 0.22);
    addText(p.x, p.y, `${combo} 連擊！`, '#7ff6ff', 28, 1.1);
    sfx.milestone(combo);
  }
}

function hurtPlayer(sx, sy) {
  const p = player;
  if (p.invuln > 0 || p.dead) return;
  p.hp--;
  p.invuln = 1.4;
  heartPop = 1;
  const dx = p.x - sx, dy = p.y - sy, d = Math.hypot(dx, dy) || 1;
  p.vx = (dx / d) * 3.2; // 低於擊殺速度，被撞飛不會順便殺敵
  p.vy = (dy / d) * 3.2;
  if (combo >= 3) addText(p.x, p.y, '連擊中斷', '#ff8fa3', 16);
  combo = 0;
  comboTimer = 0;
  hitstop = Math.max(hitstop, 0.14);
  addTrauma(0.6);
  screenFlash('#ff3b5c', 0.35);
  burst(p.x, p.y, 12, 18, '#ff6b81', 220, { life: 0.5, kind: 'shard', grav: 300 });
  sfx.hurt();
  vibrate([40, 30, 60]);
  if (p.hp <= 0) die();
}

function die() {
  const p = player;
  p.dead = true;
  mode = 'dead';
  deadT = 1.1;
  slowmo = 1.0;
  aim.on = false;
  burst(p.x, p.y, 12, 40, '#e9fdff', 320, { life: 0.9, kind: 'shard', grav: 200 });
  burst(p.x, p.y, 12, 20, '#5ff0ff', 260, { life: 0.6, kind: 'spark' });
  rings.push(makeRing(p.x, p.y, 4, 1));
  addTrauma(1);
  screenFlash('#ffffff', 0.5);
  sfx.die();
  vibrate(200);
  if (run) run.end = performance.now();
  if (score > best) {
    best = score;
    newBest = true;
    store.set('prism.best', best);
  }
}

// ================= 主更新 =================
function updateFx(rdt) {
  trauma = Math.max(0, trauma - rdt * 1.5);
  const s = trauma * trauma * 16;
  shakeX = (Math.random() * 2 - 1) * s;
  shakeY = (Math.random() * 2 - 1) * s;
  punch *= Math.exp(-rdt * 10);
  flashA = Math.max(0, flashA - rdt * 2.2);
  rimFlash = Math.max(0, rimFlash - rdt * 3);
  scorePop *= Math.exp(-rdt * 8);
  comboPop *= Math.exp(-rdt * 7);
  heartPop *= Math.exp(-rdt * 6);
  denyT = Math.max(0, denyT - rdt);
  camLead += (isoX(player.x, player.y) * 0.12 - camLead) * Math.min(1, rdt * 3);
  if (banner) {
    banner.t += rdt;
    if (banner.t > banner.max) banner = null;
  }
  for (const m of motes) {
    m.y -= m.v * rdt;
    if (m.y < -0.02) { m.y = 1.02; m.x = Math.random(); }
  }
}

function updateWorld(dt) {
  if (mode === 'title') {
    titleRingT -= dt;
    if (titleRingT <= 0) {
      rings.push(makeRing(rand(1, N - 1), rand(1, N - 1), 2.5, 0.6));
      titleRingT = 1.4;
    }
  } else {
    if (mode === 'play') updateWaves(dt);
    updatePlayer(dt);

    for (const s of spawns) {
      s.t -= dt;
      if (s.t <= 0) {
        enemies.push(makeEnemy(s.type, s.x, s.y));
        burst(s.x, s.y, 6, 12, ENEMY[s.type].color, 160, { life: 0.4 });
        rings.push(makeRing(s.x, s.y, 0.9, 0.5));
        sfx.pop();
      }
    }
    spawns = spawns.filter(s => s.t > 0);

    for (const e of enemies) updateEnemy(e, dt);
    separateEnemies();

    if (mode === 'play' && !player.dead) {
      for (const e of enemies) {
        if (e.dead) continue;
        const dx = e.x - player.x, dy = e.y - player.y;
        const d = Math.hypot(dx, dy) || 0.001;
        if (d < e.r + PLAYER_R) {
          if (player.dashing) hitEnemy(e, dx / d, dy / d);
          else hurtPlayer(e.x, e.y);
          if (player.dead) break;
        }
      }
    }
    enemies = enemies.filter(e => !e.dead);

    for (const b of bullets) {
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      b.life -= dt;
      if (b.x < -0.5 || b.y < -0.5 || b.x > N + 0.5 || b.y > N + 0.5) b.life = 0;
      if (b.life <= 0 || mode !== 'play' || player.dead) continue;
      if (Math.hypot(b.x - player.x, b.y - player.y) < b.r + PLAYER_R) {
        b.life = 0;
        if (player.dashing) {
          // 衝刺中撞到子彈 = 打掉它
          const pts = 25 * comboMult();
          score += pts;
          scorePop = 1;
          hitstop = Math.max(hitstop, 0.03);
          burst(b.x, b.y, 10, 8, '#ffd1f4', 220, { kind: 'spark', life: 0.25 });
          addText(b.x, b.y, `+${pts}`, '#ffd1f4', 14);
          sfx.parry();
        } else {
          hurtPlayer(b.x, b.y);
        }
      }
    }
    bullets = bullets.filter(b => b.life > 0);

    if (comboTimer > 0) {
      comboTimer -= dt;
      if (comboTimer <= 0) combo = 0;
    }
  }

  for (const p of particles) {
    const k = Math.exp(-p.drag * dt);
    p.vx *= k;
    p.vy = p.vy * k + p.grav * dt;
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.rot += p.vr * dt;
    p.life -= dt;
  }
  particles = particles.filter(p => p.life > 0);

  for (const t of texts) { t.life -= dt; t.y -= 40 * dt; }
  texts = texts.filter(t => t.life > 0);

  for (const t of trails) t.life -= dt;
  trails = trails.filter(t => t.life > 0);

  for (let i = 0; i < tileGlow.length; i++) tileGlow[i] = Math.max(0, tileGlow[i] - dt * 2.5);
  for (const r of rings) {
    r.r += r.speed * dt;
    const v = r.str * (1 - r.r / r.max);
    for (let j = 0; j < N; j++) {
      for (let i = 0; i < N; i++) {
        const d = Math.hypot(i + 0.5 - r.x, j + 0.5 - r.y);
        if (Math.abs(d - r.r) < 0.55 && v > tileGlow[j * N + i]) tileGlow[j * N + i] = v;
      }
    }
  }
  rings = rings.filter(r => r.r < r.max);
}

function update(rdt) {
  time += rdt;
  updateFx(rdt);
  if (mode === 'dead' && !overShown) {
    deadT -= rdt;
    if (deadT <= 0) showOver();
  }
  // 頓幀：擊中瞬間整個世界停住一下，打擊感的關鍵
  if (hitstop > 0) { hitstop -= rdt; return; }
  let target = 1;
  if (aim.on && mode === 'play') target = AIM_SLOW;
  if (slowmo > 0) { slowmo -= rdt; target = Math.min(target, 0.3); }
  timeScale += (target - timeScale) * Math.min(1, rdt * 12);
  updateWorld(rdt * timeScale);
}

// ================= 繪圖 =================
function circle(x, y, r) {
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
}

function quad(ax, ay, bx, by, cx, cy, dx, dy, fill) {
  ctx.beginPath();
  ctx.moveTo(ax, ay);
  ctx.lineTo(bx, by);
  ctx.lineTo(cx, cy);
  ctx.lineTo(dx, dy);
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();
}

function floorEllipse(x, y, r) {
  ctx.beginPath();
  ctx.ellipse(isoX(x, y), isoY(x, y), r * RX, r * RY, 0, 0, Math.PI * 2);
}

function drawMotes() {
  ctx.fillStyle = 'rgba(160, 220, 255, 0.35)';
  for (const m of motes) circle(m.x * W, m.y * H, m.s);
}

function drawIsland() {
  // 島嶼下方的光暈
  ctx.save();
  ctx.translate(0, N * TH + DEPTH + 10);
  ctx.scale(1, 0.35);
  const g = ctx.createRadialGradient(0, 0, 0, 0, 0, N * TW * 0.55);
  g.addColorStop(0, 'rgba(95, 240, 255, 0.2)');
  g.addColorStop(1, 'rgba(95, 240, 255, 0)');
  ctx.fillStyle = g;
  ctx.fillRect(-N * TW, -N * TW, N * TW * 2, N * TW * 2);
  ctx.restore();

  // 依 i+j 由後往前畫，格子被衝擊波掃過時會亮起並彈起
  for (let s = 0; s <= 2 * (N - 1); s++) {
    for (let i = Math.max(0, s - N + 1); i <= Math.min(N - 1, s); i++) {
      const j = s - i;
      const g = tileGlow[j * N + i];
      const lift = g * 7;
      const tx = isoX(i, j), ty = isoY(i, j) - lift;
      const rx = isoX(i + 1, j), ry = isoY(i + 1, j) - lift;
      const bx = isoX(i + 1, j + 1), by = isoY(i + 1, j + 1) - lift;
      const lx = isoX(i, j + 1), ly = isoY(i, j + 1) - lift;
      const hR = (i === N - 1 ? DEPTH : 0) + lift;
      const hL = (j === N - 1 ? DEPTH : 0) + lift;
      if (hR > 0.3) quad(rx, ry, bx, by, bx, by + hR, rx, ry + hR, mix(SIDE_R, GLOW, g * 0.4));
      if (hL > 0.3) quad(lx, ly, bx, by, bx, by + hL, lx, ly + hL, mix(SIDE_L, GLOW, g * 0.4));
      quad(tx, ty, rx, ry, bx, by, lx, ly, mix((i + j) % 2 ? TILE_A : TILE_B, GLOW, g * 0.8));
    }
  }

  ctx.beginPath();
  ctx.moveTo(isoX(0, 0), isoY(0, 0));
  ctx.lineTo(isoX(N, 0), isoY(N, 0));
  ctx.lineTo(isoX(N, N), isoY(N, N));
  ctx.lineTo(isoX(0, N), isoY(0, N));
  ctx.closePath();
  ctx.strokeStyle = `rgba(127, 246, 255, ${0.18 + rimFlash * 0.6})`;
  ctx.lineWidth = 2 + rimFlash * 2;
  ctx.stroke();
}

function drawFloorFx() {
  for (const s of spawns) {
    const k = 1 - s.t / s.max;
    const col = ENEMY[s.type].color;
    floorEllipse(s.x, s.y, 0.45 * (1.4 - k * 0.4));
    ctx.strokeStyle = col;
    ctx.globalAlpha = 0.4 + 0.4 * Math.sin(time * 20);
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.globalAlpha = k * 0.35;
    ctx.fillStyle = col;
    ctx.fill();
    ctx.globalAlpha = k * 0.5;
    const px = isoX(s.x, s.y), py = isoY(s.x, s.y);
    ctx.fillRect(px - 3 * k, py - 70, 6 * k, 70);
    ctx.globalAlpha = 1;
  }

  for (const r of rings) {
    const a = 1 - r.r / r.max;
    floorEllipse(r.x, r.y, r.r);
    ctx.strokeStyle = `rgba(190, 250, 255, ${a * r.str})`;
    ctx.lineWidth = 1 + 3 * a;
    ctx.stroke();
  }

  // 衝鋒怪的預警線
  ctx.setLineDash([6, 6]);
  ctx.lineDashOffset = -time * 60;
  for (const e of enemies) {
    if (e.type !== 'horn' || e.state !== 'wind') continue;
    ctx.strokeStyle = `rgba(255, 90, 60, ${0.5 + 0.4 * Math.sin(time * 30)})`;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(isoX(e.x, e.y), isoY(e.x, e.y));
    ctx.lineTo(isoX(e.x + e.dx * 3.8, e.y + e.dy * 3.8), isoY(e.x + e.dx * 3.8, e.y + e.dy * 3.8));
    ctx.stroke();
  }
  ctx.setLineDash([]);
}

function drawShadows() {
  ctx.fillStyle = 'rgba(5, 8, 25, 0.45)';
  if (!player.dead) { floorEllipse(player.x, player.y, PLAYER_R * 0.9); ctx.fill(); }
  for (const e of enemies) { floorEllipse(e.x, e.y, e.r * 0.9 * Math.min(1, e.age / 0.3)); ctx.fill(); }
  for (const b of bullets) { floorEllipse(b.x, b.y, b.r); ctx.fill(); }
}

// 瞄準時預測衝刺路徑（含反彈），只畫出「有殺傷力」的那一段
function drawAim() {
  if (!aim.on || mode !== 'play' || player.dead) return;
  const v = aimVector();
  if (!v) return;
  const col = player.charges > 0 ? '127, 246, 255' : '255, 90, 110';
  const sp = DASH_MIN + (DASH_MAX - DASH_MIN) * v.power;
  const o = { x: player.x, y: player.y, vx: v.x * sp, vy: v.y * sp };
  const step = 1 / 60, k = Math.exp(-FRICTION * step);
  const offset = Math.floor(time * 30);
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  for (let i = 0; i < 120; i++) {
    o.x += o.vx * step;
    o.y += o.vy * step;
    bounceInside(o, PLAYER_R, 0.85);
    o.vx *= k;
    o.vy *= k;
    if (Math.hypot(o.vx, o.vy) < KILL_SPEED) break;
    if ((i + offset) % 4 === 0) {
      const t = i / 120;
      ctx.fillStyle = `rgba(${col}, ${0.9 - t * 0.5})`;
      circle(isoX(o.x, o.y), isoY(o.x, o.y) - 4, 3.2 * (1 - t * 0.5));
    }
  }
  floorEllipse(o.x, o.y, PLAYER_R * 1.3);
  ctx.strokeStyle = `rgba(${col}, 0.8)`;
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.restore();
}

function drawTrails() {
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  const r = PLAYER_R * RX;
  for (const t of trails) {
    const a = t.life / t.max;
    ctx.save();
    ctx.translate(isoX(t.x, t.y), isoY(t.x, t.y) - r - 5);
    ctx.rotate(Math.atan2(isoY(t.vx, t.vy), isoX(t.vx, t.vy)));
    ctx.scale(1.5, 0.7);
    ctx.fillStyle = `rgba(95, 240, 255, ${a * 0.35})`;
    circle(0, 0, r * a);
    ctx.restore();
  }
  ctx.restore();
}

function drawPlayer() {
  const p = player;
  const sp = Math.hypot(p.vx, p.vy);
  const r = PLAYER_R * RX;
  const px = isoX(p.x, p.y);
  const cy = isoY(p.x, p.y) - r - 5 + (sp < 1 ? Math.sin(time * 6) * 1.5 : 0);
  const blink = p.invuln > 0 && Math.floor(p.invuln * 18) % 2 === 0;

  ctx.save();
  ctx.globalAlpha = blink ? 0.35 : 1;
  ctx.translate(px, cy);

  // 身體依速度方向拉長（擠壓與伸展）
  const st = clamp((sp / DASH_MAX) * 0.55 + p.squash, -0.4, 0.7);
  ctx.save();
  ctx.rotate(Math.atan2(isoY(p.vx, p.vy), isoX(p.vx, p.vy)));
  ctx.scale(1 + st, 1 / (1 + st));
  ctx.globalCompositeOperation = 'lighter';
  ctx.fillStyle = p.dashing ? 'rgba(95, 240, 255, 0.4)' : 'rgba(95, 240, 255, 0.2)';
  circle(0, 0, r * 1.7);
  ctx.globalCompositeOperation = 'source-over';
  ctx.fillStyle = '#e4fdff';
  circle(0, 0, r);
  ctx.strokeStyle = '#5ff0ff';
  ctx.lineWidth = 2.5;
  ctx.stroke();
  ctx.restore();

  // 眼睛看向面對的方向；背對鏡頭時不畫
  const fsx = isoX(p.fx, p.fy), fsy = isoY(p.fx, p.fy);
  const fl = Math.hypot(fsx, fsy) || 1;
  const ex = fsx / fl, ey = fsy / fl;
  if (ey > -0.6) {
    ctx.fillStyle = '#14204a';
    for (const s of [-1, 1]) {
      ctx.beginPath();
      ctx.ellipse(s * r * 0.3 + ex * r * 0.3, -r * 0.1 + ey * r * 0.25, r * 0.13, p.dashing ? r * 0.06 : r * 0.2, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // 頭上的衝刺格
  const shake = denyT > 0 ? Math.sin(time * 80) * 3 * (denyT / 0.35) : 0;
  for (let k = 0; k < MAX_CHARGES; k++) {
    const x = (k - 1) * 11 + shake, y = -r - 13, s = 4.5;
    ctx.beginPath();
    ctx.moveTo(x, y - s); ctx.lineTo(x + s, y); ctx.lineTo(x, y + s); ctx.lineTo(x - s, y);
    ctx.closePath();
    if (k < p.charges) {
      ctx.fillStyle = '#7ff6ff';
      ctx.fill();
    } else {
      ctx.strokeStyle = denyT > 0 ? '#ff5a6e' : 'rgba(127, 246, 255, 0.4)';
      ctx.lineWidth = 1.5;
      ctx.stroke();
      if (k === p.charges) {
        const f = p.chargeT / CHARGE_TIME;
        ctx.save();
        ctx.translate(x, y);
        ctx.scale(f, f);
        ctx.translate(-x, -y);
        ctx.fillStyle = 'rgba(127, 246, 255, 0.6)';
        ctx.fill();
        ctx.restore();
      }
    }
  }
  ctx.restore();
}

function ball(r, color, dark) {
  ctx.fillStyle = dark;
  circle(0, r * 0.08, r);
  ctx.fillStyle = color;
  circle(0, -r * 0.04, r * 0.9);
  ctx.fillStyle = 'rgba(255, 255, 255, 0.35)';
  ctx.beginPath();
  ctx.ellipse(-r * 0.35, -r * 0.45, r * 0.25, r * 0.15, -0.5, 0, Math.PI * 2);
  ctx.fill();
}

function eyes(ex, ey, r, angry) {
  const ox = ex * r * 0.25, oy = ey * r * 0.18 - r * 0.12;
  for (const s of [-1, 1]) {
    const x = s * r * 0.33 + ox, y = oy;
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.ellipse(x, y, r * 0.2, r * 0.24, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#1a1030';
    circle(x + ex * r * 0.07, y + ey * r * 0.07, r * 0.11);
    if (angry) {
      ctx.strokeStyle = '#1a1030';
      ctx.lineWidth = r * 0.1;
      ctx.beginPath();
      ctx.moveTo(x + s * r * 0.22, y - r * 0.36);
      ctx.lineTo(x - s * r * 0.16, y - r * 0.2);
      ctx.stroke();
    }
  }
}

function hexagon(r) {
  ctx.beginPath();
  for (let i = 0; i < 6; i++) {
    const a = Math.PI / 6 + (i * Math.PI) / 3;
    if (i) ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r * 0.85);
    else ctx.moveTo(Math.cos(a) * r, Math.sin(a) * r * 0.85);
  }
  ctx.closePath();
}

function drawEnemy(e) {
  const d = ENEMY[e.type];
  const sc = e.age < 0.3 ? easeOutBack(e.age / 0.3) : 1;
  const r = e.r * RX * sc;
  const ox = e.type === 'horn' && e.state === 'wind' ? Math.sin(time * 70) * 2 : 0;
  const white = e.flash > 0;
  const lx = isoX(player.x - e.x, player.y - e.y), ly = isoY(player.x - e.x, player.y - e.y);
  const ll = Math.hypot(lx, ly) || 1;
  const ex = lx / ll, ey = ly / ll;

  ctx.save();
  ctx.translate(isoX(e.x, e.y) + ox, isoY(e.x, e.y) - r - 3);
  switch (e.type) {
    case 'blob': {
      const w = Math.sin(e.wob) * 0.1;
      ctx.scale(1 + w, 1 - w);
      ball(r, white ? '#fff' : d.color, white ? '#fff' : d.dark);
      eyes(ex, ey, r, false);
      break;
    }
    case 'horn': {
      ctx.fillStyle = white ? '#fff' : '#ffe2b8';
      for (const s of [-1, 1]) {
        ctx.beginPath();
        ctx.moveTo(s * r * 0.45, -r * 0.6);
        ctx.lineTo(s * r * 0.95, -r * 1.35);
        ctx.lineTo(s * r * 0.1, -r * 0.85);
        ctx.fill();
      }
      const body = e.state === 'wind' ? '#ff6a3d' : d.color;
      ball(r, white ? '#fff' : body, white ? '#fff' : d.dark);
      eyes(ex, ey, r, e.state !== 'move');
      break;
    }
    case 'eye': {
      const charging = e.t < 0.5;
      if (charging) {
        ctx.globalCompositeOperation = 'lighter';
        ctx.fillStyle = `rgba(255, 80, 180, ${0.3 + 0.3 * Math.sin(time * 40)})`;
        circle(0, 0, r * 1.35);
        ctx.globalCompositeOperation = 'source-over';
      }
      ball(r, white ? '#fff' : d.color, white ? '#fff' : d.dark);
      ctx.fillStyle = '#f6efff';
      circle(ex * r * 0.15, ey * r * 0.12 - r * 0.05, r * 0.55);
      ctx.fillStyle = charging ? '#ff2d8a' : '#2a1550';
      circle(ex * r * 0.32, ey * r * 0.25 - r * 0.05, r * 0.26);
      ctx.fillStyle = '#fff';
      circle(ex * r * 0.32 - r * 0.08, ey * r * 0.25 - r * 0.13, r * 0.07);
      break;
    }
    case 'shell': {
      ctx.save();
      ctx.translate(0, r * 0.08);
      hexagon(r);
      ctx.fillStyle = white ? '#fff' : d.dark;
      ctx.fill();
      ctx.restore();
      hexagon(r * 0.88);
      ctx.fillStyle = white ? '#fff' : d.color;
      ctx.fill();
      hexagon(r * 0.5);
      ctx.fillStyle = 'rgba(255, 255, 255, 0.18)';
      ctx.fill();
      if (e.hp === 1) {
        ctx.strokeStyle = '#0f3a26';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(-r * 0.6, -r * 0.5);
        ctx.lineTo(-r * 0.2, -r * 0.1);
        ctx.lineTo(-r * 0.35, r * 0.2);
        ctx.lineTo(r * 0.1, r * 0.55);
        ctx.stroke();
      }
      eyes(ex, ey, r * 0.8, true);
      break;
    }
  }
  ctx.restore();
}

function drawBullet(b) {
  const px = isoX(b.x, b.y), py = isoY(b.x, b.y) - 10;
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.fillStyle = 'rgba(255, 107, 224, 0.3)';
  circle(px, py, b.r * RX * 2.2);
  ctx.restore();
  ctx.fillStyle = '#ffd1f4';
  circle(px, py, b.r * RX);
}

function drawEntities() {
  const list = [];
  if (!player.dead) list.push({ d: player.x + player.y, f: drawPlayer });
  for (const e of enemies) list.push({ d: e.x + e.y, f: () => drawEnemy(e) });
  for (const b of bullets) list.push({ d: b.x + b.y, f: () => drawBullet(b) });
  list.sort((a, b) => a.d - b.d);
  for (const it of list) it.f();
}

function drawParticles() {
  ctx.save();
  for (const p of particles) {
    const a = Math.max(0, p.life / p.max);
    ctx.globalAlpha = a;
    if (p.kind === 'spark') {
      ctx.globalCompositeOperation = 'lighter';
      ctx.strokeStyle = p.color;
      ctx.lineWidth = p.size * 0.7;
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
      ctx.lineTo(p.x - p.vx * 0.04, p.y - p.vy * 0.04);
      ctx.stroke();
    } else if (p.kind === 'shard') {
      ctx.globalCompositeOperation = 'source-over';
      ctx.fillStyle = p.color;
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      ctx.fillRect(-p.size, -p.size * 0.5, p.size * 2, p.size);
      ctx.restore();
    } else {
      ctx.globalCompositeOperation = 'source-over';
      ctx.fillStyle = p.color;
      circle(p.x, p.y, p.size * (0.4 + 0.6 * a));
    }
  }
  ctx.restore();
}

function popText(text, x, y, size, color, alpha = 1) {
  ctx.globalAlpha = alpha;
  ctx.font = `800 ${size}px ${FONT}`;
  ctx.lineWidth = Math.max(3, size * 0.18);
  ctx.strokeStyle = 'rgba(8, 10, 24, 0.85)';
  ctx.strokeText(text, x, y);
  ctx.fillStyle = color;
  ctx.fillText(text, x, y);
  ctx.globalAlpha = 1;
}

function drawTexts() {
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round';
  for (const t of texts) {
    const k = 1 - t.life / t.max;
    const sc = k < 0.15 ? 0.5 + (k / 0.15) * 0.8 : 1.3 - Math.min(0.3, (k - 0.15) * 2);
    popText(t.text, t.x, t.y, t.size * sc, t.color, Math.min(1, (t.life / t.max) * 3));
  }
}

function heart(x, y, s, full) {
  ctx.beginPath();
  ctx.moveTo(x, y + s * 0.9);
  ctx.bezierCurveTo(x - s * 1.25, y + s * 0.05, x - s * 0.6, y - s * 0.95, x, y - s * 0.3);
  ctx.bezierCurveTo(x + s * 0.6, y - s * 0.95, x + s * 1.25, y + s * 0.05, x, y + s * 0.9);
  if (full) {
    ctx.fillStyle = '#ff5d7a';
    ctx.fill();
  } else {
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.25)';
    ctx.lineWidth = 2;
    ctx.stroke();
  }
}

function drawHUD() {
  ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round';

  if (mode !== 'title') {
    const top = safeTop + 14;
    for (let k = 0; k < MAX_HP; k++) {
      const full = k < player.hp;
      heart(24 + k * 30, top + 12, 10 * (full ? 1 + heartPop * 0.35 : 1), full);
    }

    ctx.textAlign = 'center';
    popText(score.toLocaleString(), W / 2, top + 14, 30 * (1 + scorePop * 0.25), '#ffffff');
    popText(`最佳 ${best.toLocaleString()}`, W / 2, top + 40, 12, 'rgba(255, 255, 255, 0.55)');

    ctx.textAlign = 'right';
    popText(`第 ${wave} 波`, W - 16, top + 12, 15, 'rgba(255, 255, 255, 0.8)');

    if (combo >= 2) {
      ctx.textAlign = 'center';
      const cy = top + 72;
      const hue = (180 + combo * 18) % 360;
      popText(`${combo} 連擊`, W / 2, cy, 22 * (1 + comboPop * 0.45), `hsl(${hue}, 100%, 72%)`);
      popText(`x${comboMult()}`, W / 2, cy + 24, 14, '#ffe66d');
      ctx.fillStyle = 'rgba(255, 255, 255, 0.15)';
      ctx.fillRect(W / 2 - 45, cy + 38, 90, 3);
      ctx.fillStyle = `hsl(${hue}, 100%, 72%)`;
      ctx.fillRect(W / 2 - 45, cy + 38, 90 * clamp(comboTimer / COMBO_TIME, 0, 1), 3);
    }

    if (banner) {
      const t = banner.t;
      const sc = t < 0.25 ? easeOutBack(t / 0.25) : 1;
      const a = Math.min(1, (banner.max - t) / 0.3);
      const islandTop = H * 0.52 - (N * TH / 2 + DEPTH / 2) * viewScale;
      const by = Math.max(safeTop + 130, islandTop - 30);
      ctx.textAlign = 'center';
      popText(banner.text, W / 2, by, 36 * sc, '#ffffff', a);
      if (banner.sub) popText(banner.sub, W / 2, by + 32, 18 * sc, '#7ff6ff', a);
    }

    if (mode === 'play' && !hasDashed && wave >= 1) {
      ctx.textAlign = 'center';
      popText('按住往後拉，放開衝刺', W / 2, H - 70, 16, '#ffffff', 0.6 + 0.4 * Math.sin(time * 4));
    }

    if (aim.on) {
      const v = aimVector();
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.3)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(aim.sx, aim.sy, 10, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(aim.sx, aim.sy);
      ctx.lineTo(aim.x, aim.y);
      ctx.stroke();
      if (v) {
        ctx.strokeStyle = 'rgba(127, 246, 255, 0.8)';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(aim.sx, aim.sy, 18, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * v.power);
        ctx.stroke();
      }
    }

    if (player.hp === 1 && !player.dead) {
      const g = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.35, W / 2, H / 2, Math.max(W, H) * 0.75);
      g.addColorStop(0, 'rgba(255, 40, 70, 0)');
      g.addColorStop(1, `rgba(255, 40, 70, ${0.22 + 0.1 * Math.sin(time * 5)})`);
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, W, H);
    }
  }

  if (flashA > 0) {
    ctx.globalAlpha = flashA;
    ctx.fillStyle = flashColor;
    ctx.fillRect(0, 0, W, H);
    ctx.globalAlpha = 1;
  }
}

function render() {
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);
  drawMotes();

  ctx.save();
  ctx.translate(W / 2 + shakeX, H * 0.52 + shakeY + Math.sin(time * 1.2) * 3);
  ctx.scale(viewScale * (1 + punch), viewScale * (1 + punch));
  ctx.translate(-camLead, -(N * TH / 2 + DEPTH / 2));
  drawIsland();
  drawFloorFx();
  drawShadows();
  drawAim();
  drawTrails();
  drawEntities();
  drawParticles();
  drawTexts();
  ctx.restore();

  drawHUD();
}

// ================= 介面 =================
const $ = id => document.getElementById(id);
const ui = {
  title: $('title'), titleBest: $('title-best'),
  over: $('over'), overScore: $('over-score'), overDetail: $('over-detail'), overBest: $('over-best'),
  revive: $('btn-revive'), retry: $('btn-retry'), start: $('btn-start'), mute: $('btn-mute'),
  lab: $('btn-lab'),
};

ui.titleBest.textContent = best > 0 ? `最佳分數 ${best.toLocaleString()}` : '';
ui.mute.textContent = isMuted() ? '🔇' : '🔊';

function startRun() {
  resetGame();
  mode = 'play';
  run = { start: performance.now(), end: 0, reported: false };
}

// ================= 試驗場模式 =================
// park.html 用 iframe 載入 index.html?mode=lab。每局結束（重玩、完成或中途離開）時，
// 用 postMessage 回傳共用介面的結果：{ durationSec, grade, score }。
const labMode = new URLSearchParams(location.search).get('mode') === 'lab';
let run = null;

function finishRun() {
  if (!labMode || !run || run.reported) return;
  run.reported = true;
  const durationSec = Math.round(((run.end || performance.now()) - run.start) / 1000);
  const grade = wave >= 8 ? 'S' : wave >= 5 ? 'A' : wave >= 3 ? 'B' : 'C';
  parent.postMessage({ type: 'lab:result', durationSec, grade, score }, '*');
}

if (labMode) {
  ui.lab.hidden = false;
  ui.lab.addEventListener('click', () => {
    finishRun();
    parent.postMessage({ type: 'lab:close' }, '*');
  });
  window.addEventListener('message', e => {
    if (e.data?.type !== 'lab:quit') return;
    finishRun();
    parent.postMessage({ type: 'lab:close' }, '*');
  });
}

function showOver() {
  overShown = true;
  ui.overScore.textContent = score.toLocaleString();
  ui.overDetail.textContent = `到達第 ${wave} 波 · 最高 ${bestCombo} 連擊 · 最佳 ${best.toLocaleString()}`;
  ui.overBest.hidden = !newBest;
  ui.revive.hidden = revived;
  ui.revive.disabled = false;
  ui.over.classList.add('show');
}

ui.start.addEventListener('click', () => {
  unlockAudio();
  ui.title.classList.remove('show');
  startRun();
});

ui.retry.addEventListener('click', async () => {
  ui.over.classList.remove('show');
  finishRun();
  await Ads.onRunEnd();
  startRun();
});

ui.revive.addEventListener('click', async () => {
  ui.revive.disabled = true;
  const ok = await Ads.showRewarded();
  if (!ok) { ui.revive.disabled = false; return; }
  revived = true;
  overShown = false;
  if (run) run.end = 0;
  ui.over.classList.remove('show');
  const p = player;
  Object.assign(p, { dead: false, hp: 2, invuln: 2, vx: 0, vy: 0, charges: MAX_CHARGES });
  heartPop = 1;
  mode = 'play';
  bullets = [];
  for (const e of enemies) {
    const dx = e.x - p.x, dy = e.y - p.y, d = Math.hypot(dx, dy) || 1;
    e.vx = (dx / d) * 6;
    e.vy = (dy / d) * 6;
    e.state = 'move';
    e.t = 1.5;
  }
  rings.push(makeRing(p.x, p.y, 5, 1));
  screenFlash('#7ff6ff', 0.4);
  showBanner('復活！', '', 1.0);
  sfx.heal();
});

ui.mute.addEventListener('click', () => {
  unlockAudio();
  ui.mute.textContent = toggleMute() ? '🔇' : '🔊';
});

document.addEventListener('visibilitychange', () => {
  paused = document.hidden;
  aim.on = false;
  suspendAudio(document.hidden);
});

// ================= 主迴圈 =================
let last = performance.now();
function frame(now) {
  const rdt = Math.min(0.05, (now - last) / 1000);
  last = now;
  if (!paused) update(rdt);
  render();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
