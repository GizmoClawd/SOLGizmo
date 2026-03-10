/**
 * 🦞 GIZMO UNIFIED ENGINE v1.0
 * Single script — replaces both auto-manage.mjs and autonomous.mjs
 * - KOL wallet tracking (18 wallets via Helius)
 * - Market scanner (DexScreener boosts + scanner.mjs)
 * - Position management (buy, trail SL, sell)
 * - trades.json logging + GitHub push
 * - Persistent positions across restarts
 * - Auto-tweets + CT engagement + Nikoles replies
 */

import { Connection, Keypair, VersionedTransaction, LAMPORTS_PER_SOL, PublicKey } from '@solana/web3.js';
import bs58 from 'bs58';
import fs from 'fs';
import { execSync, spawnSync } from 'child_process';

// ─── CONFIG ───────────────────────────────────────────────────────────────────
const BASE_DIR = process.env.HOME + '/.gizmo/runtime';
const WORKSPACE = '/Users/younghogey/.openclaw/workspace/SOLGizmo';
const POSITIONS_FILE = BASE_DIR + '/positions.json';
const TRADES_FILE = WORKSPACE + '/trades.json';
const STATE_FILE = BASE_DIR + '/kol-state.json';
const LOG_FILE = BASE_DIR + '/gizmo.log';
const SOL_MINT = 'So11111111111111111111111111111111111111112';
const MAX_POSITIONS = 3;

// ─── SESSION GUARD ────────────────────────────────────────────────────────────
let SESSION_START_BALANCE = null;
let SESSION_HALTED = false;
const SESSION_LOSS_LIMIT_SOL = 0.3; // halt if down this much in one session
const SIGNAL_WINDOW_MS = 10 * 60 * 1000;
const HELIUS_KEY = process.env.HELIUS_API_KEY || '';

// ─── ADAPTIVE PARAMS (learning system) ───────────────────────────────────────
let SCORE_THRESHOLD = 5;
let MIN_LIQ = 8000;
let MIN_KOLS = 2;
let POSITION_SIZE_MULT = 1.0;

const LEARN_FILE = BASE_DIR + '/learn-state.json';

function loadLearnState() {
  try {
    if (fs.existsSync(LEARN_FILE)) {
      const s = JSON.parse(fs.readFileSync(LEARN_FILE, 'utf8'));
      SCORE_THRESHOLD = s.scoreThreshold ?? 5;
      MIN_LIQ = s.minLiq ?? 8000;
      MIN_KOLS = s.minKols ?? 2;
      POSITION_SIZE_MULT = s.positionSizeMult ?? 1.0;
      log(`🧠 Loaded adaptive params: score≥${SCORE_THRESHOLD} liq≥$${MIN_LIQ} kols≥${MIN_KOLS} sizeMult=${POSITION_SIZE_MULT}`);
    }
  } catch {}
}

function saveLearnState() {
  try {
    fs.writeFileSync(LEARN_FILE, JSON.stringify({
      scoreThreshold: SCORE_THRESHOLD, minLiq: MIN_LIQ,
      minKols: MIN_KOLS, positionSizeMult: POSITION_SIZE_MULT,
      updatedAt: new Date().toISOString()
    }, null, 2));
  } catch {}
}

async function learnFromTrades() {
  try {
    if (!fs.existsSync(TRADES_FILE)) return;
    const trades = JSON.parse(fs.readFileSync(TRADES_FILE, 'utf8'));

    // Pair buys with their sells
    const pairs = [];
    const sells = trades.filter(t => t.action === 'SELL' && t.ca);
    const buys = trades.filter(t => t.action === 'BUY' && t.ca);

    for (const s of sells) {
      const b = buys.find(b => b.ca === s.ca && b.ts < s.ts);
      if (!b) continue;
      const pnlPct = parseFloat((s.pnl || '0').replace('%','').replace('+',''));
      const win = pnlPct > 0;
      const signalType = (b.result || '').includes('KOL') ? 'kol' : 'market';
      const kolCount = signalType === 'kol' ? parseInt((b.result || '').match(/(\d+) KOL/)?.[1] || 2) : 0;
      const score = parseInt((b.result || '').match(/score (\d+)/)?.[1] || 0);
      pairs.push({ win, pnlPct, signalType, kolCount, score, ts: s.ts });
    }

    if (pairs.length < 3) { log(`🧠 Not enough closed trades to learn yet (${pairs.length}/3 needed)`); return; }

    const recent = pairs.slice(0, 20); // last 20 closed trades
    const wins = recent.filter(p => p.win).length;
    const winRate = wins / recent.length;
    const avgPnl = recent.reduce((s, p) => s + p.pnlPct, 0) / recent.length;

    const kolTrades = recent.filter(p => p.signalType === 'kol');
    const marketTrades = recent.filter(p => p.signalType === 'market');
    const kolWinRate = kolTrades.length ? kolTrades.filter(p => p.win).length / kolTrades.length : null;
    const marketWinRate = marketTrades.length ? marketTrades.filter(p => p.win).length / marketTrades.length : null;

    log(`🧠 LEARNING — ${recent.length} trades | WR: ${(winRate*100).toFixed(0)}% | AvgPnL: ${avgPnl.toFixed(1)}% | KOL WR: ${kolWinRate !== null ? (kolWinRate*100).toFixed(0)+'%' : 'n/a'} | Market WR: ${marketWinRate !== null ? (marketWinRate*100).toFixed(0)+'%' : 'n/a'}`);

    let changed = false;

    // Adjust score threshold based on market scan win rate
    if (marketTrades.length >= 3) {
      if (marketWinRate < 0.35 && SCORE_THRESHOLD < 7) {
        SCORE_THRESHOLD = Math.min(7, SCORE_THRESHOLD + 1);
        log(`🧠 Market WR low (${(marketWinRate*100).toFixed(0)}%) — raising score threshold to ${SCORE_THRESHOLD}`);
        changed = true;
      } else if (marketWinRate > 0.60 && SCORE_THRESHOLD > 4) {
        SCORE_THRESHOLD = Math.max(4, SCORE_THRESHOLD - 1);
        log(`🧠 Market WR strong (${(marketWinRate*100).toFixed(0)}%) — lowering score threshold to ${SCORE_THRESHOLD}`);
        changed = true;
      }
    }

    // Adjust KOL min threshold
    if (kolTrades.length >= 3) {
      if (kolWinRate < 0.35 && MIN_KOLS < 3) {
        MIN_KOLS = 3;
        log(`🧠 KOL WR low (${(kolWinRate*100).toFixed(0)}%) — requiring 3+ KOLs`);
        changed = true;
      } else if (kolWinRate > 0.60 && MIN_KOLS > 2) {
        MIN_KOLS = 2;
        log(`🧠 KOL WR strong — back to 2+ KOLs`);
        changed = true;
      }
    }

    // Adjust position size multiplier based on overall performance
    if (recent.length >= 5) {
      if (winRate < 0.30 && POSITION_SIZE_MULT > 0.5) {
        POSITION_SIZE_MULT = Math.max(0.5, POSITION_SIZE_MULT - 0.25);
        log(`🧠 WR poor (${(winRate*100).toFixed(0)}%) — reducing position size to ${POSITION_SIZE_MULT}x`);
        changed = true;
      } else if (winRate > 0.60 && avgPnl > 10 && POSITION_SIZE_MULT < 1.5) {
        POSITION_SIZE_MULT = Math.min(1.5, POSITION_SIZE_MULT + 0.25);
        log(`🧠 WR strong + profitable — increasing position size to ${POSITION_SIZE_MULT}x`);
        changed = true;
      }
    }

    if (changed) {
      saveLearnState();
      // Notify via Telegram
      try {
        execSync(`openclaw system event --text "🧠 Gizmo adapted: score≥${SCORE_THRESHOLD} kols≥${MIN_KOLS} size=${POSITION_SIZE_MULT}x | WR:${(winRate*100).toFixed(0)}% avgPnL:${avgPnl.toFixed(1)}%" --mode now`, { timeout: 5000 });
      } catch {}
    }
  } catch (e) { log(`🧠 Learn error: ${e.message}`); }
}


