// 浮島樂園（原型）
// 主世界：浮在空中的樂園，遊客自己走來走去、排隊玩設施、付遊客幣。
// 副世界：藍圖風的試驗場，在這裡開發設施、試運轉（玩小遊戲）拿零件、升級設施。
import { unlockAudio, suspendAudio, toggleMute, isMuted, sfx } from './audio.js';

const canvas = document.getElementById('park');
const ctx = canvas.getContext('2d');
const $ = id => document.getElementById(id);

// ================= 參數（數字都集中在這裡）=================
const TW = 56, TH = 28;             // 一格的寬、高
const RX = TW / Math.SQRT2, RY = TH / Math.SQRT2;
const SIDE = 20;                    // 島邊緣的土層厚度
const MAX_GUESTS = 28;
const GUEST_SPEED = 1.2;            // 格/秒
const SPAWN_EVERY = 7;              // 秒；再除以樂園吸引力（設施等級總和）
const OFFLINE_CAP_H = 8;
const OFFLINE_FULL_MIN = 10;        // 離線滿 8 小時 ≈ 樂園開著 10 分鐘的收入
const RUN_CAP_SEC = 180;            // 試運轉的零件在 3 分鐘封頂
const PARTS_SWAP = 3;               // 專屬零件不夠時，用其他零件 3:1 代替
const GRADES = ['C', 'B', 'A', 'S'];
const GRADE_FEE = { C: 1, B: 1.1, A: 1.25, S: 1.4 };  // 依「歷史最佳」評價，只升不降
const GRADE_PARTS = { C: 1, B: 1.2, A: 1.5, S: 1.8 };
const START_COINS = 120;
const BUILD_SEC = { dev: 5, up: [8, 20] };   // 開發、升到 Lv2、升到 Lv3 的施工秒數
const ADJ_BONUS = 0.1;              // 每有一座設施在旁邊（隔 1 格內），試運轉零件 +10%
const SAVE_KEY = 'park.save2';

// ---- 關卡制小遊戲（依「小遊戲通用規則」）----
const LEVEL_PARTS = n => Math.round(6 + n * 0.6);  // 第一次過第 n 關拿到的零件
const STAR_PARTS = 2;               // 第一次拿到第 2、3 顆星，每顆多給的零件
const REPLAY_RATE = 0.25;           // 重玩已過的關：第一次過關的 25%
const FAIL_RATE = 0.25;             // 失敗安慰獎：第一次過關的 25% × 完成進度
const LEVEL_FEE = { every: 10, bonus: 0.05 };      // 每通過 10 關，這座設施收費 +5%
const BOOST_SHIELD_COST = 40;       // 道具「開局護盾」的遊客幣價格

const RES = {
  coin: { icon: '🪙', name: '遊客幣' },
  spark: { icon: '⚡', name: '彈射零件' },
  bead: { icon: '🔩', name: '滑道零件' },
  tune: { icon: '🎵', name: '旋律零件' },
  shell: { icon: '🐚', name: '水池零件' },
};

// 每座設施佔 2×2 格，要放在草地上、旁邊有步道；入口和排隊位置依擺放自動算出來
const FACS = [
  {
    id: 'bumper', name: '彈射碰碰場', icon: '⚡', kind: 'bumper', x: 9, y: 10, spots: 6,
    part: 'spark', game: '稜光衝刺', src: 'index.html?mode=lab',
    fee: 8, cap: [3, 4, 5], ride: 6, speed: 1, lv: 1,
    up: [{ coin: 150, part: 15 }, { coin: 450, part: 40 }],
    desc: '霓虹碰碰車。試運轉就是玩「稜光衝刺」。',
  },
  {
    id: 'carousel', name: '旋轉木馬', icon: '🎠', kind: 'carousel', x: 6, y: 10, spots: 6,
    part: 'tune', game: null, gameName: '節奏點擊',
    fee: 6, cap: [4, 5, 6], ride: 7, speed: 1.3, lv: 1,
    up: [{ coin: 200, part: 10 }, { coin: 500, part: 30 }],
    desc: '樂園的招牌。試運轉的小遊戲「節奏點擊」製作中。',
  },
  {
    id: 'pond', name: '釣魚池', icon: '🎣', kind: 'pond', x: 9, y: 5, spots: 5,
    part: 'shell', game: null, gameName: '悠閒釣魚',
    fee: 7, cap: [3, 4, 5], ride: 8, speed: 1, lv: 0,
    dev: { coin: 300 }, up: [{ coin: 250, part: 12 }, { coin: 550, part: 32 }],
    desc: '坐在池邊慢慢釣。試運轉的小遊戲「悠閒釣魚」製作中。',
  },
  {
    id: 'marble', name: '鋼珠滑道', icon: '🔮', kind: 'marble', x: 13, y: 9, spots: 6,
    part: 'bead', game: '鋼球滑道', src: 'ball.html', levels: true,
    fee: 7, cap: [3, 4, 5], ride: 7, speed: 1, lv: 1,
    up: [{ coin: 180, part: 15 }, { coin: 480, part: 40 }],
    desc: '坐進透明大球滾下滑道。試運轉就是玩「鋼球滑道」，一關一關往前推進。',
  },
  { id: 'plot', name: '空地', icon: '❔', kind: 'plot', x: 6, y: 5, locked: true, desc: '更多設施即將推出' },
];
for (const f of FACS) {
  Object.assign(f, {
    w: 2, h: 2, grade: null, queue: [], riders: [], state: 'idle', t: 0, wait: 0, spin: 0, phase: 0, pop: 0, celebrate: false,
    build: null, door: null, queuePts: [], cleared: 0, stars: {}, fails: {},
  });
}
const FAC_BY = Object.fromEntries(FACS.map(f => [f.id, f]));
const rides = () => FACS.filter(f => !f.locked && f.lv > 0);

// ================= 小工具 =================
const rand = (a, b) => a + Math.random() * (b - a);
const pick = a => a[(Math.random() * a.length) | 0];
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
const hash = (i, j) => { const s = Math.sin(i * 127.1 + j * 311.7) * 43758.5453; return s - Math.floor(s); };
const isoX = (x, y) => (x - y) * TW / 2;
const isoY = (x, y) => (x + y) * TH / 2;
const fmt = n => Math.floor(n).toLocaleString();
const capOf = f => f.cap[f.lv - 1];
// 收費加成：關卡制看通關進度，舊的稜光衝刺看最佳評價；兩者都只升不降
const progressBonus = f => (f.levels ? 1 + Math.floor(f.cleared / LEVEL_FEE.every) * LEVEL_FEE.bonus : f.grade ? GRADE_FEE[f.grade] : 1);
const feeOf = f => Math.round(f.fee * (1 + 0.35 * (f.lv - 1)) * progressBonus(f));
const totalStars = f => Object.values(f.stars).reduce((s, v) => s + v, 0);
const maxLv = f => f.up.length + 1;

const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
};

// ================= 地圖 =================
const G = 17;
const T = new Uint8Array(G * G);            // 0 空、1 草地、2 步道
const tileAt = (i, j) => (i >= 0 && j >= 0 && i < G && j < G ? T[j * G + i] : 0);
const setTile = (i, j, v) => { T[j * G + i] = v; };
const key = (i, j) => j * G + i;

for (let j = 0; j < 16; j++) {
  for (let i = 0; i < G; i++) {
    const dx = i + 0.5 - 8.5, dy = j + 0.5 - 8.6;
    if (dx * dx + dy * dy < (7.6 + (hash(i, j) - 0.5) * 1.1) ** 2) setTile(i, j, 1);
  }
}
// 步道：中央十字 + 一圈環狀步道，入口在最前面
for (let j = 2; j <= 15; j++) setTile(8, j, 2);
for (let i = 2; i <= 14; i++) setTile(i, 8, 2);
for (let k = 4; k <= 12; k++) { setTile(4, k, 2); setTile(12, k, 2); setTile(k, 4, 2); setTile(k, 12, 2); }

const GATE = { x: 8.5, y: 15.9 };
const FOUNTAIN = { x: 7.5, y: 7.5 };
const VENDOR = { x: 7.45, y: 8.22 };
const decor = [];
const fixed = new Set();
decor.push({ kind: 'fountain', x: FOUNTAIN.x, y: FOUNTAIN.y });
decor.push({ kind: 'lamp', x: 7.85, y: 14.5 }, { kind: 'lamp', x: 9.15, y: 14.5 }, { kind: 'lamp', x: 9.15, y: 8.85 });
decor.push({ kind: 'bench', x: 9.5, y: 9.3 }, { kind: 'flowers', x: 9.5, y: 7.5 }, { kind: 'flowers', x: 2.5, y: 7.5 });
for (const d of decor) fixed.add(key(Math.floor(d.x), Math.floor(d.y)));
for (let j = 0; j < G; j++) {
  for (let i = 0; i < G; i++) {
    if (tileAt(i, j) !== 1 || fixed.has(key(i, j))) continue;
    const h = hash(i + 3, j + 7);
    if (h < 0.4) decor.push({ kind: 'tree', x: i + 0.5 + (hash(i, j + 9) - 0.5) * 0.3, y: j + 0.5 + (hash(i + 9, j) - 0.5) * 0.3, s: 0.8 + hash(j, i) * 0.4 });
    else if (h < 0.6) decor.push({ kind: 'flowers', x: i + 0.5, y: j + 0.5 });
  }
}
// 被設施蓋住的樹和花不畫；設施搬走後會再出現
const covered = (x, y) => FACS.some(f => x >= f.x && x < f.x + f.w && y >= f.y && y < f.y + f.h);

// 步道上的最短路徑（BFS）
function nearestPath(x, y) {
  let bi = 6, bj = 6, bd = Infinity;
  for (let j = 0; j < G; j++) for (let i = 0; i < G; i++) {
    if (tileAt(i, j) !== 2) continue;
    const d = (i + 0.5 - x) ** 2 + (j + 0.5 - y) ** 2;
    if (d < bd) { bd = d; bi = i; bj = j; }
  }
  return [bi, bj];
}
function bfs(from, to) {
  const start = key(...from), goal = key(...to);
  const prev = new Map([[start, -1]]);
  const q = [start];
  while (q.length) {
    const c = q.shift();
    if (c === goal) break;
    const ci = c % G, cj = (c / G) | 0;
    for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const ni = ci + di, nj = cj + dj;
      if (tileAt(ni, nj) !== 2) continue;
      const n = key(ni, nj);
      if (!prev.has(n)) { prev.set(n, c); q.push(n); }
    }
  }
  const out = [];
  for (let c = goal; c !== -1 && c !== undefined; c = prev.get(c)) out.unshift([c % G, (c / G) | 0]);
  return out;
}
function tileOf(x, y) {
  const i = Math.floor(x), j = Math.floor(y);
  return tileAt(i, j) === 2 ? [i, j] : nearestPath(x, y);
}

// 每格步道走到入口的步數，用來決定設施的上下車位置要朝哪邊、隊伍往哪排
const gateDist = new Map();
{
  const start = key(Math.floor(GATE.x), Math.floor(GATE.y));
  gateDist.set(start, 0);
  const q = [start];
  while (q.length) {
    const c = q.shift(), ci = c % G, cj = (c / G) | 0;
    for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const n = key(ci + di, cj + dj);
      if (tileAt(ci + di, cj + dj) === 2 && !gateDist.has(n)) { gateDist.set(n, gateDist.get(c) + 1); q.push(n); }
    }
  }
}

// ---- 擺放規則 ----
const overlaps = (a, x, y, b) => x < b.x + b.w && x + a.w > b.x && y < b.y + b.h && y + a.h > b.y;
function doorTile(f, x = f.x, y = f.y) {
  let best = null;
  for (let j = y; j < y + f.h; j++) for (let i = x; i < x + f.w; i++) {
    for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const ni = i + di, nj = j + dj, d = gateDist.get(key(ni, nj));
      if (tileAt(ni, nj) === 2 && d !== undefined && (!best || d < best.d)) best = { i: ni, j: nj, di, dj, d };
    }
  }
  return best;
}
function canPlace(f, x, y) {
  for (let j = y; j < y + f.h; j++) for (let i = x; i < x + f.w; i++) if (tileAt(i, j) !== 1) return false;
  if (FACS.some(o => o !== f && overlaps(f, x, y, o))) return false;
  return !!doorTile(f, x, y);
}
// 兩座設施之間最多隔 1 格，就算「相鄰」
function gap(a, ax, ay, b) {
  return Math.max(b.x - (ax + a.w), ax - (b.x + b.w), b.y - (ay + a.h), ay - (b.y + b.h), 0);
}
const neighbors = (f, x = f.x, y = f.y) => FACS.filter(o => o !== f && !o.locked && o.lv > 0 && gap(f, x, y, o) <= 1);

// 依目前位置算出上下車點和排隊位置（沿著往入口的步道排）
function layoutFac(f) {
  if (f.locked) return;
  const d = doorTile(f);
  f.door = [d.i + 0.5 - d.di * 0.3, d.j + 0.5 - d.dj * 0.3];
  const pts = [f.door];
  let c = [d.i, d.j];
  for (let k = 0; k < 10; k++) {
    const cd = gateDist.get(key(...c));
    const next = [[1, 0], [-1, 0], [0, 1], [0, -1]].map(([di, dj]) => [c[0] + di, c[1] + dj])
      .find(([i, j]) => gateDist.get(key(i, j)) === cd - 1);
    if (!next) break;
    pts.push([next[0] + 0.5, next[1] + 0.5]);
    c = next;
  }
  f.queuePts = [];
  let seg = 0, along = 0.4;
  while (f.queuePts.length < f.spots && seg < pts.length - 1) {
    const [ax, ay] = pts[seg], [bx, by] = pts[seg + 1], len = Math.hypot(bx - ax, by - ay);
    if (along > len) { along -= len; seg++; continue; }
    const t = along / len, nx = -(by - ay) / len, ny = (bx - ax) / len;
    f.queuePts.push([ax + (bx - ax) * t + nx * 0.17, ay + (by - ay) * t + ny * 0.17]);
    along += 0.32;
  }
  while (f.queuePts.length < f.spots) f.queuePts.push(f.queuePts[f.queuePts.length - 1] || f.door);
}

