// 鋼球滑道：鋼球自己往前滾，手指左右滑動閃開障礙物，滾到終點就過關。
// 試驗場用 iframe 載入 ball.html?mode=lab&level=3&shield=1&boost=1&fails=0，
// 每次一關結束（過關、或失敗後選擇重來／離開）就用 postMessage 回傳結果。
import { unlockAudio, suspendAudio, toggleMute, isMuted, sfx } from './audio.js';
import { Ads } from './ads.js';

const canvas = document.getElementById('ball');
const ctx = canvas.getContext('2d');
const $ = id => document.getElementById(id);

// ================= 參數（手感都在這裡調）=================
const HALF = 1.5;           // 跑道半寬
const R = 0.3;              // 球半徑
const CAM_BACK = 3.2;       // 鏡頭在球後方多遠
const CAM_H = 2.6;          // 鏡頭高度
const CAM_FOLLOW = 0.55;    // 鏡頭左右跟球的比例（製造視差）
const FAR = 70;             // 看得到多遠
const DRAG_GAIN = 1.05;     // 手指橫移「畫面寬的 80%」= 球移動一整個跑道寬 × 這個倍數
const FOLLOW = 26;          // 球追手指的速度，越大越跟手
const MAX_LATERAL = 9;      // 產生關卡時假設玩家最快的橫移速度（格/秒）
const NEAR_MISS = 0.2;      // 和障礙物的距離小於這個就算擦身而過
const INVULN = 1.0;         // 護盾擋下一次撞擊後的無敵秒數
const STARS = [0.6, 0.9];   // 寶石收集比例達到這些值 → 2 星、3 星
const EASE_AFTER = 3;       // 同一關失敗幾次後悄悄降低難度
const GRAV = 11;            // 騰空時的重力（越小越飄）
const DROP_EVERY = 30;      // 兩次騰空之間至少隔這麼遠
const AIR_CHANCE = 0.35;    // 每一排有這個機率變成騰空段
const DROP = [3.5, 7];      // 斷崖的高度差範圍
const RAMP = { len: 3.5, rise: 1.6 };   // 跳台長度與抬升高度（第 2 關起）
const BASE_SPEED = 9.5;     // 第 1 關的速度
const BOOST = { from: 4, at: 0.5, mult: 1.22, step: 0.01, max: 1.4 };  // 第 4 關起，關卡一半的位置有強制加速帶

const params = new URLSearchParams(location.search);
const labMode = params.get('mode') === 'lab';
const baseShield = Number(params.get('shield')) || 0;   // 設施等級給的護盾
let boost = Number(params.get('boost')) || 0;           // 道具買的護盾，只用在第一次挑戰
let level = Math.max(1, Number(params.get('level')) || 1);
let fails = Number(params.get('fails')) || 0;

const rand01 = Math.random;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
function vibrate(p) {
  if (navigator.userActivation && !navigator.userActivation.hasBeenActive) return;
  try { navigator.vibrate?.(p); } catch {}
}

// ================= 關卡產生器 =================
// 同一關每次產生的都一樣（固定種子）
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const COLORS = ['#ff8fb1', '#ffb35c', '#8f9bff', '#6fd6b4', '#ff7a7a', '#c38bff'];