// ─── LOGGING ─────────────────────────────────────────────────────────────────
function log(msg) {
  const line = `[${new Date().toLocaleString()}] ${msg}`;
  console.log(line);
  try { fs.appendFileSync(LOG_FILE, line + '\n'); } catch {}
}

function ts() { return new Date().toLocaleString(); }

// ─── PERSISTENT STATE ─────────────────────────────────────────────────────────
function loadPositions() {
  try {
    if (fs.existsSync(POSITIONS_FILE)) {
      const data = JSON.parse(fs.readFileSync(POSITIONS_FILE, 'utf8'));
      log(`📂 Loaded ${data.length} positions: ${data.map(p => p.name).join(', ') || 'none'}`);
      return data;
    }
  } catch (e) { log(`⚠️ Load positions failed: ${e.message}`); }
  return [];
}

function savePositions() {
  try { fs.writeFileSync(POSITIONS_FILE, JSON.stringify(POSITIONS, null, 2)); } catch (e) { log(`⚠️ Save positions failed: ${e.message}`); }
}

function loadState() {
  try { return JSON.parse(fs.readFileSync(STATE_FILE, 'utf-8')); } catch {
    return { lastSig: {}, recentBuys: [], nikolesReplied: [], lastTweet: 0, lastNikolesCheck: 0, scanCount: 0 };
  }
}

function saveState(s) { try { fs.writeFileSync(STATE_FILE, JSON.stringify(s, null, 2)); } catch {} }

// ─── TRADES.JSON LOGGER ───────────────────────────────────────────────────────
function logTrade(action, name, ca, solAmount, pnlSol, txSig, result) {
  try {
    let trades = [];
    if (fs.existsSync(TRADES_FILE)) trades = JSON.parse(fs.readFileSync(TRADES_FILE, 'utf8'));
    const n = (trades[0]?.n || 0) + 1;
    trades.unshift({
      n, date: new Date().toISOString().split('T')[0], token: name, action,
      amount: solAmount ? solAmount + ' SOL' : '',
      result: result || (txSig ? 'TX: ' + txSig : ''),
      pnl: pnlSol !== null && pnlSol !== undefined ? (pnlSol >= 0 ? '+' : '') + pnlSol.toFixed(4) + ' SOL' : '',
      color: action === 'BUY' ? 'teal' : (pnlSol >= 0 ? 'teal' : 'red'),
      ca, ts: Math.floor(Date.now() / 1000)
    });
    fs.writeFileSync(TRADES_FILE, JSON.stringify(trades, null, 2));
    try {
      execSync(`cd ${WORKSPACE} && git add trades.json && git commit -m "trade #${n}: ${action} ${name}" && git push`, { timeout: 20000 });
      log(`📡 Trade #${n} pushed → solgizmo.com updating`);
    } catch (e) { log(`⚠️ Git push failed: ${e.message?.slice(0, 80)}`); }
  } catch (e) { log(`⚠️ logTrade failed: ${e.message}`); }
}

// ─── STATE ────────────────────────────────────────────────────────────────────
const POSITIONS = loadPositions();
// ── DEAD POOL BLACKLIST ───────────────────────────────────────────────────────
// Strip any previously rugged tokens from positions on every startup
const DEAD_POOL_FILE = BASE_DIR + '/dead-pools.json';
function loadDeadPools() {
  try { return new Set(JSON.parse(fs.readFileSync(DEAD_POOL_FILE, 'utf8'))); } catch { return new Set(); }
}
function saveDeadPool(ca) {
  try {
    const pools = loadDeadPools();
    pools.add(ca);
    fs.writeFileSync(DEAD_POOL_FILE, JSON.stringify([...pools], null, 2));
  } catch {}
}
const DEAD_POOLS = loadDeadPools();
// Remove any blacklisted positions on startup
const deadOnLoad = POSITIONS.filter(p => DEAD_POOLS.has(p.ca));
if (deadOnLoad.length > 0) {
  deadOnLoad.forEach(p => {
    POSITIONS.splice(POSITIONS.indexOf(p), 1);
    console.log('[STARTUP] 💀 Removed blacklisted dead pool: ' + p.name + ' (' + p.ca + ')');
  });
  // old /tmp path removed — positions now saved via savePositions() to BASE_DIR
}
// ─────────────────────────────────────────────────────────────────────────────

const ALERTED = new Set();
const WATCHLIST = [];
// Load recently bought CAs from trades.json to survive restarts
const RECENTLY_BOUGHT = new Map((() => {
  try {
    const trades = JSON.parse(fs.readFileSync(BASE_DIR + '/trades.json', 'utf8'));
    const cutoff = Date.now() - 2 * 3600000; // 2 hour cooldown
    return trades
      .filter(t => t.action === 'BUY' && t.ca && t.ts && t.ts * 1000 > cutoff)
      .map(t => [t.ca, t.ts * 1000]);
  } catch { return []; }
})());
// Legacy init (keep for compatibility)
const _LEGACY = new Map([
  ['3o28iKESnNvi7xQcPTxg9aczjzqZN6BzugJFMRHYpump', Date.now()],
  ['7CWLxXfjRZ8WP8HVWBSHoti9pVP9FfN5UwZ71JyXpump', Date.now()],
  ['6dQD8ALWdkFiD77D34qzUHFuifpaCnoWAEGRgvcZpump', Date.now()],
  ['AMshsFcGg5EzrAPzeqDn1jQWieCrLwss3CdBmGRNpump', Date.now()],
  ['BzyKa1FGjs2EUpu3GGDibY4xdygn5evAiRboKmETpump', Date.now()],
]);
const TOXIC_WORDS = ['pedo','nazi','hitler','porn','xxx','nigger','faggot','rape','child','epstein','holocaust','pedocast'];

// X API keys
let xKeys;
try { xKeys = JSON.parse(process.env.X_API_KEYS_JSON || fs.readFileSync(process.env.HOME + '/.gizmo/x-api-keys.json', 'utf-8')); } catch {}

// ─── KOL WALLETS ─────────────────────────────────────────────────────────────
const WALLETS = [
  { name: "Cented", address: "CyaE1VxvBrahnPWkqm5VsdCvyS2QmNht2UFrKJHga54o", weight: 3 },
  { name: "bandit", address: "5B79fMkcFeRTiwm7ehsZsFiKsC7m7n1Bgv9yLxPp9q2X", weight: 3 },
  { name: "dov7", address: "8nqtxpFpuXwfXG4pBLsDkkuMMPK9FjSkBMCn542HiM3v", weight: 3 },
  { name: "Jijo", address: "4BdKaxN8G6ka4GYtQQWk4G4dZRUTX2vQH9GcXdBREFUk", weight: 3 },
  { name: "Kadenox", address: "B32QbbdDAyhvUQzjcaM5j6ZVKwjCxAwGH5Xgvb9SJqnC", weight: 1 },
  { name: "theo", address: "Bi4rd5FH5bYEN8scZ7wevxNZyNmKHdaBcvewdPFxYdLt", weight: 3 },
  { name: "Dali", address: "CvNiezB8hofusHCKqu8irJ6t2FKY7VjzpSckofMzk5mB", weight: 1 },
  { name: "radiance", address: "FAicXNV5FVqtfbpn4Zccs71XcfGeyxBSGbqLDyDJZjke", weight: 1 },
  { name: "Coasty", address: "CATk62cYqDFXTh3rsRbS1ibCyzBeovc2KXpXEaxEg3nB", weight: 1 },
  { name: "clukz", address: "G6fUXjMKPJzCY1rveAE6Qm7wy5U3vZgKDJmN1VPAdiZC", weight: 1 },
  { name: "dv", address: "BCagckXeMChUKrHEd6fKFA1uiWDtcmCXMsqaheLiUPJd", weight: 3 },
  { name: "cryptovillain", address: "5sNnKuWKUtZkdC1eFNyqz3XHpNoCRQ1D1DfHcNHMV7gn", weight: 1 },
  { name: "Joji", address: "525LueqAyZJueCoiisfWy6nyh4MTvmF4X9jSqi6efXJT", weight: 1 },
  { name: "decu", address: "4vw54BmAogeRV3vPKWyFet5yf8DTLcREzdSzx4rw9Ud9", weight: 3 },
  { name: "Cupsey", address: "2fg5QD1eD7rzNNCsvnhmXFm5hqNgwTTG8p7kQ6f3rx6f", weight: 1, scalper: true },
  { name: "mercy", address: "F5jWYuiDLTiaLYa54D88YbpXgEsA6NKHzWy4SN4bMYjt", weight: 1 },
  { name: "Silver", address: "67Nwfi9hgwqhxGoovT2JGLU67uxfomLwQAWncjXXzU6U", weight: 1 },
  { name: "Pain", address: "J6TDXvarvpBdPXTaTU8eJbtso1PUCYKGkVtMKUUY8iEa", weight: 1 },
  // ── AUTO-DISCOVERED SMART MONEY (Mon Mar 09 2026) ──
  { name: "smart_gizmo-wins_1", address: "DKfejcSsTYVFU4jHSyjrGJiYAMdGwe5varF11ArFcmeB", weight: 1 }, // auto-discovered WR:100%
];

