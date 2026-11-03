// 廣告介面。網頁版先用假的實作；之後用 Capacitor 包成 App 時，
// 只要把這裡換成 AdMob 外掛的呼叫，遊戲本身不用改。

const INTERSTITIAL_EVERY = 3;       // 每 3 局最多一次插頁廣告
const INTERSTITIAL_GAP_MS = 120000; // 而且至少間隔 2 分鐘

let runs = 0;
let lastInterstitial = 0;
let removed = false;
try { removed = localStorage.getItem('prism.noads') === '1'; } catch {}

const wait = ms => new Promise(r => setTimeout(r, ms));

export const Ads = {
  get removed() { return removed; },

  // 玩家自己選擇看的激勵廣告；回傳 true 代表看完、可以給獎勵
  async showRewarded() {
    console.info('[ads] 激勵廣告（測試用：直接給獎勵）');
    await wait(400);
    return true;
  },

  // 每局結束時呼叫，依頻率限制決定要不要放插頁廣告
  async onRunEnd() {
    runs++;
    if (removed) return;
    const now = Date.now();
    if (runs % INTERSTITIAL_EVERY !== 0 || now - lastInterstitial < INTERSTITIAL_GAP_MS) return;
    lastInterstitial = now;
    console.info('[ads] 插頁廣告（測試用：略過）');
  },
};