function makeLevel(n, ease) {
  const r = rng(n * 7919 + 13);
  // 難度呈鋸齒狀：每 5 關一個難關，後面兩關放鬆一點
  const tier = n % 5 === 0 ? 3 : n % 5 === 1 && n > 1 ? -2 : n % 5 === 2 && n > 2 ? -1 : 0;
  const d = Math.max(0, n - 1 + tier - (ease ? 3 : 0));
  const speed = Math.min(17, BASE_SPEED + d * 0.22) * (ease ? 0.92 : 1);
  const length = Math.round(speed * (26 + Math.min(n, 30)));
  // 加速帶：過了之後後半段變快；產生關卡時也用變快後的速度來算玩家來不來得及閃
  const boostZ = n >= BOOST.from ? Math.round(length * BOOST.at) : Infinity;
  const boostMul = Math.min(BOOST.max, BOOST.mult + (n - BOOST.from) * BOOST.step);
  let spd = speed;
  const gap = Math.max(1.0, 1.9 - d * 0.03) + (ease ? 0.25 : 0);
  const spacing = Math.max(4.2, 9 - d * 0.13);

  // 新機制一關一關加進來，剛解鎖的那種出現得比較多
  const kinds = ['block'];
  if (n >= 3) kinds.push('wall');
  if (n >= 5) kinds.push('mover');
  if (n >= 8) kinds.push('hole');
  if (n >= 12) kinds.push('zigzag');
  const newest = kinds[kinds.length - 1];
  const intro = {
    1: '軌道會斷掉！騰空時也能左右移動吃寶石', 2: '新玩法：跳台，飛得更高更遠', 3: '新障礙：牆',
    [BOOST.from]: '新玩法：中段的加速帶，過了之後更快', 5: '新障礙：會動的方塊', 8: '新障礙：地面破洞', 12: '新障礙：連續窄門',
  }[n] || '';

  // 跑道由好幾段組成；每段有自己的高度（跳台那段是斜的），段和段之間可以是空的
  const segs = [], obs = [], holes = [], gems = [];
  let segStart = 0, curH = 0, lastAir = -99, pad = null;
  const lo = -HALF + gap / 2, hi = HALF - gap / 2;
  let z = 16, gx = 0;
  const color = () => COLORS[(r() * COLORS.length) | 0];
  const box = (x0, x1, z0, depth, h, extra = {}) => {
    if (x1 - x0 > 0.15) obs.push({ x0, x1, z0, z1: z0 + depth, h, base: curH, color: color(), ...extra });
  };
  const nextLane = (dz) => clamp(gx + (r() * 2 - 1) * Math.min((dz / spd) * MAX_LATERAL * 0.55, HALF * 1.5), lo, hi);
  const gemTrail = (fromX, toX, z0, z1) => {
    const count = r() < 0.35 ? 3 : 1;
    for (let k = 0; k < count; k++) {
      const t = (k + 1) / (count + 1);
      gems.push({ x: lerp(fromX, toX, t), z: lerp(z0, z1, t), y: curH + 0.42, got: false });
    }
  };

  while (z < length - 14) {
    // 加速帶：整條跑道寬、一定會經過；前後都留空地
    if (z >= boostZ && !pad) {
      pad = { z0: z, z1: z + 3, y: curH, mult: boostMul };
      spd = speed * boostMul;
      z += 3 + spacing;
      continue;
    }
    // 騰空：軌道在這裡斷掉，球飛出去，落到前方更低的另一段軌道上
    if (z - lastAir > DROP_EVERY && r() < AIR_CHANCE) {
      const edge = z + 2;
      const ramp = n >= 2 && r() < 0.5;
      const drop = DROP[0] + r() * (DROP[1] - DROP[0]);
      let vy0 = 0;
      if (ramp) {
        // 跳台：最後一段往上斜，球會被往上拋
        segs.push({ z0: segStart, z1: edge - RAMP.len, y0: curH, y1: curH });
        segs.push({ z0: edge - RAMP.len, z1: edge, y0: curH, y1: curH + RAMP.rise, ramp: true });
        curH += RAMP.rise;
        vy0 = (spd * RAMP.rise) / RAMP.len;
      } else segs.push({ z0: segStart, z1: edge, y0: curH, y1: curH });
      // 算出落點：空隙一定比飛行距離短，所以只要不撞到東西就一定落得到
      const tAir = (vy0 + Math.sqrt(vy0 * vy0 + 2 * GRAV * drop)) / GRAV;
      const target = clamp(gx + (r() * 2 - 1) * 1.4, -HALF + 0.5, HALF - 0.5);
      for (let k = 1; k <= 5; k++) {
        const tk = (tAir * k) / 6;
        gems.push({ x: lerp(gx, target, k / 5), z: edge + spd * tk, y: curH + vy0 * tk - (GRAV * tk * tk) / 2 + R, got: false });
      }
      curH -= drop;
      segStart = edge + spd * tAir * 0.7;
      gx = target;
      z = edge + spd * tAir + spacing + 2;   // 落地後留一段空地
      lastAir = z;
      continue;
    }
    const kind = n <= 2 ? 'block' : r() < 0.45 ? newest : kinds[(r() * kinds.length) | 0];
    if (kind === 'zigzag') {
      for (let k = 0; k < 3; k++) {
        const nx = clamp((k % 2 ? 1 : -1) * (HALF - gap / 2 - 0.1) * (0.6 + r() * 0.4), lo, hi);
        gemTrail(gx, nx, z - spacing * 0.7, z);
        box(-HALF, nx - gap * 0.55, z, 0.5, 1.1);
        box(nx + gap * 0.55, HALF, z, 0.5, 1.1);
        gx = nx;
        z += spacing * 0.75;
      }
      z += spacing * 0.5;
      continue;
    }
    const nx = nextLane(spacing);
    gemTrail(gx, nx, z - spacing, z - 0.8);
    if (kind === 'block') {
      // 安全通道兩邊放方塊；有時只放一邊
      const one = r() < 0.4;
      const h = 0.55 + r() * 0.45;
      if (!one || r() < 0.5) box(-HALF, nx - gap / 2, z, 0.8, h);
      if (!one || obs.length === 0 || obs[obs.length - 1].z0 !== z) box(nx + gap / 2, HALF, z, 0.8, h);
    } else if (kind === 'wall') {
      box(-HALF, nx - gap * 0.55, z, 0.5, 1.2);
      box(nx + gap * 0.55, HALF, z, 0.5, 1.2);
    } else if (kind === 'mover') {
      // 左右來回的方塊；寬度保證任何時候至少有一邊過得去
      const w = Math.min(0.9, 2 * HALF - 2 * gap);
      const amp = HALF - w / 2;
      obs.push({ x0: -w / 2, x1: w / 2, z0: z, z1: z + 0.8, h: 0.8, base: curH, color: color(), move: { amp, speed: 1.4 + r() * 1.2 + d * 0.02, phase: r() * 6 } });
    } else if (kind === 'hole') {
      const depth = 2 + r() * 1.5;
      if (nx - gap / 2 > -HALF + 0.2) holes.push({ x0: -HALF, x1: nx - gap / 2, z0: z, z1: z + depth, y: curH });
      if (nx + gap / 2 < HALF - 0.2) holes.push({ x0: nx + gap / 2, x1: HALF, z0: z, z1: z + depth, y: curH });
      z += depth;
    }
    gx = nx;
    z += spacing;
  }
  segs.push({ z0: segStart, z1: length + 40, y0: curH, y1: curH });
  for (const o of obs) Object.assign(o, { minD: 9, passed: false });
  return { n, speed, length, segs, obs, holes, gems, intro, pad };
}

// ---- 跑道高度查詢 ----
const segAt = z => L.segs.find(s => z >= s.z0 && z < s.z1) || null;
const heightOn = (s, z) => lerp(s.y0, s.y1, clamp((z - s.z0) / (s.z1 - s.z0), 0, 1));
const holeAt = (x, z) => L.holes.find(h => z > h.z0 + 0.15 && z < h.z1 - 0.1 && x > h.x0 && x < h.x1) || null;
// 球底下有沒有地面：有就回傳高度，沒有（斷崖、破洞）回傳 null
function support(x, z, ignoreHoles = false) {
  const s = segAt(z);
  if (!s || (!ignoreHoles && holeAt(x, z))) return null;
  return heightOn(s, z);
}
// 前方一小段裡最低的地面；球掉到比這還低就是摔出跑道了
function lowestAhead(z) {
  let m = Infinity;
  for (const s of L.segs) if (s.z1 > z - 1 && s.z0 < z + 30) m = Math.min(m, s.y0, s.y1);
  return m === Infinity ? ball.lastGround : m;
}
const floorAt = z => { const s = segAt(z) || L.segs[L.segs.length - 1]; return heightOn(s, z); };