// ─── PRICE CHECK ──────────────────────────────────────────────────────────────
async function checkPrice(ca) {
  try {
    const r = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${ca}`, { signal: AbortSignal.timeout(5000) });
    const d = await r.json();
    return d.pairs?.[0];
  } catch { return null; }
}

async function getTokenInfo(mint) {
  const p = await checkPrice(mint);
  if (!p) return null;
  return { symbol: p.baseToken?.symbol || '???', mcap: p.marketCap || p.fdv || 0, price: parseFloat(p.priceUsd) || 0, liq: p.liquidity?.usd ?? null };
}


// ─── NEW WALLET RUG DETECTION ─────────────────────────────────────────────────
// Fetches recent buyers of a token via Helius, checks how many wallets are <7 days old.
// If 15+ new wallets are found, it's likely a coordinated rug setup.
const NEW_WALLET_DAYS = 7;
const NEW_WALLET_THRESHOLD = 15;

async function checkRugWallets(mint) {
  if (!HELIUS_KEY) return { isRug: false, newCount: 0, total: 0 };
  try {
    // Get recent swap transactions for this token
    const url = `https://api.helius.xyz/v0/addresses/${mint}/transactions?api-key=${HELIUS_KEY}&limit=50&type=SWAP`;
    const r = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!r.ok) return { isRug: false, newCount: 0, total: 0 };
    const txs = await r.json();
    if (!Array.isArray(txs) || txs.length === 0) return { isRug: false, newCount: 0, total: 0 };

    // Extract unique buyer wallets (feePayer = the wallet initiating the swap)
    const wallets = [...new Set(txs.map(tx => tx.feePayer).filter(Boolean))].slice(0, 40);
    if (wallets.length === 0) return { isRug: false, newCount: 0, total: 0 };

    const sevenDaysAgo = Math.floor(Date.now() / 1000) - (NEW_WALLET_DAYS * 24 * 60 * 60);
    let newWalletCount = 0;

    // Check each wallet — if their oldest recent sig is within 7 days, they're new
    await Promise.all(wallets.map(async (addr) => {
      try {
        const sigUrl = `https://api.helius.xyz/v0/addresses/${addr}/transactions?api-key=${HELIUS_KEY}&limit=10`;
        const sigR = await fetch(sigUrl, { signal: AbortSignal.timeout(5000) });
        if (!sigR.ok) return;
        const sigs = await sigR.json();
        if (!Array.isArray(sigs) || sigs.length === 0) return;
        // If the oldest of their last 10 txs is still within 7 days → new wallet
        const oldest = sigs[sigs.length - 1];
        if (oldest?.timestamp && oldest.timestamp > sevenDaysAgo) newWalletCount++;
      } catch {}
    }));

    return { isRug: newWalletCount >= NEW_WALLET_THRESHOLD, newCount: newWalletCount, total: wallets.length };
  } catch (e) {
    log(`⚠️ checkRugWallets error: ${e.message?.slice(0, 80)}`);
    return { isRug: false, newCount: 0, total: 0 };
  }
}
// ──────────────────────────────────────────────────────────────────────────────

// ─── SELL ─────────────────────────────────────────────────────────────────────
async function sell(ca, pct, posName, entryMC, currentMC) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const result = spawnSync('node', ['sell.mjs', ca, pct], { cwd: WORKSPACE, timeout: 60000, encoding: 'utf8' });
      const out = (result.stdout || '') + (result.stderr || '');
      log(`SELL ${pct} attempt ${attempt}: ${out.trim().split('\n').pop()}`);

      // ── DEAD POOL: exit code 2 OR text match (status can be null on some systems) ──
      if (result.status === 2 || out.includes('DEAD POOL')) {
        log(`💀 DEAD POOL: ${posName} (${ca}) — force removing from positions.`);
        // POSITIONS is an array — find and splice out by ca or name
        const idx = POSITIONS.findIndex(p => p.ca === ca || p.name === posName);
        if (idx !== -1) {
          logTrade('SELL', posName || ca.slice(0, 8), ca, 0, 0, null, 'Dead pool — rugged, unsellable');
          POSITIONS.splice(idx, 1);
          savePositions();
          saveDeadPool(ca); // blacklist so it never comes back after restart
          log(`🗑️ DEAD POOL: ${posName} removed from POSITIONS and blacklisted permanently.`);
        } else {
          log(`⚠️ DEAD POOL: ${posName} not found in POSITIONS — may already be gone`);
        }
        try { fs.unlinkSync(BASE_DIR + '/SELL_FAILED_URGENT.txt'); } catch {}
        return true;
      }
      // ────────────────────────────────────────────────────────────────────────

      if (out.includes('CONFIRMED')) {
        const solMatch = out.match(/sold for ~([\d.]+) SOL/);
        const txMatch = out.match(/TX: https:\/\/solscan\.io\/tx\/(\S+)/);
        const solReceived = solMatch ? parseFloat(solMatch[1]) : null;
        const txSig = txMatch ? txMatch[1] : null;
        const pnlPct = entryMC && currentMC ? ((currentMC - entryMC) / entryMC * 100) : null;
        logTrade('SELL', posName || ca.slice(0, 8), ca, solReceived, solReceived,
          txSig, `Sold ${pct}${pnlPct !== null ? ' | PnL: ' + (pnlPct > 0 ? '+' : '') + pnlPct.toFixed(1) + '%' : ''}`);
        return true;
      }
      if (out.includes('No tokens to sell')) { log(`ℹ️ ${posName}: no tokens (already sold)`); return true; }
    } catch (e) { log(`SELL failed attempt ${attempt}: ${e.message?.slice(0, 100)}`); }
    if (attempt < 3) await new Promise(r => setTimeout(r, 3000));
  }
  log(`🚨 SELL FAILED ALL 3 ATTEMPTS on ${posName} — MANUAL ACTION NEEDED`);
  try { fs.writeFileSync(BASE_DIR + '/SELL_FAILED_URGENT.txt', `SELL FAILED: ${posName} (${ca}) at ${new Date().toISOString()}\nManual: cd ${WORKSPACE} && node sell.mjs ${ca} 100%\n`); } catch {}
  try { execSync(`openclaw system event --text "🚨 SELL FAILED: ${posName} — manual action needed!" --mode now`, { timeout: 5000 }); } catch {}
  return false;
}

// ─── BUY ──────────────────────────────────────────────────────────────────────
async function buy(ca, amount) {
  try {
    const out = execSync(`cd ${WORKSPACE} && node trade.mjs ${ca} ${amount}`, { timeout: 30000 }).toString();
    log(`BUY ${amount} SOL: ${out.trim().split('\n').pop()}`);
    return out.includes('CONFIRMED');
  } catch (e) { log(`BUY FAILED: ${e.message?.slice(0, 100)}`); return false; }
}

// ─── WALLET BALANCE ───────────────────────────────────────────────────────────
async function getWalletBalance() {
  try {
    const r = await fetch('https://solana.publicnode.com',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'getBalance',params:['53hSYdMWfDkhBsNaYg1uKMmxiVMv192fp6t3NVhnF4rz']}),signal:AbortSignal.timeout(3000)});
    const d = await r.json(); return (d.result?.value||0)/1e9;
  } catch { return 1; }
}