// ================= 存檔 =================
const res = { coin: START_COINS, spark: 0, bead: 0, tune: 0, shell: 0 };
let visitors = 0, firstVisit = true, tested = false, lastSeen = Date.now();
(function load() {
  const s = store.get(SAVE_KEY, null);
  if (!s) return;
  firstVisit = false;
  Object.assign(res, s.res);
  for (const f of FACS) {
    const d = s.fac?.[f.id];
    if (d) {
      Object.assign(f, {
        lv: d.lv, grade: d.grade, x: d.x ?? f.x, y: d.y ?? f.y, build: d.build || null,
        cleared: d.cleared || 0, stars: d.stars || {}, fails: d.fails || {},
      });
    }
  }
  visitors = s.visitors || 0;
  tested = !!s.tested;
  lastSeen = s.seen || Date.now();
})();
// 新加入的設施，預設位置可能已經被玩家擺了別的東西：找一塊空地放
for (const f of FACS) {
  if (f.locked || canPlace(f, f.x, f.y)) continue;
  search: for (let y = 0; y < G; y++) for (let x = 0; x < G; x++) if (canPlace(f, x, y)) { f.x = x; f.y = y; break search; }
}
FACS.forEach(layoutFac);
function save() {
  store.set(SAVE_KEY, {
    res, visitors, tested, seen: Date.now(),
    fac: Object.fromEntries(FACS.filter(f => !f.locked).map(f => [f.id, {
      lv: f.lv, grade: f.grade, x: f.x, y: f.y, build: f.build, cleared: f.cleared, stars: f.stars, fails: f.fails,
    }])),
  });
}

// 樂園開著時，大約每秒的收入（用來算離線收入）
const liveRate = () => rides().reduce((s, f) => s + (feeOf(f) * capOf(f)) / (f.ride + 4) * 0.5, 0);

// ================= 畫面尺寸與鏡頭 =================
let W = 0, H = 0, DPR = 1;
const cam = { x: 0, y: 0, s: 1, fit: 1 };
const isl = { minX: 0, maxX: 0, minY: 0, maxY: 0 };
for (let j = 0; j < G; j++) for (let i = 0; i < G; i++) {
  if (!tileAt(i, j)) continue;
  isl.minX = Math.min(isl.minX, isoX(i, j + 1)); isl.maxX = Math.max(isl.maxX, isoX(i + 1, j));
  isl.minY = Math.min(isl.minY, isoY(i, j)); isl.maxY = Math.max(isl.maxY, isoY(i + 1, j + 1));
}
const islMidX = (isl.minX + isl.maxX) / 2, islMidY = (isl.minY + isl.maxY) / 2;

function resize() {
  DPR = Math.min(window.devicePixelRatio || 1, 2);
  W = window.innerWidth;
  H = window.innerHeight;
  canvas.width = Math.round(W * DPR);
  canvas.height = Math.round(H * DPR);
  canvas.style.width = W + 'px';
  canvas.style.height = H + 'px';
  cam.fit = Math.min((W - 16) / (isl.maxX - isl.minX), (H - 200) / (isl.maxY - isl.minY + 120));
  // 地圖變大後，手機上一開始先放大一點（人物才看得清楚），拖曳可以看到其他地方
  cam.s = Math.max(cam.fit * 1.12, Math.min(0.62, cam.fit * 2));
  cam.x = W / 2 - islMidX * cam.s;
  cam.y = H / 2 - (islMidY + 20) * cam.s;
  clampCam();
}
window.addEventListener('resize', resize);

// 島的中心最多只能拖到「島的邊緣碰到畫面中間附近」
function clampCam() {
  const cx = cam.x + islMidX * cam.s, cy = cam.y + islMidY * cam.s;
  const rx = Math.max(W * 0.1, (isl.maxX - isl.minX) / 2 * cam.s - W * 0.3);
  const ry = Math.max(H * 0.1, (isl.maxY - isl.minY) / 2 * cam.s - H * 0.2);
  cam.x += clamp(cx, W / 2 - rx, W / 2 + rx) - cx;
  cam.y += clamp(cy, H / 2 - ry, H / 2 + ry) - cy;
}
function zoomAt(px, py, f) {
  const ns = clamp(cam.s * f, cam.fit * 0.9, Math.max(cam.fit * 2.6, 1.4));
  const k = ns / cam.s;
  cam.x = px - (px - cam.x) * k;
  cam.y = py - (py - cam.y) * k;
  cam.s = ns;
  clampCam();
}

let time = 0;
const bobY = () => (mode === 'park' ? Math.sin(time * 0.7) * 3 : 0);
const toScreen = (ix, iy) => [cam.x + ix * cam.s, cam.y + (iy + bobY()) * cam.s];
function toWorld(sx, sy) {
  const ix = (sx - cam.x) / cam.s, iy = (sy - cam.y) / cam.s - bobY();
  return [ix / TW + iy / TH, iy / TH - ix / TW];
}
resize();

// ================= 狀態 =================
let mode = 'park';          // park | lab
let trans = null;           // 切換世界的過場
let guests = [], parts = [], texts = [], flyers = [];
let spawnT = 1, chatT = 0, vendorCD = 3, saveT = 5, hintT = 0;
let selected = null, labOpen = false, labSession = null;
let moving = null;          // 試驗場裡正在搬的設施：{ f, x, y }
let panelT = 0;
const quiet = () => labOpen;
const play = (name, ...a) => { if (!quiet()) sfx[name](...a); };

// ================= 人物 =================
const SKIN = ['#ffe0c9', '#f6c9a6', '#dca27c', '#a8714f'];
const SHIRT = ['#ff8fb1', '#7fc8ff', '#ffd166', '#9be08a', '#c4a3ff', '#ffa96b', '#6fe0d0', '#ff7a7a'];
const HAIR = ['#4a3428', '#2b2333', '#c8763a', '#f2d27a', '#e86f8a', '#7a5cff', '#6b4b3a'];
const BALLOON = ['#ff5f7e', '#ffd23f', '#5fc8ff', '#9dff6b', '#c38bff'];
const LINES = {
  walk: ['下一個玩什麼呢～', '好熱鬧喔！', '這座島好漂亮', '肚子有點餓了', '風好舒服～'],
  queue: ['好期待！', '快輪到我了～', '排隊也很開心', '聽說這個超好玩'],
  wait: ['嘿嘿', '拍張照好了', '再逛一下'],
  staff: ['今天也要加油！', '設施檢查中～', '掃乾淨囉', '歡迎光臨！'],
};

function makePerson(x, y, look) {
  return {
    x, y, z: 0, jz: 0, jv: 0, squash: 0, dir: 1, walkT: 0, moving: false, alpha: 1,
    state: 'wait', t: 0, next: null, route: [], onArrive: null, hop: null,
    fac: null, seat: 0, arrived: false, inRide: false, rod: false,
    emote: null, emoteT: 0, say: null, sayT: 0, chatCD: 8, balloon: null, fading: false,
    lane: rand(-0.13, 0.13), look,
  };
}

function spawnGuest() {
  const g = makePerson(GATE.x + rand(-0.2, 0.2), GATE.y, {
    skin: pick(SKIN), shirt: pick(SHIRT), hair: pick(HAIR), hat: Math.random() < 0.3 ? pick(SHIRT) : null,
  });
  g.role = 'guest';
  const pool = rides().flatMap(f => Array(f.lv).fill(f.id));
  g.plan = [];
  const n = 1 + ((Math.random() * 3) | 0);
  for (let k = 0; k < 8 && g.plan.length < n && pool.length; k++) {
    const id = pick(pool);
    if (!g.plan.includes(id)) g.plan.push(id);
  }
  guests.push(g);
  if (Math.random() < 0.4) wander(g); else decide(g);
}

function emote(p, icon, dur = 1.3) { p.emote = icon; p.emoteT = dur; }
function say(p, text, dur = 1.8) { p.say = text; p.sayT = dur; }

function walkTo(p, x, y, cb) {
  const path = bfs(tileOf(p.x, p.y), tileOf(x, y));
  p.route = path.slice(1, -1).map(([i, j]) => [i + 0.5 + p.lane, j + 0.5 - p.lane]);
  p.route.push([x, y]);
  p.state = 'walk';
  p.onArrive = cb;
}
function waitThen(p, t, cb) { p.state = 'wait'; p.t = t; p.next = cb; }
function hopTo(p, target, dur, h, done, delay = 0) {
  p.hop = { sx: p.x, sy: p.y, sz: p.z, target, t: -delay, dur, h, done };
}

function decide(g) {
  if (!g.plan.length) return leave(g);
  const f = FAC_BY[g.plan.shift()];
  if (f.lv === 0 || f.queue.length >= f.spots) {
    if (Math.random() < 0.6) return wander(g);
    return decide(g);
  }
  f.queue.push(g);
  g.fac = f;
  g.arrived = false;
  const [qx, qy] = queueSpot(f, f.queue.length - 1);
  walkTo(g, qx, qy, () => { g.state = 'queue'; });
}

function wander(g) {
  let i, j;
  do { i = (Math.random() * G) | 0; j = (Math.random() * G) | 0; } while (tileAt(i, j) !== 2);
  walkTo(g, i + 0.5 + g.lane, j + 0.5 + rand(-0.2, 0.2), () => {
    const icon = pick(['🎵', '✨', '📸', '😋', '😊']);
    emote(g, icon);
    if (icon === '📸') burst(isoX(g.x, g.y), isoY(g.x, g.y) - 24, 6, '#ffffff', 60, 'spark');
    waitThen(g, rand(1, 2.2), () => decide(g));
  });
}

function leave(g) {
  walkTo(g, GATE.x + rand(-0.2, 0.2), GATE.y + 0.1, () => { g.fading = true; g.state = 'gone'; });
}

const queueSpot = (f, i) => f.queuePts[Math.max(0, i)];

// 施工：開發或升級要等一小段時間，用現實時間計算（離開遊戲也會繼續）
const buildLeft = f => (f.build ? Math.max(0, (f.build.end - Date.now()) / 1000) : 0);
function startBuild(f) {
  const sec = f.lv === 0 ? BUILD_SEC.dev : BUILD_SEC.up[f.lv - 1];
  f.build = { end: Date.now() + sec * 1000, sec };
}
function finishBuild(f) {
  const dev = f.lv === 0;
  f.build = null;
  f.lv++;
  if (mode === 'park' && !labOpen) celebrate(f); else f.celebrate = true;
  play('build');
  toast(dev ? `「${f.name}」開發完成！遊客開始來玩了` : `${f.name}升到 Lv${f.lv}！`);
  save();
  if (selected === f) openPanel(f);
}
// 搬家：排隊和乘坐中的遊客先請出來，改去玩別的
function evict(f) {
  for (const g of [...f.queue, ...f.riders]) {
    Object.assign(g, { inRide: false, rod: false, fac: null, hop: null, z: 0 });
    if (f.riders.includes(g)) [g.x, g.y] = f.door;
    emote(g, '❓');
    waitThen(g, 0.5, () => decide(g));
  }
  f.queue = [];
  f.riders = [];
  f.state = 'idle';
  f.spin = 0;
}

// 每座設施乘坐時，第 k 個座位的位置（世界座標 + 高度）
function seatPos(f, k) {
  const cx = f.x + 1, cy = f.y + 1, n = capOf(f);
  if (f.kind === 'carousel') {
    const a = f.phase + (k * Math.PI * 2) / n;
    return { x: cx + Math.cos(a) * 0.62, y: cy + Math.sin(a) * 0.62, z: 22 + Math.sin(f.phase * 3 + k * 1.7) * 4 * f.spin };
  }
  if (f.kind === 'bumper') {
    const c = bumperCar(f, k);
    return { x: c.x, y: c.y, z: 6 };
  }
  if (f.kind === 'marble') {
    const [x, y, z] = marblePoint(marbleU(f, k));
    return { x: cx + x, y: cy + y, z };
  }
  const a = Math.PI / 2 + (k - (n - 1) / 2) * 0.6;
  return { x: cx + Math.cos(a) * 0.9, y: cy + Math.sin(a) * 0.9, z: 0 };
}