// ================= 畫面 =================
let W = 0, H = 0, DPR = 1, F = 300, HOR = 200;
function resize() {
  DPR = Math.min(window.devicePixelRatio || 1, 2);
  W = window.innerWidth;
  H = window.innerHeight;
  canvas.width = Math.round(W * DPR);
  canvas.height = Math.round(H * DPR);
  canvas.style.width = W + 'px';
  canvas.style.height = H + 'px';
  F = Math.min(W * 0.9, H * 0.55);
  HOR = H * 0.3;
}
window.addEventListener('resize', resize);
resize();

// ================= 狀態 =================
let L = null;               // 目前關卡
let state = 'ready';        // ready | play | crash | done
let ball, camX = 0, camY = CAM_H, camZ = 0, tilt = 0, t = 0, runT = 0;
let shields = 0, inv = 0, gemsGot = 0, continued = false, reported = false;
let trauma = 0, flash = 0, hitstop = 0, crashT = 0, doneT = 0;
let parts = [], texts = [], trail = [], streaks = [];
let paused = false, lastNearZ = -1, fovKick = 0;

function load(n) {
  level = n;
  L = makeLevel(n, fails >= EASE_AFTER);
  // h 是球底部的高度；grounded 表示正貼著地面滾
  ball = { x: 0, tx: 0, z: 0, vx: 0, roll: 0, h: 0, vy: 0, grounded: true, airT: 0, lastGround: 0, sq: 0, slopeVy: 0, mul: 1, boosted: false };
  fovKick = 0;
  camX = 0; camY = CAM_H; camZ = -CAM_BACK; tilt = 0; t = 0; runT = 0;
  shields = baseShield + boost;
  inv = 0; gemsGot = 0; continued = false; reported = false;
  trauma = 0; flash = 0; hitstop = 0; crashT = 0; doneT = 0;
  parts = []; texts = []; trail = []; streaks = [];
  state = 'ready';
  $('r-title').textContent = `第 ${n} 關`;
  $('r-goal').textContent = L.intro || (n % 5 === 0 ? '難關！滾到終點就過關' : '滾到終點就過關');
  $('h-level').textContent = `第 ${n} 關`;
  showPanel('ready');
  refreshHud();
}

// ================= 輸入：相對拖曳 =================
// 手指移動多少，球就移動多少（不是點哪裡就跳到哪裡），這樣才有細膩的滑動感
let dragX = null;
canvas.addEventListener('pointerdown', e => {
  unlockAudio();
  canvas.setPointerCapture(e.pointerId);
  dragX = e.clientX;
});
canvas.addEventListener('pointermove', e => {
  if (dragX === null) return;
  const dx = e.clientX - dragX;
  dragX = e.clientX;
  if (state !== 'play') return;
  ball.tx = clamp(ball.tx + (dx / (W * 0.8)) * HALF * 2 * DRAG_GAIN, -HALF + R, HALF - R);
});
const up = () => { dragX = null; };
canvas.addEventListener('pointerup', up);
canvas.addEventListener('pointercancel', up);
// 電腦上可以用方向鍵測試
const keys = {};
addEventListener('keydown', e => { keys[e.key] = true; });
addEventListener('keyup', e => { keys[e.key] = false; });

// ================= 更新 =================
function moverX(o) {
  if (!o.move) return [o.x0, o.x1];
  const c = Math.sin(t * o.move.speed + o.move.phase) * o.move.amp;
  return [o.x0 + c, o.x1 + c];
}

function update(dt) {
  trauma = Math.max(0, trauma - dt * 2);
  flash = Math.max(0, flash - dt * 3);
  for (const p of parts) { p.life -= dt; p.vy -= p.g * dt; p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt; }
  parts = parts.filter(p => p.life > 0);
  for (const s of texts) s.t += dt;
  texts = texts.filter(s => s.t < 0.9);
  if (hitstop > 0) { hitstop -= dt; return; }
  t += dt;

  ball.sq = Math.max(0, ball.sq - dt * 3);
  fovKick = Math.max(0, fovKick - dt * 0.6);
  if (state === 'play') updatePlay(dt);
  else if (state === 'crash') {
    crashT += dt;
    if (ball.falling) {
      // 摔出跑道：繼續往下掉，鏡頭不跟
      ball.vy -= GRAV * dt;
      ball.h += ball.vy * dt;
      ball.z += L.speed * 0.5 * dt;
    }
    if (crashT > 0.9 && !$('fail').classList.contains('show')) showFail();
  } else if (state === 'done') {
    doneT += dt;
    ball.z += L.speed * ball.mul * Math.max(0.2, 1 - doneT) * dt;
    ball.h = support(ball.x, ball.z, true) ?? ball.h;
    if (doneT > 1 && !$('pass').classList.contains('show')) showPass();
  }
  // 鏡頭：前後左右很快跟上；高度在空中時跟得慢一點，球往下掉時會先掉出畫面中央，製造下墜感
  camZ = lerp(camZ, ball.z - CAM_BACK, 1 - Math.exp(-20 * dt));
  camX = lerp(camX, ball.x * CAM_FOLLOW, 1 - Math.exp(-10 * dt));
  const camTarget = (ball.falling ? ball.lastGround : ball.grounded ? ball.h : ball.h + 0.5) + CAM_H;
  camY = lerp(camY, camTarget, 1 - Math.exp(-(ball.grounded ? 9 : 4.5) * dt));
  tilt = lerp(tilt, clamp(-ball.vx * 0.012, -0.07, 0.07), 1 - Math.exp(-8 * dt));
}

