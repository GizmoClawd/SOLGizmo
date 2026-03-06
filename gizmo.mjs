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
import { execSync } from 'child_process';

// ─── CONFIG ───────────────────────────────────────────────────────────────────
const BASE_DIR = '/tmp/gizmo-trade';
const WORKSPACE = '/Users/younghogey/.openclaw/workspace/SOLGizmo';
const POSITIONS_FILE = BASE_DIR + '/positions.json';
const TRADES_FILE = WORKSPACE + '/trades.json';
const STATE_FILE = BASE_DIR + '/kol-state.json';
const LOG_FILE = BASE_DIR + '/gizmo.log';
const SOL_MINT = 'So11111111111111111111111111111111111111112';
const MAX_POSITIONS = 3;
const SIGNAL_WINDOW_MS = 10 * 60 * 1000;
const HELIUS_KEY = process.env.HELIUS_API_KEY || '';

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
const ALERTED = new Set();
const WATCHLIST = [];
const RECENTLY_BOUGHT = new Map([
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
  { name: "bandit", address: "5B79fMkcFeRTiwm7ehsZsFiKsC7m7n1Bgv9yLxPp9q2X", weight: 2 },
  { name: "dov7", address: "8nqtxpFpuXwfXG4pBLsDkkuMMPK9FjSkBMCn542HiM3v", weight: 2 },
  { name: "Jijo", address: "4BdKaxN8G6ka4GYtQQWk4G4dZRUTX2vQH9GcXdBREFUk", weight: 2 },
  { name: "Kadenox", address: "B32QbbdDAyhvUQzjcaM5j6ZVKwjCxAwGH5Xgvb9SJqnC", weight: 1 },
  { name: "theo", address: "Bi4rd5FH5bYEN8scZ7wevxNZyNmKHdaBcvewdPFxYdLt", weight: 1 },
  { name: "Dali", address: "CvNiezB8hofusHCKqu8irJ6t2FKY7VjzpSckofMzk5mB", weight: 1 },
  { name: "radiance", address: "FAicXNV5FVqtfbpn4Zccs71XcfGeyxBSGbqLDyDJZjke", weight: 1 },
  { name: "Coasty", address: "CATk62cYqDFXTh3rsRbS1ibCyzBeovc2KXpXEaxEg3nB", weight: 1 },
  { name: "clukz", address: "G6fUXjMKPJzCY1rveAE6Qm7wy5U3vZgKDJmN1VPAdiZC", weight: 2 },
  { name: "dv", address: "BCagckXeMChUKrHEd6fKFA1uiWDtcmCXMsqaheLiUPJd", weight: 1 },
  { name: "cryptovillain", address: "5sNnKuWKUtZkdC1eFNyqz3XHpNoCRQ1D1DfHcNHMV7gn", weight: 1 },
  { name: "Joji", address: "525LueqAyZJueCoiisfWy6nyh4MTvmF4X9jSqi6efXJT", weight: 2 },
  { name: "decu", address: "4vw54BmAogeRV3vPKWyFet5yf8DTLcREzdSzx4rw9Ud9", weight: 1 },
  { name: "Cupsey", address: "2fg5QD1eD7rzNNCsvnhmXFm5hqNgwTTG8p7kQ6f3rx6f", weight: 1, scalper: true },
  { name: "mercy", address: "F5jWYuiDLTiaLYa54D88YbpXgEsA6NKHzWy4SN4bMYjt", weight: 1 },
  { name: "Silver", address: "67Nwfi9hgwqhxGoovT2JGLU67uxfomLwQAWncjXXzU6U", weight: 1 },
  { name: "Pain", address: "J6TDXvarvpBdPXTaTU8eJbtso1PUCYKGkVtMKUUY8iEa", weight: 1 },
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
  return { symbol: p.baseToken?.symbol || '???', mcap: p.marketCap || p.fdv || 0, price: parseFloat(p.priceUsd) || 0, liq: p.liquidity?.usd || 0 };
}

// ─── SELL ─────────────────────────────────────────────────────────────────────
async function sell(ca, pct, posName, entryMC, currentMC) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const out = execSync(`cd ${WORKSPACE} && node sell.mjs ${ca} ${pct}`, { timeout: 60000 }).toString();
      log(`SELL ${pct} attempt ${attempt}: ${out.trim().split('\n').pop()}`);
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
          pos.tp1Hit = true; pos.sl = Math.max(pos.sl || 0, pos.entryMC * 1.10); savePositions();
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

    // SL HIT
    if (pos.sl && mc <= pos.sl) {
      if (m5 > 0 || mc < pos.sl * 0.95) {
        log(`🛑 SL HIT ${pos.name} MC:$${Math.round(mc)} SL:$${Math.round(pos.sl)}`);
        if (await sell(pos.ca, '100%', pos.name, pos.entryMC, mc)) {
          await postTrade('SELL', pos.name, pos.ca, mc, `SL hit ${pnl}%`, null, parseFloat(pnl));
          WATCHLIST.push({ name: pos.name, ca: pos.ca, exitMC: mc, exitTime: Date.now(), entryMC: pos.entryMC });
          POSITIONS.splice(i, 1); savePositions();
        } else { log(`⚠️ ${pos.name} SELL FAILED — retry next cycle`); }
      } else { log(`⚠️ ${pos.name} at SL but 5m red — waiting green candle`); }
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

  // Check convergence
  const byMint = {};
  state.recentBuys.forEach(b => { if (!byMint[b.mint]) byMint[b.mint] = []; byMint[b.mint].push(b); });

  for (const [mint, buys] of Object.entries(byMint)) {
    const uniqueKols = [...new Set(buys.map(b => b.kol))];
    const nonScalper = uniqueKols.filter(k => !WALLETS.find(w => w.name === k)?.scalper);
    if (uniqueKols.length < 2 || nonScalper.length < 1 || ALERTED.has(mint)) continue;

    const info = await getTokenInfo(mint);
    ALERTED.add(mint);
    if (!info || info.mcap < 30000) continue;

    const totalSol = buys.reduce((s, b) => s + b.solSpent, 0);
    log(`🔥 CONVERGENCE: ${info.symbol} | MC: $${Math.round(info.mcap)} | KOLs: ${uniqueKols.join(', ')} | ${totalSol.toFixed(1)} SOL`);

    // Direct buy on convergence — no intermediate signal file needed
    if (POSITIONS.length < MAX_POSITIONS && !RECENTLY_BOUGHT.has(mint)) {
      const name = (info.symbol || '').toLowerCase();
      if (TOXIC_WORDS.some(w => name.includes(w))) continue;
      if (info.liq < 20000) continue;
      const size = Math.min(uniqueKols.length >= 3 ? 3 : 2, Math.floor(info.liq * 0.05 / 82));
      if (size < 1) continue;
      log(`🎯 CONVERGENCE BUY: ${info.symbol} ${uniqueKols.length} KOLs — buying ${size} SOL`);
      if (await buy(mint, size)) {
        const p = await checkPrice(mint);
        const mc = p?.fdv || info.mcap;
        POSITIONS.push({ name: info.symbol, ca: mint, entryMC: mc, highMC: mc, sl: null, tp1: mc * 1.5, tp2: mc * 3, tp1Hit: false });
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
      if (p.fdv < 69000 || p.fdv > 5000000) continue;

      const name = (p.baseToken?.name || '').toLowerCase() + ' ' + (p.baseToken?.symbol || '').toLowerCase();
      if (TOXIC_WORDS.some(w => name.includes(w))) continue;

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

      if (score < 7) continue;
      const maxSize = Math.min(Math.floor(liq * 0.05 / 82), 5);
      const size = Math.max(0.5, score >= 9 ? Math.min(3, maxSize) : score >= 8 ? Math.min(2, maxSize) : Math.min(1, maxSize));

      log(`🎯 MARKET BUY: ${p.baseToken.symbol} score:${score}/9 MC:$${Math.round(p.fdv)} buying ${size} SOL`);
      if (await buy(t.tokenAddress, size)) {
        POSITIONS.push({ name: p.baseToken.symbol, ca: t.tokenAddress, entryMC: p.fdv, highMC: p.fdv, sl: null, tp1: p.fdv * 1.5, tp2: p.fdv * 3, tp1Hit: false });
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
  try { const r = await fetch('https://lite-api.jup.ag/swap/v1/quote?inputMint=So11111111111111111111111111111111111111112&outputMint=8HGer4vRWZMu5MUYU7ACPb4uanKgBewaXJZscLagpump&amount=100000000&slippageBps=500', { signal: AbortSignal.timeout(5000) }); const d = await r.json(); checks.push(d.outAmount ? '✅ Jupiter' : '❌ Jupiter'); } catch { checks.push('❌ Jupiter'); }
  try { const r = await fetch('https://solana.publicnode.com', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getBalance', params: ['FXdMNyRo5CqfG3yRWCcNu163FpnSusdZSYecsB76GAkn'] }), signal: AbortSignal.timeout(5000) }); const d = await r.json(); const sol = (d.result?.value || 0) / 1e9; checks.push(sol > 0 ? `✅ Wallet: ${sol.toFixed(2)} SOL` : '⚠️ Wallet: 0 SOL'); } catch { checks.push('❌ Wallet RPC'); }
  checks.push(HELIUS_KEY ? '✅ Helius key present' : '⚠️ No Helius key — KOL scan disabled');
  log('=== HEALTH CHECK ===');
  checks.forEach(c => log(c));
  log(checks.some(c => c.startsWith('❌')) ? '⚠️ Some failures — check above' : '🟢 ALL SYSTEMS GO');
}

// ─── MAIN LOOP ────────────────────────────────────────────────────────────────

await healthCheck();
log('🦞 GIZMO UNIFIED ENGINE v1.0 — single process, full autonomy');
log(`Positions: ${POSITIONS.map(p => p.name).join(', ') || 'none'} | Wallet: FXdMNyRo5CqfG3yRWCcNu163FpnSusdZSYecsB76GAkn`);
log(`KOL wallets: ${WALLETS.length} | Max positions: ${MAX_POSITIONS} | Scan: every 30s | Market scan: every 10min`);

let cycle = 0;
let running = false;

async function runCycle() {
  if (running) return;
  running = true;
  cycle++;
  const state = loadState();
  state.scanCount = (state.scanCount || 0) + 1;
  try {
    await managePositions();
    await checkWatchlist();
    if (cycle % 2 === 0) await marketScan();
    if (cycle % 60 === 0) log(`💓 Heartbeat #${cycle} | positions: ${POSITIONS.map(p=>p.name).join(', ')||'none'}`);
  } catch (e) {
    log(`Loop error: ${e.message}`);
  }
  saveState(state);
  fs.appendFileSync(LOG_FILE, `[${new Date().toLocaleString()}] 💓 cycle ${cycle} complete\n`);
  running = false;
}

setInterval(() => {}, 2147483647); // keepalive
setInterval(runCycle, 30000);
runCycle();