// 鋼珠滑道：從後方的塔頂沿著之字形軌道滾到前面（座標相對設施中心，z 是高度）
const MARBLE_PATH = [[-0.7, -0.7, 62], [0.7, -0.7, 50], [0.7, 0, 38], [-0.7, 0, 26], [-0.7, 0.7, 14], [0.7, 0.7, 4]];
const MARBLE_LEN = MARBLE_PATH.slice(1).map((p, i) => Math.hypot(p[0] - MARBLE_PATH[i][0], p[1] - MARBLE_PATH[i][1]));
const MARBLE_TOTAL = MARBLE_LEN.reduce((s, v) => s + v, 0);
function marblePoint(u) {
  let d = clamp(u, 0, 1) * MARBLE_TOTAL;
  for (let i = 0; i < MARBLE_LEN.length; i++) {
    if (d <= MARBLE_LEN[i] || i === MARBLE_LEN.length - 1) {
      const t = clamp(d / MARBLE_LEN[i], 0, 1), a = MARBLE_PATH[i], b = MARBLE_PATH[i + 1];
      return [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
    }
    d -= MARBLE_LEN[i];
  }
}
// 第 k 顆球艙目前在軌道上的位置：待命時停在塔頂，運轉時一顆接一顆滾下來
function marbleU(f, k) {
  const n = capOf(f);
  if (f.state === 'run') return clamp((f.t / f.ride) * (1 + 0.12 * (n - 1)) - k * 0.12, 0, 1);
  if (f.state === 'stop') return 1 - k * 0.07;
  return k * 0.04;
}
function bumperCar(f, k) {
  const n = capOf(f), cx = f.x + 1, cy = f.y + 1;
  const px = f.x + 0.35 + (k * 1.3) / Math.max(1, n - 1), py = f.y + 0.4;
  const mx = cx + 0.55 * Math.sin(f.phase * 0.9 * (1 + k * 0.17) + k * 2.1);
  const my = cy + 0.55 * Math.sin(f.phase * 1.13 * (1 + k * 0.11) + k * 1.3);
  return { x: lerp(px, mx, f.spin), y: lerp(py, my, f.spin) };
}

function updatePerson(p, dt) {
  p.emoteT -= dt;
  p.sayT -= dt;
  p.chatCD -= dt;
  p.squash = Math.max(0, p.squash - dt * 2.5);
  if (p.jz > 0 || p.jv > 0) {
    p.jv -= 1100 * dt;
    p.jz += p.jv * dt;
    if (p.jz <= 0) { p.jz = 0; p.jv = 0; p.squash = 0.4; }
  }
  if (p.fading) { p.alpha -= dt * 2.5; return; }
  p.moving = false;

  if (p.hop) {
    const h = p.hop;
    h.t += dt;
    const e = clamp(h.t / h.dur, 0, 1);
    const tp = h.target();
    p.x = lerp(h.sx, tp.x, e);
    p.y = lerp(h.sy, tp.y, e);
    p.z = lerp(h.sz, tp.z, e) + h.h * 4 * e * (1 - e);
    if (e >= 1) { p.hop = null; p.squash = 0.35; h.done?.(); }
    return;
  }

  switch (p.state) {
    case 'walk': {
      const [tx, ty] = p.route[0];
      if (step(p, tx, ty, GUEST_SPEED * dt)) {
        p.route.shift();
        if (!p.route.length) { p.state = 'idle'; p.onArrive?.(); }
      }
      break;
    }
    case 'queue': {
      const [qx, qy] = queueSpot(p.fac, p.fac.queue.indexOf(p));
      p.arrived = step(p, qx, qy, GUEST_SPEED * dt);
      if (p.arrived && Math.random() < dt * 0.07) emote(p, pick(['🎵', '❗', '😊', '⏳']));
      break;
    }
    case 'ride': {
      const s = seatPos(p.fac, p.seat);
      p.x = s.x; p.y = s.y; p.z = s.z;
      break;
    }
    case 'wait':
      p.t -= dt;
      if (p.t <= 0) { p.state = 'idle'; p.next?.(); }
      break;
  }
}

// 往目標走一步；到了就回傳 true
function step(p, tx, ty, d) {
  const dx = tx - p.x, dy = ty - p.y, dist = Math.hypot(dx, dy);
  if (dist <= d) { p.x = tx; p.y = ty; return true; }
  p.x += (dx / dist) * d;
  p.y += (dy / dist) * d;
  p.moving = true;
  p.walkT += d / GUEST_SPEED;
  const sx = isoX(dx, dy);
  if (Math.abs(sx) > 0.01) p.dir = sx > 0 ? 1 : -1;
  return false;
}

function poke(p) {
  if (p.hop || p.inRide || p.jz > 0) return;
  p.jv = 260;
  p.jz = 0.01;
  emote(p, '❗', 0.8);
  say(p, p.role === 'guest' ? pick(LINES[p.state === 'queue' ? 'queue' : p.state === 'wait' ? 'wait' : 'walk']) : pick(LINES.staff));
  burst(isoX(p.x, p.y), isoY(p.x, p.y) - 20, 4, '#ff8fb1', 70, 'heart');
  play('squeak');
}

// ================= 員工 =================
const staff = [
  Object.assign(makePerson(6.5, 7.5, { skin: '#f6c9a6', shirt: '#3d7bd9', hair: '#4a3428', hat: '#2b5fb0' }), { role: 'mech' }),
  Object.assign(makePerson(6.5, 5.5, { skin: '#ffe0c9', shirt: '#57b26a', hair: '#c8763a', hat: '#3f8a4f' }), { role: 'sweep' }),
];
const vendor = Object.assign(makePerson(VENDOR.x, VENDOR.y, { skin: '#dca27c', shirt: '#ffb347', hair: '#2b2333', hat: '#ff5f7e' }), { role: 'vendor' });

function staffNext(s) {
  if (s.role === 'mech') {
    // 有設施在施工時，維修員優先過去幫忙
    const f = FACS.find(f => f.build) || pick(rides());
    walkTo(s, f.door[0], f.door[1], () => {
      emote(s, f.build ? '🔨' : '🔧', 2.4);
      s.work = f;
      waitThen(s, 2.5, () => { s.work = null; staffNext(s); });
    });
  } else {
    let i, j;
    do { i = (Math.random() * G) | 0; j = (Math.random() * G) | 0; } while (tileAt(i, j) !== 2);
    walkTo(s, i + 0.5, j + 0.5, () => {
      emote(s, '🧹', 1.8);
      s.sweeping = true;
      waitThen(s, 2, () => { s.sweeping = false; staffNext(s); });
    });
  }
}
staff.forEach(s => waitThen(s, rand(0.5, 2), () => staffNext(s)));

function updateStaff(s, dt) {
  updatePerson(s, dt);
  if (s.work && Math.random() < dt * 4) {
    const f = s.work;
    burst(isoX(f.x + rand(0.3, 1.7), f.y + rand(0.3, 1.7)), isoY(f.x + 1, f.y + 1) - rand(10, 40), 2, '#ffe66d', 50, 'spark');
  }
  if (s.sweeping && Math.random() < dt * 6) {
    burst(isoX(s.x + 0.15 * s.dir, s.y), isoY(s.x, s.y), 2, '#d8c7a4', 30, 'dust');
  }
}

// ================= 設施運轉 =================
function updateFac(f, dt) {
  f.pop = Math.max(0, f.pop - dt * 1.6);
  if (f.build && buildLeft(f) <= 0) finishBuild(f);
  if (f.build && Math.random() < dt * 5) {
    burst(isoX(f.x + rand(0.2, 1.8), f.y + rand(0.2, 1.8)), isoY(f.x + 1, f.y + 1) - rand(0, 30), 2, pick(['#d8c7a4', '#ffe66d']), 50, 'dust');
  }
  f.spin += ((f.state === 'run' ? 1 : 0) - f.spin) * Math.min(1, dt * 2);
  f.phase += dt * f.spin * f.speed * 1.6;
  if (f.locked || f.lv === 0) return;

  if (f.state === 'idle') {
    let n = 0;
    const cap = capOf(f);
    while (n < cap && n < f.queue.length && f.queue[n].state === 'queue' && f.queue[n].arrived) n++;
    f.wait = n > 0 ? f.wait + dt : 0;
    if (n >= cap || (n > 0 && f.wait > 2.2)) {
      f.riders = f.queue.splice(0, n);
      f.riders.forEach((g, k) => {
        g.state = 'ride';
        g.seat = k;
        g.arrived = false;
        hopTo(g, () => seatPos(f, k), 0.45, 18, () => { g.inRide = f.kind !== 'pond'; g.rod = f.kind === 'pond'; }, k * 0.1);
      });
      f.state = 'run';
      f.t = 0;
      f.wait = 0;
    }
  } else if (f.state === 'run') {
    f.t += dt;
    if (f.kind === 'bumper' && Math.random() < dt * 3) {
      const c = bumperCar(f, (Math.random() * capOf(f)) | 0);
      burst(isoX(c.x, c.y), isoY(c.x, c.y) - 8, 5, pick(['#7ff6ff', '#ff5fa2', '#ffe66d']), 90, 'spark');
    }
    if (f.kind === 'pond' && Math.random() < dt * 0.8) fishJump(f);
    if (f.t >= f.ride) { f.state = 'stop'; f.t = 0; }
  } else if (f.state === 'stop') {
    f.t += dt;
    if (f.t >= 0.9) {
      f.riders.forEach((g, k) => {
        g.inRide = false;
        g.rod = false;
        const ex = f.door[0] + rand(-0.12, 0.12), ey = f.door[1] - 0.3 + k * 0.12;
        hopTo(g, () => ({ x: ex, y: ey, z: 0 }), 0.45, 20, () => {
          pay(g, f);
          emote(g, f.kind === 'pond' ? pick(['🐟', '🐠', '❤️']) : pick(['❤️', '⭐', '😆', '🎵']));
          g.fac = null;
          waitThen(g, 0.9, () => decide(g));
        }, k * 0.12);
      });
      f.riders = [];
      f.state = 'idle';
    }
  }
}

function fishJump(f) {
  const a = rand(0, Math.PI * 2), r = rand(0, 0.45);
  const x = f.x + 1 + Math.cos(a) * r, y = f.y + 1 + Math.sin(a) * r;
  parts.push({ kind: 'fish', x: isoX(x, y), y: isoY(x, y), vx: rand(-20, 20), vy: -120, g: 320, life: 0.75, max: 0.75, size: 4, color: '#ffa94d', rot: 0 });
  ripple(x, y);
}
function ripple(x, y) {
  parts.push({ kind: 'ripple', x: isoX(x, y), y: isoY(x, y), vx: 0, vy: 0, g: 0, life: 0.9, max: 0.9, size: 1, color: '#ffffff' });
}

let coinSeq = 0, coinSfxT = 0;
function pay(g, f) {
  const fee = feeOf(f);
  const [sx, sy] = toScreen(isoX(g.x, g.y), isoY(g.x, g.y) - 26);
  texts.push({ x: isoX(g.x, g.y), y: isoY(g.x, g.y) - 34, text: `+${fee}`, t: 0, color: '#ffb800' });
  if (labOpen || mode !== 'park') { res.coin += fee; return; }
  flyers.push({ sx, sy, t: 0, amt: fee });
}

// ================= 特效 =================
function burst(x, y, n, color, speed, kind = 'spark') {
  for (let i = 0; i < n && parts.length < 400; i++) {
    const a = rand(0, Math.PI * 2), v = rand(0.3, 1) * speed;
    parts.push({
      kind, x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v * 0.6 - (kind === 'heart' ? 50 : kind === 'confetti' ? 160 : 20),
      g: kind === 'confetti' ? 260 : kind === 'heart' ? -20 : kind === 'dust' ? -10 : 120,
      life: kind === 'confetti' ? rand(0.9, 1.5) : rand(0.4, 0.8), max: 1, size: rand(2, 4), color: kind === 'confetti' ? pick(BALLOON) : color, rot: rand(0, 6),
    });
    parts[parts.length - 1].max = parts[parts.length - 1].life;
  }
}
function celebrate(f) {
  const x = isoX(f.x + 1, f.y + 1), y = isoY(f.x + 1, f.y + 1) - 40;
  burst(x, y, 60, '#fff', 220, 'confetti');
  f.pop = 1;
  for (const g of guests) {
    if (Math.hypot(g.x - f.x - 1, g.y - f.y - 1) < 3 && !g.inRide) { emote(g, pick(['❤️', '😍', '✨'])); if (!g.hop) { g.jv = 200; g.jz = 0.01; } }
  }
}

function updateFx(dt) {
  for (const p of parts) {
    p.life -= dt;
    p.vy += p.g * dt;
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.rot += dt * 8;
  }
  parts = parts.filter(p => p.life > 0);
  for (const t of texts) t.t += dt;
  texts = texts.filter(t => t.t < 1.1);
  const chip = chips.coin.getBoundingClientRect();
  for (const f of flyers) {
    f.t += dt / 0.65;
    f.tx = chip.left + 18;
    f.ty = chip.top + chip.height / 2;
    if (f.t >= 1 && !f.done) {
      f.done = true;
      res.coin += f.amt;
      bump('coin');
      coinSfxT <= 0 && (play('coin', coinSeq++), (coinSfxT = 0.06));
    }
  }
  coinSfxT -= dt;
  flyers = flyers.filter(f => !f.done);
}

// ================= 主更新 =================
function update(dt) {
  time += dt;
  const appeal = rides().reduce((s, f) => s + f.lv, 0);
  spawnT -= dt;
  if (spawnT <= 0) {
    spawnT = (SPAWN_EVERY / Math.max(1, appeal)) * rand(0.7, 1.3);
    if (guests.length < MAX_GUESTS) spawnGuest();
  }
  for (const g of guests) updatePerson(g, dt);
  guests = guests.filter(g => {
    if (g.alpha > 0) return true;
    visitors++;
    return false;
  });
  staff.forEach(s => updateStaff(s, dt));
  updatePerson(vendor, dt);
  for (const f of FACS) updateFac(f, dt);

  // 兩個遊客擦身而過時，偶爾會停下來聊天
  chatT -= dt;
  if (chatT <= 0) {
    chatT = 0.5;
    const walkers = guests.filter(g => g.state === 'walk' && g.chatCD <= 0 && !g.hop);
    for (let a = 0; a < walkers.length; a++) for (let b = a + 1; b < walkers.length; b++) {
      const A = walkers[a], B = walkers[b];
      if (Math.hypot(A.x - B.x, A.y - B.y) > 0.5 || Math.random() > 0.35) continue;
      for (const [p, icon] of [[A, '💬'], [B, '😆']]) {
        p.chatCD = 14;
        p.dir = (isoX(B.x - A.x, B.y - A.y) > 0) === (p === A) ? 1 : -1;
        emote(p, icon, 1.8);
        waitThen(p, 2, () => { p.state = 'walk'; });
      }
      a = walkers.length;
      break;
    }
  }

  // 賣氣球的會把氣球賣給路過的遊客
  vendorCD -= dt;
  if (vendorCD <= 0) {
    const g = guests.find(g => g.state === 'walk' && !g.balloon && !g.hop && Math.hypot(g.x - VENDOR.x, g.y - VENDOR.y) < 0.7);
    if (g && Math.random() < 0.5) {
      vendorCD = 6;
      g.balloon = pick(BALLOON);
      emote(g, '🎈');
      emote(vendor, '😊');
      waitThen(g, 1, () => { g.state = 'walk'; });
      res.coin += 2;
      texts.push({ x: isoX(g.x, g.y), y: isoY(g.x, g.y) - 34, text: '+2', t: 0, color: '#ffb800' });
    } else vendorCD = 0.4;
  }

  updateFx(dt);
  if (trans) { trans.t += dt / 0.5; if (trans.t >= 1) trans = null; }

  saveT -= dt;
  if (saveT <= 0) { saveT = 5; save(); }
  hintT -= dt;
  if (hintT <= 0) { hintT = 0.5; refreshHint(); }
  panelT -= dt;
  if (panelT <= 0) { panelT = 0.25; if (selected?.build) openPanel(selected); }
}

// ================= 繪圖：主世界 =================
const clouds = Array.from({ length: 9 }, (_, i) => ({ x: Math.random(), y: rand(0.05, 0.95), s: rand(0.6, 1.4), v: rand(0.004, 0.012), front: i % 3 === 0 }));

function roundRect(x, y, w, h, r) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
}
function ellipse(x, y, rx, ry, color) {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
  ctx.fill();
}
function diamond(i, j, w = 1, h = 1, inset = 0) {
  ctx.beginPath();
  ctx.moveTo(isoX(i + inset, j + inset), isoY(i + inset, j + inset));
  ctx.lineTo(isoX(i + w - inset, j + inset), isoY(i + w - inset, j + inset));
  ctx.lineTo(isoX(i + w - inset, j + h - inset), isoY(i + w - inset, j + h - inset));
  ctx.lineTo(isoX(i + inset, j + h - inset), isoY(i + inset, j + h - inset));
  ctx.closePath();
}