// 落地：衝擊越大，壓扁、震動、聲音越明顯
function land(h) {
  const impact = -ball.vy;
  ball.h = h;
  ball.vy = 0;
  ball.grounded = true;
  if (impact > 3) {
    const k = clamp(impact / 12, 0, 1);
    ball.sq = 0.12 + k * 0.25;
    trauma = Math.max(trauma, 0.15 + k * 0.3);
    sfx.land(k);
    vibrate(10 + Math.round(k * 25));
    for (const side of [-1, 1]) burstAt(ball.x + side * R, h + 0.05, ball.z, 7, '#ffffff', 2 + k * 2);
  }
}

function updatePlay(dt) {
  runT += dt;
  if (keys.ArrowLeft) ball.tx = clamp(ball.tx - 5 * dt, -HALF + R, HALF - R);
  if (keys.ArrowRight) ball.tx = clamp(ball.tx + 5 * dt, -HALF + R, HALF - R);
  // 加速帶：踩過去之後，速度在半秒內拉到更高
  if (L.pad && !ball.boosted && ball.z >= L.pad.z0) boostHit();
  ball.mul = lerp(ball.mul, ball.boosted ? L.pad.mult : 1, 1 - Math.exp(-3 * dt));
  // 起步時 0.6 秒內加速到全速
  const speed = L.speed * ball.mul * Math.min(1, 0.35 + runT * 1.1);
  ball.z += speed * dt;
  const px = ball.x;
  ball.x += (ball.tx - ball.x) * (1 - Math.exp(-FOLLOW * dt));
  ball.vx = (ball.x - px) / dt;
  ball.roll += (speed * dt) / R;
  inv = Math.max(0, inv - dt);

  // ---- 高度：貼地滾、飛出邊緣、在空中、落地 ----
  const sup = support(ball.x, ball.z, inv > 0);
  if (ball.grounded) {
    if (sup === null) {
      const hole = holeAt(ball.x, ball.z);
      ball.grounded = false;
      ball.airT = 0;
      if (hole && shields > 0) {
        // 護盾讓球彈起來，剛好飛過破洞
        useShield();
        ball.vy = (GRAV * ((hole.z1 - ball.z) / speed + 0.15)) / 2;
      } else {
        ball.vy = ball.slopeVy;          // 從跳台飛出去會帶著往上的速度
        if (!hole) { sfx.launch(); trauma = Math.max(trauma, 0.08); }
      }
    } else {
      ball.slopeVy = (sup - ball.h) / dt;
      ball.h = sup;
      ball.lastGround = sup;
    }
  }
  if (!ball.grounded) {
    ball.airT += dt;
    ball.vy -= GRAV * dt;
    ball.h += ball.vy * dt;
    if (sup !== null && ball.vy <= 0 && ball.h <= sup && ball.h > sup - 0.7) land(sup);
    else if (ball.h < lowestAhead(ball.z) - 1.2) { crash(true); return; }
  }

  trail.unshift({ x: ball.x, z: ball.z, h: ball.h });
  trail.length = Math.min(trail.length, ball.grounded ? 7 : 10);

  // 速度線
  if (Math.random() < dt * (ball.grounded ? 30 : 60)) {
    streaks.push({ x: (rand01() < 0.5 ? -1 : 1) * (HALF + 0.3 + rand01() * 2.5), y: ball.h + rand01() * 1.5 - 0.4, z: ball.z + 20 + rand01() * 30 });
  }
  streaks = streaks.filter(s => s.z > camZ + 0.5);

  // 障礙物
  for (const o of L.obs) {
    if (o.z0 > ball.z + 2 || o.passed) continue;
    const [x0, x1] = moverX(o);
    const dx = Math.max(x0 - ball.x, 0, ball.x - x1);
    const dz = Math.max(o.z0 - ball.z, 0, ball.z - o.z1);
    if (ball.z + R > o.z0 && ball.z - R < o.z1) o.minD = Math.min(o.minD, dx - R);
    const vertical = ball.h < o.base + o.h && ball.h + 2 * R > o.base;
    if (dx * dx + dz * dz < R * R && inv <= 0 && vertical) { hit(o, x0, x1); if (state !== 'play') return; }
    if (ball.z - R > o.z1) {
      o.passed = true;
      // 穿過窄門時兩邊都很近，同一排只算一次
      if (!o.hit && o.minD < NEAR_MISS && o.minD > -R && o.z0 !== lastNearZ) { lastNearZ = o.z0; nearMiss(); }
    }
  }
  // 寶石（空中的寶石也要高度對得上才吃得到）
  for (const g of L.gems) {
    if (g.got || Math.abs(g.z - ball.z) > 0.5 || Math.abs(g.x - ball.x) > R + 0.22 || Math.abs(g.y - (ball.h + R)) > 0.6) continue;
    g.got = true;
    gemsGot++;
    sfx.coin(gemsGot);
    burstAt(g.x, g.y, g.z, 8, '#7ff0ff', 2.2);
    bump('h-gems');
    refreshHud();
  }
  if (ball.z >= L.length) finish();
  refreshHud();
}

function useShield() {
  shields--;
  inv = INVULN;
  trauma = 0.5;
  flash = 0.5;
  sfx.clang();
  vibrate(40);
  burstAt(ball.x, ball.h + R, ball.z, 16, '#7ff6ff', 3);
  addText('護盾！', '#2aa9d8');
  bump('h-shield');
}

function hit(o, x0, x1) {
  o.hit = true;
  if (shields > 0) {
    useShield();
    ball.tx = clamp(ball.x + (ball.x < (x0 + x1) / 2 ? -0.7 : 0.7), -HALF + R, HALF - R);
    return;
  }
  crash(false);
}

function crash(fell) {
  state = 'crash';
  crashT = 0;
  hitstop = 0.06;
  trauma = 1;
  flash = 0.6;
  if (!fell) burstAt(ball.x, ball.h + R, ball.z, 30, '#d9e2f0', 4.5);
  sfx.die();
  vibrate([60, 40, 120]);
  if (fell) ball.falling = true;
}