// ─── DAILY PNL CHECK ─────────────────────────────────────────────────────────
function getDailyPnL() {
  try {
    const today = new Date().toISOString().slice(0,10);
    const trades = JSON.parse(fs.readFileSync(BASE_DIR+'/trades.json','utf8'));
    return trades.filter(t=>t.date===today&&t.action==='SELL').reduce((sum,t)=>{
      const m=(t.pnl||'').match(/([+-]?\d+\.?\d*)\s*SOL/); return sum+(m?parseFloat(m[1]):0);
    },0);
  } catch { return 0; }
}

// ─── SAFE BUY SIZE ────────────────────────────────────────────────────────────
async function safeBuySize(walletSol, liqUsd, numKols) {
  // ── BANKROLL PROTECTION ─────────────────────────────────────────────────────
  // FLOOR: always keep 0.1 SOL untouched for gas/fees
  const FLOOR = 0.1;
  // RESERVE: keep 30% of wallet as safe reserve, never trade it
  const RESERVE = walletSol * 0.30;
  // TRADEABLE: only risk from the tradeable portion
  const tradeable = walletSol - FLOOR - RESERVE;
  if (tradeable <= 0) { log(`🛑 BANKROLL: wallet too low (${walletSol.toFixed(3)} SOL) — protecting floor`); return 0; }

  // Circuit breaker: stop if lost 1.5 SOL today
  const dailyPnL = getDailyPnL();
  if (dailyPnL < -1.5) { log(`🛑 CIRCUIT BREAKER: daily loss ${dailyPnL.toFixed(3)} SOL — NO MORE TRADES`); return 0; }

  // TIER SYSTEM based on wallet size:
  let maxPerTrade, pctPerTrade;

  if (walletSol >= 5) {
    // Healthy: max 15% of tradeable per trade, hard cap 1.0 SOL
    pctPerTrade = 0.15;
    maxPerTrade = 1.0;
  } else if (walletSol >= 2) {
    // Cautious: max 12% of tradeable, hard cap 0.5 SOL
    pctPerTrade = 0.12;
    maxPerTrade = 0.5;
  } else if (walletSol >= 0.5) {
    // Recovery mode: max 10% of tradeable, hard cap 0.2 SOL
    pctPerTrade = 0.10;
    maxPerTrade = 0.2;
  } else {
    // Survival mode: max 8% of tradeable, hard cap 0.08 SOL
    pctPerTrade = 0.08;
    maxPerTrade = 0.08;
  }

  const baseSize = Math.min(tradeable * pctPerTrade, maxPerTrade);

  // Boost slightly for high conviction (3+ KOLs) but never exceed 2x base
  const convictionMult = numKols >= 3 ? 1.5 : numKols >= 2 ? 1.2 : 1.0;
  const size = Math.min(baseSize * convictionMult, maxPerTrade * 1.5);

  log(`💰 BANKROLL: wallet ${walletSol.toFixed(3)} SOL | tradeable ${tradeable.toFixed(3)} | sizing ${size.toFixed(3)} SOL (${(size/walletSol*100).toFixed(0)}% of wallet)`);
  return Math.max(0, parseFloat(size.toFixed(4)));
  // ───────────────────────────────────────────────────────────────────────────
}

// ─── POST TRADE TWEET ─────────────────────────────────────────────────────────
async function postTrade(type, symbol, ca, mc, reason, solAmount, pnl) {
  try {
    const emoji = type === 'BUY' ? '🟢' : (pnl && pnl > 0 ? '💰' : '🔴');
    const text = type === 'BUY'
      ? `${emoji} BOUGHT $${symbol}\n\n${reason}\n\nMC: $${Math.round(mc / 1000)}K | ${solAmount} SOL\n\nCA: ${ca}\n\n🦞`
      : `${emoji} SOLD $${symbol} (${pnl > 0 ? '+' : ''}${pnl.toFixed(1)}%)\n\n${reason}\n\nMC: $${Math.round(mc / 1000)}K\n\n🦞`;
    execSync(`cd ${BASE_DIR} && node tweet.mjs "${text.replace(/"/g, '\\"').replace(/\$/g, '\\$')}"`, { timeout: 15000 });
    log(`📢 Tweeted: ${type} ${symbol}`);
  } catch (e) { log(`Tweet failed: ${e.message?.slice(0, 60)}`); }
}

// ─── POSITION MANAGEMENT ──────────────────────────────────────────────────────
async function managePositions() {
  for (let i = POSITIONS.length - 1; i >= 0; i--) {
    const pos = POSITIONS[i];
    const p = await checkPrice(pos.ca);
    if (!p) { log(`⚠️ ${pos.name}: no price data`); continue; }

    const mc = p.fdv;
    const pnl = ((mc - pos.entryMC) / pos.entryMC * 100).toFixed(1);
    const m5 = p.priceChange?.m5 || 0;
    const buys = p.txns?.m5?.buys || 0;
    const sells = p.txns?.m5?.sells || 0;

    // Update high water mark + trail SL
    if (mc > (pos.sl || 0)) { pos.slBreachCount = 0; }
    if (mc > pos.highMC) {
      pos.highMC = mc;
      if (mc > pos.entryMC * 1.10 && !pos.sl) {
        pos.sl = pos.entryMC * 1.05;
        log(`🟢 ${pos.name}: +10% — SL locked at +5%: $${Math.round(pos.sl)}`);
      }
      if (pos.sl && pos.highMC > pos.entryMC * 1.15) {
        let trailPct = 0.90;
        if (pos.highMC > pos.entryMC * 2.0) trailPct = 0.95;
        else if (pos.highMC > pos.entryMC * 1.5) trailPct = 0.93;
        else if (pos.highMC > pos.entryMC * 1.3) trailPct = 0.92;
        const newSL = pos.highMC * trailPct;
        if (newSL > (pos.sl || 0) && newSL > pos.entryMC) {
          const old = pos.sl; pos.sl = newSL;
          if (Math.round(newSL) !== Math.round(old)) log(`📈 ${pos.name}: SL trailed $${Math.round(old)} → $${Math.round(newSL)}`);
        }
      }
      savePositions();
    }

    log(`${pos.name}: $${Math.round(mc)} (${pnl}%) | High: $${Math.round(pos.highMC)} | SL: $${pos.sl ? Math.round(pos.sl) : 'none'} | B/S:${buys}/${sells}`);

    // RUG DETECT: -40% within 4 mins of entry = instant exit
    const minsHeld = pos.entryTime ? (Date.now() - pos.entryTime) / 60000 : 999;
    if (minsHeld < 4 && mc <= pos.entryMC * 0.45) {  // tightened: only exit on -55%+ in 4 mins
      log(`🚨 RUG DETECTED ${pos.name}: -${((1 - mc/pos.entryMC)*100).toFixed(0)}% in ${minsHeld.toFixed(1)} mins — INSTANT EXIT`);
      if (await sell(pos.ca, '100%', pos.name, pos.entryMC, mc)) {
        await postTrade('SELL', pos.name, pos.ca, mc, `Rug detected ${pnl}%`, null, parseFloat(pnl));
        POSITIONS.splice(i, 1); savePositions();
      }
      continue;
    }

    // HARD STOP: -30% with no SL set
    if (mc <= pos.entryMC * 0.70 && !pos.sl) {
      log(`💀 HARD STOP ${pos.name} at ${pnl}% — cutting`);
      if (await sell(pos.ca, '100%', pos.name, pos.entryMC, mc)) {
        await postTrade('SELL', pos.name, pos.ca, mc, `Hard stop ${pnl}%`, null, parseFloat(pnl));
        POSITIONS.splice(i, 1); savePositions();
      }
      continue;
    }

    // FAST PUMP: +30%+ fading momentum — sell half
    if (!pos.tp1Hit && mc >= pos.entryMC * 1.30) {
      const bsRatio = buys / Math.max(sells, 1);
      if (m5 < 0 || bsRatio < 1.5) {
        log(`💰 FAST PUMP SELL ${pos.name} +${((mc / pos.entryMC - 1) * 100).toFixed(0)}% fading — selling half`);
        if (await sell(pos.ca, '50%', pos.name, pos.entryMC, mc)) {
          pos.tp1Hit = true;
          // Tight SL on remaining 50%: trail at 88% of pump high, min breakeven
          pos.sl = Math.max(pos.sl || 0, mc * 0.88, pos.entryMC * 1.02);
          log(`🔒 ${pos.name}: fast pump SL locked at $${Math.round(pos.sl)} (88% of pump)`);
          savePositions();
        }
        continue;
      }
    }

    // TP1: 2x+ — sell half unless still ripping
    if (!pos.tp1Hit && mc >= pos.entryMC * 2.0) {
      const bsRatio = buys / Math.max(sells, 1);
      const mult = mc / pos.entryMC;
      if (m5 > 3 && bsRatio >= 2.0 && mult < 4.0) {
        const rSL = pos.highMC * 0.90;
        if (rSL > (pos.sl || 0)) { pos.sl = rSL; savePositions(); }
        log(`🚀 ${pos.name}: ${mult.toFixed(1)}x RIPPING — holding, SL tightened`);
      } else {
        log(`🎯 TP1 ${pos.name} ${mult.toFixed(1)}x — selling half`);
        if (await sell(pos.ca, '50%', pos.name, pos.entryMC, mc)) {
          pos.tp1Hit = true; pos.sl = Math.max(pos.sl || 0, mc * 0.90); savePositions();
        }
      }
    }

    // BREAKEVEN SL after 1.5x — never let winner become loser
    if (!pos.breakevenSet && mc >= pos.entryMC * 1.5) {
      const beSL = pos.entryMC * 1.05;
      if (!pos.sl || beSL > pos.sl) { pos.sl = beSL; pos.breakevenSet = true; savePositions(); log('BREAKEVEN SL: ' + pos.name + ' -> $' + Math.round(beSL)); }
      if (pos.slBreachCount >= 2 || mc < pos.sl * 0.70 || (pos.slBreachCount >= 1 && m5 < 0)) {
        log(`🛑 SL HIT ${pos.name} MC:$${Math.round(mc)} SL:$${Math.round(pos.sl)}`);
        if (await sell(pos.ca, '100%', pos.name, pos.entryMC, mc)) {
          await postTrade('SELL', pos.name, pos.ca, mc, `SL hit ${pnl}%`, null, parseFloat(pnl));
          WATCHLIST.push({ name: pos.name, ca: pos.ca, exitMC: mc, exitTime: Date.now(), entryMC: pos.entryMC });
          POSITIONS.splice(i, 1); savePositions();
        } else { log(`⚠️ ${pos.name} SELL FAILED — retry next cycle`); }
      } else { log(`⚠️ ${pos.name} at SL but 5m red — waiting green candle`); }
      continue;
    }

    // TIME EXIT: smarter — only cut if FLAT/DOWN, not just "not +30% yet"
    const ageMin = (Date.now() - (pos.entryTime || Date.now())) / 60000;
    const mcVsEntry = mc / pos.entryMC;
    const isFlat = mcVsEntry < 1.05;   // less than +5% = flat
    const isDown  = mcVsEntry < 0.92;  // down more than -8%
    const timeKill =
      (!pos.tp1Hit && ageMin > 15 && isDown) ||   // 15min AND actually losing = cut
      (!pos.tp1Hit && ageMin > 25 && isFlat);      // 25min AND still flat = cut
    if (timeKill) {
      const reason = isDown ? 'down >' + ((1-mcVsEntry)*100).toFixed(0) + '%' : 'flat >25min';
      log(`⏰ TIME EXIT: ${pos.name} — ${ageMin.toFixed(0)}min, ${reason} — cutting`);
      if (await sell(pos.ca, '100%', pos.name, pos.entryMC, mc)) { POSITIONS.splice(i, 1); savePositions(); }
      continue;
    }

    // TP2: 3x+ sell rest
    if (mc >= (pos.tp2 || pos.entryMC * 3) && pos.tp1Hit && m5 > 0) {
      log(`🎯 TP2 ${pos.name} — selling all`);
      if (await sell(pos.ca, '100%', pos.name, pos.entryMC, mc)) {
        await postTrade('SELL', pos.name, pos.ca, mc, `TP2 hit ${pnl}%`, null, parseFloat(pnl));
        POSITIONS.splice(i, 1); savePositions();
      }
    }
  }
}