function drawSky() {
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, '#86cdfb');
  g.addColorStop(0.55, '#c9ecff');
  g.addColorStop(1, '#ffe3ef');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
  const sun = ctx.createRadialGradient(W * 0.82, H * 0.12, 0, W * 0.82, H * 0.12, 160);
  sun.addColorStop(0, 'rgba(255,250,220,0.9)');
  sun.addColorStop(1, 'rgba(255,250,220,0)');
  ctx.fillStyle = sun;
  ctx.fillRect(0, 0, W, H);
}
function drawClouds(front) {
  for (const c of clouds) {
    if (c.front !== front) continue;
    const x = ((c.x + time * c.v) % 1.3) * (W + 300) - 200, y = c.y * H, s = c.s * (front ? 1.3 : 1);
    ctx.fillStyle = front ? 'rgba(255,255,255,0.75)' : 'rgba(255,255,255,0.55)';
    ctx.beginPath();
    for (const [dx, dy, r] of [[0, 0, 26], [28, -10, 32], [60, 0, 24], [30, 8, 26]]) {
      ctx.moveTo(x + dx * s + r * s, y + dy * s);
      ctx.arc(x + dx * s, y + dy * s, r * s, 0, Math.PI * 2);
    }
    ctx.fill();
  }
}

function drawUnderside() {
  const hw = (isl.maxX - isl.minX) / 2 * 0.94, hh = (isl.maxY - isl.minY) / 2;
  const top = islMidY + 4;
  const grad = ctx.createLinearGradient(0, top, 0, top + hh + 170);
  grad.addColorStop(0, '#a77650');
  grad.addColorStop(0.5, '#7d5a63');
  grad.addColorStop(1, 'rgba(110,90,140,0.15)');
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.moveTo(islMidX - hw, top);
  for (let k = 0; k <= 26; k++) {
    const u = (k / 26) * 2 - 1;
    const base = top + hh * Math.sqrt(Math.max(0, 1 - u * u)) * 0.92 + SIDE;
    const depth = 150 * (1 - u * u) ** 1.4 * (k % 2 ? 0.7 : 1) * (0.8 + hash(k, 3) * 0.35);
    ctx.lineTo(islMidX + u * hw, base + depth);
  }
  ctx.closePath();
  ctx.fill();
  // 小碎石
  for (let k = 0; k < 4; k++) {
    const x = islMidX + (k - 1.5) * hw * 0.7, y = isl.maxY + 60 + hash(k, 1) * 50 + Math.sin(time * 0.9 + k) * 5;
    ctx.fillStyle = '#93684d';
    ctx.beginPath();
    ctx.moveTo(x - 9, y); ctx.lineTo(x + 9, y); ctx.lineTo(x + 2, y + 16); ctx.closePath();
    ctx.fill();
    ellipse(x, y, 9, 4, '#8fd16a');
  }
}

function drawTiles() {
  for (let s = 0; s < G * 2; s++) {
    for (let i = 0; i <= s; i++) {
      const j = s - i, t = tileAt(i, j);
      if (!t) continue;
      // 前方沒有地面的邊，畫出土層
      if (!tileAt(i, j + 1)) {
        ctx.fillStyle = '#c49464';
        ctx.beginPath();
        ctx.moveTo(isoX(i, j + 1), isoY(i, j + 1));
        ctx.lineTo(isoX(i + 1, j + 1), isoY(i + 1, j + 1));
        ctx.lineTo(isoX(i + 1, j + 1), isoY(i + 1, j + 1) + SIDE);
        ctx.lineTo(isoX(i, j + 1), isoY(i, j + 1) + SIDE);
        ctx.fill();
      }
      if (!tileAt(i + 1, j)) {
        ctx.fillStyle = '#a87a50';
        ctx.beginPath();
        ctx.moveTo(isoX(i + 1, j), isoY(i + 1, j));
        ctx.lineTo(isoX(i + 1, j + 1), isoY(i + 1, j + 1));
        ctx.lineTo(isoX(i + 1, j + 1), isoY(i + 1, j + 1) + SIDE);
        ctx.lineTo(isoX(i + 1, j), isoY(i + 1, j) + SIDE);
        ctx.fill();
      }
      diamond(i, j);
      ctx.fillStyle = t === 2 ? ((i + j) % 2 ? '#f6e9cd' : '#f1e2c2') : (hash(i, j) < 0.5 ? '#a3dc78' : '#9ad470');
      ctx.fill();
      if (t === 2) { ctx.strokeStyle = 'rgba(200,170,120,0.35)'; ctx.lineWidth = 1; ctx.stroke(); }
    }
  }
}

function drawFloor() {
  for (const f of FACS) {
    if (f.locked || f.lv === 0) {
      diamond(f.x, f.y, 2, 2, 0.1);
      ctx.fillStyle = f.locked ? 'rgba(255,255,255,0.25)' : '#dcbf8f';
      ctx.fill();
      ctx.setLineDash([5, 4]);
      ctx.strokeStyle = f.locked ? 'rgba(120,90,60,0.4)' : '#a5784a';
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.setLineDash([]);
      continue;
    }
    if (f.kind === 'pond') drawPond(f);
  }
}