function boostHit() {
  ball.boosted = true;
  fovKick = 0.2;
  flash = 0.35;
  trauma = Math.max(trauma, 0.3);
  sfx.launch();
  sfx.milestone(6);
  vibrate([20, 20, 50]);
  addText('加速！', '#ff5fa2');
  burstAt(ball.x, ball.h + R, ball.z + 1, 24, '#5fd6ff', 4);
}

function nearMiss() {
  sfx.whoosh();
  vibrate(8);
  addText('擦身！', '#ff8fb1');
  trauma = Math.max(trauma, 0.15);
}

function finish() {
  state = 'done';
  doneT = 0;
  sfx.clear();
  vibrate([20, 30, 20]);
  for (let k = 0; k < 4; k++) burstAt(ball.x + (k - 1.5) * 0.8, ball.h + 1.2, ball.z + 2, 20, COLORS[k], 4);
  report(true);
}

// ================= 結果 =================
const starsOf = () => {
  const ratio = L.gems.length ? gemsGot / L.gems.length : 1;
  return 1 + (ratio >= STARS[0] ? 1 : 0) + (ratio >= STARS[1] ? 1 : 0);
};
function report(pass) {
  if (reported) return;
  reported = true;
  const result = {
    type: 'lab:result', game: 'ball', level, pass, stars: pass ? starsOf() : 0,
    gems: gemsGot, gemsTotal: L.gems.length, progress: clamp(ball.z / L.length, 0, 1), durationSec: Math.round(runT),
  };
  if (labMode) parent.postMessage(result, '*');
}

// ================= 介面 =================
function showPanel(id) {
  for (const p of ['ready', 'pass', 'fail']) $(p).classList.toggle('show', p === id);
}
function refreshHud() {
  $('h-shield').textContent = shields > 0 ? `🛡 ${shields}` : '';
  $('h-gems').textContent = `💎 ${gemsGot}/${L.gems.length}`;
  const p = clamp(ball.z / L.length, 0, 1) * 100;
  $('h-fill').style.width = p + '%';
  $('h-dot').style.left = p + '%';
}
function bump(id) {
  const el = $(id);
  el.classList.remove('bump');
  void el.offsetWidth;
  el.classList.add('bump');
}
function showPass() {
  const s = starsOf();
  $('p-level').textContent = `第 ${level} 關`;
  $('p-gems').textContent = `收集寶石 ${gemsGot}/${L.gems.length}`;
  const spans = [...$('p-stars').children];
  spans.forEach(el => el.classList.remove('on'));
  spans.forEach((el, k) => k < s && setTimeout(() => { el.classList.add('on'); sfx.coin(k * 3); }, 250 + k * 280));
  showPanel('pass');
}
function showFail() {
  $('f-level').textContent = `第 ${level} 關`;
  $('f-progress').textContent = `進度 ${Math.round(clamp(ball.z / L.length, 0, 1) * 100)}%`;
  $('btn-cont').hidden = continued;
  $('btn-cont').disabled = false;
  showPanel('fail');
}

$('btn-go').addEventListener('click', () => {
  unlockAudio();
  showPanel(null);
  state = 'play';
  sfx.wave();
});
$('btn-next').addEventListener('click', () => {
  fails = 0;
  boost = 0;
  load(level + 1);
});
$('btn-retry').addEventListener('click', () => {
  report(false);
  fails++;
  boost = 0;
  load(level);
});
$('btn-cont').addEventListener('click', async () => {
  $('btn-cont').disabled = true;
  if (!(await Ads.showRewarded())) { $('btn-cont').disabled = false; return; }
  continued = true;
  shields++;
  inv = 2;
  // 放回跑道上：目前位置有軌道就放這裡，在空隙裡就放到下一段的開頭
  const s = segAt(ball.z) || L.segs.find(s => s.z0 > ball.z);
  if (s) {
    ball.z = Math.max(ball.z, s.z0 + 0.3);
    ball.h = heightOn(s, ball.z);
  }
  Object.assign(ball, { falling: false, vy: 0, grounded: true, lastGround: ball.h, slopeVy: 0 });
  camY = ball.h + CAM_H;
  ball.tx = ball.x = clamp(ball.x, -HALF + R, HALF - R);
  state = 'play';
  showPanel(null);
  refreshHud();
  sfx.heal();
});
const done = () => {
  if (state !== 'done' && runT > 0) report(false);
  parent.postMessage({ type: 'lab:close' }, '*');
};
if (labMode) {
  $('btn-done1').hidden = false;
  $('btn-done2').hidden = false;
  $('btn-done1').addEventListener('click', done);
  $('btn-done2').addEventListener('click', done);
  addEventListener('message', e => {
    if (e.data?.type !== 'lab:quit') return;
    if (state === 'play' || state === 'crash') report(false);
    parent.postMessage({ type: 'lab:close' }, '*');
  });
}
$('btn-mute').textContent = isMuted() ? '🔇' : '🔊';
$('btn-mute').addEventListener('click', () => { unlockAudio(); $('btn-mute').textContent = toggleMute() ? '🔇' : '🔊'; });
document.addEventListener('visibilitychange', () => { paused = document.hidden; suspendAudio(document.hidden); });

// ================= 特效 =================
function burstAt(x, y, z, n, color, speed) {
  for (let k = 0; k < n && parts.length < 300; k++) {
    const a = rand01() * Math.PI * 2, e = rand01() * Math.PI - Math.PI / 2;
    const v = speed * (0.4 + rand01() * 0.6);
    parts.push({ x, y, z, vx: Math.cos(a) * Math.cos(e) * v, vy: Math.abs(Math.sin(e)) * v + 1, vz: Math.sin(a) * Math.cos(e) * v + L.speed * 0.3, g: 9, life: 0.5 + rand01() * 0.5, max: 1, color });
    parts[parts.length - 1].max = parts[parts.length - 1].life;
  }
}
function addText(text, color) { texts.push({ text, color, t: 0 }); }