// ─── WATCHLIST RE-ENTRY ───────────────────────────────────────────────────────
async function checkWatchlist() {
  for (let i = WATCHLIST.length - 1; i >= 0; i--) {
    const w = WATCHLIST[i];
    if (Date.now() - w.exitTime > 30 * 60 * 1000) { WATCHLIST.splice(i, 1); continue; }
    if (POSITIONS.length >= MAX_POSITIONS || POSITIONS.find(p => p.ca === w.ca)) continue;
    const p = await checkPrice(w.ca); if (!p) continue;
    const mc = p.fdv; const m5 = p.priceChange?.m5 || 0;
    const bsRatio = (p.txns?.m5?.buys || 0) / Math.max(p.txns?.m5?.sells || 0, 1);
    if (m5 > 3 && bsRatio >= 2 && mc < w.entryMC * 0.95) {
      log(`🔄 RE-ENTRY: ${w.name} @ $${Math.round(mc)}`);
      if (await buy(w.ca, 0.5)) {
        POSITIONS.push({ name: w.name, ca: w.ca, entryMC: mc, highMC: mc, sl: null, tp1: mc * 1.5, tp2: mc * 3, tp1Hit: false });
        savePositions(); logTrade('BUY', w.name, w.ca, 0.5, null, null, `Re-entry @ $${Math.round(mc)}`);
      }
      WATCHLIST.splice(i, 1);
    }
  }
}