function drawPond(f) {
  const cx = isoX(f.x + 1, f.y + 1), cy = isoY(f.x + 1, f.y + 1);
  ellipse(cx, cy + 2, RX * 0.98, RY * 0.98, '#cfc5b4');
  ellipse(cx, cy, RX * 0.92, RY * 0.92, '#e6ddcc');
  const w = ctx.createLinearGradient(0, cy - RY, 0, cy + RY);
  w.addColorStop(0, '#9fe3f5');
  w.addColorStop(1, '#4fb1dc');
  ellipse(cx, cy, RX * 0.76, RY * 0.76, w);
  ctx.strokeStyle = 'rgba(255,255,255,0.5)';
  ctx.lineWidth = 1.5;
  for (let k = 0; k < 2; k++) {
    const r = ((time * 0.4 + k * 0.5) % 1);
    ctx.globalAlpha = 1 - r;
    ctx.beginPath();
    ctx.ellipse(cx + 10, cy - 3, RX * 0.25 * r + 4, RY * 0.25 * r + 2, 0, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
  const pads = 2 + f.lv;
  for (let k = 0; k < pads; k++) {
    const a = k * 2.4 + 0.5, r = 0.25 + (k % 3) * 0.13;
    const px = cx + isoX(Math.cos(a) * r, Math.sin(a) * r), py = cy + isoY(Math.cos(a) * r, Math.sin(a) * r);
    ellipse(px, py, 6, 3, '#6cc35a');
    if (k % 2 === 0) ellipse(px + 1, py - 1.5, 2, 1.6, '#ffb3cf');
  }
  if (f.lv >= 2) {
    ctx.fillStyle = '#c48a55';
    ctx.beginPath();
    const a = isoX(f.x + 1.75, f.y + 0.9), b = isoY(f.x + 1.75, f.y + 0.9);
    ctx.moveTo(a, b); ctx.lineTo(a + 18, b + 9); ctx.lineTo(a + 6, b + 15); ctx.lineTo(a - 12, b + 6); ctx.closePath();
    ctx.fill();
  }
}

// 人物（腳底在 x, y；單位是畫面上的等角座標）
function drawPerson(p, x, y, o = {}) {
  const bob = p.moving ? Math.abs(Math.sin(p.walkT * 10)) * 2 : 0;
  const sq = p.squash;
  ctx.globalAlpha = clamp(p.alpha, 0, 1);
  if (!o.noShadow) ellipse(x, y + (o.shadowDy || 0), 6, 2.6, 'rgba(60,40,80,0.18)');
  const top = y - (o.z || 0) - p.jz - bob;
  if (p.balloon) {
    const bx = x - p.dir * 6 + Math.sin(time * 2 + p.lane * 20) * 2, by = top - 44;
    ctx.strokeStyle = 'rgba(60,40,80,0.5)';
    ctx.lineWidth = 0.8;
    ctx.beginPath(); ctx.moveTo(x - p.dir * 5, top - 11); ctx.lineTo(bx, by + 7); ctx.stroke();
    ellipse(bx, by, 6, 7, p.balloon);
    ellipse(bx - 2, by - 2.5, 1.6, 2.2, 'rgba(255,255,255,0.6)');
  }
  ctx.save();
  ctx.translate(x, top);
  ctx.scale(p.dir * (1 + sq * 0.3), 1 - sq * 0.25);
  if (!o.sit) {
    const sw = p.moving ? Math.sin(p.walkT * 10) * 2 : 0;
    ctx.fillStyle = '#5a4a6a';
    roundRect(-3.5 + sw, -6, 3, 6, 1.5); ctx.fill();
    roundRect(0.5 - sw, -6, 3, 6, 1.5); ctx.fill();
  }
  ctx.fillStyle = p.look.shirt;
  roundRect(-5, -15, 10, 10, 4); ctx.fill();
  ellipse(0, -21, 6.2, 6, p.look.skin);
  ctx.fillStyle = p.look.hair;
  ctx.beginPath(); ctx.arc(0, -22, 6.5, Math.PI, 0); ctx.fill();
  ellipse(-4.6, -20, 2.2, 3.6, p.look.hair);
  ellipse(1.8, -20.5, 0.9, 1.2, '#3b3350');
  ellipse(4.3, -20.5, 0.9, 1.2, '#3b3350');
  ellipse(4.6, -18.2, 1.4, 0.9, 'rgba(255,120,150,0.45)');
  if (p.look.hat) {
    ellipse(1.5, -26.5, 6.8, 1.8, p.look.hat);
    ctx.fillStyle = p.look.hat;
    ctx.beginPath(); ctx.arc(0, -26.5, 5.2, Math.PI, 0); ctx.fill();
  }
  ctx.restore();
  if (p.rod) {
    const tx = x + isoX(-0.35, -0.35) * 0.8, ty = y + isoY(-0.35, -0.35) * 0.8;
    ctx.strokeStyle = '#7a5532';
    ctx.lineWidth = 1.2;
    ctx.beginPath(); ctx.moveTo(x, top - 12); ctx.lineTo(tx, top - 26); ctx.stroke();
    ctx.strokeStyle = 'rgba(255,255,255,0.7)';
    ctx.lineWidth = 0.6;
    const bobber = ty + 1 + Math.sin(time * 4 + p.lane * 30) * 1;
    ctx.beginPath(); ctx.moveTo(tx, top - 26); ctx.lineTo(tx, bobber); ctx.stroke();
    ellipse(tx, bobber, 1.6, 1.3, '#ff5f5f');
  }
  ctx.globalAlpha = 1;
}

function drawCarousel(f) {
  const n = capOf(f);
  const big = f.lv >= 3 ? 1.1 : 1;
  const base = -6;
  ellipse(0, 3, RX * 0.98 * big, RY * 0.98 * big, 'rgba(60,40,80,0.15)');
  ellipse(0, 0, RX * 0.92 * big, RY * 0.92 * big, '#d9799b');
  ctx.fillStyle = '#d9799b';
  ctx.fillRect(-RX * 0.92 * big, base, RX * 1.84 * big, -base);
  ellipse(0, base, RX * 0.92 * big, RY * 0.92 * big, '#ffd9e5');
  const horses = [];
  for (let k = 0; k < n; k++) {
    const a = f.phase + (k * Math.PI * 2) / n;
    const wx = Math.cos(a) * 0.62 * big, wy = Math.sin(a) * 0.62 * big;
    horses.push({ k, x: isoX(wx, wy), y: isoY(wx, wy) + base, d: wx + wy, dir: -Math.sin(a) - Math.cos(a) > 0 ? 1 : -1 });
  }
  horses.sort((a, b) => a.d - b.d);
  const H0 = -54;
  const drawHorse = h => {
    const bob = Math.sin(f.phase * 3 + h.k * 1.7) * 4 * f.spin;
    const hy = h.y - 14 - bob;
    ctx.strokeStyle = '#f4c95d';
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(h.x, h.y); ctx.lineTo(h.x, H0); ctx.stroke();
    ellipse(h.x, hy, 8, 4.5, ['#ffffff', '#ffe9a8', '#d6ecff'][h.k % 3]);
    ellipse(h.x + h.dir * 7, hy - 4, 3.2, 3, ['#ffffff', '#ffe9a8', '#d6ecff'][h.k % 3]);
    ellipse(h.x + h.dir * 4.5, hy - 6, 2.2, 1.6, ['#ff8fb1', '#9b7bff', '#5fc8ff'][h.k % 3]);
    const g = f.riders[h.k];
    if (g && g.inRide && !g.hop) drawPerson(g, h.x, hy + 2, { sit: true, noShadow: true });
  };
  horses.filter(h => h.d < 0).forEach(drawHorse);
  ctx.fillStyle = '#f4c95d';
  ctx.fillRect(-3, H0, 6, base - H0);
  horses.filter(h => h.d >= 0).forEach(drawHorse);
  // 頂篷
  const segs = 12, apex = H0 - 24 * big, rx = RX * 1.02 * big, ry = RY * 1.02 * big;
  const tris = [];
  for (let s = 0; s < segs; s++) {
    const a0 = f.phase + (s / segs) * Math.PI * 2, a1 = a0 + (Math.PI * 2) / segs;
    tris.push({ s, a0, a1, d: Math.sin(a0 + Math.PI / segs + Math.PI / 4) });
  }
  tris.sort((a, b) => a.d - b.d);
  for (const t of tris) {
    ctx.fillStyle = t.s % 2 ? '#fff6f9' : '#ff8fb1';
    ctx.beginPath();
    ctx.moveTo(0, apex);
    ctx.lineTo(Math.cos(t.a0) * rx, H0 + Math.sin(t.a0) * ry);
    ctx.lineTo(Math.cos(t.a1) * rx, H0 + Math.sin(t.a1) * ry);
    ctx.closePath();
    ctx.fill();
  }
  for (let s = 0; s < 16; s++) {
    const a = (s / 16) * Math.PI * 2;
    if (Math.sin(a) < -0.2) continue;
    const x = Math.cos(a) * rx, y = H0 + Math.sin(a) * ry;
    ellipse(x, y + 1.5, 3.4, 2.4, s % 2 ? '#ff8fb1' : '#ffe08a');
    if (f.lv >= 2) ellipse(x, y + 5, 1.6, 1.6, (Math.floor(time * 4) + s) % 2 ? '#fff7b0' : '#ffb84d');
  }
  ctx.fillStyle = '#f4c95d';
  ctx.beginPath(); ctx.arc(0, apex, 3, 0, Math.PI * 2); ctx.fill();
  if (f.lv >= 3) {
    ctx.strokeStyle = '#7a5532'; ctx.lineWidth = 1.2;
    ctx.beginPath(); ctx.moveTo(0, apex); ctx.lineTo(0, apex - 14); ctx.stroke();
    ctx.fillStyle = '#ff5f7e';
    ctx.beginPath(); ctx.moveTo(0, apex - 14); ctx.lineTo(10 + Math.sin(time * 5) * 2, apex - 11); ctx.lineTo(0, apex - 8); ctx.fill();
  }
}

function drawBumper(f) {
  const ox = isoX(f.x + 1, f.y + 1), oy = isoY(f.x + 1, f.y + 1);
  ctx.save();
  ctx.translate(-ox, -oy);
  diamond(f.x, f.y, 2, 2, 0.08);
  ctx.fillStyle = '#2b2450';
  ctx.fill();
  ctx.strokeStyle = 'rgba(127,246,255,0.35)';
  ctx.lineWidth = 6;
  ctx.stroke();
  ctx.strokeStyle = '#7ff6ff';
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.strokeStyle = 'rgba(183,123,255,0.25)';
  ctx.lineWidth = 1;
  for (let k = 1; k < 4; k++) {
    ctx.beginPath();
    ctx.moveTo(isoX(f.x + k / 2, f.y + 0.08), isoY(f.x + k / 2, f.y + 0.08));
    ctx.lineTo(isoX(f.x + k / 2, f.y + 1.92), isoY(f.x + k / 2, f.y + 1.92));
    ctx.moveTo(isoX(f.x + 0.08, f.y + k / 2), isoY(f.x + 0.08, f.y + k / 2));
    ctx.lineTo(isoX(f.x + 1.92, f.y + k / 2), isoY(f.x + 1.92, f.y + k / 2));
    ctx.stroke();
  }
  if (f.lv >= 2) {
    // 後方的霓虹招牌
    const sx = isoX(f.x + 0.3, f.y + 0.3), sy = isoY(f.x + 0.3, f.y + 0.3);
    ctx.fillStyle = '#5a4a6a';
    ctx.fillRect(sx - 14, sy - 34, 2, 34);
    ctx.fillRect(sx + 12, sy - 34, 2, 34);
    roundRect(sx - 22, sy - 50, 44, 18, 5);
    ctx.fillStyle = '#1a1533'; ctx.fill();
    ctx.strokeStyle = (Math.floor(time * 3) % 2) ? '#ff5fa2' : '#7ff6ff'; ctx.lineWidth = 1.5; ctx.stroke();
    ctx.fillStyle = '#ffe66d';
    ctx.font = 'bold 10px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('BUMP!', sx, sy - 37.5);
  }
  const cars = [];
  for (let k = 0; k < capOf(f); k++) { const c = bumperCar(f, k); cars.push({ k, ...c }); }
  cars.sort((a, b) => a.x + a.y - b.x - b.y);
  const COLORS = ['#ff5fa2', '#ffd23f', '#5ff0ff', '#9dff6b', '#b77bff'];
  for (const c of cars) {
    const x = isoX(c.x, c.y), y = isoY(c.x, c.y);
    ellipse(x, y + 1, 11, 5.5, '#14102a');
    ellipse(x, y - 3, 10, 5.5, COLORS[c.k % 5]);
    ellipse(x - 2, y - 5, 4, 1.6, 'rgba(255,255,255,0.45)');
    ctx.strokeStyle = '#c9c9d9'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(x + 4, y - 5); ctx.lineTo(x + 4, y - 30); ctx.stroke();
    if (f.spin > 0.5 && Math.floor(time * 10 + c.k) % 3 === 0) ellipse(x + 4, y - 30, 2, 2, '#fff7b0');
    const g = f.riders[c.k];
    if (g && g.inRide && !g.hop) drawPerson(g, x - 1, y - 3, { sit: true, noShadow: true });
  }
  if (f.lv >= 3) {
    // 圍欄燈串
    for (let k = 0; k <= 8; k++) {
      for (const [ax, ay] of [[f.x + 0.08 + k * 0.23, f.y + 1.92], [f.x + 1.92, f.y + 0.08 + k * 0.23]]) {
        ellipse(isoX(ax, ay), isoY(ax, ay) - 4, 1.8, 1.8, (Math.floor(time * 5) + k) % 2 ? '#ff5fa2' : '#ffe66d');
      }
    }
  }
  ctx.restore();
}

// 施工中的鷹架（開發中只有鷹架，升級中是蓋在原本的設施外面）
function drawScaffold(f) {
  const hgt = f.lv === 0 ? 34 : 62;
  const C = [[-0.92, -0.92], [0.92, -0.92], [0.92, 0.92], [-0.92, 0.92]].map(([x, y]) => [isoX(x, y), isoY(x, y)]);
  ctx.strokeStyle = '#c48a55';
  ctx.lineWidth = 2.2;
  ctx.globalAlpha = f.lv === 0 ? 1 : 0.85;
  for (const [x, y] of C) { ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x, y - hgt); ctx.stroke(); }
  ctx.lineWidth = 1.6;
  for (const h of [hgt * 0.45, hgt]) {
    ctx.beginPath();
    C.forEach(([x, y], k) => (k ? ctx.lineTo(x, y - h) : ctx.moveTo(x, y - h)));
    ctx.closePath();
    ctx.stroke();
  }
  // 斜撐
  ctx.beginPath();
  ctx.moveTo(C[2][0], C[2][1]); ctx.lineTo(C[3][0], C[3][1] - hgt * 0.45);
  ctx.moveTo(C[1][0], C[1][1]); ctx.lineTo(C[2][0], C[2][1] - hgt * 0.45);
  ctx.stroke();
  // 黃黑警示布條
  ctx.fillStyle = '#ffd23f';
  ctx.beginPath();
  ctx.moveTo(C[3][0], C[3][1] - 6); ctx.lineTo(C[2][0], C[2][1] - 6); ctx.lineTo(C[2][0], C[2][1] - 11); ctx.lineTo(C[3][0], C[3][1] - 11);
  ctx.fill();
  ctx.globalAlpha = 1;
  if (f.lv === 0) {
    // 起重小吊臂，會慢慢擺動
    const a = Math.sin(time * 1.2) * 0.25;
    ctx.strokeStyle = '#ff9f43';
    ctx.lineWidth = 2.5;
    ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(0, -60);
    ctx.lineTo(Math.cos(a) * 34, -60 + Math.sin(a) * 6); ctx.stroke();
    ctx.lineWidth = 0.8;
    ctx.beginPath(); ctx.moveTo(Math.cos(a) * 30, -60 + Math.sin(a) * 6); ctx.lineTo(Math.cos(a) * 30, -36); ctx.stroke();
    ctx.fillStyle = '#8e6a4b';
    ctx.fillRect(Math.cos(a) * 30 - 4, -36, 8, 6);
  }
}

function drawMarble(f) {
  const P = ([x, y, z]) => [isoX(x, y), isoY(x, y) - z];
  const top = MARBLE_PATH[0];
  // 支柱
  ctx.strokeStyle = '#b9c7dc';
  ctx.lineWidth = 2;
  for (const p of MARBLE_PATH.slice(1)) {
    const [x, y] = P(p);
    ctx.beginPath(); ctx.moveTo(x, y + p[2]); ctx.lineTo(x, y); ctx.stroke();
  }
  // 起點的塔
  const [tx, ty] = P(top);
  ellipse(tx, ty + top[2] + 2, 11, 5, 'rgba(60,40,80,0.15)');
  ctx.fillStyle = '#8f9bff';
  ctx.fillRect(tx - 8, ty, 16, top[2]);
  ctx.fillStyle = '#b3bcff';
  for (let k = 0; k < 4; k++) ctx.fillRect(tx - 8, ty + 8 + k * 14, 16, 5);
  ellipse(tx, ty, 13, 6, '#dfe4ff');
  if (f.lv >= 2) {
    ctx.strokeStyle = '#7a5532'; ctx.lineWidth = 1.2;
    ctx.beginPath(); ctx.moveTo(tx, ty - 2); ctx.lineTo(tx, ty - 20); ctx.stroke();
    ctx.fillStyle = '#5fd6ff';
    ctx.beginPath(); ctx.moveTo(tx, ty - 20); ctx.lineTo(tx + 11 + Math.sin(time * 5) * 2, ty - 17); ctx.lineTo(tx, ty - 13); ctx.fill();
  }
  // 軌道
  const pts = MARBLE_PATH.map(P);
  for (const [w, c] of [[8, '#7fb6e6'], [4.5, '#e8f6ff']]) {
    ctx.strokeStyle = c;
    ctx.lineWidth = w;
    ctx.lineJoin = 'round';
    ctx.beginPath();
    pts.forEach(([x, y], k) => (k ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
    ctx.stroke();
  }
  if (f.lv >= 3) {
    for (let k = 0; k <= 20; k++) {
      const [x, y] = P(marblePoint(k / 20));
      ellipse(x, y - 4, 1.6, 1.6, (Math.floor(time * 5) + k) % 2 ? '#ffe66d' : '#ff8fb1');
    }
  }
  // 球艙：透明的大球，裡面坐著遊客
  const n = capOf(f);
  const pods = [];
  for (let k = 0; k < n; k++) pods.push({ k, u: marbleU(f, k) });
  pods.sort((a, b) => a.u - b.u);
  for (const { k, u } of pods) {
    const [x, y] = P(marblePoint(u));
    const g = f.riders[k];
    if (g && g.inRide && !g.hop) {
      ctx.save();
      ctx.translate(x, y - 4);
      ctx.scale(0.72, 0.72);
      drawPerson(g, 0, 8, { sit: true, noShadow: true });
      ctx.restore();
    }
    ctx.fillStyle = 'rgba(210,240,255,0.42)';
    ctx.beginPath(); ctx.arc(x, y - 9, 10, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.9)';
    ctx.lineWidth = 1.2;
    ctx.stroke();
    ellipse(x - 3.5, y - 13, 2.6, 1.6, 'rgba(255,255,255,0.85)');
  }
}

function drawSign(f) {
  const x = 0, y = 0;
  ctx.fillStyle = '#9b6d45';
  ctx.fillRect(x - 1.5, y - 26, 3, 26);
  roundRect(x - 20, y - 42, 40, 18, 4);
  ctx.fillStyle = f.locked ? '#fffaf0' : '#ffe08a';
  ctx.fill();
  ctx.strokeStyle = '#9b6d45'; ctx.lineWidth = 1.5; ctx.stroke();
  ctx.fillStyle = '#5a4a3a';
  ctx.font = 'bold 9px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(f.locked ? '即將推出' : '🚧 研發中', x, y - 30);
}

function drawDecor(d) {
  const x = isoX(d.x, d.y), y = isoY(d.x, d.y);
  if (d.kind === 'tree') {
    const s = d.s, sway = Math.sin(time * 1.3 + d.x * 2) * 1.2;
    ellipse(x, y, 10 * s, 4.5 * s, 'rgba(60,40,80,0.16)');
    ctx.fillStyle = '#9b6d45';
    ctx.fillRect(x - 2 * s, y - 12 * s, 4 * s, 12 * s);
    ellipse(x + sway, y - 20 * s, 12 * s, 11 * s, '#5fb85a');
    ellipse(x - 4 * s + sway, y - 24 * s, 7 * s, 6 * s, '#7fd46a');
  } else if (d.kind === 'flowers') {
    for (let k = 0; k < 5; k++) {
      const a = k * 2.2 + d.x;
      ellipse(x + Math.cos(a) * 9, y + Math.sin(a) * 4, 2.2, 1.8, ['#ff8fb1', '#ffd23f', '#ffffff', '#c38bff'][k % 4]);
    }
  } else if (d.kind === 'lamp') {
    ctx.fillStyle = '#5a4a6a';
    ctx.fillRect(x - 1.2, y - 34, 2.4, 34);
    ellipse(x, y - 36, 4, 4, '#fff3b0');
    ellipse(x, y, 4, 2, 'rgba(60,40,80,0.18)');
  } else if (d.kind === 'bench') {
    ctx.fillStyle = '#c48a55';
    ctx.beginPath();
    ctx.moveTo(x - 12, y - 6); ctx.lineTo(x + 2, y + 1); ctx.lineTo(x + 2, y - 2); ctx.lineTo(x - 12, y - 9); ctx.fill();
    ctx.fillRect(x - 11, y - 6, 2, 6); ctx.fillRect(x, y, 2, 4);
  } else if (d.kind === 'fountain') {
    ellipse(x, y + 2, 20, 10, '#cfc5b4');
    ellipse(x, y, 17, 8.5, '#8fd8f0');
    ctx.fillStyle = '#e6ddcc';
    ctx.fillRect(x - 2.5, y - 18, 5, 18);
    for (let k = 0; k < 6; k++) {
      const a = (k / 6) * Math.PI * 2 + time, r = ((time * 1.5 + k / 6) % 1);
      ellipse(x + Math.cos(a) * r * 14, y - 18 + r * r * 18 - r * 10 + Math.sin(a) * r * 6, 1.6, 1.6, 'rgba(255,255,255,0.85)');
    }
  }
}

function drawGate() {
  const L = [isoX(6.05, GATE.y), isoY(6.05, GATE.y)], R = [isoX(6.95, GATE.y), isoY(6.95, GATE.y)];
  for (const [x, y] of [L, R]) {
    ctx.fillStyle = '#ff8fb1';
    roundRect(x - 3.5, y - 50, 7, 50, 3); ctx.fill();
    ellipse(x, y - 52, 5, 5, '#ffe08a');
  }
  const mx = (L[0] + R[0]) / 2, my = (L[1] + R[1]) / 2 - 56;
  ctx.save();
  ctx.translate(mx, my);
  ctx.transform(1, (R[1] - L[1]) / (R[0] - L[0]), 0, 1, 0, 0);
  roundRect(-30, -11, 60, 18, 8);
  ctx.fillStyle = '#fffaf2'; ctx.fill();
  ctx.strokeStyle = '#ff8fb1'; ctx.lineWidth = 2; ctx.stroke();
  ctx.fillStyle = '#d9547f';
  ctx.font = 'bold 10px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('浮島樂園', 0, 2);
  ctx.restore();
}

function drawParticles() {
  for (const p of parts) {
    const a = clamp(p.life / p.max, 0, 1);
    ctx.globalAlpha = a;
    if (p.kind === 'confetti') {
      ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.rot);
      ctx.fillStyle = p.color; ctx.fillRect(-p.size, -p.size / 2, p.size * 2, p.size); ctx.restore();
    } else if (p.kind === 'heart') {
      ctx.fillStyle = p.color; ctx.font = '8px system-ui'; ctx.textAlign = 'center'; ctx.fillText('♥', p.x, p.y);
    } else if (p.kind === 'fish') {
      ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(Math.atan2(p.vy, p.vx));
      ellipse(0, 0, 5, 2.5, p.color);
      ctx.fillStyle = p.color; ctx.beginPath(); ctx.moveTo(-4, 0); ctx.lineTo(-8, -3); ctx.lineTo(-8, 3); ctx.fill();
      ctx.restore();
      if (p.life < 0.05) ripple(...fromIso(p.x, p.y));
    } else if (p.kind === 'ripple') {
      const r = 1 - a;
      ctx.strokeStyle = 'rgba(255,255,255,0.8)'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.ellipse(p.x, p.y, 3 + r * 14, 1.5 + r * 7, 0, 0, Math.PI * 2); ctx.stroke();
    } else {
      ellipse(p.x, p.y, p.size * (p.kind === 'dust' ? 1.4 : 0.8), p.size * (p.kind === 'dust' ? 1 : 0.8), p.color);
    }
  }
  ctx.globalAlpha = 1;
}
const fromIso = (ix, iy) => [ix / TW + iy / TH, iy / TH - ix / TW];

function drawPark() {
  drawSky();
  drawClouds(false);
  ctx.save();
  ctx.translate(cam.x, cam.y + bobY() * cam.s);
  ctx.scale(cam.s, cam.s);
  drawUnderside();
  ctx.restore();
  drawClouds(true);
  ctx.save();
  ctx.translate(cam.x, cam.y + bobY() * cam.s);
  ctx.scale(cam.s, cam.s);
  drawTiles();
  drawFloor();

  const list = [];
  for (const d of decor) if (!covered(d.x, d.y)) list.push({ k: d.x + d.y, draw: () => drawDecor(d) });
  for (const f of FACS) {
    const cx = f.x + 1, cy = f.y + 1;
    const base = f.locked || f.lv === 0 ? (f.build ? null : drawSign)
      : { carousel: drawCarousel, bumper: drawBumper, marble: drawMarble }[f.kind] || null;
    if (!base && !f.build) continue;
    list.push({
      k: cx + cy, draw: () => {
        ctx.save();
        ctx.translate(isoX(cx, cy), isoY(cx, cy));
        const s = 1 + Math.sin(f.pop * Math.PI) * 0.18;
        ctx.scale(s, 2 - s);
        base?.(f);
        if (f.build) drawScaffold(f);
        ctx.restore();
      },
    });
  }
  for (const p of [...guests, ...staff, vendor]) {
    if (p.inRide && !p.hop) continue;
    list.push({ k: p.x + p.y, draw: () => drawPerson(p, isoX(p.x, p.y), isoY(p.x, p.y), { z: p.z, sit: p.rod }) });
  }
  // 賣氣球的手上那一串氣球
  list.push({
    k: VENDOR.x + VENDOR.y - 0.05, draw: () => {
      const x = isoX(VENDOR.x, VENDOR.y) + 8, y = isoY(VENDOR.x, VENDOR.y);
      BALLOON.forEach((c, k) => {
        const bx = x + (k - 2) * 5 + Math.sin(time * 2 + k) * 1.5, by = y - 48 - (k % 2) * 6;
        ctx.strokeStyle = 'rgba(60,40,80,0.4)'; ctx.lineWidth = 0.6;
        ctx.beginPath(); ctx.moveTo(x, y - 14); ctx.lineTo(bx, by + 6); ctx.stroke();
        ellipse(bx, by, 5, 6, c);
      });
    },
  });
  list.push({ k: GATE.x + GATE.y + 0.4, draw: drawGate });
  list.sort((a, b) => a.k - b.k);
  for (const d of list) d.draw();
  drawParticles();
  ctx.restore();
  drawBubbles();
}

// 表情、對話、+金幣等文字用固定的螢幕大小畫，縮小時也看得清楚
function drawBubbles() {
  const fs = clamp(cam.s * 1.3, 0.85, 1.4);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (const p of [...guests, ...staff, vendor]) {
    if (p.inRide && !p.hop) continue;
    const [sx, sy] = toScreen(isoX(p.x, p.y), isoY(p.x, p.y) - p.z - p.jz - 36);
    if (p.emoteT > 0) {
      const e = clamp((1.3 - p.emoteT) * 6, 0, 1), s = (1 + Math.sin(e * Math.PI) * 0.25) * fs * Math.min(1, p.emoteT * 4);
      ctx.globalAlpha = p.alpha;
      ellipse(sx, sy, 11 * s, 10 * s, 'rgba(255,255,255,0.95)');
      ctx.beginPath(); ctx.moveTo(sx - 3 * s, sy + 8 * s); ctx.lineTo(sx + 1 * s, sy + 13 * s); ctx.lineTo(sx + 3 * s, sy + 7 * s); ctx.fill();
      ctx.font = `${13 * s}px system-ui, "Segoe UI Emoji", sans-serif`;
      ctx.fillText(p.emote, sx, sy + 0.5);
    }
    if (p.sayT > 0) {
      ctx.font = `bold ${12 * fs}px system-ui, sans-serif`;
      const w = ctx.measureText(p.say).width + 14, y = sy - (p.emoteT > 0 ? 26 : 4) * fs;
      ctx.globalAlpha = clamp(p.sayT * 4, 0, 1);
      roundRect(sx - w / 2, y - 11 * fs, w, 22 * fs, 10 * fs);
      ctx.fillStyle = '#3b3350'; ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.fillText(p.say, sx, y);
    }
    ctx.globalAlpha = 1;
  }
  // 試運轉中的遊客也有乘坐中的表情
  for (const t of texts) {
    const [sx, sy] = toScreen(t.x, t.y - t.t * 22);
    ctx.globalAlpha = clamp(1.6 - t.t * 1.6, 0, 1);
    ctx.font = `900 ${14 * fs}px system-ui, sans-serif`;
    ctx.lineWidth = 3;
    ctx.strokeStyle = '#fff';
    ctx.strokeText(t.text, sx, sy);
    ctx.fillStyle = t.color;
    ctx.fillText(t.text, sx, sy);
  }
  ctx.globalAlpha = 1;
  for (const f of flyers) {
    const e = f.t * f.t, mx = (f.sx + f.tx) / 2, my = Math.min(f.sy, f.ty) - 80;
    const x = (1 - e) ** 2 * f.sx + 2 * (1 - e) * e * mx + e * e * f.tx;
    const y = (1 - e) ** 2 * f.sy + 2 * (1 - e) * e * my + e * e * f.ty;
    ellipse(x, y, 7, 7, '#e0a020');
    ellipse(x, y - 1, 6, 6, '#ffd34d');
    ellipse(x - 1.5, y - 2.5, 2, 1.4, 'rgba(255,255,255,0.8)');
  }
  ctx.textBaseline = 'alphabetic';
  for (const f of FACS) {
    if (!f.build) continue;
    const [x, y] = toScreen(isoX(f.x + 1, f.y + 1), isoY(f.x + 1, f.y + 1) - (f.lv === 0 ? 72 : 96));
    buildBar(f, x, y);
  }
}

// ================= 繪圖：試驗場（藍圖風）=================
function drawLab() {
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, '#1f4e8c');
  g.addColorStop(1, '#2a62a8');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
  ctx.lineWidth = 1;
  for (let x = 0; x < W; x += 24) {
    ctx.strokeStyle = x % 120 === 0 ? 'rgba(255,255,255,0.12)' : 'rgba(255,255,255,0.05)';
    ctx.beginPath(); ctx.moveTo(x + 0.5, 0); ctx.lineTo(x + 0.5, H); ctx.stroke();
  }
  for (let y = 0; y < H; y += 24) {
    ctx.strokeStyle = y % 120 === 0 ? 'rgba(255,255,255,0.12)' : 'rgba(255,255,255,0.05)';
    ctx.beginPath(); ctx.moveTo(0, y + 0.5); ctx.lineTo(W, y + 0.5); ctx.stroke();
  }

  ctx.save();
  ctx.translate(cam.x, cam.y);
  ctx.scale(cam.s, cam.s);
  ctx.lineWidth = 1 / cam.s;
  for (let j = 0; j < G; j++) for (let i = 0; i < G; i++) {
    const t = tileAt(i, j);
    if (!t) continue;
    diamond(i, j);
    if (t === 2) { ctx.fillStyle = 'rgba(255,255,255,0.08)'; ctx.fill(); }
    ctx.strokeStyle = 'rgba(255,255,255,0.2)';
    ctx.stroke();
  }
  // 相鄰的設施之間畫虛線，表示有加成
  const links = [];
  const placed = f => (moving?.f === f ? [moving.x, moving.y] : [f.x, f.y]);
  const built = FACS.filter(f => !f.locked && f.lv > 0);
  for (let a = 0; a < built.length; a++) for (let b = a + 1; b < built.length; b++) {
    const A = built[a], B = built[b], [ax, ay] = placed(A), [bx, by] = placed(B);
    if (gap(A, ax, ay, { ...B, x: bx, y: by }) <= 1) links.push([ax + 1, ay + 1, bx + 1, by + 1]);
  }
  ctx.strokeStyle = '#ffc94a';
  ctx.lineWidth = 2 / cam.s;
  ctx.setLineDash([6 / cam.s, 5 / cam.s]);
  ctx.lineDashOffset = -time * 20 / cam.s;
  for (const [ax, ay, bx, by] of links) {
    ctx.beginPath(); ctx.moveTo(isoX(ax, ay), isoY(ax, ay)); ctx.lineTo(isoX(bx, by), isoY(bx, by)); ctx.stroke();
  }
  ctx.setLineDash([]);
  ctx.lineDashOffset = 0;

  const list = FACS.slice().sort((a, b) => a.x + a.y - b.x - b.y);
  for (const f of list) {
    if (moving?.f === f) {
      ctx.globalAlpha = 0.25;
      wireBox(f);
      ctx.globalAlpha = 1;
      wireBox(f, moving.x, moving.y, canPlace(f, moving.x, moving.y) ? 'ok' : 'bad');
    } else wireBox(f);
  }
  ctx.restore();
  for (const [ax, ay, bx, by] of links) {
    const [x, y] = toScreen(isoX((ax + bx) / 2, (ay + by) / 2), isoY((ax + bx) / 2, (ay + by) / 2));
    roundRect(x - 20, y - 9, 40, 18, 9);
    ctx.fillStyle = '#ffc94a'; ctx.fill();
    ctx.fillStyle = '#1f4e8c';
    ctx.font = 'bold 11px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(`+${ADJ_BONUS * 100}%`, x, y + 4);
  }

  // 掃描線
  const sy = ((time * 0.25) % 1) * H;
  const sg = ctx.createLinearGradient(0, sy - 40, 0, sy);
  sg.addColorStop(0, 'rgba(160,220,255,0)');
  sg.addColorStop(1, 'rgba(160,220,255,0.12)');
  ctx.fillStyle = sg;
  ctx.fillRect(0, sy - 40, W, 40);

  // 標籤
  ctx.textAlign = 'center';
  for (const f of FACS) {
    const h = boxHeight(f);
    const [fx, fy] = moving?.f === f ? [moving.x, moving.y] : [f.x, f.y];
    const [x, y] = toScreen(isoX(fx + 1, fy + 1), isoY(fx + 1, fy + 1) - h - 8);
    if (f.build) buildBar(f, x, y + 44);
    const s = 1 + Math.sin(f.pop * Math.PI) * 0.3;
    ctx.font = `${22 * s}px system-ui, "Segoe UI Emoji", sans-serif`;
    ctx.fillStyle = '#fff';
    ctx.globalAlpha = f.locked ? 0.4 : 1;
    ctx.fillText(f.icon, x, y - 4);
    ctx.font = 'bold 13px system-ui, sans-serif';
    ctx.fillText(f.name, x, y + 14);
    ctx.font = '12px system-ui, sans-serif';
    ctx.fillStyle = 'rgba(255,255,255,0.75)';
    ctx.fillText(statusLine(f), x, y + 30);
    const c = !f.locked && !f.build && costCheck(f);
    if (c && c.ok) {
      const pulse = 1 + Math.sin(time * 6) * 0.15;
      ellipse(x + 30, y - 14, 9 * pulse, 9 * pulse, '#ffc94a');
      ctx.fillStyle = '#1f4e8c';
      ctx.font = 'bold 12px system-ui, sans-serif';
      ctx.fillText(f.lv === 0 ? '+' : '↑', x + 30, y - 10);
    }
    ctx.globalAlpha = 1;
  }
  const [gx, gy] = toScreen(isoX(GATE.x, GATE.y), isoY(GATE.x, GATE.y));
  ctx.font = '11px system-ui, sans-serif';
  ctx.fillStyle = 'rgba(255,255,255,0.6)';
  ctx.fillText('▲ 入口', gx, gy + 16);
  ctx.textAlign = 'left';
  ctx.fillText('FLOATING PARK · R&D 試驗場', 14, H - 70);
}

// 施工進度條（螢幕座標）
function buildBar(f, x, y) {
  const p = 1 - buildLeft(f) / f.build.sec, w = 76;
  roundRect(x - w / 2, y - 7, w, 14, 7);
  ctx.fillStyle = 'rgba(40,30,60,0.75)'; ctx.fill();
  roundRect(x - w / 2 + 2, y - 5, (w - 4) * clamp(p, 0.04, 1), 10, 5);
  ctx.fillStyle = '#ffc94a'; ctx.fill();
  ctx.fillStyle = '#fff';
  ctx.font = 'bold 10px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(`🔨 ${Math.ceil(buildLeft(f))}s`, x, y + 3.5);
}

const boxHeight = f => (f.locked ? 14 : f.lv === 0 ? 20 : 20 + f.lv * 14);
function statusLine(f) {
  if (f.locked) return '即將推出';
  if (f.build) return f.lv === 0 ? '開發中' : `Lv${f.lv} → Lv${f.lv + 1} 施工中`;
  if (f.lv === 0) return `未開發 · ${RES.coin.icon}${f.dev.coin}`;
  return `Lv${f.lv} · 評價 ${f.game ? f.grade || '—' : '—'}`;
}

function wireBox(f, fx = f.x, fy = f.y, tint = null) {
  const s = 1 + Math.sin(f.pop * Math.PI) * 0.2;
  const hgt = boxHeight(f) * s, inset = 0.14;
  const x0 = fx + inset, y0 = fy + inset, x1 = fx + f.w - inset, y1 = fy + f.h - inset;
  const P = [[x0, y0], [x1, y0], [x1, y1], [x0, y1]].map(([x, y]) => [isoX(x, y), isoY(x, y)]);
  const sel = selected === f || tint;
  const dashed = f.locked || f.lv === 0 || f.build;
  const rgb = tint === 'ok' ? '125,255,176' : tint === 'bad' ? '255,107,129' : '255,201,74';
  const line = tint ? `rgb(${rgb})` : sel ? '#ffc94a' : '#ffffff';
  if (tint) {
    diamond(fx, fy, f.w, f.h);
    ctx.fillStyle = `rgba(${rgb},0.3)`;
    ctx.fill();
  }
  // 填色：頂面與前方兩面
  ctx.fillStyle = sel ? `rgba(${rgb},0.18)` : 'rgba(255,255,255,0.07)';
  for (const face of [[1, 2], [2, 3]]) {
    const [a, b] = face;
    ctx.beginPath();
    ctx.moveTo(P[a][0], P[a][1]); ctx.lineTo(P[b][0], P[b][1]);
    ctx.lineTo(P[b][0], P[b][1] - hgt); ctx.lineTo(P[a][0], P[a][1] - hgt);
    ctx.closePath(); ctx.fill();
  }
  ctx.beginPath();
  P.forEach(([x, y], k) => (k ? ctx.lineTo(x, y - hgt) : ctx.moveTo(x, y - hgt)));
  ctx.closePath();
  ctx.fillStyle = sel ? `rgba(${rgb},0.28)` : 'rgba(255,255,255,0.12)';
  ctx.fill();
  ctx.strokeStyle = line;
  ctx.lineWidth = (sel ? 2.2 : 1.4) / cam.s;
  ctx.setLineDash(dashed ? [6, 5] : []);
  ctx.stroke();
  const baseA = ctx.globalAlpha;
  const edge = (a, b, hidden) => {
    ctx.setLineDash(hidden || dashed ? [4, 4] : []);
    ctx.globalAlpha = baseA * (hidden ? 0.35 : 1);
    ctx.beginPath(); ctx.moveTo(...a); ctx.lineTo(...b); ctx.stroke();
    ctx.globalAlpha = baseA;
  };
  edge(P[0], P[1], true); edge(P[0], P[3], true);
  edge(P[1], P[2]); edge(P[2], P[3]);
  edge(P[0], [P[0][0], P[0][1] - hgt], true);
  for (const k of [1, 2, 3]) edge(P[k], [P[k][0], P[k][1] - hgt]);
  ctx.setLineDash([]);
  // 尺寸標記
  ctx.fillStyle = 'rgba(255,255,255,0.5)';
  for (const [x, y] of P) ctx.fillRect(x - 1.5, y - 1.5, 3, 3);
}

// ================= 主繪圖 =================
function render() {
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  if (!trans) {
    (mode === 'park' ? drawPark : drawLab)();
    return;
  }
  // 切換世界：舊畫面上，新世界從按鈕位置用圓形展開
  (trans.from === 'park' ? drawPark : drawLab)();
  const btn = $('btn-mode').getBoundingClientRect();
  const r = Math.hypot(W, H) * (1 - (1 - trans.t) ** 3);
  ctx.save();
  ctx.beginPath();
  ctx.arc(btn.left + btn.width / 2, btn.top + btn.height / 2, r, 0, Math.PI * 2);
  ctx.clip();
  (mode === 'park' ? drawPark : drawLab)();
  ctx.restore();
}

// ================= 介面 =================
const chips = {};
for (const [id, r] of Object.entries(RES)) {
  const el = document.createElement('div');
  el.className = 'chip';
  el.innerHTML = `${r.icon} <b>0</b>`;
  el.title = r.name;
  $('res').appendChild(el);
  chips[id] = el;
}
function bump(id) {
  const el = chips[id];
  el.classList.remove('bump');
  void el.offsetWidth;
  el.classList.add('bump');
}
let lastHud = '';
function refreshHud() {
  const inflight = flyers.reduce((s, f) => s + f.amt, 0);
  const sig = JSON.stringify([res, inflight, guests.length]);
  if (sig === lastHud) return;
  lastHud = sig;
  for (const id of Object.keys(RES)) {
    const v = id === 'coin' ? res.coin : res[id];
    chips[id].querySelector('b').textContent = fmt(v);
    chips[id].hidden = id !== 'coin' && v <= 0;
  }
  $('guests').querySelector('b').textContent = guests.length;
}

let toastT = 0;
function toast(text) {
  const el = $('toast');
  el.textContent = text;
  el.classList.add('show');
  clearTimeout(toastT);
  toastT = setTimeout(() => el.classList.remove('show'), 1800);
}

function showModal(title, html, ok = '好') {
  $('m-title').textContent = title;
  $('m-body').innerHTML = html;
  $('m-ok').textContent = ok;
  $('modal').classList.add('show');
}
$('m-ok').addEventListener('click', () => { $('modal').classList.remove('show'); play('tap'); });

function refreshHint() {
  const el = $('hint');
  let text = '';
  const bumper = FAC_BY.bumper, pond = FAC_BY.pond;
  const b = FACS.find(f => f.build);
  if (selected || labOpen || moving) text = '';
  else if (b) text = `🔨 ${b.name}施工中…還有 ${Math.ceil(buildLeft(b))} 秒`;
  else if (!tested) text = mode === 'park' ? '點遊客或設施看看！到「🔧 試驗場」試運轉設施' : '點「鋼珠滑道」或「彈射碰碰場」開始試運轉';
  else if (pond.lv === 0 && costCheck(pond).ok) text = '遊客幣夠了！可以在試驗場開發「釣魚池」';
  else if (costCheck(bumper)?.ok) text = '零件夠了！可以在試驗場升級碰碰場';
  el.hidden = !text;
  if (text) el.textContent = text;
}

// ---- 升級、開發的費用 ----
function costCheck(f) {
  const c = f.lv === 0 ? f.dev : f.up[f.lv - 1];
  if (!c) return null;
  const need = c.part || 0;
  const own = Math.min(res[f.part], need), short = need - own;
  const others = Object.keys(RES).filter(k => k !== 'coin' && k !== f.part).sort((a, b) => res[b] - res[a]);
  const swapFrom = others[0], swap = short * PARTS_SWAP;
  const ok = res.coin >= c.coin && (short === 0 || res[swapFrom] >= swap);
  return { ok, coin: c.coin, need, own, short, swap, swapFrom };
}
function costText(f, c) {
  let t = `${RES.coin.icon}${c.coin}`;
  if (c.need) t += ` + ${RES[f.part].icon}${c.need}`;
  return t;
}
function doUpgrade(f) {
  const c = costCheck(f);
  if (!c?.ok || f.build) { play('deny'); return; }
  res.coin -= c.coin;
  res[f.part] -= c.own;
  if (c.short) res[c.swapFrom] -= c.swap;
  startBuild(f);
  f.pop = 1;
  play('tap');
  toast(`${f.name}開始施工：${Math.ceil(buildLeft(f))} 秒`);
  save();
  openPanel(f);
}

// ---- 設施卡片 ----
function openPanel(f) {
  selected = f;
  $('p-icon').textContent = f.icon;
  $('p-name').textContent = f.name;
  const stats = [], acts = [];
  const building = f.build ? `<button class="pill" disabled>🔨 施工中…還有 ${Math.ceil(buildLeft(f))} 秒</button>` : '';
  const noGame = `<button class="pill" disabled>🔒 小遊戲「${f.gameName}」還沒推出</button>`;
  const moveBtn = '<button class="pill ghost" data-act="move">✥ 移動位置</button>';
  const adj = !f.locked && neighbors(f).length;
  if (f.locked) {
    $('p-sub').textContent = f.desc;
    acts.push('<p class="note">之後的小遊戲會在這裡開發成新設施</p>');
  } else if (f.lv === 0) {
    $('p-sub').textContent = f.build ? '開發中' : '尚未開發';
    stats.push(['每位收費', `${RES.coin.icon}${Math.round(f.fee)}`], ['一次可載', `${f.cap[0]} 人`], ['開發時間', `${BUILD_SEC.dev} 秒`]);
    if (mode === 'lab') {
      const c = costCheck(f);
      acts.push(building || `<button class="pill blue" data-act="up" ${c.ok ? '' : 'disabled'}>🛠 開發　${costText(f, c)}</button>`);
      acts.push(moveBtn);
      acts.push('<p class="note">開發只要遊客幣，完成後遊客就會來玩</p>');
    } else {
      acts.push(building || '<button class="pill blue" data-act="lab">🔧 到試驗場開發</button>');
    }
  } else {
    $('p-sub').textContent = f.levels
      ? `Lv${f.lv}/${maxLv(f)} · 已通過 ${f.cleared} 關 · ★ ${totalStars(f)}`
      : `Lv${f.lv}/${maxLv(f)} · 最佳評價 ${f.game ? f.grade || '尚未測試' : '—'}`;
    stats.push(['每位收費', `${RES.coin.icon}${feeOf(f)}`]);
    if (mode === 'park') stats.push(['一次可載', `${capOf(f)} 人`], ['排隊中', `${f.queue.length} 人`]);
    else if (f.levels) stats.push(['通關收費加成', `+${Math.round((progressBonus(f) - 1) * 100)}%`], ['相鄰加成', `+${Math.round(adj * ADJ_BONUS * 100)}%`]);
    else stats.push(['一次可載', `${capOf(f)} 人`], ['相鄰加成', `+${Math.round(adj * ADJ_BONUS * 100)}%`]);
    if (mode === 'lab' && f.levels) {
      // 關卡制：挑戰下一關、選道具、重玩已過的關
      const next = f.cleared + 1;
      acts.push(`<button class="pill" data-act="play" data-level="${next}">▶ 挑戰第 ${next} 關</button>`);
      acts.push(`<label class="boost"><input type="checkbox" id="p-boost" ${boostOn && res.coin >= BOOST_SHIELD_COST ? 'checked' : ''} ${res.coin >= BOOST_SHIELD_COST ? '' : 'disabled'}>
        🛡 帶開局護盾（${RES.coin.icon}${BOOST_SHIELD_COST}）</label>`);
      if (f.cleared > 0) {
        const from = Math.max(1, f.cleared - 5);
        let strip = '';
        for (let n = from; n <= f.cleared; n++) {
          const s = f.stars[n] || 1;
          strip += `<button class="lv" data-act="play" data-level="${n}">${n}<small>${'★'.repeat(s)}${'☆'.repeat(3 - s)}</small></button>`;
        }
        acts.push(`<div class="levels">${strip}</div>`);
      }
      acts.push(`<p class="note">設施 Lv${f.lv}：每關開局 +${f.lv - 1} 護盾。第一次過關拿 ${RES[f.part].icon}，重玩或失敗拿 25%</p>`);
    }
    if (mode === 'lab') {
      if (!f.levels) acts.push(f.game ? `<button class="pill" data-act="test">▶ 試運轉：${f.game}</button>` : noGame);
      const c = costCheck(f);
      if (f.build) acts.push(building);
      else if (c) {
        const sec = BUILD_SEC.up[f.lv - 1];
        acts.push(`<button class="pill blue" data-act="up" ${c.ok ? '' : 'disabled'}>⬆ 升級到 Lv${f.lv + 1}　${costText(f, c)}　⏱${sec}秒</button>`);
        if (c.short && res[c.swapFrom] > 0) acts.push(`<p class="note">${RES[f.part].icon}不夠的部分，可以用 ${RES[c.swapFrom].icon} ${PARTS_SWAP}:1 代替（需要 ${RES[c.swapFrom].icon}${c.swap}）</p>`);
      } else acts.push('<p class="note">已經是最高等級</p>');
      acts.push(moveBtn);
      if (f.game && !f.levels) acts.push(`<p class="note">依表現拿到零件；評價只升不降。旁邊每多一座設施，試運轉零件 +${ADJ_BONUS * 100}%</p>`);
    } else {
      acts.push(building || '<button class="pill blue" data-act="lab">🔧 到試驗場改良</button>');
      acts.push(`<p class="note">${f.desc}</p>`);
    }
  }
  $('p-stats').innerHTML = stats.map(([k, v]) => `<div class="stat"><small>${k}</small><b>${v}</b></div>`).join('');
  $('p-stats').hidden = !stats.length;
  $('p-actions').innerHTML = acts.join('');
  $('panel').classList.add('show');
  refreshHint();
}
function closePanel() {
  selected = null;
  $('panel').classList.remove('show');
}
$('p-close').addEventListener('click', () => { closePanel(); play('tap'); });
$('p-actions').addEventListener('click', e => {
  const btn = e.target.closest('button');
  const act = btn?.dataset.act;
  const f = selected;
  if (!act || !f) return;
  play('tap');
  if (act === 'lab') { const keep = f; setMode('lab'); openPanel(keep); }
  if (act === 'up') doUpgrade(f);
  if (act === 'test') openLab(f);
  if (act === 'play') openLab(f, Number(btn.dataset.level));
  if (act === 'move') startMove(f);
});
let boostOn = false;
$('p-actions').addEventListener('change', e => {
  if (e.target.id === 'p-boost') { boostOn = e.target.checked; play('tap'); }
});

// ---- 移動設施（在試驗場裡）----
function moveInfo() {
  const { f, x, y } = moving;
  const ok = canPlace(f, x, y);
  const n = ok ? neighbors(f, x, y).length : 0;
  $('mv-text').textContent = ok
    ? (n ? `相鄰設施 ${n} 座：試運轉零件 +${Math.round(n * ADJ_BONUS * 100)}%` : '可以放這裡')
    : '放不下：要整塊在草地上，旁邊要有步道';
  $('mv-ok').disabled = !ok;
}
function startMove(f) {
  moving = { f, x: f.x, y: f.y };
  closePanel();
  document.body.classList.add('moving');
  moveInfo();
}
function endMove(apply) {
  const { f, x, y } = moving;
  if (apply) {
    if (!canPlace(f, x, y)) { play('deny'); return; }
    if (x !== f.x || y !== f.y) {
      evict(f);
      f.x = x;
      f.y = y;
      layoutFac(f);
      f.pop = 1;
      play('build');
      toast(`${f.name}搬好了`);
      save();
    }
  }
  moving = null;
  document.body.classList.remove('moving');
  openPanel(f);
}
$('mv-ok').addEventListener('click', () => endMove(true));
$('mv-cancel').addEventListener('click', () => { play('tap'); endMove(false); });
function moveTo(sx, sy) {
  const [wx, wy] = toWorld(sx, sy);
  const x = Math.round(wx - moving.f.w / 2), y = Math.round(wy - moving.f.h / 2);
  if (x === moving.x && y === moving.y) return;
  moving.x = x;
  moving.y = y;
  play('tap');
  moveInfo();
}

function setMode(m) {
  if (m === mode) return;
  if (moving) endMove(false);
  trans = { from: mode, t: 0 };
  mode = m;
  document.body.classList.toggle('lab', m === 'lab');
  $('btn-mode').textContent = m === 'lab' ? '🎡 回樂園' : '🔧 試驗場';
  closePanel();
  play('whoosh');
  if (m === 'park') {
    // 在試驗場升級過的設施，回到樂園時放一次慶祝
    setTimeout(() => FACS.filter(f => f.celebrate).forEach(f => { f.celebrate = false; celebrate(f); play('build'); }), 350);
  }
  refreshHint();
}
$('btn-mode').addEventListener('click', () => setMode(mode === 'park' ? 'lab' : 'park'));

$('btn-mute').textContent = isMuted() ? '🔇' : '🔊';
$('btn-mute').addEventListener('click', () => {
  unlockAudio();
  $('btn-mute').textContent = toggleMute() ? '🔇' : '🔊';
});

// ---- 試運轉：用 iframe 跑小遊戲，結束時收 { durationSec, grade, score } ----
const frame = $('lab-frame');
function openLab(f, level = 1) {
  labOpen = true;
  labSession = { f, results: [] };
  closePanel();
  let src = f.src;
  if (f.levels) {
    // 關卡制：把關卡編號、設施等級給的護盾、道具、這關失敗過幾次（用來悄悄降難度）傳進去
    let boost = 0;
    if (boostOn && res.coin >= BOOST_SHIELD_COST) { res.coin -= BOOST_SHIELD_COST; boost = 1; }
    boostOn = false;
    src += `?mode=lab&level=${level}&shield=${f.lv - 1}&boost=${boost}&fails=${f.fails[level] || 0}`;
  }
  frame.src = src;
  $('lab').classList.add('show');
  $('hint').hidden = true;
}
function closeLab() {
  if (!labOpen) return;
  labOpen = false;
  $('lab').classList.remove('show');
  frame.src = 'about:blank';
  const { f, results } = labSession;
  labSession = null;
  if (f.levels) { settleLevels(f, results); return; }
  let gain = 0, best = null;
  for (const r of results) {
    if (r.durationSec < 5) continue;
    const sec = Math.min(r.durationSec, RUN_CAP_SEC);
    gain += Math.round((3 + sec / 10) * GRADE_PARTS[r.grade]);
    if (!best || GRADES.indexOf(r.grade) > GRADES.indexOf(best)) best = r.grade;
  }
  if (!gain) { toast('這次沒有完成試運轉'); openPanel(f); return; }
  const adj = neighbors(f).length;
  gain = Math.round(gain * (1 + adj * ADJ_BONUS));
  tested = true;
  res[f.part] += gain;
  const prev = f.grade;
  const improved = !prev || GRADES.indexOf(best) > GRADES.indexOf(prev);
  if (improved) f.grade = best;
  f.pop = 1;
  burst(isoX(f.x + 1, f.y + 1), isoY(f.x + 1, f.y + 1) - 40, 30, '#fff', 180, 'confetti');
  play('build');
  save();
  showModal('試運轉報告', `
    <span class="muted">${f.name} · ${results.length} 局</span>
    <span class="big">${best}</span>
    <span class="gain">${RES[f.part].icon} ${RES[f.part].name} +${gain}</span>
    ${adj ? `<span class="muted">含相鄰設施加成 +${Math.round(adj * ADJ_BONUS * 100)}%</span><br>` : ''}
    ${improved
      ? `<span>最佳評價${prev ? `從 ${prev} ` : ''}提升到 <b>${f.grade}</b>：每位遊客付費 ×${GRADE_FEE[f.grade]}</span>`
      : `<span class="muted">最佳評價維持 ${f.grade}（評價只升不降）</span>`}
  `);
}
// 關卡制的結算：第一次過關拿主要獎勵，重玩和失敗拿 25%（失敗再乘上完成進度）
function settleLevels(f, results) {
  if (!results.length) { toast('這次沒有完成試運轉'); openPanel(f); return; }
  const before = f.cleared, feeBefore = progressBonus(f);
  let gain = 0;
  const lines = [];
  for (const r of results) {
    const base = LEVEL_PARTS(r.level);
    let g;
    if (r.pass) {
      const first = r.level > f.cleared;
      const old = f.stars[r.level] || 1;
      g = (first ? base : base * REPLAY_RATE) + Math.max(0, r.stars - old) * STAR_PARTS;
      f.cleared = Math.max(f.cleared, r.level);
      f.stars[r.level] = Math.max(f.stars[r.level] || 0, r.stars);
      delete f.fails[r.level];
      lines.push(`第 ${r.level} 關　過關 ${'★'.repeat(r.stars)}${'☆'.repeat(3 - r.stars)}　${first ? '首次' : '重玩'} +${Math.round(g)}`);
    } else {
      g = base * FAIL_RATE * r.progress;
      f.fails[r.level] = (f.fails[r.level] || 0) + 1;
      lines.push(`第 ${r.level} 關　失敗（${Math.round(r.progress * 100)}%）　+${Math.round(g)}`);
    }
    gain += g;
  }
  const adj = neighbors(f).length;
  gain = Math.round(gain * (1 + adj * ADJ_BONUS));
  tested = true;
  res[f.part] += gain;
  f.pop = 1;
  burst(isoX(f.x + 1, f.y + 1), isoY(f.x + 1, f.y + 1) - 40, 30, '#fff', 180, 'confetti');
  play('build');
  save();
  const advanced = f.cleared - before;
  const feeUp = progressBonus(f) > feeBefore;
  showModal('試運轉報告', `
    <span class="muted">${f.name}</span>
    <span class="big">${advanced ? `+${advanced}` : '—'}</span>
    <span class="muted">${advanced ? `通關進度：第 ${f.cleared} 關` : `目前通過第 ${f.cleared} 關`}</span><br>
    <span class="gain">${RES[f.part].icon} ${RES[f.part].name} +${gain}</span>
    ${adj ? `<span class="muted">含相鄰設施加成 +${Math.round(adj * ADJ_BONUS * 100)}%</span><br>` : ''}
    <span class="muted">${lines.slice(-5).join('<br>')}</span>
    ${feeUp ? `<br><b>通關 ${Math.floor(f.cleared / LEVEL_FEE.every) * LEVEL_FEE.every} 關！${f.name}收費 +${Math.round((progressBonus(f) - 1) * 100)}%</b>` : ''}
  `);
  openPanel(f);
}

window.addEventListener('message', e => {
  if (e.source !== frame.contentWindow || !labSession) return;
  if (e.data?.type === 'lab:result') labSession.results.push(e.data);
  if (e.data?.type === 'lab:close') closeLab();
});
$('lab-quit').addEventListener('click', () => {
  frame.contentWindow?.postMessage({ type: 'lab:quit' }, '*');
  setTimeout(closeLab, 400);
});

// ---- 點擊、拖曳、縮放 ----
const pointers = new Map();
let drag = null;
canvas.addEventListener('pointerdown', e => {
  unlockAudio();
  canvas.setPointerCapture(e.pointerId);
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (pointers.size === 1) {
    // 搬設施時：按住設施拖曳 = 搬它；按空白處拖曳 = 移動鏡頭
    drag = { x: e.clientX, y: e.clientY, moved: false, ghost: !!moving && boxHit(moving.f, moving.x, moving.y, e.clientX, e.clientY) };
  } else if (drag) drag.moved = true;
});
canvas.addEventListener('pointermove', e => {
  const p = pointers.get(e.pointerId);
  if (!p) return;
  if (pointers.size === 2) {
    const [a, b] = [...pointers.values()];
    const d0 = Math.hypot(a.x - b.x, a.y - b.y);
    p.x = e.clientX; p.y = e.clientY;
    const [c, d] = [...pointers.values()];
    const d1 = Math.hypot(c.x - d.x, c.y - d.y);
    if (d0 > 0) zoomAt((c.x + d.x) / 2, (c.y + d.y) / 2, d1 / d0);
    return;
  }
  const dx = e.clientX - p.x, dy = e.clientY - p.y;
  p.x = e.clientX; p.y = e.clientY;
  if (drag && (drag.moved || Math.hypot(e.clientX - drag.x, e.clientY - drag.y) > 8)) {
    drag.moved = true;
    if (drag.ghost && moving) { moveTo(e.clientX, e.clientY); return; }
    cam.x += dx; cam.y += dy;
    clampCam();
  }
});
const endPointer = e => {
  pointers.delete(e.pointerId);
  if (pointers.size === 0 && drag) {
    if (!drag.moved) tap(e.clientX, e.clientY);
    drag = null;
  }
};
canvas.addEventListener('pointerup', endPointer);
canvas.addEventListener('pointercancel', e => { pointers.delete(e.pointerId); drag = null; });
canvas.addEventListener('wheel', e => { e.preventDefault(); zoomAt(e.clientX, e.clientY, e.deltaY < 0 ? 1.1 : 1 / 1.1); }, { passive: false });

// 設施（放在 x, y 時）在畫面上的範圍有沒有包含這個點
function boxHit(f, x, y, sx, sy) {
  const top = isoY(x, y) - (mode === 'park' ? 70 : boxHeight(f) + 30), bottom = isoY(x + f.w, y + f.h);
  const [x0, y0] = toScreen(isoX(x, y + f.h), top), [x1, y1] = toScreen(isoX(x + f.w, y), bottom);
  return sx >= x0 && sx <= x1 && sy >= y0 && sy <= y1;
}
function facAt(sx, sy) {
  const sorted = FACS.slice().sort((a, b) => b.x + b.y - a.x - a.y);
  return sorted.find(f => boxHit(f, f.x, f.y, sx, sy)) || null;
}
function personAt(sx, sy) {
  let best = null, bd = 16 + 14 * cam.s;
  for (const p of [...guests, ...staff, vendor]) {
    if (p.inRide || p.fading) continue;
    const [x, y] = toScreen(isoX(p.x, p.y), isoY(p.x, p.y) - p.z - 14);
    const d = Math.hypot(sx - x, sy - y);
    if (d < bd) { bd = d; best = p; }
  }
  return best;
}
function tap(sx, sy) {
  if (trans) return;
  if (moving) { moveTo(sx, sy); return; }
  if (mode === 'park') {
    const p = personAt(sx, sy);
    if (p) { poke(p); return; }
  }
  const f = facAt(sx, sy);
  if (f) { play('tap'); openPanel(f); return; }
  if (selected) closePanel();
}

// ================= 開始 =================
document.addEventListener('visibilitychange', () => {
  suspendAudio(document.hidden);
  if (document.hidden) save();
});
window.addEventListener('pagehide', save);

// 一開始就放幾個遊客進來，讓樂園不是空的
for (let k = 0; k < 6; k++) {
  spawnGuest();
  const g = guests[guests.length - 1];
  const [i, j] = pick([[8, 5], [8, 9], [5, 8], [11, 8], [8, 13], [4, 6], [12, 10], [6, 12]]);
  g.x = i + 0.5 + g.lane; g.y = j + 0.5;
  if (g.state === 'walk') { const cb = g.onArrive, r = g.route[g.route.length - 1]; walkTo(g, r[0], r[1], cb); }
}

if (firstVisit) {
  showModal('歡迎來到浮島樂園！', `
    遊客會自己來玩設施、付 ${RES.coin.icon} 遊客幣。<br>
    到下方的 <b>🔧 試驗場</b> 試運轉設施（就是玩小遊戲），<br>拿零件來升級，樂園就會越來越熱鬧。
  `, '開始');
} else {
  const away = Math.min((Date.now() - lastSeen) / 1000, OFFLINE_CAP_H * 3600);
  const gain = Math.round((away / (OFFLINE_CAP_H * 3600)) * OFFLINE_FULL_MIN * 60 * liveRate());
  if (away > 60 && gain > 0) {
    res.coin += gain;
    showModal('歡迎回來！', `
      你不在的時候，遊客還是照常來玩。
      <span class="gain">${RES.coin.icon} +${fmt(gain)}</span>
      <span class="muted">離線收入最多累積 ${OFFLINE_CAP_H} 小時</span>
    `);
  }
}
save();

let last = performance.now();
function frameLoop(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  if (!document.hidden) update(dt);
  if (!labOpen) { render(); refreshHud(); }
  requestAnimationFrame(frameLoop);
}
requestAnimationFrame(frameLoop);