// ================= 繪圖 =================
function proj(x, y, z) {
  const dz = Math.max(0.25, z - camZ);
  // 加速後視角稍微拉廣，速度感更強
  const f = (F * (1 - fovKick - (ball.mul - 1) * 0.3)) / dz;
  return [W / 2 + (x - camX) * f, HOR + (camY - y) * f, f];
}
const fog = z => clamp((z - camZ) / FAR, 0, 1) ** 1.5;
const SKY = '#bfe2fb';
const hexRGB = h => { const p = parseInt(h.slice(1), 16); return [(p >> 16) & 255, (p >> 8) & 255, p & 255]; };
const SKY_RGB = hexRGB(SKY);
// 顏色乘上明暗 s，再依距離 k 混進天空色（遠處自然淡出）
function tint(hex, k, s = 1) {
  return `rgb(${hexRGB(hex).map((v, i) => Math.round(clamp(v * s, 0, 255) * (1 - k) + SKY_RGB[i] * k)).join(',')})`;
}
function poly(pts, fill) {
  ctx.beginPath();
  pts.forEach(([x, y], k) => (k ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();
}

function drawSky() {
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, '#7fbdf0');
  g.addColorStop(0.32, SKY);
  g.addColorStop(1, '#ffe1ee');
  ctx.fillStyle = g;
  ctx.fillRect(-50, -50, W + 100, H + 100);
  // 遠方雲海，跟著前進慢慢往下流
  for (let k = 0; k < 7; k++) {
    const y = HOR + 20 + ((k * 97 + camZ * 6) % (H * 0.9));
    const x = ((k * 173) % W) - camX * 20;
    ctx.fillStyle = `rgba(255,255,255,${0.35 + (y / H) * 0.3})`;
    ctx.beginPath();
    ctx.ellipse(x, y, 90 + (y - HOR) * 0.5, 18 + (y - HOR) * 0.1, 0, 0, Math.PI * 2);
    ctx.fill();
  }
}

// 跑道切成一格一格的「列」，和障礙物一起由遠到近排序再畫，
// 這樣高處的跑道邊緣才會正確地擋住下方較低的跑道
const THICK = 0.35;
function floorItems(items) {
  for (const s of L.segs) {
    const zA = Math.max(s.z0, camZ + 0.3), zB = Math.min(s.z1, camZ + FAR);
    let z = zA;
    while (z < zB) {
      const zn = Math.min(zB, Math.floor(z) + 1), z0 = z;
      items.push({ z: zn - 1e-4, draw: () => drawRow(s, z0, zn) });
      z = zn;
    }
  }
  // 破洞：看得到下面的天空，遠端有一截跑道的斷面
  for (const h of L.holes) {
    if (h.z1 < camZ + 0.3 || h.z0 > camZ + FAR) continue;
    items.push({ z: h.z0 + 1e-4, draw: () => drawHole(h) });
  }
  const p = L.pad;
  if (p && p.z1 > camZ + 0.3 && p.z0 < camZ + FAR) items.push({ z: p.z0 + 1e-4, draw: drawPad });
}
// 加速帶：整條跑道寬的發光地板，上面的箭頭一直往前流
function drawPad() {
  const p = L.pad, k = fog(p.z0), y = p.y + 0.01;
  const z0 = Math.max(p.z0, camZ + 0.3);
  poly([proj(-HALF, y, z0), proj(HALF, y, z0), proj(HALF, y, p.z1), proj(-HALF, y, p.z1)], tint('#5fd6ff', k, 1));
  for (let i = 0; i < 4; i++) {
    const a = p.z0 + ((i * 0.75 + t * 3) % 3);
    if (a < z0 || a + 0.5 > p.z1) continue;
    const pts = [[-1.1, a], [0, a + 0.5], [1.1, a], [1.1, a + 0.25], [0, a + 0.75], [-1.1, a + 0.25]]
      .filter(([, zz]) => zz <= p.z1).map(([x, zz]) => proj(x, y, zz));
    poly(pts, tint(i % 2 ? '#ff5fa2' : '#ffffff', k));
  }
}
function drawRow(s, z0, z1) {
  const ya = heightOn(s, z0), yb = heightOn(s, z1), k = fog(z0);
  const a = proj(-HALF, ya, z0), b = proj(HALF, ya, z0), c = proj(HALF, yb, z1), d = proj(-HALF, yb, z1);
  const stripe = Math.floor(z0) % 2;
  const base = z0 > L.length ? '#fff4d6' : s.ramp ? (stripe ? '#ffe9a8' : '#ffd97a') : stripe ? '#eef3fb' : '#dfe7f4';
  poly([a, b, c, d], tint(base, k));
  // 跳台上的箭頭
  if (s.ramp && stripe) {
    const m = proj(0, (ya + yb) / 2, (z0 + z1) / 2);
    ctx.fillStyle = tint('#ff9f43', k);
    ctx.font = `900 ${Math.max(8, m[2] * 0.5)}px system-ui`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('▲', m[0], m[1]);
  }
  // 兩側發光的軌道邊
  const ea = proj(-HALF, ya + 0.06, z0), ed = proj(-HALF, yb + 0.06, z1), eb = proj(HALF, ya + 0.06, z0), ec = proj(HALF, yb + 0.06, z1);
  ctx.strokeStyle = tint('#5fd6ff', k);
  ctx.lineWidth = Math.max(1, a[2] * 0.06);
  ctx.beginPath(); ctx.moveTo(ea[0], ea[1]); ctx.lineTo(ed[0], ed[1]); ctx.moveTo(eb[0], eb[1]); ctx.lineTo(ec[0], ec[1]); ctx.stroke();
  // 跑道的厚度（斷崖後的下一段開頭看得最清楚）
  poly([a, b, proj(HALF, ya - THICK, z0), proj(-HALF, ya - THICK, z0)], tint(s.z0 === z0 ? '#8ea3c4' : '#9fb3cf', k));
}
function drawHole(h) {
  const z0 = Math.max(h.z0, camZ + 0.3);
  const pts = [proj(h.x0, h.y, z0), proj(h.x1, h.y, z0), proj(h.x1, h.y, h.z1), proj(h.x0, h.y, h.z1)];
  const g = ctx.createLinearGradient(0, pts[2][1], 0, pts[0][1]);
  g.addColorStop(0, '#9fd0f5');
  g.addColorStop(1, '#ffe6f1');
  poly(pts, g);
  poly([pts[3], pts[2], proj(h.x1, h.y - THICK, h.z1), proj(h.x0, h.y - THICK, h.z1)], tint('#7d8fb0', fog(h.z1)));
}
// 影子落在球正下方的地面上；飛越空隙時沒有影子
function drawShadow() {
  if (ball.falling || state === 'crash') return;
  const ground = support(ball.x, ball.z, inv > 0);
  if (ground === null) return;
  const lift = clamp(ball.h - ground, 0, 4);
  const [sx, sy, f] = proj(ball.x, ground, ball.z);
  ctx.fillStyle = `rgba(40,50,80,${0.22 * (1 - lift / 4)})`;
  ctx.beginPath();
  ctx.ellipse(sx, sy, R * f * (1.1 + lift * 0.25), R * f * 0.35 * (1 + lift * 0.25), 0, 0, Math.PI * 2);
  ctx.fill();
}

function drawBox(o) {
  const [x0, x1] = moverX(o);
  const z0 = Math.max(o.z0, camZ + 0.3), z1 = o.z1;
  if (z1 <= z0) return;
  const k = fog(z0);
  const c = (hex, s) => tint(hex, k, s);
  const y0 = o.base, y1 = o.base + o.h;
  const P = (x, y, z) => proj(x, y, z);
  if (camX < x0) poly([P(x0, y0, z0), P(x0, y0, z1), P(x0, y1, z1), P(x0, y1, z0)], c(o.color, 0.72));
  if (camX > x1) poly([P(x1, y0, z0), P(x1, y0, z1), P(x1, y1, z1), P(x1, y1, z0)], c(o.color, 0.72));
  poly([P(x0, y1, z0), P(x1, y1, z0), P(x1, y1, z1), P(x0, y1, z1)], c(o.color, 1.15));
  poly([P(x0, y0, z0), P(x1, y0, z0), P(x1, y1, z0), P(x0, y1, z0)], c(o.color, 0.92));
  // 上緣的亮線
  const a = P(x0, y1, z0), b = P(x1, y1, z0);
  ctx.strokeStyle = `rgba(255,255,255,${0.7 * (1 - k)})`;
  ctx.lineWidth = Math.max(1, a[2] * 0.04);
  ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke();
  if (o.move) {
    // 會動的方塊上有箭頭提示
    const [mx, my, f] = P((x0 + x1) / 2, y0 + o.h * 0.5, z0);
    ctx.fillStyle = `rgba(255,255,255,${0.8 * (1 - k)})`;
    ctx.font = `bold ${Math.max(8, f * 0.35)}px system-ui`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('⇆', mx, my);
  }
}

function drawGem(g) {
  if (g.got) return;
  const bob = Math.sin(t * 3 + g.z) * 0.06;
  const [x, y, f] = proj(g.x, g.y + bob, g.z);
  const s = 0.17 * f, w = Math.abs(Math.cos(t * 3 + g.z)) * 0.8 + 0.2;
  const k = fog(g.z);
  ctx.globalAlpha = 1 - k;
  ctx.fillStyle = 'rgba(127,240,255,0.25)';
  ctx.beginPath(); ctx.arc(x, y, s * 1.8, 0, Math.PI * 2); ctx.fill();
  poly([[x, y - s * 1.3], [x + s * w, y], [x, y + s * 1.3], [x - s * w, y]], '#4fd8f5');
  poly([[x, y - s * 1.3], [x + s * w, y], [x, y]], '#b8f6ff');
  ctx.globalAlpha = 1;
}

function drawGate() {
  const z = L.length;
  if (z < camZ + 0.5 || z > camZ + FAR) return;
  const k = fog(z), gy = floorAt(z);
  for (const x of [-HALF - 0.1, HALF + 0.1]) {
    const a = proj(x, gy, z), b = proj(x, gy + 2, z);
    ctx.strokeStyle = tint('#ff8fb1', k);
    ctx.lineWidth = Math.max(2, a[2] * 0.12);
    ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke();
  }
  // 棋盤格終點布條
  const cols = 10;
  for (let c = 0; c < cols; c++) for (let r = 0; r < 2; r++) {
    const xa = -HALF - 0.1 + ((2 * HALF + 0.2) * c) / cols, xb = xa + (2 * HALF + 0.2) / cols;
    const ya = gy + 1.6 + r * 0.2, yb = ya + 0.2;
    poly([proj(xa, yb, z), proj(xb, yb, z), proj(xb, ya, z), proj(xa, ya, z)], tint((c + r) % 2 ? '#2c3550' : '#ffffff', k));
  }
}

function drawBall() {
  if (ball.falling) {
    // 摔出跑道：一邊往下掉一邊淡出
    const [x, y, f] = proj(ball.x, ball.h + R, ball.z);
    drawSphere(x, y, R * f, clamp(1 - crashT / 0.9, 0, 1));
    return;
  }
  if (state === 'crash') return;
  // 殘影
  for (let k = trail.length - 1; k >= 1; k -= 2) {
    const p = trail[k];
    const [x, y, f] = proj(p.x, p.h + R, p.z);
    ctx.fillStyle = `rgba(200,215,240,${0.18 * (1 - k / trail.length)})`;
    ctx.beginPath(); ctx.arc(x, y, R * f * (1 - k * 0.04), 0, Math.PI * 2); ctx.fill();
  }
  const [x, y, f] = proj(ball.x, ball.h + R, ball.z);
  const blink = inv > 0 && Math.floor(inv * 14) % 2 === 0 ? 0.45 : 1;
  drawSphere(x, y, R * f, blink);
  if (shields > 0) {
    ctx.strokeStyle = `rgba(95,214,255,${0.5 + Math.sin(t * 6) * 0.2})`;
    ctx.lineWidth = Math.max(1.5, f * 0.03);
    ctx.beginPath(); ctx.arc(x, y, R * f * 1.25, 0, Math.PI * 2); ctx.stroke();
  }
}

// 金屬球：固定的反光 + 會跟著滾動移動的刻痕，看起來才像真的在滾
const MARKS = Array.from({ length: 8 }, (_, k) => ({ th: (k / 8) * Math.PI * 2, ph: ((k * 37) % 10) / 10 - 0.5 }));
function drawSphere(x, y, r, alpha) {
  // 橫移時橫向拉長；落地時被壓扁（以球底為支點）
  const sq = 1 + Math.min(0.14, Math.abs(ball.vx) * 0.012) + ball.sq;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.translate(x, y + r * (1 - 1 / sq));
  ctx.scale(sq, 1 / sq);
  const g = ctx.createRadialGradient(-r * 0.35, -r * 0.4, r * 0.05, 0, 0, r);
  g.addColorStop(0, '#ffffff');
  g.addColorStop(0.25, '#e3e9f3');
  g.addColorStop(0.7, '#8d99b2');
  g.addColorStop(1, '#4a546c');
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.fill();
  // 環境反射：上半部映著天空、下半部映著跑道
  ctx.save();
  ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.clip();
  ctx.fillStyle = 'rgba(160,210,250,0.28)';
  ctx.beginPath(); ctx.ellipse(0, -r * 0.15, r * 0.95, r * 0.28, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,0.18)';
  ctx.beginPath(); ctx.ellipse(0, r * 0.55, r * 0.8, r * 0.22, 0, 0, Math.PI * 2); ctx.fill();
  // 滾動刻痕
  const spin = ball.x / R * 0.6;
  for (const m of MARKS) {
    const th = m.th + ball.roll;
    const front = Math.sin(th);
    if (front <= 0.05) continue;
    const mx = r * Math.sin(m.ph * 2 + spin) * 0.85 * front, my = -r * Math.cos(th) * 0.92;
    ctx.fillStyle = `rgba(60,70,95,${0.35 * front})`;
    ctx.beginPath(); ctx.ellipse(mx, my, r * 0.09 * front + 0.5, r * 0.05 * front + 0.5, 0, 0, Math.PI * 2); ctx.fill();
  }
  ctx.restore();
  // 高光（不跟著轉）
  ctx.fillStyle = 'rgba(255,255,255,0.9)';
  ctx.beginPath(); ctx.ellipse(-r * 0.38, -r * 0.45, r * 0.2, r * 0.12, -0.6, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
}

function drawStreaks() {
  ctx.lineCap = 'round';
  for (const s of streaks) {
    const a = proj(s.x, s.y, s.z), b = proj(s.x, s.y, s.z + 1.6);
    ctx.strokeStyle = `rgba(255,255,255,${0.5 * (1 - fog(s.z))})`;
    ctx.lineWidth = Math.max(1, a[2] * 0.03);
    ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke();
  }
}

function drawParts() {
  for (const p of parts) {
    if (p.z < camZ + 0.3) continue;
    const [x, y, f] = proj(p.x, p.y, p.z);
    ctx.globalAlpha = clamp(p.life / p.max, 0, 1);
    ctx.fillStyle = p.color;
    ctx.fillRect(x - f * 0.04, y - f * 0.04, f * 0.08, f * 0.08);
  }
  ctx.globalAlpha = 1;
}

function render() {
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  const sh = trauma * trauma * 14;
  ctx.translate((rand01() - 0.5) * sh, (rand01() - 0.5) * sh);
  // 鏡頭跟著橫移微微傾斜
  ctx.translate(W / 2, H * 0.7);
  ctx.rotate(tilt);
  ctx.translate(-W / 2, -H * 0.7);
  drawSky();
  if (!L) return;
  drawStreaks();
  // 由遠到近畫：跑道、障礙物、寶石、終點、球
  const items = [];
  floorItems(items);
  for (const o of L.obs) if (o.z1 > camZ + 0.3 && o.z0 < camZ + FAR) items.push({ z: o.z0, draw: () => drawBox(o) });
  for (const g of L.gems) if (!g.got && g.z > camZ + 0.5 && g.z < camZ + FAR) items.push({ z: g.z, draw: () => drawGem(g) });
  items.push({ z: L.length, draw: drawGate });
  // 球排在「它佔用的那幾列跑道」之後畫，才不會被腳下的跑道蓋住
  items.push({ z: ball.z - R + 2e-5, draw: drawShadow });
  items.push({ z: ball.z - R, draw: drawBall });
  items.sort((a, b) => b.z - a.z);
  for (const it of items) it.draw();
  drawParts();
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  if (flash > 0) { ctx.fillStyle = `rgba(255,255,255,${flash * 0.6})`; ctx.fillRect(0, 0, W, H); }
  // 浮動文字（擦身、護盾）
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (const s of texts) {
    const [x, y] = proj(ball.x, ball.h + R + 1, ball.z);
    ctx.globalAlpha = clamp(1.5 - s.t * 1.8, 0, 1);
    ctx.font = `900 ${22 + Math.sin(Math.min(1, s.t * 6) * Math.PI) * 6}px system-ui, sans-serif`;
    ctx.lineWidth = 4;
    ctx.strokeStyle = '#fff';
    ctx.strokeText(s.text, x, y - s.t * 40);
    ctx.fillStyle = s.color;
    ctx.fillText(s.text, x, y - s.t * 40);
  }
  ctx.globalAlpha = 1;
}

// 開發用：網址加上 ?debug 可以從主控台看狀態（window.ballDebug）
if (params.has('debug')) window.ballDebug = { get ball() { return ball; }, get level() { return L; }, get state() { return state; } };

// ================= 主迴圈 =================
load(level);
let last = performance.now();
function frame(now) {
  const dt = Math.min(0.033, (now - last) / 1000);
  last = now;
  if (!paused) update(dt);
  render();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