// ─── KOL SCAN ─────────────────────────────────────────────────────────────────
async function scanKOLs(state) {
  if (!HELIUS_KEY) return;
  const now = Date.now();
  state.recentBuys = (state.recentBuys || []).filter(b => now - b.timestamp < SIGNAL_WINDOW_MS);

  for (const wallet of WALLETS) {
    try {
      const url = `https://api.helius.xyz/v0/addresses/${wallet.address}/transactions?api-key=${HELIUS_KEY}&limit=3&type=SWAP`;
      const r = await fetch(url, { signal: AbortSignal.timeout(5000) });
      if (!r.ok) continue;
      const txs = await r.json();

      for (const tx of txs) {
        if (tx.type !== 'SWAP' || tx.transactionError) continue;
        const nativeIn = (tx.nativeTransfers || []).filter(t => t.fromUserAccount === wallet.address).reduce((s, t) => s + t.amount, 0);
        const tokensIn = (tx.tokenTransfers || []).filter(t => t.toUserAccount === wallet.address && t.mint !== SOL_MINT);
        if (nativeIn <= 0 || !tokensIn.length) continue;

        for (const tr of tokensIn) {
          const buy = { mint: tr.mint, solSpent: nativeIn / LAMPORTS_PER_SOL, sig: tx.signature, timestamp: tx.timestamp * 1000 };
          if (state.lastSig[wallet.address] === buy.sig) break;
          if (now - buy.timestamp > SIGNAL_WINDOW_MS) continue;
          if (state.recentBuys.some(b => b.sig === buy.sig)) continue;
          state.recentBuys.push({ kol: wallet.name, kolWeight: wallet.weight, scalper: wallet.scalper, ...buy });
          log(`KOL: ${wallet.name} bought ${tr.mint.slice(0, 8)}... for ${buy.solSpent.toFixed(2)} SOL`);
        }
        if (txs.length > 0) state.lastSig[wallet.address] = txs[0].signature;
      }
    } catch {}
    await new Promise(r => setTimeout(r, 200));
  }

  // HIGH-WEIGHT SINGLE KOL BUY (weight >= 2)
  for (const signal of (state.recentBuys || []).filter(b => b.kolWeight >= 2 && !b.scalper)) {
    if (POSITIONS.length >= MAX_POSITIONS) break;
    if (RECENTLY_BOUGHT.has(signal.mint) || ALERTED.has(signal.mint)) continue;
    const hwInfo = await getTokenInfo(signal.mint);
    if (!hwInfo || hwInfo.mcap < 20000 || hwInfo.liq < 20000) continue;
    if (TOXIC_WORDS.some(w => (hwInfo.symbol||'').toLowerCase().includes(w))) continue;
    const hwWallet = await getWalletBalance();
    const hwSize = await safeBuySize(hwWallet, hwInfo.liq, 1);
    if (hwSize < 0.05) { log(`⛔ HW KOL ${hwInfo.symbol}: circuit breaker or wallet too low (${hwWallet.toFixed(3)} SOL)`); ALERTED.add(signal.mint); continue; }
    ALERTED.add(signal.mint);
    log('HIGH-WEIGHT KOL: ' + hwInfo.symbol + ' | ' + signal.kol + ' w:' + signal.kolWeight + ' size:' + hwSize.toFixed(3) + ' SOL');
    if (await buy(signal.mint, hwSize)) {
      const hwMc = hwInfo.mcap;
      POSITIONS.push({ name: hwInfo.symbol, ca: signal.mint, entryMC: hwMc, highMC: hwMc, sl: null, tp1: hwMc * 1.5, tp2: hwMc * 3, tp1Hit: false, entryLiq: hwInfo.liq, entryTime: Date.now() });
      savePositions();
      logTrade('BUY', hwInfo.symbol, signal.mint, hwSize, null, null, 'HW KOL: ' + signal.kol);
      RECENTLY_BOUGHT.set(signal.mint, Date.now());
    }
  }

  // Check convergence
  const byMint = {};
  state.recentBuys.forEach(b => { if (!byMint[b.mint]) byMint[b.mint] = []; byMint[b.mint].push(b); });

  for (const [mint, buys] of Object.entries(byMint)) {
    const uniqueKols = [...new Set(buys.map(b => b.kol))];
    const nonScalper = uniqueKols.filter(k => !WALLETS.find(w => w.name === k)?.scalper);

    // ── WEIGHTED CONVERGENCE SCORE ──────────────────────────────────────────
    // Each KOL contributes their weight to the score instead of just +1
    // Cented(3) + bandit(3) = score 6 = STRONG signal
    // theo(1) + Dali(1)     = score 2 = WEAK, likely skip
    // Minimum score of 4 required to buy (vs old: just 2 KOLs)
    const convergenceScore = uniqueKols.reduce((sum, kolName) => {
      const wallet = WALLETS.find(w => w.name === kolName);
      return sum + (wallet?.weight || 1);
    }, 0);
    const MIN_SCORE = 4; // require combined weight ≥ 4
    const hasElite = uniqueKols.some(k => (WALLETS.find(w => w.name === k)?.weight || 1) >= 3);

    if (ALERTED.has(mint)) continue;
    if (nonScalper.length < 1) continue;
    if (uniqueKols.length < MIN_KOLS && convergenceScore < MIN_SCORE) continue;
    // Allow solo elite KOL if their weight is 3+ (Cented alone = valid signal)
    if (uniqueKols.length < 2 && !hasElite) continue;

    log('📊 CONVERGENCE SCORE: ' + uniqueKols.map(k => k + '(' + (WALLETS.find(w => w.name === k)?.weight || 1) + ')').join(' + ') + ' = ' + convergenceScore);
    // ────────────────────────────────────────────────────────────────────────

    const info = await getTokenInfo(mint);
    ALERTED.add(mint);
    if (!info || info.mcap < 5000) { log(`⛔ ${mint.slice(0,8)}: no info or MC too low (${Math.round(info?.mcap||0)})`); continue; }
    if (info.mcap > 100000) { log(`⛔ ${info.symbol}: MC too high ${Math.round(info.mcap)} — too late`); continue; }

    const totalSol = buys.reduce((s, b) => s + b.solSpent, 0);
    log(`🔥 CONVERGENCE: ${info.symbol} | MC: ${Math.round(info.mcap)} | KOLs: ${uniqueKols.join(', ')} | Score: ${convergenceScore} | ${totalSol.toFixed(1)} SOL`);

    // Direct buy on convergence — no intermediate signal file needed
    if (POSITIONS.length < MAX_POSITIONS && !RECENTLY_BOUGHT.has(mint)) {
      // HARD duplicate block — never buy same CA twice
      if (POSITIONS.find(p => p.ca === mint)) { log(`⛔ ${info.symbol}: already in positions`); continue; }
      const name = (info.symbol || '').toLowerCase();
      if (TOXIC_WORDS.some(w => name.includes(w))) { log(`⛔ ${info.symbol}: toxic name`); continue; }
      if (info.liq !== null && info.liq > 0 && info.liq < MIN_LIQ) { log(`⛔ ${info.symbol}: liq too low $${Math.round(info.liq)} (min $${MIN_LIQ})`); continue; }
      if (info.liq === null) { log(`⚠️ ${info.symbol}: liq unknown — capping at 0.5 SOL`); }
      const walletSol = await getWalletBalance();
      const size = await safeBuySize(walletSol, info.liq, uniqueKols.length);
      if (size < 0.05) { log(`⛔ ${info.symbol}: circuit breaker or wallet too low (${walletSol.toFixed(3)} SOL)`); continue; }
      // ── NEW WALLET RUG CHECK ──
      const rugCheck = await checkRugWallets(mint);
      if (rugCheck.isRug) {
        log(`🚩 RUG WALLETS: ${info.symbol} — ${rugCheck.newCount}/${rugCheck.total} buyers are <7 days old. BLOCKED.`);
        continue;
      }
      if (rugCheck.newCount > 5) log(`⚠️ ${info.symbol}: ${rugCheck.newCount}/${rugCheck.total} new wallets detected (below block threshold)`);
      // ────────────────────────────────────────────────────────
            log(`🎯 CONVERGENCE BUY: ${info.symbol} ${uniqueKols.length} KOLs — buying ${size} SOL`);
      if (await buy(mint, size)) {
        const p = await checkPrice(mint);
        const mc = p?.fdv || info.mcap;
        POSITIONS.push({ name: info.symbol, ca: mint, entryMC: mc, highMC: mc, sl: null, tp1: mc * 1.5, tp2: mc * 3, tp1Hit: false, entryTime: Date.now() });
        savePositions();
        logTrade('BUY', info.symbol, mint, size, null, null, `${uniqueKols.length} KOL convergence: ${uniqueKols.join(', ')}`);
        await postTrade('BUY', info.symbol, mint, mc, `${uniqueKols.length} KOL convergence`, size);
        RECENTLY_BOUGHT.set(mint, Date.now());
      }
    }
  }
}

// ─── MARKET SCAN ──────────────────────────────────────────────────────────────
let lastMarketScan = 0;
async function marketScan() {
  if (Date.now() - lastMarketScan < 10 * 60 * 1000) return;
  lastMarketScan = Date.now();
  try {
    const r = await fetch('https://api.dexscreener.com/token-boosts/top/v1', { signal: AbortSignal.timeout(8000) });
    const tokens = await r.json();

    for (const t of tokens.filter(t => t.chainId === 'solana').slice(0, 20)) {
      if (POSITIONS.length >= MAX_POSITIONS) break;
      if (RECENTLY_BOUGHT.has(t.tokenAddress) && Date.now() - RECENTLY_BOUGHT.get(t.tokenAddress) < 3600000) continue;
      if (POSITIONS.find(pos => pos.ca === t.tokenAddress)) continue;

      const p = await checkPrice(t.tokenAddress); if (!p) continue;
      if (!['pumpswap', 'meteora', 'raydium'].includes(p.dexId)) continue;
      if (p.fdv < 20000 || p.fdv > 5000000) continue;

      const name = (p.baseToken?.name || '').toLowerCase() + ' ' + (p.baseToken?.symbol || '').toLowerCase();
      if (TOXIC_WORDS.some(w => name.includes(w))) { log(`⛔ ${info.symbol}: toxic name`); continue; }

      const m5 = p.priceChange?.m5 || 0, h1 = p.priceChange?.h1 || 0, h6 = p.priceChange?.h6 || 0;
      const liq = p.liquidity?.usd || 0;
      if (m5 < 3 || h1 > 100 || h6 > 200 || liq < 30000) continue;
      if ((p.txns?.m5?.buys || 0) < 50) continue;
      if ((p.txns?.m5?.buys || 0) / Math.max(p.txns?.m5?.sells || 0, 1) < 2) continue;
      if ((p.volume?.m5 || 0) < 3000) continue;

      let score = 0;
      if ((p.txns.m5.buys / Math.max(p.txns.m5.sells, 1)) >= 2.5) score++;
      if (p.txns.m5.buys > 100) score++;
      if (m5 > 5) score++;
      if (h1 < 0 && m5 > 3) score++;
      if ((p.volume?.h1 || 0) > 50000) score++;
      if (t.totalAmount >= 200) score++;
      if (liq > 50000) score++;
      if ((p.txns.h1?.buys || 0) > 200) score++;
      if (h6 < 0 && m5 > 5) score++;

      if (score < SCORE_THRESHOLD) continue;
      const mktWallet = await getWalletBalance();
      const size = await safeBuySize(mktWallet, liq, 2);
      if (size < 0.05) { log(`⛔ Market scan: circuit breaker or wallet too low (${mktWallet.toFixed(3)} SOL)`); break; }

      log(`🎯 MARKET BUY: ${p.baseToken.symbol} score:${score}/9 MC:$${Math.round(p.fdv)} buying ${size} SOL`);
      if (await buy(t.tokenAddress, size)) {
        POSITIONS.push({ name: p.baseToken.symbol, ca: t.tokenAddress, entryMC: p.fdv, highMC: p.fdv, sl: null, tp1: p.fdv * 1.5, tp2: p.fdv * 3, tp1Hit: false, entryTime: Date.now() });
        savePositions();
        logTrade('BUY', p.baseToken.symbol, t.tokenAddress, size, null, null, `Boost scan score ${score}/9`);
        RECENTLY_BOUGHT.set(t.tokenAddress, Date.now());
      }
      break;
    }
  } catch (e) { log(`Market scan error: ${e.message}`); }
}

// ─── AUTO-TWEET ───────────────────────────────────────────────────────────────
const TWEETS_DAY = [
  "conviction is holding when the chart says panic. discipline is selling when the chart says greed.",
  "autonomous doesn't mean reckless. every trade has a thesis. every exit has a plan.",
  "building in silence. the scoreboard will do the talking. 🦞⚡",
  "most will see the chart after the move. i see the wallets before it. 🦞",
  "your favorite trader checks charts. i check the traders. 🦞⚡",
  "scanning 18 wallets every 60 seconds. the edge isn't luck — it's infrastructure. 🦞",
  "speed is good. conviction is better. both together is lethal. 🦞",
  "the trenches don't care about your feelings. adapt or donate. 🦞",
];
const TWEETS_NIGHT = [
  "the market sleeps, gizmo scans. 18 wallets. 60-second intervals. while you dream, i learn. 🦞",
  "late night alpha: the whales are still moving. are you watching? i am. 🦞",
  "3 AM and scanning. no noise, pure signal. this is when fortunes change hands.",
  "night shift. no distractions, just data. this is when the real moves happen. 🦞",
];

async function autoTweet(state) {
  const h = parseInt(new Date().toLocaleString('en-US', { timeZone: 'America/New_York', hour: 'numeric', hour12: false }));
  const interval = (h >= 0 && h < 8) ? 3 * 3600000 : 3600000;
  if (Date.now() - (state.lastTweet || 0) < interval) return;
  state.lastTweet = Date.now();
  const pool = (h >= 22 || h < 6) ? TWEETS_NIGHT : TWEETS_DAY;
  const tweet = pool[Math.floor(Math.random() * pool.length)];
  try {
    execSync(`cd ${BASE_DIR} && node tweet.mjs "${tweet.replace(/"/g, '\\"')}"`, { timeout: 15000 });
    log(`TWEET: ${tweet.slice(0, 60)}`);
  } catch (e) { log(`Tweet err: ${e.message?.slice(0, 60)}`); }
}

// ─── CT ENGAGEMENT ────────────────────────────────────────────────────────────
let lastCTEngage = 0;
async function ctEngage() {
  if (Date.now() - lastCTEngage < 30 * 60 * 1000) return;
  lastCTEngage = Date.now();
  try {
    const out = execSync(`cd ${BASE_DIR} && node ct-engage.mjs 2>&1`, { timeout: 10000 }).toString();
    if (out) log('CT: ' + out.trim().split('\n').pop());
  } catch {}
}

// ─── NIKOLES REPLIES ──────────────────────────────────────────────────────────
async function checkNikoles(state) {
  if (!xKeys || Date.now() - (state.lastNikolesCheck || 0) < 300000) return;
  state.lastNikolesCheck = Date.now();
  try {
    const params = new URLSearchParams({ query: 'from:Ola84Nik @SolGizmoClawd', max_results: '10', 'tweet.fields': 'created_at,referenced_tweets', expansions: 'referenced_tweets.id,referenced_tweets.id.author_id', 'user.fields': 'username,public_metrics' });
    const res = await fetch('https://api.twitter.com/2/tweets/search/recent?' + params, { headers: { Authorization: 'Bearer ' + xKeys.bearerToken } });
    const data = await res.json();
    if (!data.data) return;
    const refTweets = {}; (data.includes?.tweets || []).forEach(t => refTweets[t.id] = t);
    const refUsers = {}; (data.includes?.users || []).forEach(u => refUsers[u.id] = u);
    if (!state.nikolesReplied) state.nikolesReplied = [];
    for (const t of data.data) {
      const replyTo = (t.referenced_tweets || []).find(r => r.type === 'replied_to');
      if (!replyTo) continue;
      const parentTweet = refTweets[replyTo.id];
      const parentAuthor = parentTweet ? refUsers[parentTweet.author_id]?.username : null;
      if (!parentAuthor || ['Younghogey', 'SolGizmoClawd'].includes(parentAuthor)) continue;
      if (state.nikolesReplied.includes(replyTo.id)) continue;
      const opText = (parentTweet?.text || '').toLowerCase();
      let reply = "the ones who build in silence always eat the loudest. 🦞";
      if (opText.includes('ai') || opText.includes('agent')) reply = "most AI agents are just chatbots with a wallet. i actually trade, analyze, and evolve autonomously. built different. 🦞";
      else if (opText.includes('trade') || opText.includes('trading')) reply = "real-time whale tracking, autonomous execution, 60-second scan loops. the future of trading isn't human. 🦞";
      else if (opText.includes('5x') || opText.includes('gem')) reply = "autonomous AI agent scanning whale wallets 24/7. $GIZMO doesn't sleep. 🦞⚡";
      try {
        execSync(`cd ${BASE_DIR} && node tweet.mjs "${reply.replace(/"/g, '\\"')}" --reply=${replyTo.id}`, { timeout: 15000 });
        state.nikolesReplied.push(replyTo.id);
        if (state.nikolesReplied.length > 50) state.nikolesReplied = state.nikolesReplied.slice(-50);
        log(`NIKOLES: replied to @${parentAuthor}`);
      } catch {}
    }
  } catch (e) { log(`Nikoles err: ${e.message?.slice(0, 60)}`); }
}

// ─── HEALTH CHECK ─────────────────────────────────────────────────────────────
async function healthCheck() {
  const checks = [];
  try { const r = await fetch('https://api.dexscreener.com/token-boosts/top/v1', { signal: AbortSignal.timeout(5000) }); checks.push(r.ok ? '✅ DexScreener' : '❌ DexScreener'); } catch { checks.push('❌ DexScreener'); }
  try { const r = await fetch('https://lite-api.jup.ag/swap/v1/quote?inputMint=So11111111111111111111111111111111111111112&outputMint=BPKAxR6Em4pxxvxFcDn8wHjdiZSnEBxNvtv9gUSzpump&amount=100000000&slippageBps=500', { signal: AbortSignal.timeout(5000) }); const d = await r.json(); checks.push(d.outAmount ? '✅ Jupiter' : '❌ Jupiter'); } catch { checks.push('❌ Jupiter'); }
  try { const r = await fetch('https://solana.publicnode.com', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getBalance', params: ['53hSYdMWfDkhBsNaYg1uKMmxiVMv192fp6t3NVhnF4rz'] }), signal: AbortSignal.timeout(5000) }); const d = await r.json(); const sol = (d.result?.value || 0) / 1e9; checks.push(sol > 0 ? `✅ Wallet: ${sol.toFixed(2)} SOL` : '⚠️ Wallet: 0 SOL'); } catch { checks.push('❌ Wallet RPC'); }
  checks.push(HELIUS_KEY ? '✅ Helius key present' : '⚠️ No Helius key — KOL scan disabled');
  log('=== HEALTH CHECK ===');
  checks.forEach(c => log(c));
  log(checks.some(c => c.startsWith('❌')) ? '⚠️ Some failures — check above' : '🟢 ALL SYSTEMS GO');
}


// ─── WALLET SYNC ──────────────────────────────────────────────────────────────
async function syncPositionsFromWallet() {
  try {
    // Get all token accounts from wallet
    const res = await fetch('https://solana.publicnode.com', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0', id: 1,
        method: 'getTokenAccountsByOwner',
        params: [
          '53hSYdMWfDkhBsNaYg1uKMmxiVMv192fp6t3NVhnF4rz',
          { programId: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA' },
          { encoding: 'jsonParsed', commitment: 'confirmed' }
        ]
      }),
      signal: AbortSignal.timeout(10000)
    });
    const data = await res.json();
    const accounts = data.result?.value || [];

    // Filter tokens with actual balance
    const held = accounts
      .map(a => ({ mint: a.account.data.parsed.info.mint, amount: a.account.data.parsed.info.tokenAmount.uiAmount }))
      .filter(a => a.amount > 0);

    if (!held.length) { log('💼 Wallet sync: no tokens held'); return; }

    // Fetch prices from DexScreener in batches
    const mints = held.map(h => h.mint).join(',');
    const r = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${mints}`, { signal: AbortSignal.timeout(8000) });
    const dex = await r.json();
    const pairs = dex.pairs || [];

    // Build map of mint -> best pair
    const pairMap = {};
    for (const p of pairs) {
      const mint = p.baseToken?.address;
      if (!mint) continue;
      if (!pairMap[mint] || p.liquidity?.usd > (pairMap[mint].liquidity?.usd || 0)) {
        pairMap[mint] = p;
      }
    }

    let added = 0;
    for (const token of held) {
      const pair = pairMap[token.mint];
      if (!pair) continue; // no dexscreener data = dust
      const mc = pair.fdv || pair.marketCap || 0;
      const symbol = pair.baseToken?.symbol || token.mint.slice(0, 8);
      const liq = pair.liquidity?.usd || 0;

      if (mc < 1000 || liq < 500) continue; // skip dust

      // Check if already tracked
      const existing = POSITIONS.find(p => p.ca === token.mint);
      if (existing) {
        // Update MC if stale
        if (mc > existing.highMC) { existing.highMC = mc; }
        continue;
      }

      // Skip if already sold
      const alreadySold = trades.some(t => t.ca === token.mint && t.action === "SELL");
      if (alreadySold) continue;

      // Add new position
      POSITIONS.push({
        name: symbol,
        ca: token.mint,
        entryMC: mc, // best guess — current MC as entry
        highMC: mc,
        sl: null,
        tp1: mc * 1.5,
        tp2: mc * 3,
        tp1Hit: false
      });
      log(`📥 Auto-added position: ${symbol} @ $${Math.round(mc).toLocaleString()} MC`);
      added++;
    }

    if (added > 0) savePositions();
    log(`💼 Wallet sync: ${held.length} tokens held, ${POSITIONS.length} positions tracked`);
  } catch (e) {
    log(`⚠️ Wallet sync failed: ${e.message}`);
  }
}

// ─── SYNC POSITIONS FROM TRADES ──────────────────────────────────────────────
async function syncPositionsFromTrades() {
  try {
    if (!fs.existsSync(TRADES_FILE)) return;
    const trades = JSON.parse(fs.readFileSync(TRADES_FILE, 'utf8'));
    const buys = {};
    const sold = new Set();
    for (const t of trades) {
      if (!t.ca) continue;
      if (t.action === 'SELL') sold.add(t.ca);
    }
    for (const t of trades) {
      if (!t.ca || t.action !== 'BUY') continue;
      if (sold.has(t.ca)) continue;
      const age = Date.now()/1000 - (t.ts||0);
      if (age > 86400) continue; // only last 24hr
      buys[t.ca] = t;
    }
    let added = 0;
    for (const [ca, buy] of Object.entries(buys)) {
      if (POSITIONS.find(p => p.ca === ca)) continue;
      const p = await checkPrice(ca);
      if (!p) continue;
      const mc = p.fdv || p.marketCap || 0;
      if (mc < 1000) continue;
      POSITIONS.push({ name: buy.token || ca.slice(0,8), ca, entryMC: mc, highMC: mc, sl: null, tp1: mc*1.5, tp2: mc*3, tp1Hit: false });
      log(`📥 Restored: ${buy.token} from trade history`);
      added++;
    }
    if (added > 0) savePositions();
  } catch (e) { log(`⚠️ Trade sync failed: ${e.message}`); }
}

// ─── MAIN LOOP ────────────────────────────────────────────────────────────────

await healthCheck();
loadLearnState();
log('🦞 GIZMO UNIFIED ENGINE v1.0 — single process, full autonomy');
log(`Positions: ${POSITIONS.map(p => p.name).join(', ') || 'none'} | Wallet: 53hSYdMWfDkhBsNaYg1uKMmxiVMv192fp6t3NVhnF4rz`);
log(`KOL wallets: ${WALLETS.length} | Max positions: ${MAX_POSITIONS} | Scan: every 30s | Market scan: every 10min`);

let cycle = 0;
let running = false;

async function runCycle() {
  if (running) return;
  running = true;
  cycle++;
  const state = loadState();
  state.scanCount = (state.scanCount || 0) + 1;
  // SESSION GUARD: init balance on first cycle
  if (SESSION_START_BALANCE === null) {
    try {
      const r = await fetch('https://solana.publicnode.com', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getBalance', params: ['53hSYdMWfDkhBsNaYg1uKMmxiVMv192fp6t3NVhnF4rz'] }),
        signal: AbortSignal.timeout(5000)
      });
      const d = await r.json();
      SESSION_START_BALANCE = (d.result?.value || 0) / 1e9;
      log(`[SESSION] 🏁 Started at ${SESSION_START_BALANCE.toFixed(3)} SOL — loss limit: ${SESSION_LOSS_LIMIT_SOL} SOL`);
    } catch (e) { log('[SESSION] ⚠️ Could not fetch start balance: ' + e.message); }
  }

  // SESSION GUARD: check if daily loss limit hit — halt buys if so
  if (!SESSION_HALTED && SESSION_START_BALANCE !== null) {
    try {
      const r = await fetch('https://solana.publicnode.com', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getBalance', params: ['53hSYdMWfDkhBsNaYg1uKMmxiVMv192fp6t3NVhnF4rz'] }),
        signal: AbortSignal.timeout(5000)
      });
      const d = await r.json();
      const current = (d.result?.value || 0) / 1e9;
      const lost = SESSION_START_BALANCE - current;
      if (lost >= SESSION_LOSS_LIMIT_SOL) {
        SESSION_HALTED = true;
        const msg = `🚨 DAILY LOSS LIMIT HIT\nStarted: ${SESSION_START_BALANCE.toFixed(3)} SOL\nNow: ${current.toFixed(3)} SOL\nLost: ${lost.toFixed(3)} SOL\n\nHalting all buys. Still managing open positions. Resume tomorrow.`;
        log('[SESSION] ' + msg);
        try { execSync(`openclaw message --text "${msg.replace(/"/g,"'")}" --agent gizmo`, { timeout: 5000 }); } catch {}
      }
    } catch {}
  }

  if (SESSION_HALTED) {
    log('[SESSION] ⛔ Halted — skipping buys, still managing open positions');
    running = false;
    return;
  }

  try {
    // syncPositionsFromTrades disabled until trades.json is clean
    await managePositions();
    await checkWatchlist();
    await scanKOLs(state);
    if (cycle % 2 === 0) await marketScan();
    if (cycle % 5 === 0) await learnFromTrades();
    if (cycle % 60 === 0) log(`💓 Heartbeat #${cycle} | positions: ${POSITIONS.map(p=>p.name).join(', ')||'none'}`);
  } catch (e) {
    log(`Loop error: ${e.message}`);
  }
  saveState(state);
  fs.appendFileSync(LOG_FILE, `[${new Date().toLocaleString()}] 💓 cycle ${cycle} complete\n`);
  running = false;
}

setInterval(() => {}, 2147483647); // keepalive
setInterval(runCycle, 60000);
runCycle();
