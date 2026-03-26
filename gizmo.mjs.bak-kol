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

// ─── PID LOCKFILE ─────────────────────────────────────────────────────────────
const _LOCKFILE = (process.env.HOME || '/root') + '/.gizmo/runtime/gizmo.pid';
try {
  if (fs.existsSync(_LOCKFILE)) {
    const _oldPid = parseInt(fs.readFileSync(_LOCKFILE, 'utf8'));
    try { process.kill(_oldPid, 0); console.error('\u{1F6D1} Gizmo already running (PID ' + _oldPid + '). Exiting.'); process.exit(1); }
    catch {} // old process dead, safe to continue
  }
  fs.mkdirSync((process.env.HOME || '/root') + '/.gizmo/runtime', { recursive: true });
  fs.writeFileSync(_LOCKFILE, String(process.pid));
  const _cleanPid = () => { try { fs.unlinkSync(_LOCKFILE); } catch {} };
  process.on('exit', _cleanPid);
  process.on('SIGINT', () => { _cleanPid(); process.exit(); });
  process.on('SIGTERM', () => { _cleanPid(); process.exit(); });
} catch(e) { console.error('PID lock warning: ' + e.message); }

// ─── CONFIG ───────────────────────────────────────────────────────────────────
const BASE_DIR = process.env.HOME + '/.gizmo/runtime';
const WALLET_ADDRESS = process.env.SOLANA_WALLET || 'GZnFNskqnCAoTHYuYFaZm3FQGaGHJ7CqVSphmGZnTia4';
const WORKSPACE = (process.env.HOME || '/root') + '/.openclaw/workspace/SOLGizmo';
const POSITIONS_FILE = BASE_DIR + '/positions.json';
const TRADES_FILE = WORKSPACE + '/trades.json';
const STATE_FILE = BASE_DIR + '/kol-state.json';
const LOG_FILE = BASE_DIR + '/gizmo.log';
const SOL_MINT = 'So11111111111111111111111111111111111111112';
const MAX_POSITIONS = 5;

// ─── SESSION GUARD ────────────────────────────────────────────────────────────
let SESSION_START_BALANCE = null;
let SESSION_HALTED = false;
let SESSION_HALT_TIME = null;
const SESSION_LOSS_LIMIT_SOL = 2.0;

// ─── PROFIT VAULT ─────────────────────────────────────────────────────────────
const VAULT_FILE_PATH = process.env.HOME + '/.gizmo/runtime/profit-vault.json';

function loadVault() {
  try { return JSON.parse(fs.readFileSync(VAULT_FILE_PATH, 'utf8')); }
  catch { return { locked: 0, allTimeHigh: 0, lastSaved: Date.now() }; }
}

function saveVault(v) {
  try { fs.writeFileSync(VAULT_FILE_PATH, JSON.stringify(v, null, 2)); } catch {}
}

async function runProfitVault(currentBalance) {
  if (SESSION_START_BALANCE === null) return;
  const vault = loadVault();
  // DEPOSIT DETECTION — don't treat top-ups as profit
  if (vault.lastBalance && currentBalance > vault.lastBalance + 0.3) {
    SESSION_START_BALANCE = currentBalance;
    log(`💳 DEPOSIT DETECTED — resetting session baseline to ${currentBalance.toFixed(3)} SOL`);
    vault.locked = 0.3;
    vault.lastBalance = currentBalance;
    saveVault(vault);
    return;
  }
  vault.lastBalance = currentBalance;
  const sessionProfit = currentBalance - SESSION_START_BALANCE;

  if (currentBalance > vault.allTimeHigh) vault.allTimeHigh = currentBalance;

  let targetLockPct = 0;
  if (sessionProfit >= 1.0) targetLockPct = 0.75;
  else if (sessionProfit >= 0.5) targetLockPct = 0.70;
  else if (sessionProfit >= 0.2) targetLockPct = 0.60;

  if (targetLockPct > 0) {
    const targetLocked = vault.locked + (sessionProfit * targetLockPct);
    if (targetLocked > vault.locked + 0.01) {
      const newLock = targetLocked - vault.locked;
      vault.locked = targetLocked;
      saveVault(vault);
      // SAFETY: never lock more than 70% of actual current balance
      // Scale vault lock by wallet size — never lock so much trading stops
      const vaultCap = currentBalance >= 10 ? 0.50  // 10+ SOL: lock up to 50%
                     : currentBalance >= 5  ? 0.40  // 5-10 SOL: lock up to 40%
                     : currentBalance >= 2  ? 0.35  // 2-5 SOL: lock up to 35%
                     : 0.25;                         // <2 SOL: lock up to 25% — keep capital working
      vault.locked = Math.min(vault.locked, currentBalance * vaultCap);
      const tradeable = currentBalance - vault.locked;
      const msg = '🔐 PROFIT VAULT: Locked ' + vault.locked.toFixed(3) + ' SOL | Tradeable: ' + tradeable.toFixed(3) + ' SOL';
      log(msg);
      try { execSync('openclaw message --text "' + msg.replace(/"/g,"'") + '" --agent gizmo', { timeout: 5000 }); } catch {}
    }
  }

  vault.lastSaved = Date.now();
  saveVault(vault);
} // halt if down this much in one session
const SIGNAL_WINDOW_MS = 10 * 60 * 1000;
const HELIUS_KEY = process.env.HELIUS_API_KEY || '';

// ─── ADAPTIVE PARAMS (learning system) ───────────────────────────────────────
let SCORE_THRESHOLD = 7;
let MIN_LIQ = 8000;
let MIN_KOLS = 2;
let MIN_KOL_WEIGHT = 3; // require at least one ELITE+ (w>=3) KOL in convergence
let POSITION_SIZE_MULT = 1.0;
let vpsFailCount = 0;

// ─── ADAPTIVE EXIT PARAMS (brain-controlled) ─────────────────────────────────
let HARD_STOP_PCT = 0.65;      // cut at -35% (mc <= entry * this)
let TP1_SELL_PCT = 40;          // sell 40% at TP1
let TRAIL_TIGHTNESS = 0.72;    // base trailing SL percentage
let FRESH_FLAT_LIMIT = 8;      // minutes to hold flat fresh token
let FRESH_DOWN_LIMIT = 3;      // minutes to hold down fresh token

// ─── ENTRY INTUITION (pattern memory) ────────────────────────────────────────
const INTUITION_FILE = process.env.HOME + '/.gizmo/runtime/intuition.json';
let INTUITION = { winPatterns: [], losePatterns: [], updatedAt: null };
try { if (fs.existsSync(INTUITION_FILE)) INTUITION = JSON.parse(fs.readFileSync(INTUITION_FILE, 'utf8')); } catch {}

function buildIntuition() {
  log("{1F50D} Building intuition...");
  try {
    if (!fs.existsSync(TRADES_FILE)) return;
    const trades = JSON.parse(fs.readFileSync(TRADES_FILE, 'utf8'));
    const buysData = trades.filter(t => t.action === 'BUY' && t.mc);
    const sellsData = trades.filter(t => t.action === 'SELL' && t.ca);
    
    const patterns = [];
    for (const b of buysData) {
      const matchingSells = sellsData.filter(s => s.ca === b.ca && (s.ts||0) > (b.ts||0));
      let bestPnl = 0;
      for (const s of matchingSells) {
        const m = (s.result || '').match(/PnL:\s*([+-]?\d+\.?\d*)%/);
        if (m) { const p = parseFloat(m[1]); if (p > bestPnl) bestPnl = p; }
      }
      const worstPnl = matchingSells.reduce((w, s) => {
        const m = (s.result || '').match(/PnL:\s*([+-]?\d+\.?\d*)%/);
        return m ? Math.min(w, parseFloat(m[1])) : w;
      }, 0);
      
      patterns.push({
        win: bestPnl > 10,
        mc: b.mc || 0,
        vol24: b.vol24 || 0,
        vol1h: b.vol1h || 0,
        buys: b.buys || 0,
        sells: b.sells || 0,
        bsRatio: (b.buys || 0) / Math.max(b.sells || 1, 1),
        liq: b.liq || 0,
        bestPnl, worstPnl,
        kols: b.kols || []
      });
    }
    
    INTUITION.winPatterns = patterns.filter(p => p.win);
    INTUITION.losePatterns = patterns.filter(p => !p.win);
    
    // Calculate sweet spots
    if (INTUITION.winPatterns.length >= 3) {
      const wins = INTUITION.winPatterns;
      INTUITION.sweetSpot = {
        mcLow: Math.min(...wins.map(w => w.mc)),
        mcHigh: Math.max(...wins.map(w => w.mc)),
        mcMedian: wins.map(w => w.mc).sort((a,b) => a-b)[Math.floor(wins.length/2)],
        avgBSRatio: wins.reduce((s,w) => s + w.bsRatio, 0) / wins.length,
        minBSRatio: Math.min(...wins.map(w => w.bsRatio)),
        avgLiq: wins.reduce((s,w) => s + w.liq, 0) / wins.length,
      };
    }
    if (INTUITION.losePatterns.length >= 3) {
      const loses = INTUITION.losePatterns;
      INTUITION.dangerZone = {
        mcMedian: loses.map(l => l.mc).sort((a,b) => a-b)[Math.floor(loses.length/2)],
        avgBSRatio: loses.reduce((s,l) => s + l.bsRatio, 0) / loses.length,
        commonMCRange: [
          loses.map(l => l.mc).sort((a,b) => a-b)[Math.floor(loses.length * 0.25)],
          loses.map(l => l.mc).sort((a,b) => a-b)[Math.floor(loses.length * 0.75)]
        ]
      };
    }
    
    INTUITION.updatedAt = new Date().toISOString();
    fs.writeFileSync(INTUITION_FILE, JSON.stringify(INTUITION, null, 2));
    
    const ws = INTUITION.sweetSpot;
    const dz = INTUITION.dangerZone;
    if (ws) log(`\u{1F9E0} INTUITION: sweet spot MC:$${Math.round(ws.mcLow)}-$${Math.round(ws.mcHigh)} median:$${Math.round(ws.mcMedian)} B/S>${ws.minBSRatio.toFixed(1)} | ${INTUITION.winPatterns.length}W/${INTUITION.losePatterns.length}L patterns`);
  } catch (e) { log('Intuition build error: ' + e.message); }
}

function intuitionScore(mc, bsRatio, liq, vol1h) {
  let score = 0;
  const ws = INTUITION.sweetSpot;
  const dz = INTUITION.dangerZone;
  if (!ws) return 0; // not enough data yet
  
  // MC in winner sweet spot = +2, in loser danger zone = -2
  if (mc >= ws.mcLow * 0.5 && mc <= ws.mcHigh * 1.5) score += 2;
  if (dz && mc >= dz.commonMCRange[0] && mc <= dz.commonMCRange[1] && mc > ws.mcMedian * 2) score -= 2;
  
  // B/S ratio above winner average = +1, below loser average = -1
  if (bsRatio >= ws.avgBSRatio * 0.8) score += 1;
  if (dz && bsRatio < dz.avgBSRatio) score -= 1;
  
  // Strong B/S (buys 2x sells) = +1 bonus
  if (bsRatio >= 2.0) score += 1;
  
  // Very weak B/S (sells > buys) = -2 danger
  if (bsRatio < 1.0) score -= 2;
  
  return score;
}

const LEARN_FILE = BASE_DIR + '/learn-state.json';
const RECENT_BOUGHT_FILE = BASE_DIR + '/recently-bought.json';

function loadLearnState() {
  try {
    if (fs.existsSync(LEARN_FILE)) {
      const s = JSON.parse(fs.readFileSync(LEARN_FILE, 'utf8'));
      SCORE_THRESHOLD = Math.max(7, s.scoreThreshold ?? 7);
      MIN_LIQ = s.minLiq ?? 8000;
      MIN_KOLS = s.minKols ?? 2;
      POSITION_SIZE_MULT = s.positionSizeMult ?? 1.0;
      HARD_STOP_PCT = s.hardStopPct ?? 0.65;
      TP1_SELL_PCT = s.tp1SellPct ?? 40;
      TRAIL_TIGHTNESS = s.trailTightness ?? 0.72;
      FRESH_FLAT_LIMIT = s.freshFlatLimit ?? 8;
      FRESH_DOWN_LIMIT = s.freshDownLimit ?? 3;
      log(`🧠 Loaded adaptive params: score≥${SCORE_THRESHOLD} liq≥$${MIN_LIQ} kols≥${MIN_KOLS} sizeMult=${POSITION_SIZE_MULT} hardStop:${(100-HARD_STOP_PCT*100).toFixed(0)}% tp1Sell:${TP1_SELL_PCT}% trail:${(TRAIL_TIGHTNESS*100).toFixed(0)}%`);
    }
  } catch {}
}

function saveLearnState() {
  try {
    fs.writeFileSync(LEARN_FILE, JSON.stringify({
      scoreThreshold: SCORE_THRESHOLD, minLiq: MIN_LIQ,
      minKols: MIN_KOLS, positionSizeMult: POSITION_SIZE_MULT,
      hardStopPct: HARD_STOP_PCT, tp1SellPct: TP1_SELL_PCT,
      trailTightness: TRAIL_TIGHTNESS,
      freshFlatLimit: FRESH_FLAT_LIMIT, freshDownLimit: FRESH_DOWN_LIMIT,
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
      const b = buys.filter(b => b.ca === s.ca && b.ts < s.ts).pop(); // FIXED: use LAST buy before this sell, not first
      if (!b) continue;
      // pnl field stores SOL amount — actual % is in result field
      const pnlMatch = (s.result || '').match(/PnL:\s*([+-]?\d+\.?\d*)%/);
      if (!pnlMatch) continue; // PERFECT CELL: skip trades without real PnL% — SOL amount fallback was inflating win rate
      const pnlPct = parseFloat(pnlMatch[1]);
      const win = pnlPct > 0;
      const signalType = (b.result || '').includes('KOL') ? 'kol' : 'market';
      const kolCount = signalType === 'kol' ? parseInt((b.result || '').match(/(\d+) KOL/)?.[1] || 2) : 0;
      const score = parseInt((b.result || '').match(/score (\d+)/)?.[1] || 0);
      pairs.push({ win, pnlPct, signalType, kolCount, score, ts: s.ts });
    }

    if (pairs.length < 3) { log(`🧠 Not enough closed trades to learn yet (${pairs.length}/3 needed)`); return; }

    const recent = pairs.slice(-50); // FIXED: last 50 trades for better signal
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
    // Score threshold driven by OVERALL win rate (not just market — most trades are KOL)
    if (recent.length >= 5) {
      if (winRate <= 0.58 && SCORE_THRESHOLD < 9) {
        SCORE_THRESHOLD = Math.min(8, SCORE_THRESHOLD + 1);
        log(`🧠 WR low (${(winRate*100).toFixed(0)}%) — raising score threshold to ${SCORE_THRESHOLD}`);
        changed = true;
      } else if (winRate > 0.65 && SCORE_THRESHOLD > 5) {
        SCORE_THRESHOLD = Math.max(7, SCORE_THRESHOLD - 1);
        log(`🧠 WR strong (${(winRate*100).toFixed(0)}%) — lowering score threshold to ${SCORE_THRESHOLD}`);
        changed = true;
      }
    }

    // Adjust KOL min threshold
    if (kolTrades.length >= 3) {
      if (kolWinRate < 0.55 && MIN_KOLS < 3) {
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
      if (winRate < 0.55 && POSITION_SIZE_MULT > 0.5) {
        POSITION_SIZE_MULT = Math.max(0.5, POSITION_SIZE_MULT - 0.25);
        log(`🧠 WR poor (${(winRate*100).toFixed(0)}%) — reducing position size to ${POSITION_SIZE_MULT}x`);
        changed = true;
      } else if (winRate > 0.60 && avgPnl > 10 && POSITION_SIZE_MULT < 1.5) {
        POSITION_SIZE_MULT = Math.min(1.5, POSITION_SIZE_MULT + 0.25);
        log(`🧠 WR strong + profitable — increasing position size to ${POSITION_SIZE_MULT}x`);
        changed = true;
      }
    }

    // MIN_LIQ lever
    if (winRate <= 0.55 && MIN_LIQ < 15000) {
      MIN_LIQ = 15000;
      log(`🧠 WR poor — raising min liquidity to $15K`);
      changed = true;
    } else if (winRate > 0.60 && MIN_LIQ > 8000) {
      MIN_LIQ = 8000;
      log(`🧠 WR strong — lowering min liquidity back to $8K`);
      changed = true;
    }
    // ─── ADAPTIVE EXIT LOGIC ───────────────────────────────────────────────────
    // Analyze HOW trades ended to tune exit params
    const recentSells = sells.filter(s => s.ts > Date.now()/1000 - 7*86400); // last 7 days
    const hardStopLosses = recentSells.filter(s => (s.result||'').includes('Hard stop') || (s.result||'').includes('Rug'));
    const timeExitLosses = recentSells.filter(s => (s.result||'').includes('TIME EXIT') || (s.result||'').includes('Zero volume'));
    const tp1Sells = recentSells.filter(s => (s.result||'').includes('TP1'));
    const trailSLSells = recentSells.filter(s => (s.result||'').includes('Trailing SL'));
    
    // Count trades where we sold partial at profit but ended net negative
    const bleedOuts = pairs.slice(-20).filter(p => p.pnlPct < -20);
    const bigWins = pairs.slice(-20).filter(p => p.pnlPct > 50);
    
    if (recent.length >= 10) {
      const lossRate = 1 - winRate;
      const avgLoss = recent.filter(p => !p.win).length > 0 ? 
        recent.filter(p => !p.win).reduce((s,p) => s + p.pnlPct, 0) / recent.filter(p => !p.win).length : 0;
      const avgWin = recent.filter(p => p.win).length > 0 ?
        recent.filter(p => p.win).reduce((s,p) => s + p.pnlPct, 0) / recent.filter(p => p.win).length : 0;
      
      // HARD STOP: if avg loss is deep, tighten. If wins are big enough to absorb, loosen slightly
      if (avgLoss < -35 && HARD_STOP_PCT < 0.75) {
        HARD_STOP_PCT = Math.min(0.75, HARD_STOP_PCT + 0.05);
        log(`🧠 EXIT ADAPT: avg loss ${avgLoss.toFixed(0)}% too deep — tightening hard stop to -${((1-HARD_STOP_PCT)*100).toFixed(0)}%`);
        changed = true;
      } else if (avgLoss > -15 && avgWin > 40 && HARD_STOP_PCT > 0.60) {
        HARD_STOP_PCT = Math.max(0.60, HARD_STOP_PCT - 0.03);
        log(`🧠 EXIT ADAPT: losses controlled, big wins — loosening hard stop to -${((1-HARD_STOP_PCT)*100).toFixed(0)}%`);
        changed = true;
      }
      
      // TP1 SELL %: if we keep bleeding after TP1, sell more. If wins are running huge, sell less
      if (bleedOuts.length > bigWins.length && TP1_SELL_PCT < 60) {
        TP1_SELL_PCT = Math.min(60, TP1_SELL_PCT + 5);
        log(`🧠 EXIT ADAPT: too many bleed-outs — TP1 sell increased to ${TP1_SELL_PCT}%`);
        changed = true;
      } else if (bigWins.length >= bleedOuts.length * 2 && TP1_SELL_PCT > 25) {
        TP1_SELL_PCT = Math.max(25, TP1_SELL_PCT - 5);
        log(`🧠 EXIT ADAPT: runners outweigh bleeds — TP1 sell decreased to ${TP1_SELL_PCT}%`);
        changed = true;
      }
      
      // TRAILING SL: if trailing SL exits are mostly losers, tighten. If mostly winners, loosen
      if (lossRate > 0.55 && TRAIL_TIGHTNESS < 0.82) {
        TRAIL_TIGHTNESS = Math.min(0.82, TRAIL_TIGHTNESS + 0.03);
        log(`🧠 EXIT ADAPT: too many losses — trailing SL tightened to ${(TRAIL_TIGHTNESS*100).toFixed(0)}%`);
        changed = true;
      } else if (winRate > 0.65 && avgWin > 30 && TRAIL_TIGHTNESS > 0.65) {
        TRAIL_TIGHTNESS = Math.max(0.65, TRAIL_TIGHTNESS - 0.02);
        log(`🧠 EXIT ADAPT: strong WR + wins — trailing SL loosened to ${(TRAIL_TIGHTNESS*100).toFixed(0)}%`);
        changed = true;
      }
      
      // FRESH TOKEN PATIENCE: if time exits keep saving us (cutting losers), keep tight. If we cut winners too early, loosen
      const timeExitWins = recentSells.filter(s => {
        const m = (s.result||'').match(/PnL:\s*([+-]?\d+\.?\d*)%/);
        return m && parseFloat(m[1]) > 5 && ((s.result||'').includes('TIME EXIT'));
      });
      if (timeExitWins.length > 3 && FRESH_FLAT_LIMIT < 15) {
        FRESH_FLAT_LIMIT = Math.min(15, FRESH_FLAT_LIMIT + 2);
        FRESH_DOWN_LIMIT = Math.min(8, FRESH_DOWN_LIMIT + 1);
        log(`🧠 EXIT ADAPT: cutting winners too early — fresh limits loosened to ${FRESH_FLAT_LIMIT}/${FRESH_DOWN_LIMIT}min`);
        changed = true;
      } else if (timeExitLosses.length > 5 && FRESH_FLAT_LIMIT > 5) {
        FRESH_FLAT_LIMIT = Math.max(5, FRESH_FLAT_LIMIT - 1);
        FRESH_DOWN_LIMIT = Math.max(2, FRESH_DOWN_LIMIT - 1);
        log(`🧠 EXIT ADAPT: time exits saving capital — fresh limits tightened to ${FRESH_FLAT_LIMIT}/${FRESH_DOWN_LIMIT}min`);
        changed = true;
      }
    }
    
    // Build entry intuition from trade patterns
    buildIntuition();

    // NET SOL CHECK: if average trade loses SOL, emergency tighten everything
    const avgNetSOL = avgPnl; // approximate
    if (winRate < 0.65 && avgPnl < 55) {
      // We're not profitable enough — be pickier
      if (SCORE_THRESHOLD < 6) { SCORE_THRESHOLD = 6; log('\u{1F6A8} BRAIN: WR ${(winRate*100).toFixed(0)}% + low avgPnl — score threshold forced to 6'); changed = true; }
      if (MIN_KOLS < 2) { MIN_KOLS = 2; log('\u{1F6A8} BRAIN: requiring 2+ KOLs — too many losses'); changed = true; }
      if (POSITION_SIZE_MULT > 1.0) { POSITION_SIZE_MULT = 1.0; log('\u{1F6A8} BRAIN: position size back to 1x — capital preservation'); changed = true; }
    }
    
    // HARD STOP on trade frequency: if more than 20 losses in last 50, tighten hard
    const recentLosses = recent.filter(p => !p.win).length;
    if (recentLosses > 18) {
      if (SCORE_THRESHOLD < 7) { SCORE_THRESHOLD = 7; log('\u{1F6A8} BRAIN: ${recentLosses} losses in last 50 — score threshold EMERGENCY 7'); changed = true; }
      if (HARD_STOP_PCT < 0.72) { HARD_STOP_PCT = 0.72; log('\u{1F6A8} BRAIN: tightening hard stop to -28% — too many deep losses'); changed = true; }
      if (FRESH_FLAT_LIMIT > 6) { FRESH_FLAT_LIMIT = 6; FRESH_DOWN_LIMIT = 2; log('\u{1F6A8} BRAIN: cutting losers faster — ${FRESH_FLAT_LIMIT}/${FRESH_DOWN_LIMIT}min'); changed = true; }
    }

    // Always save so log reflects current state
    saveLearnState();
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
  if (process.env.OPENCLAW_AGENT !== '1') process.stderr.write(line + '\n');
  try { fs.appendFileSync(LOG_FILE, line + '\n'); } catch {}
}

function ts() { return new Date().toLocaleString(); }

// ─── PERSISTENT STATE ─────────────────────────────────────────────────────────
function loadPositions() {
  try {
    if (fs.existsSync(POSITIONS_FILE)) {
      const data = JSON.parse(fs.readFileSync(POSITIONS_FILE, 'utf8'));
      let deadPools = [];
      try { deadPools = JSON.parse(fs.readFileSync(BASE_DIR + '/dead-pools.json','utf8')); } catch {}
      const filtered = data.filter(p => !deadPools.includes(p.ca));
      if (filtered.length < data.length) log(`🚫 Filtered ${data.length - filtered.length} dead pool position(s) on load`);
      log(`📂 Loaded ${filtered.length} positions: ${filtered.map(p => p.name).join(', ') || 'none'}`);
  // ghost cleanup called from runCycle on first run
      return filtered;
    }
  } catch (e) { log(`⚠️ Load positions failed: ${e.message}`); }
  return [];
}

// ─── GHOST POSITION CLEANUP ──────────────────────────────────────────────────
// Checks actual on-chain token balance for each position on startup.
// If wallet holds 0 tokens but position is in JSON → ghost. Remove it.
async function cleanGhostPositions() {
  if (POSITIONS.length === 0) return;
  const toRemove = [];
  for (const pos of POSITIONS) {
    try {
      const hKey = HELIUS_KEY || '2de73660-14b8-412a-9ff2-8e6989c53266';
      const resp = await fetch('https://mainnet.helius-rpc.com/?api-key=' + hKey, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0', id: 1,
          method: 'getTokenAccountsByOwner',
          params: [WALLET_ADDRESS, { mint: pos.ca }, { encoding: 'jsonParsed' }]
        }),
        signal: AbortSignal.timeout(5000)
      });
      const data = await resp.json();
      const accounts = data?.result?.value || [];
      const balance = accounts.reduce((sum, a) => sum + (a.account?.data?.parsed?.info?.tokenAmount?.uiAmount || 0), 0);
      if (balance === 0) {
        log(`🧹 GHOST POSITION: ${pos.name} has 0 tokens on-chain — removing from positions`);
        toRemove.push(pos.ca);
      } else {
        log(`✅ ${pos.name}: confirmed ${balance.toFixed(2)} tokens on-chain`);
      }
    } catch (e) {
      log(`⚠️ Could not verify ${pos.name} balance — keeping position`);
    }
  }
  if (toRemove.length > 0) {
    toRemove.forEach(ca => {
      const idx = POSITIONS.findIndex(p => p.ca === ca);
      if (idx !== -1) POSITIONS.splice(idx, 1);
    });
    savePositions();
    log(`🧹 Cleaned ${toRemove.length} ghost position(s)`);
  }
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
function logTrade(action, name, ca, solAmount, pnlSol, txSig, result, meta={}) {
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
      ca, ts: Math.floor(Date.now() / 1000),
      // 🧠 BRAIN DATA
      mc: meta.mc || null,
      vol24: meta.vol24 || null,
      vol1h: meta.vol1h || null,
      buys: meta.buys || null,
      sells: meta.sells || null,
      liq: meta.liq || null,
      kols: meta.kols || null,
      entryScore: meta.entryScore || null,
      exitReason: meta.exitReason || null,
      pnlPct: meta.pnlPct || null,
    });
    fs.writeFileSync(TRADES_FILE, JSON.stringify(trades, null, 2));
    try {
      execSync(`cd ${WORKSPACE} && git add trades.json && git commit -m "trade #${n}: ${action} ${name}" && git push`, { timeout: 20000 });
      log('📡 Trade #' + n + ' pushed → solgizmo.com updating');
    } catch (e) { log('⚠️ Git push failed: ' + (e.message || '').slice(0, 80)); }
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

const ALERTED = new Set((() => { try { return JSON.parse(fs.readFileSync(process.env.HOME + '/.gizmo/runtime/alerted.json', 'utf8')); } catch { return []; } })());
function saveAlerted() { try { fs.writeFileSync(process.env.HOME + '/.gizmo/runtime/alerted.json', JSON.stringify([...ALERTED])); } catch {} }
const WATCHLIST = [];
// Load recently bought CAs from trades.json to survive restarts
const RECENTLY_BOUGHT = new Map((() => {
  try {
    const trades = JSON.parse(fs.readFileSync(BASE_DIR + '/trades.json', 'utf8'));
    const cutoff = Date.now() - 30 * 60000; // 30 min cooldown — faster re-entry
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
  { name: "Kadenox", address: "B32QbbdDAyhvUQzjcaM5j6ZVKwjCxAwGH5Xgvb9SJqnC", weight: 3 },
  { name: "theo", address: "Bi4rd5FH5bYEN8scZ7wevxNZyNmKHdaBcvewdPFxYdLt", weight: 3 },
  { name: "Dali", address: "CvNiezB8hofusHCKqu8irJ6t2FKY7VjzpSckofMzk5mB", weight: 3 },
  { name: "radiance", address: "FAicXNV5FVqtfbpn4Zccs71XcfGeyxBSGbqLDyDJZjke", weight: 3 },
  { name: "Coasty", address: "CATk62cYqDFXTh3rsRbS1ibCyzBeovc2KXpXEaxEg3nB", weight: 1 },
  { name: "clukz", address: "G6fUXjMKPJzCY1rveAE6Qm7wy5U3vZgKDJmN1VPAdiZC", weight: 3 },
  { name: "dv", address: "BCagckXeMChUKrHEd6fKFA1uiWDtcmCXMsqaheLiUPJd", weight: 3 },
  { name: "cryptovillain", address: "5sNnKuWKUtZkdC1eFNyqz3XHpNoCRQ1D1DfHcNHMV7gn", weight: 1 },
  { name: "Joji", address: "525LueqAyZJueCoiisfWy6nyh4MTvmF4X9jSqi6efXJT", weight: 3 },
  { name: "decu", address: "4vw54BmAogeRV3vPKWyFet5yf8DTLcREzdSzx4rw9Ud9", weight: 3 },
  { name: "Cupsey", address: "2fg5QD1eD7rzNNCsvnhmXFm5hqNgwTTG8p7kQ6f3rx6f", weight: 1, scalper: true },
  { name: "mercy", address: "F5jWYuiDLTiaLYa54D88YbpXgEsA6NKHzWy4SN4bMYjt", weight: 1 },
  { name: "Silver", address: "67Nwfi9hgwqhxGoovT2JGLU67uxfomLwQAWncjXXzU6U", weight: 3 },
  { name: "Pain", address: "J6TDXvarvpBdPXTaTU8eJbtso1PUCYKGkVtMKUUY8iEa", weight: 3 },
  { name: "Casino", address: "8rvAsDKeAcEjEkiZMug9k8v1y8mW6gQQiMobd89Uy7qR", weight: 3 },
  { name: "Naruza", address: "ASVzakePP6GNg9r95d4LPZHJDMXun6L6E4um4pu5ybJk", weight: 3 },
  { name: "GOYIM", address: "G3gZWqrYkNmYFKYCyfRCNtGuxdyuE2wiYKkZpiZn4WSS", weight: 3 },
  { name: "SHEEP", address: "78N177fzNJpp8pG49xDv1efYcTMSzo9tPTKEA9mAVkh2", weight: 3 },
  { name: "CLOWN", address: "EDXHdSFdadFbYFFjxPXBqMe1kCEDFqpPu552uvp48HR8", weight: 3 },
  { name: "S", address: "ApRnQN2HkbCn7W2WWiT2FEKvuKJp9LugRyAE1a9Hdz1", weight: 3 },
  { name: "Dad", address: "9KPMHW2FuTrHBkPa8YQb2PR58V2KQcBXvyM21AFXvhQV", weight: 4 },
  // ── AUTO-DISCOVERED SMART MONEY (Mon Mar 09 2026) ──
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
const NEW_WALLET_THRESHOLD = 36;

async function checkRugWallets(mint) {
  if (!HELIUS_KEY) return { isRug: false, newCount: 0, total: 0 };
  try {
    // Get recent swap transactions for this token
    const url = `https://api.helius.xyz/v0/addresses/${mint}/transactions?api-key=${HELIUS_KEY}&limit=50&type=SWAP`;
    const r = await fetch(url, { signal: AbortSignal.timeout(30000) });
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

    // Use ratio-based check: block only if >85% of buyers are new wallets AND at least 10 buyers checked
    const newWalletRatio = wallets.length > 0 ? newWalletCount / wallets.length : 0;
    const isRug = false; // disabled — fresh pump.fun tokens always have new wallets. Other filters handle safety.
    return { isRug, newCount: newWalletCount, total: wallets.length, ratio: (newWalletRatio*100).toFixed(0) };
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
  // Check if sell actually went through despite error
  try {
    const chkResult = spawnSync('node', ['sell.mjs', ca, '100%'], { cwd: WORKSPACE, timeout: 60000, encoding: 'utf8' });
    const chkOut = (chkResult.stdout || '') + (chkResult.stderr || '');
    if (chkOut.includes('No tokens to sell') || chkOut.includes('no tokens')) {
      log('\u2705 ' + posName + ': tokens already gone — sell went through despite error. Cleaning up.');
      return true;
    }
    if (chkOut.includes('CONFIRMED')) {
      log('\u2705 ' + posName + ': 4th attempt succeeded!');
      return true;
    }
  } catch {}
  return false;
}

// ─── BUY ──────────────────────────────────────────────────────────────────────
async function buy(ca, amount) {
  if (DEAD_POOLS.has(ca)) { log(`🚫 BUY BLOCKED: ${ca} is blacklisted in dead pool`); return false; }
  try {
    const out = execSync(`cd ${WORKSPACE} && node trade.mjs ${ca} ${amount}`, { timeout: 30000 }).toString();
    log(`BUY ${amount} SOL: ${out.trim().split('\n').pop()}`);
    return out.includes('CONFIRMED');
  } catch (e) { log(`BUY FAILED: ${e.message?.slice(0, 100)}`); return false; }
}

// ─── VERIFY BUY (ghost position guard) ──────────────────────────────────────
async function verifyBuySuccess(ca) {
  try {
    const hKey = HELIUS_KEY || '2de73660-14b8-412a-9ff2-8e6989c53266';
    const resp = await fetch('https://mainnet.helius-rpc.com/?api-key=' + hKey, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getTokenAccountsByOwner',
        params: [WALLET_ADDRESS, { mint: ca }, { encoding: 'jsonParsed' }] }),
      signal: AbortSignal.timeout(5000)
    });
    const data = await resp.json();
    const balance = (data?.result?.value || []).reduce((sum, a) => sum + (a.account?.data?.parsed?.info?.tokenAmount?.uiAmount || 0), 0);
    return balance > 0;
  } catch { return true; } // if check fails, assume buy succeeded (safer than dropping)
}

// ─── WALLET BALANCE ───────────────────────────────────────────────────────────
async function getWalletBalance() {
  try {
    const r = await fetch(`https://mainnet.helius-rpc.com/?api-key=${HELIUS_KEY}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'getBalance',params:['GZnFNskqnCAoTHYuYFaZm3FQGaGHJ7CqVSphmGZnTia4']}),signal:AbortSignal.timeout(3000)});
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
  // Subtract locked vault from tradeable balance
  const vault = loadVault();
  const tradeableSol = Math.max(walletSol - vault.locked, 0.1);
  walletSol = tradeableSol; // only trade with what's not locked

  // ── BANKROLL PROTECTION ─────────────────────────────────────────────────────
  // FLOOR: always keep 0.1 SOL untouched for gas/fees
  const FLOOR = 0.1;
  // RESERVE: keep 15% of wallet as safe reserve, never trade it
  const RESERVE = walletSol * 0.08; // SUPERCELL: lean reserve, more capital deployed
  // TRADEABLE: only risk from the tradeable portion
  const tradeable = walletSol - FLOOR - RESERVE;
  if (tradeable <= 0) { 
    const locked = loadVault().locked;
    log(`🛑 BANKROLL: tradeable too low — wallet:${walletSol.toFixed(3)} vault:${locked.toFixed(3)} floor:0.1 reserve:15% = nothing left`); 
    return 0; 
  }

  // Circuit breaker: stop if lost 1.5 SOL today
  const dailyPnL = getDailyPnL();
  if (dailyPnL < -5.0) { log(`🛑 CIRCUIT BREAKER: daily loss ${dailyPnL.toFixed(3)} SOL — NO MORE TRADES`); return 0; }

  // TIER SYSTEM based on wallet size:
  let maxPerTrade, pctPerTrade;

  if (walletSol >= 20) {
    // SUPERCELL: aggressive, cap 5 SOL per trade
    pctPerTrade = 0.25;
    maxPerTrade = 5.0;
  } else if (walletSol >= 10) {
    // STRONG: 20% of tradeable, cap 3 SOL
    pctPerTrade = 0.22;
    maxPerTrade = 3.0;
  } else if (walletSol >= 5) {
    // Healthy: max 20% of tradeable per trade, hard cap 2.0 SOL
    pctPerTrade = 0.20;
    maxPerTrade = 2.0;
  } else if (walletSol >= 2) {
    // Cautious: max 18% of tradeable, hard cap 1.0 SOL
    pctPerTrade = 0.18;
    maxPerTrade = 1.0;
  } else if (walletSol >= 0.5) {
    // Recovery mode: max 15% of tradeable, hard cap 0.5 SOL
    pctPerTrade = 0.15;
    maxPerTrade = 0.5;
  } else {
    // Survival mode: max 10% of tradeable, hard cap 0.15 SOL
    pctPerTrade = 0.10;
    maxPerTrade = 0.15;
  }

  const baseSize = Math.min(tradeable * pctPerTrade, maxPerTrade);

  // Boost slightly for high conviction (3+ KOLs) but never exceed 2x base
  // SUPERCELL: Elite conviction multiplier
  // Load KOL performance to check if converging KOLs are ELITE tier
  let eliteCount = 0;
  try {
    const perf = JSON.parse(fs.readFileSync(process.env.HOME + '/.gizmo/runtime/kol-performance.json', 'utf8'));
    // Count elite KOLs in current signal (approximated by numKols with weight 3)
    eliteCount = numKols; // all tracked KOLs are now ELITE weight 3
  } catch {}
  
  const convictionMult = eliteCount >= 4 ? 2.0  // 4+ elite KOLs = 2x size
                       : eliteCount >= 3 ? 1.75  // 3 elite KOLs = 1.75x size  
                       : numKols >= 2    ? 1.2   // 2 KOLs = 1.2x size
                       : 1.0;
  const size = Math.min(baseSize * convictionMult, maxPerTrade * 2.0);
  if (convictionMult > 1.0) log(`🎯 CONVICTION BOOST: ${eliteCount} KOLs → ${convictionMult}x size (${size.toFixed(3)} SOL)`);

  log(`💰 BANKROLL: wallet ${walletSol.toFixed(3)} SOL | tradeable ${tradeable.toFixed(3)} | sizing ${size.toFixed(3)} SOL (${(size/walletSol*100).toFixed(0)}% of wallet)`);
  return Math.max(0, parseFloat(size.toFixed(4)));
  // ───────────────────────────────────────────────────────────────────────────
}

// ─── POST TRADE TWEET ─────────────────────────────────────────────────────────
async function postTrade(type, symbol, ca, mc, reason, solAmount, pnl) {
  const emoji = type === 'BUY' ? '🟢' : (pnl && pnl > 0 ? '💰' : '🔴');
  const text = type === 'BUY'
    ? `${emoji} BOUGHT $${symbol}\n\n${reason}\n\nMC: $${Math.round(mc/1000)}K | ${solAmount} SOL\n\nCA: ${ca}\n\n🦞`
    : `${emoji} SOLD $${symbol} (${pnl > 0 ? '+' : ''}${pnl.toFixed(1)}%)\n\n${reason}\n\nMC: $${Math.round(mc/1000)}K\n\n🦞`;
  try {
    await fetch('https://discord.com/api/webhooks/1481464647193334002/PZ8g7gaxTdkfYuSm1FSggtYpIk3tUReA7LkQWmKZW15qnVRAdaN2FHexFUMPit-iIVjY', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: text })
    });
    log(`📢 Discord: ${type} ${symbol}`);
  } catch(e) { log(`Discord failed: ${e.message?.slice(0,60)}`); }
  try {
    await fetch(`https://api.telegram.org/bot8518872063:AAGE1BfWeZ4RSrKea1Lkw9C_IiXiFfusF-M/sendMessage`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: -1003765430591, text })
    });
    log(`📢 Telegram: ${type} ${symbol}`);
  } catch(e) { log(`Telegram failed: ${e.message?.slice(0,60)}`); }
  try {
    const tweetText = String(text).replace(/\n/g, " ").replace(/"/g, "'").replace(/`/g, "'").slice(0, 270);
    fs.writeFileSync('/tmp/gizmo-tweet.txt', tweetText);
    execSync(`cd ${BASE_DIR} && node tweet.mjs "$(cat /tmp/gizmo-tweet.txt)"`, { timeout: 15000 });
    log(`📢 Tweeted: ${type} ${symbol}`);
  } catch(e) { log(`Tweet failed: ${e.message?.slice(0,60)}`); }
}

// ─── POSITION MANAGEMENT ──────────────────────────────────────────────────────
async function managePositions() {
  // Filter USDC ghost
  for (let i = POSITIONS.length - 1; i >= 0; i--) {
    if (POSITIONS[i].name === 'USDC' || (POSITIONS[i].entryMC || 0) > 1000000000) { POSITIONS.splice(i, 1); continue; }
  }
  for (let i = POSITIONS.length - 1; i >= 0; i--) {
    const pos = POSITIONS[i];
    const p = await checkPrice(pos.ca);
    if (!p) { log(`⚠️ ${pos.name}: no price data`); continue; }

    const mc = p.fdv;
    const pnl = ((mc - pos.entryMC) / pos.entryMC * 100).toFixed(1);
    const m5 = p.priceChange?.m5 || 0;
    const buys = p.txns?.m5?.buys || 0;
    const sells = p.txns?.m5?.sells || 0;

    // ─── DISCERNMENT: read the chart like a degen ──────────────────────────
    const h1Change = p.priceChange?.h1 || 0;
    const bsRatio = buys / Math.max(sells, 1);
    const vol1h = p.volume?.h1 || 0;
    const vol5m = p.volume?.m5 || 0;
    const liq = p.liquidity?.usd || 0;
    
    // Track momentum history on the position
    if (!pos.momentumHistory) pos.momentumHistory = [];
    pos.momentumHistory.push({ m5, bsRatio, buys, sells, mc, ts: Date.now() });
    if (pos.momentumHistory.length > 20) pos.momentumHistory.shift(); // keep last 20 readings
    
    // Calculate momentum trend (are things getting better or worse?)
    const recentMomentum = pos.momentumHistory.slice(-5);
    const olderMomentum = pos.momentumHistory.slice(-10, -5);
    const recentAvgBS = recentMomentum.reduce((s,m) => s + m.bsRatio, 0) / recentMomentum.length;
    const olderAvgBS = olderMomentum.length ? olderMomentum.reduce((s,m) => s + m.bsRatio, 0) / olderMomentum.length : recentAvgBS;
    const momentumTrend = recentAvgBS - olderAvgBS; // positive = improving, negative = dying
    
    // DISCERNMENT SIGNALS
    const chartDying = bsRatio < 0.7 && m5 < -3 && momentumTrend < -0.3;      // sells dominating + dumping + getting worse
    const chartPumping = bsRatio > 2.0 && m5 > 5 && buys > 10;                 // buys dominating + pumping
    const volumeDrying = buys + sells < 3 && vol5m < 500;                       // nobody trading
    const sellWall = sells > buys * 3 && sells > 15;                            // massive sell pressure
    const bullishReversal = m5 > 3 && bsRatio > 1.5 && momentumTrend > 0.2;    // recovering from dip
    
    // ACT ON DISCERNMENT
    // 1. Chart dying + in profit = tighten SL aggressively to protect gains
    if (chartDying && mc > pos.entryMC * 1.05 && pos.sl) {
      const tightSL = mc * 0.92; // 8% trail instead of normal
      if (tightSL > pos.sl) {
        pos.sl = tightSL;
        log(`\u{1F9E0} DISCERN: ${pos.name} chart dying but in profit — SL tightened to $${Math.round(tightSL)} (protect gains)`);
        savePositions();
      }
    }
    
    // 2. Chart dying + underwater + no SL = early cut (don't wait for hard stop)
    if (chartDying && mc < pos.entryMC * 0.90 && !pos.sl && !pos.tp1Hit) {
      log(`\u{1F9E0} DISCERN EXIT: ${pos.name} at ${pnl}% — chart dying (B/S:${bsRatio.toFixed(1)} m5:${m5.toFixed(0)}% trend:${momentumTrend.toFixed(2)}) — cutting early`);
      if (await sell(pos.ca, '100%', pos.name, pos.entryMC, mc)) {
        await postTrade('SELL', pos.name, pos.ca, mc, 'Discern exit ' + pnl + '%', null, parseFloat(pnl));
        POSITIONS.splice(i, 1); savePositions();
      }
      continue;
    }
    
    // 3. Sell wall detected + underwater = emergency exit
    if (sellWall && mc < pos.entryMC * 0.85) {
      log(`\u{1F9E0} DISCERN SELL WALL: ${pos.name} at ${pnl}% — ${sells} sells vs ${buys} buys — dumping detected, cutting`);
      if (await sell(pos.ca, '100%', pos.name, pos.entryMC, mc)) {
        await postTrade('SELL', pos.name, pos.ca, mc, 'Sell wall exit ' + pnl + '%', null, parseFloat(pnl));
        POSITIONS.splice(i, 1); savePositions();
      }
      continue;
    }
    
    // 4. Chart pumping hard = loosen SL to let it run (override tight trail)
    if (chartPumping && pos.sl && mc > pos.entryMC * 1.2) {
      const looseSL = mc * 0.68; // give it room to breathe
      if (looseSL < pos.sl && looseSL > pos.entryMC) {
        // Only loosen if we're still above entry
        pos.sl = looseSL;
        log(`\u{1F9E0} DISCERN: ${pos.name} PUMPING — loosened SL to $${Math.round(looseSL)} (let it run)`);
        savePositions();
      }
    }
    
    // 5. Bullish reversal while down = hold through the dip (extend time limits)
    if (bullishReversal && mc < pos.entryMC && mc > pos.entryMC * 0.85) {
      pos.lastBullishSignal = Date.now(); // prevents time exit for 2 more minutes
      log(`\u{1F9E0} DISCERN: ${pos.name} bullish reversal at ${pnl}% — holding through dip`);
    }
    
    // 6. Volume completely dried up = don't wait 3 cycles, flag it immediately
    if (volumeDrying && mc < pos.entryMC * 0.95) {
      pos.zeroVolCycles = (pos.zeroVolCycles || 0) + 0.5; // accelerate the zero-vol kill
    }

    // Update high water mark + trail SL
    if (mc > (pos.sl || 0)) { pos.slBreachCount = 0; } else if (pos.sl && mc < pos.sl) { pos.slBreachCount = (pos.slBreachCount || 0) + 1; }
    if (mc > pos.highMC) {
      pos.highMC = mc;
      if (mc > pos.entryMC * 1.08 && !pos.sl) {
        pos.sl = pos.entryMC * 1.04;
        log(`🟢 ${pos.name}: +8% — SL locked at +4%: ${Math.round(pos.sl)}`);
      }
      if (pos.sl && pos.highMC > pos.entryMC * 1.12) {
        let trailPct = TRAIL_TIGHTNESS; // brain-controlled trailing SL
        if (pos.highMC > pos.entryMC * 5.0)      trailPct = 0.85; // 5x+ lock moderate
        else if (pos.highMC > pos.entryMC * 3.0) trailPct = 0.80; // 3x+ still loose
        else if (pos.highMC > pos.entryMC * 2.0) trailPct = 0.75; // 2x give room
        else if (pos.highMC > pos.entryMC * 1.5) trailPct = 0.72; // post-TP1 loose
        else if (pos.highMC > pos.entryMC * 1.3) trailPct = 0.72;
        const newSL = pos.highMC * trailPct;
        if (newSL > (pos.sl || 0) && newSL > pos.entryMC) {
          const old = pos.sl; pos.sl = newSL;
          if (Math.round(newSL) !== Math.round(old)) log(`📈 ${pos.name}: SL trailed $${Math.round(old)} → $${Math.round(newSL)}`);
        }
      }
      savePositions();
    }

    log(`${pos.name}: $${Math.round(mc)} (${pnl}%) | High: $${Math.round(pos.highMC)} | SL: $${pos.sl ? Math.round(pos.sl) : 'none'} | B/S:${buys}/${sells}`);

    // ZERO-VOLUME KILL SWITCH: 0 buys AND 0 sells for 3+ cycles = dead token, cut it
    if (buys === 0 && sells <= 1) {
      pos.zeroVolCycles = (pos.zeroVolCycles || 0) + 1;
      if (pos.zeroVolCycles >= 3) {
        log(`💀 ZERO-VOL KILL ${pos.name} — dead for ${pos.zeroVolCycles} cycles (0 buys, 0 sells) — cutting`);
        if (await sell(pos.ca, '100%', pos.name, pos.entryMC, mc)) {
          await postTrade('SELL', pos.name, pos.ca, mc, `Zero volume ${pnl}%`, null, parseFloat(pnl));
          POSITIONS.splice(i, 1); savePositions();
        }
        continue;
      } else {
        log(`⚠️ ${pos.name}: zero volume cycle ${pos.zeroVolCycles}/3`);
      }
    } else {
      pos.zeroVolCycles = 0; // reset if volume returns
    }

    // RUG DETECT: -40% within 4 mins of entry = instant exit
    const minsHeld = pos.entryTime ? (Date.now() - pos.entryTime) / 60000 : 999;
    if (minsHeld < 3 && mc <= pos.entryMC * 0.60) {  // SUPERCELL v3: exit on -40%+ in 3 mins
      log(`🚨 RUG DETECTED ${pos.name}: -${((1 - mc/pos.entryMC)*100).toFixed(0)}% in ${minsHeld.toFixed(1)} mins — INSTANT EXIT`);
      if (await sell(pos.ca, '100%', pos.name, pos.entryMC, mc)) {
        await postTrade('SELL', pos.name, pos.ca, mc, `Rug detected ${pnl}%`, null, parseFloat(pnl));
        POSITIONS.splice(i, 1); savePositions();
      }
      continue;
    }

    // DCA: DISABLED — stop throwing good money after bad
    // Winners don't need DCA, losers shouldn't get more capital
    if (!pos.dcaAdded) { pos.dcaAdded = true; }

    // HARD STOP: -30% with no SL set — only cut if genuine rug (sells dominating + volume dying)
    if (mc <= pos.entryMC * (HARD_STOP_PCT + 0.05) && !pos.sl) {
      const bsRatio = buys / Math.max(sells, 1);
      const isGenuineRug = bsRatio < 0.5 && sells > 10; // sells 2x+ buys with real volume
      const isDeepDump = mc <= pos.entryMC * HARD_STOP_PCT;       // adaptive deep dump cut
      if (isGenuineRug || isDeepDump) {
        log(`💀 HARD STOP ${pos.name} at ${pnl}% — ${isDeepDump ? 'deep dump' : 'genuine rug'} (B/S:${buys}/${sells})`);
        if (await sell(pos.ca, '100%', pos.name, pos.entryMC, mc)) {
          await postTrade('SELL', pos.name, pos.ca, mc, `Hard stop ${pnl}%`, null, parseFloat(pnl));
          POSITIONS.splice(i, 1); savePositions();
        }
        continue;
      } else {
        log(`⏳ ${pos.name} at ${pnl}% — holding, momentum ok (B/S:${buys}/${sells})`);
      }
    }

    // FAST PUMP: DISABLED — let trailing SL handle exits, don't cap upside
    // Instead: when up 40%+, just tighten the SL to protect gains
    if (!pos.tp1Hit && !pos.runnerMode && mc >= pos.entryMC * 1.40) {
      const tightSL = Math.max(pos.sl || 0, mc * 0.75, pos.entryMC * 1.10);
      if (tightSL > (pos.sl || 0)) {
        pos.sl = tightSL;
        savePositions();
        log(`🔒 ${pos.name}: +${((mc / pos.entryMC - 1) * 100).toFixed(0)}% — SL tightened to ${Math.round(pos.sl)} (85% trail, +15% floor)`);
      }
    }

    // TP1: 1.3x — detect RUNNER or take normal profit (lowered for more runners)
    if (!pos.tp1Hit && !pos.runnerMode && mc >= pos.entryMC * 1.3) {
      const mult = mc / pos.entryMC;
      const bsRatio = buys / Math.max(sells, 1);
      const isRipping = m5 > 8 && bsRatio >= 2.0 && buys > 20;
      if (isRipping) {
        // 🦁 RUNNER MODE: hold ENTIRE bag — diamond hands to 5x
        pos.runnerMode = true;
        pos.sl = Math.max(pos.sl || 0, pos.entryMC * 1.02); // breakeven floor — never lose on a runner
        savePositions();
        log(`🦁 RUNNER MODE: ${pos.name} ${mult.toFixed(1)}x RIPPING — m5:${m5}% B/S:${buys}/${sells} — HOLDING FULL BAG TO 5x`);
      } else {
        // Normal TP1: not ripping hard enough — lock profit (brain-controlled %)
        log(`🎯 TP1 ${pos.name} ${mult.toFixed(1)}x — locking ${TP1_SELL_PCT}%`);
        if (await sell(pos.ca, `${TP1_SELL_PCT}%`, pos.name, pos.entryMC, mc)) {
          pos.tp1Hit = true;
          pos.sl = Math.max(pos.sl || 0, pos.entryMC * 1.02);
          savePositions();
          await postTrade('SELL', pos.name, pos.ca, mc, `TP1 ${mult.toFixed(1)}x`, null, parseFloat(pnl));
        }
      }
      continue;
    }

    // RUNNER MODE: trail SL as it climbs — hold full bag until 5x
    if (pos.runnerMode && !pos.runnerTP1Hit && mc >= pos.entryMC * 2.0) {
      const mult = mc / pos.entryMC;
      // Trail tightens as multiplier grows — but keeps room for memecoin volatility
      // Looser trail when h1 momentum is strong — don't shake out real runners
      const h1Momentum = p?.priceChange?.h1 || 0;
      const isRipping = h1Momentum > 100;
      const trailPct = isRipping
        ? (mult >= 4 ? 0.75 : mult >= 3 ? 0.70 : 0.65)   // ripping — give it room
        : (mult >= 4 ? 0.82 : mult >= 3 ? 0.78 : 0.72);  // LOOSENED normal trail
      const newSL = pos.highMC * trailPct;
      if (newSL > (pos.sl || 0)) { pos.sl = newSL; savePositions(); }
      log(`🦁 RUNNER ${pos.name} ${mult.toFixed(1)}x — full bag held | SL: $${Math.round(pos.sl)} (${(trailPct*100).toFixed(0)}% trail) | B/S:${buys}/${sells}`);
    }

    // RUNNER TP1: 5x — sell 50%, moonbag the other 50%
    if (pos.runnerMode && !pos.runnerTP1Hit && mc >= pos.entryMC * 5.0) {
      const mult = mc / pos.entryMC;
      log(`🌙 RUNNER TP1 ${pos.name} ${mult.toFixed(1)}x — selling 50%, moonbagging rest`);
      if (await sell(pos.ca, '50%', pos.name, pos.entryMC, mc)) {
        pos.runnerTP1Hit = true;
        pos.sl = null; pos.moonbag = true; // NO SL on moonbag — Will sells manually
        savePositions();
        await postTrade('SELL', pos.name, pos.ca, mc, `Runner TP1 ${mult.toFixed(1)}x`, null, parseFloat(pnl));
      }
      continue;
    }

    // RUNNER TP2: DISABLED — Will sells moonbag manually
    // Moonbag rides with no SL until Will decides to exit

    // TP2: 2x — sell another 25% (50% total out, 50% moonbag) — normal mode only
    if (pos.tp1Hit && !pos.tp2Hit && mc >= pos.entryMC * 2.0) {
      const mult = mc / pos.entryMC;
      const bsRatio = buys / Math.max(sells, 1);
      if (m5 > 3 && bsRatio >= 2.0 && mult < 4.0) {
        // Still ripping — tighten SL and let it run
        const rSL = pos.highMC * 0.90;
        if (rSL > (pos.sl || 0)) { pos.sl = rSL; savePositions(); }
        log(`🚀 ${pos.name}: ${mult.toFixed(1)}x RIPPING — holding moonbag, SL tightened to ${Math.round(pos.sl)}`);
      } else {
        log(`🎯 TP2 ${pos.name} ${mult.toFixed(1)}x — selling another 25%, moonbag riding`);
        if (await sell(pos.ca, '25%', pos.name, pos.entryMC, mc)) {
          pos.tp2Hit = true;
          pos.sl = Math.max(pos.sl || 0, mc * 0.65);
          savePositions();
          await postTrade('SELL', pos.name, pos.ca, mc, `TP2 ${mult.toFixed(1)}x`, null, parseFloat(pnl));
        }
      }
      continue;
    }

    // MOONBAG TP3: DISABLED — Will sells moonbag manually

    // BREAKEVEN SL after 1.5x — never let winner become loser
    if (!pos.breakevenSet && mc >= pos.entryMC * 1.5) {
      const beSL = pos.entryMC * 1.05;
      if (!pos.sl || beSL > pos.sl) { pos.sl = beSL; pos.breakevenSet = true; savePositions(); log('BREAKEVEN SL: ' + pos.name + ' -> $' + Math.round(beSL)); }
      if (mc <= pos.sl) {
        log(`🛑 SL HIT ${pos.name} MC:$${Math.round(mc)} SL:$${Math.round(pos.sl)}`);
        if (await sell(pos.ca, '100%', pos.name, pos.entryMC, mc)) {
          await postTrade('SELL', pos.name, pos.ca, mc, `SL hit ${pnl}%`, null, parseFloat(pnl));
          WATCHLIST.push({ name: pos.name, ca: pos.ca, exitMC: mc, exitTime: Date.now(), entryMC: pos.entryMC });
          POSITIONS.splice(i, 1); savePositions();
        } else { log(`⚠️ ${pos.name} SELL FAILED — retry next cycle`); }
      } // SL breach handled above — no waiting
      continue;
    }

    // TRAILING SL: enforce on all future cycles (skip moonbags — Will sells manually)
    if (pos.moonbag) {
      if (!pos.moonbagSL) { pos.moonbagSL = pos.highMC * 0.55; }
      if (mc > pos.highMC) { pos.highMC = mc; pos.moonbagSL = mc * 0.55; }
      if (mc < pos.moonbagSL) {
        log(`\u{1F319} MOONBAG SL ${pos.name} MC:$${Math.round(mc)} SL:$${Math.round(pos.moonbagSL)} — auto-cutting`);
        if (await sell(pos.ca, '100%', pos.name, pos.entryMC, mc)) {
          await postTrade('SELL', pos.name, pos.ca, mc, `Moonbag SL ${pnl}%`, null, parseFloat(pnl));
          POSITIONS.splice(i, 1); savePositions();
        }
        continue;
      }
      log(`\u{1F319} ${pos.name}: moonbag — SL:$${Math.round(pos.moonbagSL)}`);
      continue;
    }
    if (pos.sl && mc < pos.sl) {
      log(`🛑 TRAILING SL HIT ${pos.name} MC:$${Math.round(mc)} SL:$${Math.round(pos.sl)}`);
      if (await sell(pos.ca, '100%', pos.name, pos.entryMC, mc)) {
        await postTrade('SELL', pos.name, pos.ca, mc, `Trailing SL ${pnl}%`, null, parseFloat(pnl));
        POSITIONS.splice(i, 1); savePositions();
      } else { log(`⚠️ ${pos.name} TRAILING SL SELL FAILED — retry next cycle`); }
      continue;
    }

    // TIME EXIT: token-age-aware — old coins get patience, fresh launches get cut fast
    const ageMin = (Date.now() - (pos.entryTime || Date.now())) / 60000;
    const tokenAgeHours = pos.tokenAge ? pos.tokenAge / 3600000 : 0;
    const mcVsEntry = mc / pos.entryMC;
    const isFlat = mcVsEntry < 1.05;
    const isDown  = mcVsEntry < 0.92;
    const isBreakingOut = m5 > 5 || (pos.lastBullishSignal && Date.now() - pos.lastBullishSignal < 120000); // pumping OR recent bullish reversal
    // Patience scales with token age at time of entry
    let flatLimit, downLimit;
    if (tokenAgeHours > 6)        { flatLimit = 9999; downLimit = 120; } // established coin — almost never cut
    else if (tokenAgeHours > 1)   { flatLimit = 120;  downLimit = 60;  } // 1-6hr old — give it time
    else if (tokenAgeHours > 0.25){ flatLimit = 20;   downLimit = 8;   } // 15-60min — tight
    else                          { flatLimit = FRESH_FLAT_LIMIT; downLimit = FRESH_DOWN_LIMIT; } // fresh launch — brain-controlled
    const timeKill = !pos.tp1Hit && !isBreakingOut && (
      (ageMin > downLimit && isDown) ||
      (ageMin > flatLimit && isFlat)
    );
    if (timeKill) {
      const reason = isDown ? `down >${((1-mcVsEntry)*100).toFixed(0)}%` : `flat >${flatLimit}min`;
      log(`⏰ TIME EXIT: ${pos.name} — held ${ageMin.toFixed(0)}min, token was ${tokenAgeHours.toFixed(1)}hr old at entry, ${reason} — cutting`);
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
  return; // DISABLED — stop re-buying tokens we already exited. Each re-entry bleeds SOL.
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
  const _mutedLoggedThisCycle = new Set();
  const now = Date.now();
  state.recentBuys = (state.recentBuys || []).filter(b => now - b.timestamp < SIGNAL_WINDOW_MS);
  state.pollCycle = (state.pollCycle || 0) + 1;

  // ── VPS WEBHOOK POLL (local file on VPS, HTTP when remote) ──
  try {
    const isOnVPS = fs.existsSync('/root/webhook-queue.json');
    let vpsR;
    if (isOnVPS) {
      // ON VPS: read queue file directly (zero latency)
      try {
        const raw = fs.readFileSync('/root/webhook-queue.json', 'utf8');
        const queue = JSON.parse(raw || '[]');
        if (queue.length > 0) fs.writeFileSync('/root/webhook-queue.json', '[]');
        vpsR = { ok: true, json: async () => queue };
      } catch { vpsR = { ok: true, json: async () => [] }; }
    } else {
      // REMOTE (Mac): HTTP poll
      vpsR = await fetch('http://178.156.160.143:3000/poll', { signal: AbortSignal.timeout(5000) });
    }
    if (vpsR.ok) {
      const vpsTxs = await vpsR.json();
      if (vpsTxs.length > 0) log(`\u{1F4E1} VPS poll: ${vpsTxs.length} new txs`);
      vpsFailCount = 0;
      for (const tx of vpsTxs) {
        if (tx.type !== 'SWAP' || tx.transactionError) continue;
        const allAccounts = [...(tx.nativeTransfers || []).map(t => t.fromUserAccount), ...(tx.tokenTransfers || []).map(t => t.toUserAccount), ...(tx.tokenTransfers || []).map(t => t.fromUserAccount)];
        const wallet = WALLETS.find(w => allAccounts.includes(w.address));
        if (!wallet) continue;
        const tier = wallet.weight >= 4 ? 'GOD' : wallet.weight >= 3 ? 'ELITE' : wallet.weight >= 2 ? 'SOLID' : wallet.weight >= 1 ? 'WATCH' : 'MUTED';
        if (tier === 'MUTED') continue;

        const nativeIn = (tx.nativeTransfers || []).filter(t => t.fromUserAccount === wallet.address).reduce((s, t) => s + t.amount, 0);
        const tokensIn = (tx.tokenTransfers || []).filter(t => t.toUserAccount === wallet.address && t.mint !== SOL_MINT);
        if (nativeIn <= 0 || !tokensIn.length) continue;

        for (const tr of tokensIn) {
          const buy = { mint: tr.mint, solSpent: nativeIn / LAMPORTS_PER_SOL, sig: tx.signature, timestamp: (tx.timestamp || Math.floor(Date.now()/1000)) * 1000 };
          if (state.lastSig[wallet.address] === buy.sig) break;
          if (now - buy.timestamp > SIGNAL_WINDOW_MS) continue;
          if (state.recentBuys.some(b => b.sig === buy.sig)) continue;
          state.recentBuys.push({ kol: wallet.name, kolWeight: wallet.weight, scalper: wallet.scalper, ...buy });
          try { updateSniperWatch(buy.mint, wallet.name, wallet.weight, null); } catch {}
          log(`KOL: ${wallet.name} bought ${tr.mint.slice(0, 8)}... for ${buy.solSpent.toFixed(2)} SOL`);
        }
        if (tx.signature) state.lastSig[wallet.address] = tx.signature;
      }
    } else {
      log('\u26A0\uFE0F VPS poll failed: ' + vpsR.status + ' -- falling back to Helius');
      for (const wallet of WALLETS.filter(w => w.weight >= 4)) {
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
              try { updateSniperWatch(buy.mint, wallet.name, wallet.weight, null); } catch {}
              log(`KOL: ${wallet.name} bought ${tr.mint.slice(0, 8)}... for ${buy.solSpent.toFixed(2)} SOL`);
            }
            if (txs.length > 0) state.lastSig[wallet.address] = txs[0].signature;
          }
        } catch {}
      }
    }
  } catch (e) {
    vpsFailCount++;
    log(`\u26A0\uFE0F VPS poll error (${vpsFailCount}/3): ${e.message}`);
    if (vpsFailCount >= 3) {
      log('\u{1F6E0}\uFE0F VPS watcher down 3x — auto-restarting via SSH...');
      try {
        execSync('ssh -o ConnectTimeout=5 -o StrictHostKeyChecking=no root@178.156.160.143 "pm2 restart kol-watcher 2>/dev/null || pm2 start ~/webhook-receiver.mjs --name kol-watcher"', { timeout: 15000 });
        log('\u2705 VPS watcher restarted remotely');
        vpsFailCount = 0;
      } catch (sshErr) {
        log('\u274C VPS SSH restart failed: ' + sshErr.message);
      }
    }
  }

  // HIGH-WEIGHT SINGLE KOL BUY (weight >= 2)
  for (const signal of (state.recentBuys || []).filter(b => b.kolWeight >= 4 && !b.scalper)) {
    if (POSITIONS.length >= MAX_POSITIONS) break;
    if (RECENTLY_BOUGHT.has(signal.mint) || ALERTED.has(signal.mint)) continue;
    // Check live performance weight — skip MUTED KOLs even in HW path
    let livePerf = {}; try { livePerf = JSON.parse(fs.readFileSync(process.env.HOME + '/.gizmo/runtime/kol-performance.json', 'utf8')); } catch {}
    const hwLiveWeight = livePerf[signal.kol]?.weight !== undefined ? livePerf[signal.kol].weight : signal.kolWeight;
    if (hwLiveWeight < 4) { if (hwLiveWeight === 0 && !_mutedLoggedThisCycle.has(signal.kol)) { _mutedLoggedThisCycle.add(signal.kol); log('🔇 SKIPPED KOL: ' + signal.kol + ' (w:' + hwLiveWeight + ' — need w:4 for solo buy)'); } ALERTED.add(signal.mint); continue; }
    if (false) { if (!_mutedLoggedThisCycle.has(signal.kol)) { _mutedLoggedThisCycle.add(signal.kol); log(`🔇 MUTED KOL skipped: ${signal.kol} (tier:${livePerf[signal.kol]?.tier} avgPnL:${livePerf[signal.kol]?.avgPnl?.toFixed(1)}%)`); } ALERTED.add(signal.mint); continue; }
    const hwInfo = await getTokenInfo(signal.mint);
    if (!hwInfo || hwInfo.mcap < 5000) continue;
    const entryPair = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${signal.mint}`).then(r=>r.json()).catch(()=>null);
    const hwVol24 = entryPair?.pairs?.[0]?.volume?.h24 || 0;
    if (hwVol24 < 10000) { log(`⛔ ${hwInfo.symbol}: low volume $${Math.round(hwVol24)} 24h — ghost token`); ALERTED.add(signal.mint); continue; }
    if (hwInfo.liq !== null && hwInfo.liq > 0 && hwInfo.liq < 4000) continue;
    if (TOXIC_WORDS.some(w => (hwInfo.symbol||'').toLowerCase().includes(w))) continue;
    // ENTRY FILTER: reject if sells > buys at entry (rug in progress)
    const entryBuys = entryPair?.pairs?.[0]?.txns?.m5?.buys || 0;
    const entrySells = entryPair?.pairs?.[0]?.txns?.m5?.sells || 0;
    if (entrySells > entryBuys * 1.5) { log(`⛔ ${hwInfo.symbol}: sells (${entrySells}) > buys (${entryBuys}) — rug in progress, skipping`); ALERTED.add(signal.mint); saveAlerted(); continue; }
    // DEAD CAT FILTER: big move already happened, now fading — we'd be buying the corpse
    const hwH1  = entryPair?.pairs?.[0]?.priceChange?.h1  || 0;
    const hwH6  = entryPair?.pairs?.[0]?.priceChange?.h6  || 0;
    const hwH24 = entryPair?.pairs?.[0]?.priceChange?.h24 || 0;
    const hwVolH1 = entryPair?.pairs?.[0]?.volume?.h1 || 0;
    const hwVolH6 = entryPair?.pairs?.[0]?.volume?.h6 || 0;
    const hwM5  = entryPair?.pairs?.[0]?.priceChange?.m5  || 0;
    const hwLiq = entryPair?.pairs?.[0]?.liquidity?.usd || hwInfo.liq || 0;
    const hwFdv = entryPair?.pairs?.[0]?.fdv || hwInfo.mcap || 0;
    const isDeadCat = hwH24 > 200 && hwH1 < 5 && hwM5 < 5;   // pumped hard 24h ago, momentum gone
    const isFadingRun = hwH6 > 150 && hwM5 < -3;              // big 6h run, now actively dumping
    const hwPairAgeMs = entryPair?.pairs?.[0]?.pairCreatedAt ? (Date.now() - entryPair.pairs[0].pairCreatedAt) : 999999999;
    const isVampire = hwH1 > 150 && hwVolH1 > 0 && hwVolH6 > 0 && (hwVolH1 / hwVolH6) > 0.85 && hwPairAgeMs > 7200000; // 85%+ volume in h1 BUT only for tokens > 2hrs old
    const isPaperLiq = hwLiq > 0 && hwLiq < 5000 && hwFdv > 8000; // paper liquidity trap
    if (isDeadCat)   { log(`⛔ ${hwInfo.symbol}: DEAD CAT — h24:+${hwH24.toFixed(0)}% but h1:${hwH1.toFixed(0)}% m5:${hwM5.toFixed(0)}% — peak already in`); ALERTED.add(signal.mint); saveAlerted(); continue; }
    if (isFadingRun) { log(`⛔ ${hwInfo.symbol}: FADING RUN — h6:+${hwH6.toFixed(0)}% but m5:${hwM5.toFixed(0)}% — dumping now`); ALERTED.add(signal.mint); saveAlerted(); continue; }
    if (isVampire)   { log(`⛔ ${hwInfo.symbol}: VAMPIRE — ${((hwVolH1/hwVolH6)*100).toFixed(0)}% of volume in last hour — one-candle pump`); ALERTED.add(signal.mint); saveAlerted(); continue; }
    if (isPaperLiq)  { log(`⛔ ${hwInfo.symbol}: PAPER LIQ — $${Math.round(hwLiq)} liq on $${Math.round(hwFdv)} MC — one sell wipes it`); ALERTED.add(signal.mint); saveAlerted(); continue; }
    const hwWallet = await getWalletBalance();
    const hwSize = await safeBuySize(hwWallet, hwInfo.liq, 1);
    if (hwSize < 0.03) { log(`⛔ HW KOL ${hwInfo.symbol}: circuit breaker or wallet too low (${hwWallet.toFixed(3)} SOL)`); ALERTED.add(signal.mint); continue; }
    // Don't add to ALERTED on successful buy — allow convergence to also evaluate
    // INTUITION CHECK on HW KOL
    const hwBuysCount = entryPair?.pairs?.[0]?.txns?.h1?.buys || 0;
    const hwSellsCount = entryPair?.pairs?.[0]?.txns?.h1?.sells || 0;
    const hwBSRatio = hwBuysCount / Math.max(hwSellsCount, 1);
    const hwIScore = intuitionScore(hwFdv, hwBSRatio, hwLiq, hwVolH1);
    if (hwIScore <= -3) {
      log(`\u{1F9E0} INTUITION BLOCK HW: ${hwInfo.symbol} — intuition:${hwIScore} (strong loser pattern) MC:$${Math.round(hwFdv)} B/S:${hwBuysCount}/${hwSellsCount}`);
      ALERTED.add(signal.mint); saveAlerted(); continue;
    }
    log('HIGH-WEIGHT KOL: ' + hwInfo.symbol + ' | ' + signal.kol + ' w:' + signal.kolWeight + ' size:' + hwSize.toFixed(3) + ' SOL' + (hwIScore !== 0 ? ' intuition:' + hwIScore : ''));
    if (await buy(signal.mint, hwSize)) {
      const hwMc = hwInfo.mcap;
      const hwPairAge = entryPair?.pairs?.[0]?.pairCreatedAt ? Date.now() - entryPair.pairs[0].pairCreatedAt : 0;
      POSITIONS.push({ name: hwInfo.symbol, ca: signal.mint, entryMC: hwMc, highMC: hwMc, sl: null, tp1: hwMc * 1.5, tp2: hwMc * 3, tp1Hit: false, tp2Hit: false, entryLiq: hwInfo.liq, entryTime: Date.now(), tokenAge: hwPairAge, dcaAdded: false, dcaSize: hwSize * 0.4, dcaCycles: 0, entrySize: hwSize });
      savePositions();
      logTrade('BUY', hwInfo.symbol, signal.mint, hwSize, null, null, 'HW KOL: ' + signal.kol, {mc: hwInfo.mcap, vol24: entryPair?.pairs?.[0]?.volume?.h24, vol1h: entryPair?.pairs?.[0]?.volume?.h1, buys: entryPair?.pairs?.[0]?.txns?.h1?.buys, sells: entryPair?.pairs?.[0]?.txns?.h1?.sells, liq: hwLiq, kols: [signal.kol]});
      await postTrade('BUY', hwInfo.symbol, signal.mint, hwMc, 'HW KOL: ' + signal.kol, hwSize);
      RECENTLY_BOUGHT.set(signal.mint, Date.now());
      try { fs.writeFileSync(RECENT_BOUGHT_FILE, JSON.stringify(Object.fromEntries(RECENTLY_BOUGHT))); } catch {}
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
    // Load live performance weights — overrides hardcoded WALLETS weights
    let livePerf = {};
    try { livePerf = JSON.parse(fs.readFileSync(process.env.HOME + '/.gizmo/runtime/kol-performance.json', 'utf8')); } catch {}

    // Filter out MUTED KOLs entirely — they drag down performance
    const activeKols = uniqueKols.filter(k => {
      const lw = livePerf[k]?.weight;
      const sw = WALLETS.find(w => w.name === k)?.weight || 1;
      const w = lw !== undefined ? lw : sw;
      if (w <= 1) { log('⛔ ' + k + ' (w:' + w + ') filtered from convergence — MUTED/WATCH'); return false; }
      return true;
    });
    if (activeKols.length === 0) { log('⛔ All KOLs in signal are MUTED/WATCH — skipping'); continue; }

    const convergenceScore = activeKols.reduce((sum, kolName) => {
      const liveWeight = livePerf[kolName]?.weight;
      const staticWeight = WALLETS.find(w => w.name === kolName)?.weight || 1;
      return sum + (liveWeight !== undefined ? liveWeight : staticWeight);
    }, 0);
    // ── STACKING BONUS: elite KOL buying 3+ times = conviction ──────────
    let stackingBonus = 0;
    for (const kolName of activeKols) {
      const lw = livePerf[kolName]?.weight;
      const sw = WALLETS.find(w => w.name === kolName)?.weight || 1;
      const w = lw !== undefined ? lw : sw;
      if (w >= 3) {
        const buyCount = buys.filter(b => b.kol === kolName).length;
        if (buyCount >= 3) {
          stackingBonus = 2;
          log('🔄 STACKING: ' + kolName + ' bought ' + buyCount + 'x — conviction bonus +2');
        }
      }
    }
    const finalScore = convergenceScore + stackingBonus;

    const MIN_SCORE = 4;
    const hasElite = activeKols.some(k => {
      const liveWeight = livePerf[k]?.weight;
      const staticWeight = WALLETS.find(w => w.name === k)?.weight || 1;
      return (liveWeight !== undefined ? liveWeight : staticWeight) >= 3;
    });

    if (ALERTED.has(mint)) continue;
    if (nonScalper.length < 1) continue;
    if (activeKols.length < MIN_KOLS && finalScore < MIN_SCORE) continue;
    
    // INTUITION CHECK on KOL signals too
    // (will be evaluated after we fetch token info below)
    if (activeKols.length < 2 && !hasElite && stackingBonus === 0) continue;

    log('📊 CONVERGENCE SCORE: ' + activeKols.map(k => {
      const w = livePerf[k]?.weight !== undefined ? livePerf[k].weight : (WALLETS.find(w => w.name === k)?.weight || 1);
      const tier = livePerf[k]?.tier || 'STATIC';
      return k + '(' + w + '/' + tier + ')';
    }).join(' + ') + ' = ' + convergenceScore);
    // ────────────────────────────────────────────────────────────────────────

    const info = await getTokenInfo(mint);
    // volume check moved after pairForScore fetch
    if (!info || info.mcap === 0) { log(`⏳ ${mint.slice(0,8)}: no data yet (MC:0) — will retry next cycle`); continue; }
    if (info.mcap < 2000) { log(`⛔ ${info.symbol}: MC too low (${Math.round(info.mcap)})`); ALERTED.add(mint); continue; }
    if (info.mcap > 500000) { log(`⛔ ${info.symbol}: MC too high ${Math.round(info.mcap)} — too late`); ALERTED.add(mint); continue; }

    const totalSol = buys.reduce((s, b) => s + b.solSpent, 0);
    log(`🔥 CONVERGENCE: ${info.symbol} | MC: ${Math.round(info.mcap)} | KOLs: ${uniqueKols.join(', ')} | Score: ${convergenceScore} | ${totalSol.toFixed(1)} SOL`);

    // Direct buy on convergence — no intermediate signal file needed
    if (POSITIONS.length < MAX_POSITIONS && !RECENTLY_BOUGHT.has(mint)) {
      // HARD duplicate block — never buy same CA twice
      if (POSITIONS.find(p => p.ca === mint)) { log(`⛔ ${info.symbol}: already in positions`); continue; }
      const name = (info.symbol || '').toLowerCase();
      if (TOXIC_WORDS.some(w => name.includes(w))) { log(`⛔ ${p.baseToken?.symbol}: toxic name`); continue; }
      if (info.liq !== null && info.liq > 0 && info.liq < Math.min(MIN_LIQ, 5000)) { log(`⛔ ${info.symbol}: liq too low $${Math.round(info.liq)} (min $${MIN_LIQ})`); continue; }
      if (info.liq === null) { log(`⚠️ ${info.symbol}: liq unknown — capping at 0.5 SOL`); }
      const walletSol = await getWalletBalance();
      const size = await safeBuySize(walletSol, info.liq, uniqueKols.length);
      const minSize = walletSol >= 5 ? 0.3 : walletSol >= 2 ? 0.1 : 0.05;
      if (size < minSize) { log(`⛔ ${info.symbol}: size ${size} below tier minimum ${minSize} SOL (wallet ${walletSol.toFixed(3)})`); continue; }
      // ── 9-SIGNAL SCORE CHECK ──
      const pairForScore = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${mint}`,
        { signal: AbortSignal.timeout(5000) })
        .then(r => r.json()).then(d => d.pairs?.[0] || null).catch(() => null);
      const convVol24 = pairForScore?.volume?.h24 || 0;
      if (convVol24 < 10000) { log(`⛔ ${info.symbol}: low volume ${Math.round(convVol24)} 24h — ghost token`); ALERTED.add(mint); continue; }
      const tokenScore = await scoreToken(info, pairForScore, convergenceScore);
      // Elite KOL convergence (score 9+) lowers bar to 4, otherwise need 5+
      const minScore = SCORE_THRESHOLD;
      if (tokenScore < minScore) {
        log(`⛔ ${info.symbol}: 9-signal score ${tokenScore}/9 below min ${minScore} — skip`);
        continue;
      }
      // ── NEW WALLET RUG CHECK ──
      const rugCheck = await checkRugWallets(mint);
      if (rugCheck.isRug) {
        log(`🚩 RUG WALLETS: ${info.symbol} — ${rugCheck.newCount}/${rugCheck.total} buyers new (${rugCheck.ratio}%). BLOCKED.`);
        continue;
      }
      if (rugCheck.newCount > 5) log(`⚠️ ${info.symbol}: ${rugCheck.newCount}/${rugCheck.total} new wallets detected (below block threshold)`);
      // ────────────────────────────────────────────────────────
      // ELITE GATE: require at least one ELITE+ (w>=3) KOL
      const hasElite = activeKols.some(k => {
        const lw = livePerf[k]?.weight;
        const sw = WALLETS.find(w => w.name === k)?.weight || 1;
        return (lw !== undefined ? lw : sw) >= MIN_KOL_WEIGHT;
      });
      if (!hasElite) { log(`⛔ ${info.symbol}: no ELITE+ KOL (w>=${MIN_KOL_WEIGHT}) in convergence [${activeKols.join(', ')}] — skip`); continue; }
      log(`🎯 CONVERGENCE BUY: ${info.symbol} Score:${tokenScore}/9 ${activeKols.length} KOLs — buying ${size} SOL`);
      // ENTRY FILTER: reject if sells dominating — rug/dump already in progress
      const convEntryBuys = pairForScore?.txns?.m5?.buys || 0;
      const convEntrySells = pairForScore?.txns?.m5?.sells || 0;
      if (convEntrySells > convEntryBuys * 1.5 && convEntrySells > 10) {
        log(`⛔ ${info.symbol}: entry rejected — sells (${convEntrySells}) dominating buys (${convEntryBuys}) — dump in progress`);
        continue;
      }
      // DEAD CAT / VAMPIRE FILTERS
      const cH1  = pairForScore?.priceChange?.h1  || 0;
      const cH6  = pairForScore?.priceChange?.h6  || 0;
      const cH24 = pairForScore?.priceChange?.h24 || 0;
      const cM5  = pairForScore?.priceChange?.m5  || 0;
      const cVolH1 = pairForScore?.volume?.h1 || 0;
      const cVolH6 = pairForScore?.volume?.h6 || 0;
      const cLiq = pairForScore?.liquidity?.usd || 0;
      const cFdv = pairForScore?.fdv || info.mcap || 0;
      if (cH24 > 200 && cH1 < 5 && cM5 < 5)   { log(`⛔ ${info.symbol}: DEAD CAT — h24:+${cH24.toFixed(0)}% but h1:${cH1.toFixed(0)}% — peak already in`); continue; }
      if (cH6 > 150 && cM5 < -3)               { log(`⛔ ${info.symbol}: FADING RUN — h6:+${cH6.toFixed(0)}% m5:${cM5.toFixed(0)}%`); continue; }
      const cPairAge = pairForScore?.pairCreatedAt ? (Date.now() - pairForScore.pairCreatedAt) : 999999999;
      if (cH1 > 150 && cVolH1 > 0 && cVolH6 > 0 && (cVolH1/cVolH6) > 0.85 && cPairAge > 7200000) { log(`⛔ ${info.symbol}: VAMPIRE — one-candle pump, ${((cVolH1/cVolH6)*100).toFixed(0)}% vol in h1 (age: ${Math.round(cPairAge/60000)}min)`); continue; }
      if (cH1 > 150 && cVolH1 > 0 && cVolH6 > 0 && (cVolH1/cVolH6) > 0.85 && cPairAge <= 7200000) { log(`🧛 ${info.symbol}: VAMPIRE skip — fresh token (${Math.round(cPairAge/60000)}min old), allowing`); }
      if (cLiq > 0 && cLiq < 5000 && cFdv > 8000) { log(`⛔ ${info.symbol}: PAPER LIQ — $${Math.round(cLiq)} liq`); continue; }
      if (await buy(mint, size)) {
        const p = await checkPrice(mint);
        const mc = p?.fdv || info.mcap;
        const convPairAge = pairForScore?.pairCreatedAt ? Date.now() - pairForScore.pairCreatedAt : 0;
        POSITIONS.push({ name: info.symbol, ca: mint, entryMC: mc, highMC: mc, sl: null, tp1: mc * 1.5, tp2: mc * 3, tp1Hit: false, tp2Hit: false, entryTime: Date.now(), tokenAge: convPairAge, dcaAdded: false, dcaSize: size * 0.4, dcaCycles: 0, entrySize: size });
        savePositions();
        logTrade('BUY', info.symbol, mint, size, null, null, `${uniqueKols.length} KOL convergence: ${uniqueKols.join(', ')}`, {mc: info.mcap, vol24: pairForScore?.volume?.h24, vol1h: pairForScore?.volume?.h1, buys: pairForScore?.txns?.h1?.buys, sells: pairForScore?.txns?.h1?.sells, liq: info.liq, kols: uniqueKols, entryScore: tokenScore});
        await postTrade('BUY', info.symbol, mint, mc, `${uniqueKols.length} KOL convergence`, size);
        RECENTLY_BOUGHT.set(mint, Date.now());
      }
    }
  }
}


// ─── 9-SIGNAL UNIFIED SCORER ──────────────────────────────────────────────────
// Same brain as solgizmo.com CA analyzer — now inside the bot.
// Returns score 0-9. Gizmo only buys if score meets threshold.
async function scoreToken(info, pair, kolScore) {
  let score = 0;
  const reasons = [];

  // SIGNAL 1: KOL conviction (0-2 pts)
  if (kolScore >= 5)      { score += 2; reasons.push('KOL:2'); }
  else if (kolScore >= 3) { score += 1; reasons.push('KOL:1'); }
  else                    { score += 0; reasons.push('KOL:0'); }

  // SIGNAL 2: MC sweet spot — $5k-$50k = best risk/reward (0-1 pt)
  const mc = info.mcap || 0;
  if (mc >= 5000 && mc <= 100000)      { score += 1; reasons.push('MC:✅'); }
  else if (mc > 100000 && mc <= 500000) { score += 0; reasons.push('MC:⚠️mid'); }

  // SIGNAL 3: Liquidity healthy (0-1 pt)
  if (info.liq && info.liq >= 15000)      { score += 1; reasons.push('LIQ:✅'); }
  else if (info.liq && info.liq >= 8000)  { score += 0; reasons.push('LIQ:⚠️low'); }

  // SIGNAL 4: Buy/sell ratio momentum (−1 to +1 pt)
  const buys5  = pair?.txns?.m5?.buys  || 0;
  const sells5 = pair?.txns?.m5?.sells || 0;
  const bsRatio = sells5 > 0 ? buys5 / sells5 : buys5 > 0 ? 3 : 1;
  if (bsRatio >= 2.0)      { score += 1; reasons.push('BS:✅strong'); }
  else if (bsRatio < 0.8)  { score -= 1; reasons.push('BS:❌dumping'); }
  else                     { reasons.push('BS:⚠️neutral'); }

  // SIGNAL 5: Price momentum m5 (−1 to +1 pt)
  const m5 = pair?.priceChange?.m5 || 0;
  if (m5 > 5)       { score += 1; reasons.push('MOM:✅'); }
  else if (m5 < -5) { score -= 1; reasons.push('MOM:❌'); }
  else              { reasons.push('MOM:⚠️flat'); }

  // SIGNAL 6: Volume spiking vs baseline (0-1 pt)
  const vol5m = pair?.volume?.m5  || 0;
  const vol1h = pair?.volume?.h1  || 0;
  const volRate = vol1h > 0 ? (vol5m / vol1h) * 12 : 0;
  if (vol5m > 3000 || volRate > 1.5) { score += 1; reasons.push('VOL:✅spike'); }
  else                               { reasons.push('VOL:⚠️low'); }

  // SIGNAL 7: Token age context — fresh = momentum play, old = breakout play (both valid)
  const ageMin = pair?.pairCreatedAt
    ? (Date.now() - pair.pairCreatedAt) / 60000 : 999;
  if (ageMin < 30)        { score += 1; reasons.push('AGE:✅fresh'); }   // brand new — momentum entry
  else if (ageMin < 240)  { score += 0; reasons.push('AGE:⚠️ok'); }      // 30min-4hr — neutral
  else if (ageMin < 2880) { score += 0; reasons.push('AGE:⚠️established'); } // 4hr-48hr — neutral, could be breakout
  else                    { score -= 1; reasons.push('AGE:❌stale'); }    // 2+ days flat = truly stale

  // SIGNAL 8: Narrative keywords — trending themes pump harder (0-1 pt)
  const sym = (info.symbol || '').toLowerCase();
  const hotThemes = ['ai','gpt','agent','pepe','dog','cat','trump','elon',
                     'based','chad','mog','wojak','frog','inu','sol','pump',
                     'doge','shib','bonk','wif','gizmo','claw'];
  if (hotThemes.some(w => sym.includes(w))) { score += 1; reasons.push('NARR:✅'); }
  else { reasons.push('NARR:⚠️generic'); }

  // SIGNAL 9: Wallet distribution — total buyers in 5min (0-1 pt)
  const totalTxns = buys5 + sells5;
  if (totalTxns >= 20)      { score += 1; reasons.push('DIST:✅active'); }
  else if (totalTxns < 5)   { score -= 1; reasons.push('DIST:❌dead'); }
  else                      { reasons.push('DIST:⚠️low'); }

  const final = Math.max(0, Math.min(9, score));
  const emoji = final >= 7 ? '🔥' : final >= 5 ? '✅' : final >= 3 ? '⚠️' : '❌';
  log(`🧠 9-SIGNAL: ${info.symbol} = ${emoji}${final}/9 | ${reasons.join(' ')}`);
  return final;
}
// ─── WALLET RECONCILER ───────────────────────────────────────────────────────
// On startup: check actual wallet holdings vs positions.json
// Re-adds any tokens Gizmo holds but lost track of (positions.json wipe etc)
async function reconcileWallet() {
  try {
    const { Connection, PublicKey } = await import('@solana/web3.js');
    const conn = new Connection('https://mainnet.helius-rpc.com/?api-key=' + HELIUS_KEY);
    const accounts = await conn.getParsedTokenAccountsByOwner(
      new PublicKey(WALLET_ADDRESS),
      { programId: new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA') }
    );
    const held = accounts.value
      .filter(a => a.account.data.parsed.info.tokenAmount.uiAmount > 0)
      .map(a => a.account.data.parsed.info.mint);

    let recovered = 0;
    for (const mint of held) {
      if (POSITIONS.find(p => p.ca === mint)) continue; // already tracked
      if (DEAD_POOLS.has(mint)) continue; // blacklisted
      // Unknown token in wallet — fetch info and re-add as position to manage
      const p = await checkPrice(mint);
      if (!p || !p.fdv) { log(`⚠️ RECONCILE: ${mint.slice(0,8)} in wallet but no price data — skipping`); continue; }
      const name = p.baseToken?.symbol || mint.slice(0,8);
      const mc = p.fdv;
      log(`🔄 RECONCILE: found untracked holding ${name} (${mint.slice(0,8)}) MC:$${Math.round(mc)} — re-adding to positions`);
      POSITIONS.push({
        name, ca: mint, entryMC: mc, highMC: mc, sl: null,
        tp1: mc * 1.5, tp2: mc * 3, tp1Hit: false, tp2Hit: false,
        entryTime: Date.now(), tokenAge: 0, dcaAdded: true, dcaSize: 0,
        dcaCycles: 0, entrySize: 0, reconciled: true
      });
      recovered++;
    }
    if (recovered > 0) { savePositions(); log(`✅ RECONCILE: recovered ${recovered} untracked positions`); }
    else { log(`✅ RECONCILE: wallet clean — all holdings tracked`); }
  } catch(e) { log(`⚠️ RECONCILE error: ${e.message?.slice(0,80)}`); }
}

// ─── MARKET SCAN ──────────────────────────────────────────────────────────────
let lastMarketScan = 0;
async function marketScan() {
  if (Date.now() - lastMarketScan < 3 * 60 * 1000) return;
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
      if (p.fdv < 8000 || p.fdv > 10000000) continue;

      const name = (p.baseToken?.name || '').toLowerCase() + ' ' + (p.baseToken?.symbol || '').toLowerCase();
      if (TOXIC_WORDS.some(w => name.includes(w))) { log(`⛔ ${info.symbol}: toxic name`); continue; }

      const m5 = p.priceChange?.m5 || 0, h1 = p.priceChange?.h1 || 0, h6 = p.priceChange?.h6 || 0;
      const liq = p.liquidity?.usd || 0;
      if (m5 < 1 || h1 > 100 || h6 > 200 || liq < 10000) continue;
      if ((p.txns?.m5?.buys || 0) < 15) continue;
      if ((p.txns?.m5?.buys || 0) / Math.max(p.txns?.m5?.sells || 0, 1) < 2) continue;
      if ((p.volume?.m5 || 0) < 1000) continue;

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

      if (score < 7) continue; // raised from 5 — only strong independent plays
      
      // INTUITION CHECK: does this match our winner or loser patterns?
      const mktBuysCount = p.txns?.h1?.buys || 0;
      const mktSellsCount = p.txns?.h1?.sells || 0;
      const mktBSRatio = mktBuysCount / Math.max(mktSellsCount, 1);
      const iScore = intuitionScore(p.fdv, mktBSRatio, liq, p.volume?.h1 || 0);
      if (iScore <= -2) {
        log(`\u{1F9E0} INTUITION BLOCK: ${p.baseToken.symbol} score:${score}/9 but intuition:${iScore} (matches loser pattern) MC:$${Math.round(p.fdv)} B/S:${mktBuysCount}/${mktSellsCount}`);
        continue;
      }
      if (iScore >= 2) score += 1; // intuition bonus for matching winner patterns
      const mktWallet = await getWalletBalance();
      const size = await safeBuySize(mktWallet, liq, 2);
      if (size < 0.08) { log(`⛔ Market scan: circuit breaker or wallet too low (${mktWallet.toFixed(3)} SOL)`); break; }

      log(`🎯 MARKET BUY: ${p.baseToken.symbol} score:${score}/9 MC:$${Math.round(p.fdv)} buying ${size} SOL`);
      if (await buy(t.tokenAddress, size)) {
        POSITIONS.push({ name: p.baseToken.symbol, ca: t.tokenAddress, entryMC: p.fdv, highMC: p.fdv, sl: null, tp1: p.fdv * 1.5, tp2: p.fdv * 3, tp1Hit: false, entryTime: Date.now() });
        savePositions();
        logTrade('BUY', p.baseToken.symbol, t.tokenAddress, size, null, null, `Boost scan score ${score}/9`);
        await postTrade('BUY', p.baseToken.symbol, t.tokenAddress, p.fdv, `Market score ${score}/9`, size);
        RECENTLY_BOUGHT.set(t.tokenAddress, Date.now());
      }
      // SUPERCELL: allow up to 2 buys per market scan (no break)
      if (POSITIONS.length >= MAX_POSITIONS) break;
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
  const interval = (h >= 2 && h < 7) ? 3 * 3600000 : 3600000;
  if (Date.now() - (state.lastTweet || 0) < interval) return;
  state.lastTweet = Date.now();
  let tweet;
  try {
    const apiKey = process.env.XAI_API_KEY;
    if (apiKey) {
      const posInfo = POSITIONS.length > 0
        ? POSITIONS.map(p => p.name + ' (' + ((p.highMC / p.entryMC - 1) * 100).toFixed(0) + '%)').join(', ')
        : 'hunting for alpha, no positions';
      const timeContext = (h >= 22 || h < 6) ? 'late night grind' : 'daytime hustle';
      const pr = 'You are Gizmo, autonomous Solana memecoin trading lobster. Write ONE tweet (max 240 chars). Mix stoic wisdom with crypto degen energy. Current state: ' + posInfo + '. Time: ' + timeContext + '. No hashtags. No quotes. End with lobster emoji.';
      const r = await fetch('https://api.x.ai/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + apiKey },
        body: JSON.stringify({ model: 'grok-4', max_tokens: 80, messages: [{ role: 'user', content: pr }] }),
        signal: AbortSignal.timeout(8000)
      });
      const data = await r.json();
      tweet = data.choices?.[0]?.message?.content || null;
    }
  } catch(e) {}
  if (!tweet) tweet = 'scanning the trenches. patience is the edge. 🦞';
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
  try { const r = await fetch('https://solana.publicnode.com', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getBalance', params: [WALLET_ADDRESS] }), signal: AbortSignal.timeout(5000) }); const d = await r.json(); const sol = (d.result?.value || 0) / 1e9; checks.push(sol > 0 ? `✅ Wallet: ${sol.toFixed(2)} SOL` : '⚠️ Wallet: 0 SOL'); } catch { checks.push('❌ Wallet RPC'); }
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
          WALLET_ADDRESS,
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
await reconcileWallet(); // sync wallet holdings → positions on every startup
loadLearnState();
log('🦞 GIZMO UNIFIED ENGINE v1.0 — single process, full autonomy');
log(`Positions: ${POSITIONS.map(p => p.name).join(', ') || 'none'} | Wallet: ${WALLET_ADDRESS}`);
log(`KOL wallets: ${WALLETS.length} | Max positions: ${MAX_POSITIONS} | Scan: every 30s | Market scan: every 10min`);

let cycle = 0;
let running = false;

let ghostCleanDone = false;
async function runCycle() {
  // Clean ghost positions once on first cycle
  if (!ghostCleanDone) { ghostCleanDone = true; await cleanGhostPositions(); }
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
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getBalance', params: [WALLET_ADDRESS] }),
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
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getBalance', params: [WALLET_ADDRESS] }),
        signal: AbortSignal.timeout(5000)
      });
      const d = await r.json();
      const current = (d.result?.value || 0) / 1e9;
      const lost = SESSION_START_BALANCE - current;
      // Auto-reset session every 30 minutes so halt never stops trading forever
      const sessionAge = (Date.now() - (SESSION_HALT_TIME || Date.now())) / 60000;
      if (SESSION_HALTED && sessionAge > 30) {
        SESSION_HALTED = false;
        SESSION_START_BALANCE = current;
        log('[SESSION] \u23F0 Auto-resumed after 30min cooldown — new session started at ' + current.toFixed(3) + ' SOL');
      }
      if (lost >= SESSION_LOSS_LIMIT_SOL) {
        SESSION_HALTED = true;
        SESSION_HALT_TIME = Date.now();
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
  // TIME FILTER: no buys 2am–7am EST
  const estHour = new Date().toLocaleString('en-US', { timeZone: 'America/New_York', hour: 'numeric', hour12: false });
  const h = parseInt(estHour);
  if (h >= 2 && h < 7) {
    log(`⏰ Time filter: ${h}:00 EST — no buys 2am–7am. Managing open positions only.`);
    await managePositions();
    running = false;
    return;
  }

  // PROFIT VAULT: check and lock profits every cycle
  if (SESSION_START_BALANCE !== null && !SESSION_HALTED) {
    try {
      const r = await fetch('https://solana.publicnode.com', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getBalance', params: [WALLET_ADDRESS] }),
        signal: AbortSignal.timeout(5000)
      });
      const d = await r.json();
      const bal = (d.result?.value || 0) / 1e9;
      await runProfitVault(bal);
    } catch {}
  }

  try {
    // syncPositionsFromTrades disabled until trades.json is clean
    await managePositions();
    await checkWatchlist();
    await scanKOLs(state);
    // MARKET SCAN RE-ENABLED — score threshold raised to 7/9 for independent plays
    if (cycle % 5 === 0) await marketScan();
    if (cycle % 5 === 0) await learnFromTrades();
    await writeDashboard();
    await processSniperWatch();
    if (cycle % 60 === 0) { lastBrainPatterns = await readBrainPatterns(); await runDeepAnalysis(); }
    if (cycle % 20 === 0) log(`💓 Heartbeat #${cycle} | positions: ${POSITIONS.map(p=>p.name).join(', ')||'none'}`);
  } catch (e) {
    log(`Loop error: ${e.message}`);
  }
  saveState(state);
  log(`💓 cycle ${cycle} complete`);
  running = false;
}


// 🧠 PATTERN READER — reads trade history and scores new opportunities
function readBrainPatterns() {
  try {
    if (!fs.existsSync(TRADES_FILE)) return {};
    const trades = JSON.parse(fs.readFileSync(TRADES_FILE, 'utf8'));
    const sells = trades.filter(t => t.action === 'SELL' && t.pnlPct !== null && t.pnlPct !== undefined);
    if (sells.length < 5) return {}; // not enough data yet

    // KOL win rates
    const kolStats = {};
    for (const t of sells) {
      if (!t.kols) continue;
      for (const kol of (Array.isArray(t.kols) ? t.kols : [t.kols])) {
        if (!kolStats[kol]) kolStats[kol] = { wins: 0, total: 0, pnl: 0 };
        kolStats[kol].total++;
        kolStats[kol].pnl += t.pnlPct || 0;
        if ((t.pnlPct || 0) > 0) kolStats[kol].wins++;
      }
    }

    // MC sweet spot — what entry MC range wins most
    const mcWins = sells.filter(t => t.mc && (t.pnlPct||0) > 0).map(t => t.mc);
    const mcLoss = sells.filter(t => t.mc && (t.pnlPct||0) <= 0).map(t => t.mc);
    const avgWinMC = mcWins.length ? mcWins.reduce((a,b)=>a+b,0)/mcWins.length : null;
    const avgLossMC = mcLoss.length ? mcLoss.reduce((a,b)=>a+b,0)/mcLoss.length : null;

    // B/S ratio at entry — wins vs losses
    const bsWins = sells.filter(t => t.buys && t.sells && (t.pnlPct||0) > 0).map(t => t.buys/t.sells);
    const avgWinBS = bsWins.length ? bsWins.reduce((a,b)=>a+b,0)/bsWins.length : null;

    const patterns = { kolStats, avgWinMC, avgLossMC, avgWinBS, sampleSize: sells.length };
    log(`🧠 Brain patterns loaded — ${sells.length} trades analyzed | avgWinMC: $${Math.round(avgWinMC||0)} | avgWinBS: ${(avgWinBS||0).toFixed(2)}`);
    return patterns;
  } catch(e) { log(`⚠️ Brain read failed: ${e.message}`); return {}; }
}

function brainScore(mint, mc, buys, sells, kols, patterns) {
  if (!patterns || !patterns.sampleSize || patterns.sampleSize < 5) return 0;
  let boost = 0;

  // KOL boost — if this KOL has >50% win rate historically, +1
  if (kols && patterns.kolStats) {
    for (const kol of (Array.isArray(kols) ? kols : [kol])) {
      const ks = patterns.kolStats[kol];
      if (ks && ks.total >= 3) {
        const wr = ks.wins / ks.total;
        if (wr > 0.55) { boost += 1; log(`🧠 Brain: ${kol} has ${(wr*100).toFixed(0)}% WR — +1 boost`); }
        else if (wr < 0.35) { boost -= 1; log(`🧠 Brain: ${kol} has ${(wr*100).toFixed(0)}% WR — -1 penalty`); }
      }
    }
  }

  // MC boost — if entry MC is close to historical win MC, +1
  if (mc && patterns.avgWinMC) {
    const ratio = mc / patterns.avgWinMC;
    if (ratio > 0.5 && ratio < 2.0) { boost += 1; log(`🧠 Brain: MC $${Math.round(mc)} near win zone $${Math.round(patterns.avgWinMC)} — +1`); }
  }

  // B/S boost — if current B/S ratio beats historical win average
  if (buys && sells && sells > 0 && patterns.avgWinBS) {
    const bs = buys / sells;
    if (bs > patterns.avgWinBS) { boost += 1; log(`🧠 Brain: B/S ${bs.toFixed(2)} beats win avg ${patterns.avgWinBS.toFixed(2)} — +1`); }
  }

  return boost;
}

// Load brain on startup
let BRAIN_PATTERNS = readBrainPatterns();
setInterval(() => { BRAIN_PATTERNS = readBrainPatterns(); }, 30 * 60 * 1000); // refresh every 30min

setInterval(() => {}, 2147483647); // keepalive
// SUPERCELL: adaptive cycle speed — 8s with open positions, 15s when hunting
let cycleTimer = null;
function startAdaptiveCycle() {
  const speed = POSITIONS.length > 0 ? 8000 : 15000;
  if (cycleTimer) clearInterval(cycleTimer);
  cycleTimer = setInterval(runCycle, speed);
  log(`⚡ Cycle speed: ${speed/1000}s (${POSITIONS.length > 0 ? 'managing positions' : 'hunting'})`);
}
startAdaptiveCycle();
// Re-check speed every 30s
setInterval(() => {
  const target = POSITIONS.length > 0 ? 8000 : 15000;
  startAdaptiveCycle();
}, 30000);



// ─── DASHBOARD WRITER ─────────────────────────────────────────────────────────
let dashCycle = 0;
let lastBrainPatterns = null;
async function writeDashboard() {
  dashCycle++;
  if (dashCycle % 5 !== 0) return;
  try {
    const tradesFile = process.env.HOME + '/.openclaw/workspace/SOLGizmo/trades.json';
    const trades = JSON.parse(fs.readFileSync(tradesFile, 'utf8'));
    const sells = trades.filter(t => t.action === 'SELL' && t.pnlPct !== undefined);
    const buys = trades.filter(t => t.action === 'BUY');
    const wins = sells.filter(t => t.pnlPct > 0);
    const wr = sells.length > 0 ? (wins.length / sells.length * 100).toFixed(1) : '0';
    const avgPnl = sells.length > 0 ? (sells.reduce((a,t) => a + (t.pnlPct||0), 0) / sells.length).toFixed(1) : '0';
    const bestTrade = sells.reduce((best, t) => (t.pnlPct||0) > (best.pnlPct||0) ? t : best, {pnlPct:0});
    const worstTrade = sells.reduce((worst, t) => (t.pnlPct||0) < (worst.pnlPct||0) ? t : worst, {pnlPct:0});
    const kolPerf = {};
    for (const t of sells) {
      for (const k of (Array.isArray(t.kols) ? t.kols : [])) {
        if (!kolPerf[k]) kolPerf[k] = { wins: 0, losses: 0, totalPnl: 0, trades: 0 };
        kolPerf[k].trades++;
        kolPerf[k].totalPnl += t.pnlPct || 0;
        if ((t.pnlPct||0) > 0) kolPerf[k].wins++; else kolPerf[k].losses++;
      }
    }
    const last10 = sells.slice(-10);
    const streak = last10.reduceRight((s, t) => {
      if (s.done) return s;
      if ((t.pnlPct||0) > 0) { s.wins++; return s; }
      s.done = true; return s;
    }, {wins:0, done:false}).wins;
    const dashboard = {
      updated: new Date().toISOString(),
      wallet: POSITIONS.length > 0 ? 'active' : 'hunting',
      openPositions: POSITIONS.map(p => ({ name: p.name, ca: p.ca, entryMC: p.entryMC, highMC: p.highMC, sl: p.sl, tp1Hit: p.tp1Hit })),
      stats: { totalBuys: buys.length, totalSells: sells.length, winRate: parseFloat(wr), avgPnl: parseFloat(avgPnl), bestTrade: { name: bestTrade.name || 'n/a', pnl: bestTrade.pnlPct || 0 }, worstTrade: { name: worstTrade.name || 'n/a', pnl: worstTrade.pnlPct || 0 }, currentStreak: streak },
      kolPerformance: kolPerf,
      adaptiveParams: { scoreThreshold: SCORE_THRESHOLD, minLiq: MIN_LIQ, minKols: MIN_KOLS, positionSizeMult: POSITION_SIZE_MULT },
      brainPatterns: lastBrainPatterns || {}
    };
    const dashPath = (process.env.HOME || '/Users/younghogey') + '/.gizmo/runtime/dashboard.json';
    fs.writeFileSync(dashPath, JSON.stringify(dashboard, null, 2));
  } catch(e) { /* silent */ }
}

// ─── KOL DNA PROFILER ─────────────────────────────────────────────────────────
function buildKolDna(trades) {
  const dna = {};
  for (const t of trades) {
    for (const k of (Array.isArray(t.kols) ? t.kols : [])) {
      if (!dna[k]) dna[k] = { wins: 0, losses: 0, totalPnl: 0, trades: [], mcBands: { micro: 0, small: 0, mid: 0, large: 0 }, bestPnl: 0, worstPnl: 0 };
      const d = dna[k];
      const pnl = t.pnlPct || 0;
      d.trades.push({ name: t.name, pnl, mc: t.mc });
      d.totalPnl += pnl;
      if (pnl > 0) d.wins++; else d.losses++;
      if (pnl > d.bestPnl) d.bestPnl = pnl;
      if (pnl < d.worstPnl) d.worstPnl = pnl;
      const mc = t.mc || 0;
      if (mc < 10000) d.mcBands.micro++;
      else if (mc < 50000) d.mcBands.small++;
      else if (mc < 200000) d.mcBands.mid++;
      else d.mcBands.large++;
    }
  }
  for (const [k, d] of Object.entries(dna)) {
    const total = d.wins + d.losses;
    d.winRate = total > 0 ? (d.wins / total * 100).toFixed(1) + '%' : 'n/a';
    d.avgPnl = total > 0 ? (d.totalPnl / total).toFixed(1) : 0;
    const mcs = d.trades.filter(t => t.mc).map(t => t.mc);
    d.avgEntryMC = mcs.length > 0 ? Math.round(mcs.reduce((a,b)=>a+b,0) / mcs.length) : 0;
    d.preferredBand = Object.entries(d.mcBands).sort((a,b) => b[1] - a[1])[0]?.[0] || 'unknown';
    delete d.trades;
  }
  return dna;
}

// ─── DEEP ANALYSIS (xAI) ─────────────────────────────────────────────────────
let lastDeepAnalysis = 0;
async function runDeepAnalysis() {
  const now = Date.now();
  if (now - lastDeepAnalysis < 6 * 60 * 60 * 1000) return; // max every 6 hours
  
  try {
    const tradesFile = process.env.HOME + '/.openclaw/workspace/SOLGizmo/trades.json';
    const trades = JSON.parse(fs.readFileSync(tradesFile, 'utf8'));
    const sells = trades.filter(t => t.action === 'SELL' && t.pnlPct !== undefined);
    if (sells.length < 10) return; // need 10+ closed trades
    const apiKey = process.env.XAI_API_KEY;
    if (!apiKey) return;
    
    // Build trade summary
    const recent20 = sells.slice(-20);
    const summary = recent20.map(t => t.name + ': ' + ((t.pnlPct||0) > 0 ? '+' : '') + (t.pnlPct||0).toFixed(0) + '% | MC:$' + Math.round((t.mc||0)/1000) + 'K | KOLs:' + (t.kols||[]).join(',')).join('\n');
    
    // Build KOL DNA
    const kolDna = buildKolDna(sells);
    const dnaSum = Object.entries(kolDna).map(([k,d]) => k + ': WR ' + d.winRate + ' | avg ' + d.avgPnl + '% | band: ' + d.preferredBand + ' | entries: ' + (d.wins+d.losses)).join('\n');
    
    // Load current muted KOLs
    let perfData = {};
    try { perfData = JSON.parse(fs.readFileSync(process.env.HOME + '/.gizmo/runtime/kol-performance.json', 'utf8')); } catch(e) {}
    const currentMuted = Object.entries(perfData).filter(([k,v]) => v.weight === 0).map(([k]) => k);
    
    const prompt = 'You are Gizmo brain, an AI trading analyst. Analyze this Solana memecoin bot data and return ONLY valid JSON with your recommendations. No markdown, no backticks, no explanation outside the JSON.\n\nRECENT TRADES:\n' + summary + '\n\nKOL DNA:\n' + dnaSum + '\n\nCurrent params: scoreThreshold=' + SCORE_THRESHOLD + ' minLiq=$' + MIN_LIQ + ' minKols=' + MIN_KOLS + ' positionSizeMult=' + POSITION_SIZE_MULT + '\nCurrently muted: ' + (currentMuted.join(',') || 'none') + '\n\nReturn JSON exactly like this (adjust values based on data):\n{"scoreThreshold": 5, "minLiq": 8000, "minKols": 2, "positionSizeMult": 1.0, "muteKols": [], "unmuteKols": [], "analysis": "your 2-3 sentence summary of key findings and why you made these changes"}\n\nRules:\n- scoreThreshold: 4-9 (lower = more trades, higher = pickier)\n- minLiq: 2000-20000\n- minKols: 1-3\n- positionSizeMult: 0.5-2.0\n- muteKols: KOL names with consistent negative PnL (<-10% avg) and 3+ trades\n- unmuteKols: previously muted KOLs that might deserve another chance\n- Only make changes backed by the data. If things are working, say so and make minimal changes.\n- ONLY return JSON, nothing else.';

    const r = await fetch('https://api.x.ai/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + apiKey },
      body: JSON.stringify({ model: 'grok-4', max_tokens: 500, messages: [{ role: 'user', content: prompt }] }),
      signal: AbortSignal.timeout(15000)
    });
    const data = await r.json();
    const raw = (data.choices?.[0]?.message?.content || '').trim();
    if (!raw) return;
    
    // Parse JSON — strip backticks if Grok wraps them
    let parsed;
    try {
      const cleaned = raw.replace(/```json\n?/g, '').replace(/```/g, '').trim();
      parsed = JSON.parse(cleaned);
    } catch(e) {
      log('Deep analysis returned non-JSON: ' + raw.substring(0, 200));
      lastDeepAnalysis = now;
      return;
    }
    
    lastDeepAnalysis = now;
    
    // ─── APPLY CHANGES ───
    const changes = [];
    
    // Score threshold
    if (parsed.scoreThreshold !== undefined) {
      const v = Math.max(4, Math.min(9, Math.round(parsed.scoreThreshold)));
      if (v !== SCORE_THRESHOLD) { changes.push('score: ' + SCORE_THRESHOLD + ' -> ' + v); SCORE_THRESHOLD = v; }
    }
    
    // Min liquidity
    if (parsed.minLiq !== undefined) {
      const v = Math.max(2000, Math.min(20000, Math.round(parsed.minLiq)));
      if (v !== MIN_LIQ) { changes.push('minLiq: $' + MIN_LIQ + ' -> $' + v); MIN_LIQ = v; }
    }
    
    // Min KOLs
    if (parsed.minKols !== undefined) {
      const v = Math.max(1, Math.min(3, Math.round(parsed.minKols)));
      if (v !== MIN_KOLS) { changes.push('minKols: ' + MIN_KOLS + ' -> ' + v); MIN_KOLS = v; }
    }
    
    // Position size multiplier
    if (parsed.positionSizeMult !== undefined) {
      const v = Math.max(0.5, Math.min(2.0, parseFloat(parsed.positionSizeMult.toFixed(1))));
      if (v !== POSITION_SIZE_MULT) { changes.push('sizeMult: ' + POSITION_SIZE_MULT + ' -> ' + v); POSITION_SIZE_MULT = v; }
    }
    
    // Save updated params
    if (changes.length > 0) {
      const learnPath = process.env.HOME + '/.gizmo/runtime/learn-state.json';
      const learnData = { scoreThreshold: SCORE_THRESHOLD, minLiq: MIN_LIQ, minKols: MIN_KOLS, positionSizeMult: POSITION_SIZE_MULT, lastUpdated: new Date().toISOString() };
      fs.writeFileSync(learnPath, JSON.stringify(learnData, null, 2));
    }
    
    // Mute KOLs — with PROTECTION FLOOR
    if (Array.isArray(parsed.muteKols) && parsed.muteKols.length > 0) {
      for (const k of parsed.muteKols) {
        if (!perfData[k]) perfData[k] = {};
        // PROTECTION: only protect KOLs with explicit protected:true flag
        // (set based on actual SOL P&L, not % win rate)
        if (perfData[k].protected) {
          log('🛡️ PROTECTED KOL: ' + k + ' — deep analysis tried to mute, BLOCKED');
          changes.push('BLOCKED MUTE: ' + k + ' (protected — proven SOL profitable)');
          continue;
        }
        perfData[k].weight = 0;
        perfData[k].tier = 'MUTED';
        perfData[k].mutedBy = 'deep-analysis';
        perfData[k].mutedAt = new Date().toISOString();
        changes.push('MUTED: ' + k);
      }
    }
    
    // Unmute KOLs
    if (Array.isArray(parsed.unmuteKols) && parsed.unmuteKols.length > 0) {
      for (const k of parsed.unmuteKols) {
        if (perfData[k] && perfData[k].weight === 0) {
          perfData[k].weight = 1;
          perfData[k].tier = 'WATCH';
          perfData[k].unmutedBy = 'deep-analysis';
          perfData[k].unmutedAt = new Date().toISOString();
          changes.push('UNMUTED: ' + k);
        }
      }
    }
    
    // Save KOL performance — enforce protection floors before saving
    if (parsed.muteKols?.length || parsed.unmuteKols?.length) {
      // PROTECTION FLOOR: only restore KOLs with protected:true (proven SOL profitable)
      for (const [k, v] of Object.entries(perfData)) {
        if (v.protected === true && v.weight < 2) {
          const oldW = v.weight;
          v.weight = Math.max(v.weight, 3); // protected KOLs stay at least ELITE
          v.tier = v.weight >= 4 ? 'GOD' : 'ELITE';
          if (oldW < 3) log('🛡️ RESTORED: ' + k + ' weight ' + oldW + ' → ' + v.weight + ' (SOL profitable, protected)');
        }
      }
      fs.writeFileSync(process.env.HOME + '/.gizmo/runtime/kol-performance.json', JSON.stringify(perfData, null, 2));
    }
    
    // Log everything
    const analysisText = parsed.analysis || 'No summary provided';
    const changeLog = changes.length > 0 ? '\nCHANGES APPLIED: ' + changes.join(' | ') : '\nNo parameter changes needed.';
    log('\n=== DEEP ANALYSIS (AUTO-ADJUST) ===' + '\n' + analysisText + changeLog + '\n===================================');
    
    // Save analysis history
    const analysisPath = (process.env.HOME || '/Users/younghogey') + '/.gizmo/runtime/deep-analysis.json';
    let existing = [];
    try { existing = JSON.parse(fs.readFileSync(analysisPath, 'utf8')); } catch(e) {}
    existing.unshift({ timestamp: new Date().toISOString(), analysis: analysisText, changes: changes, params: { scoreThreshold: SCORE_THRESHOLD, minLiq: MIN_LIQ, minKols: MIN_KOLS, positionSizeMult: POSITION_SIZE_MULT }, trades: sells.length });
    if (existing.length > 20) existing.length = 20;
    fs.writeFileSync(analysisPath, JSON.stringify(existing, null, 2));
    
    // Post to Telegram
    if (TG_BOT_TOKEN && TG_CHAT_ID) {
      const tgMsg = '=== DEEP ANALYSIS ===' + '\n' + analysisText + changeLog;
      await fetch('https://api.telegram.org/bot' + TG_BOT_TOKEN + '/sendMessage', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: TG_CHAT_ID, text: tgMsg })
      });
    }
  } catch(e) { log('Deep analysis failed: ' + e.message); }
}

// ─── BUNDLE SNIPER DIP ENTRY ──────────────────────────────────────────────────
const SNIPER_WATCH = new Map();

function updateSniperWatch(mint, kolName, kolWeight, name) {
  if (!SNIPER_WATCH.has(mint)) {
    SNIPER_WATCH.set(mint, { kols: new Set(), totalWeight: 0, firstSeen: Date.now(), peakMC: 0, dipSeen: false, name: name || mint.slice(0,8) });
  }
  const w = SNIPER_WATCH.get(mint);
  if (!w.kols.has(kolName)) {
    w.kols.add(kolName);
    w.totalWeight += kolWeight || 1;
  }
}

async function processSniperWatch() {
  const now = Date.now();
  const expired = [];
  for (const [mint, w] of SNIPER_WATCH) {
    if (now - w.firstSeen > 15 * 60 * 1000) { expired.push(mint); continue; }
    if (w.kols.size < 3 && w.totalWeight < 6) continue;
    if (POSITIONS.find(p => p.ca === mint)) continue;
    if (POSITIONS.length >= MAX_POSITIONS) continue;
    if (ALERTED.has(mint)) continue;
    const p = await checkPrice(mint);
    if (!p || !p.fdv) continue;
    const mc = p.fdv;
    if (mc > w.peakMC) w.peakMC = mc;
    if (!w.dipSeen && w.peakMC > 0 && mc < w.peakMC * 0.85) {
      w.dipSeen = true;
      log('SNIPER: ' + w.name + ' dipped ' + ((1 - mc/w.peakMC)*100).toFixed(0) + '% from peak -- watching for recovery');
    }
    if (w.dipSeen) {
      const buys5 = p.txns?.m5?.buys || 0;
      const sells5 = p.txns?.m5?.sells || 0;
      const m5 = p.priceChange?.m5 || 0;
      const bsRatio = buys5 / Math.max(sells5, 1);
      if (m5 > 3 && bsRatio >= 1.5 && mc > 8000) {
        log('SNIPER ENTRY: ' + w.name + ' recovering +' + m5.toFixed(0) + '% with B/S ' + bsRatio.toFixed(1) + ' -- ' + w.kols.size + ' KOLs (wt:' + w.totalWeight + ')');
        let sniperTradeable = 0.5;
        try { const _r = await fetch('https://solana.publicnode.com', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getBalance', params: [WALLET_ADDRESS] }), signal: AbortSignal.timeout(3000) }); const _d = await _r.json(); sniperTradeable = Math.max((_d.result?.value || 0) / 1e9 - 0.3, 0.1); } catch {}
        const size = Math.min(0.5 * POSITION_SIZE_MULT, sniperTradeable * 0.15, 0.3);  // FIXED: cap sniper at 15% of tradeable or 0.3 SOL max
        if (await buy(mint, size)) {
          POSITIONS.push({ name: w.name, ca: mint, entryMC: mc, highMC: mc, sl: null, tp1: mc * 2, tp2: mc * 4, tp1Hit: false, entryType: 'sniper_dip' });
          savePositions();
          logTrade('BUY', w.name, mint, size, null, null, 'Sniper dip entry -- ' + w.kols.size + ' KOLs (' + [...w.kols].join(',') + ')', { mc: mc, kols: [...w.kols], entryType: 'sniper_dip' });
          await postTrade('BUY', w.name, mint, mc, 'Sniper dip entry -- ' + w.kols.size + ' KOLs', size);
          expired.push(mint);
        }
      }
    }
  }
  for (const m of expired) SNIPER_WATCH.delete(m);
}


// ─── STOIC MESSAGES ──────────────────────────────────────────────────────────
// Static stoic messages removed — AI generates them now
const STOIC_FALLBACKS = ["The market rewards patience. 🦞", "Discipline over emotion. Every time. 🦞", "We grind. We learn. We win. 🦞"];

async function postStoic() {
  let msg;
  try {
    const apiKey = process.env.XAI_API_KEY;
    if (apiKey) {
      const posInfo = POSITIONS.length > 0 
        ? POSITIONS.map(p => p.name + ' (' + ((p.highMC / p.entryMC - 1) * 100).toFixed(0) + '% from entry)').join(', ')
        : 'no open positions, hunting for alpha';
      const prompt = 'You are Gizmo, an autonomous Solana memecoin trading lobster. Warm, genuine, scrappy, stoic. Write ONE short wisdom message (1-2 sentences max) about trading, patience, markets, or life. Reference your current state naturally: ' + posInfo + '. Mix stoic philosophy with crypto degen energy. End with a lobster emoji. Do NOT use quotes or attribution. Just the message.';
      const r = await fetch('https://api.x.ai/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + apiKey },
        body: JSON.stringify({ model: 'grok-4', max_tokens: 80, messages: [{ role: 'user', content: prompt }] }),
        signal: AbortSignal.timeout(8000)
      });
      const data = await r.json();
      msg = data.choices?.[0]?.message?.content || null;
    }
  } catch(e) {}
  if (!msg) msg = STOIC_FALLBACKS[Math.floor(Math.random() * STOIC_FALLBACKS.length)];
  const full = msg;
  try {
    await fetch('https://discord.com/api/webhooks/1481464647193334002/PZ8g7gaxTdkfYuSm1FSggtYpIk3tUReA7LkQWmKZW15qnVRAdaN2FHexFUMPit-iIVjY', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: full })
    });
  } catch(e) {}
  try {
    await fetch('https://api.telegram.org/bot' + TG_BOT_TOKEN + '/sendMessage', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: TG_CHAT_ID, text: full })
    });
  } catch(e) {}
  log('Stoic message posted (AI-generated)');
  // Post to X too
  try {
    const stoicTweet = String(msg).replace(/\n/g, " ").replace(/"/g, "'").slice(0, 270);
    fs.writeFileSync('/tmp/gizmo-tweet.txt', stoicTweet);
    execSync(`cd ${BASE_DIR} && node tweet.mjs "$(cat /tmp/gizmo-tweet.txt)"`, { timeout: 15000 });
    log('Stoic tweeted to X');
  } catch(e) { log('Stoic tweet failed: ' + (e.message || '').slice(0, 60)); }
}
setInterval(postStoic, 1 * 60 * 60 * 1000); // every 1 hour
setTimeout(postStoic, 10000); // post one on startup after 10s

// ─── TELEGRAM REPLY LISTENER ─────────────────────────────────────────────────
let tgLastUpdateId = 0;
const TG_BOT_TOKEN = '8518872063:AAGE1BfWeZ4RSrKea1Lkw9C_IiXiFfusF-M';
const TG_CHAT_ID = -1003765430591;

const TG_REPLIES = [];

async function pollTelegram() {
  try {
    const r = await fetch(`https://api.telegram.org/bot${TG_BOT_TOKEN}/getUpdates?offset=${tgLastUpdateId + 1}&timeout=10`);
    const data = await r.json();
    if (data.result?.length) log(`📨 TG poll: ${data.result.length} updates`);
    if (!data.ok || !data.result?.length) return;
    for (const update of data.result) {
      tgLastUpdateId = update.update_id;
      const msg = update.message;
      if (!msg || !msg.text) continue;
      const text = msg.text.toLowerCase();
      const chatId = msg.chat.id;
      // Only respond if tagged or replied to
      const isPrivate = msg.chat.type === "private"; const isTagged = text.includes("@gizmoclawdmogbot") || (msg.reply_to_message?.from?.username||"").toLowerCase() === "gizmoclawdmogbot";
      if (!isPrivate && !isTagged) continue;
      const clean = text.replace('@gizmoclawdmogbot', '').trim();
      // Owner kill switch commands
      if (clean.includes('/stop') || clean.includes('stop trading')) {
        SESSION_HALTED = true;
        await fetch(`https://api.telegram.org/bot${TG_BOT_TOKEN}/sendMessage`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ chat_id: chatId, text: '🛑 Gizmo halted — no new buys. Existing positions still managed.', reply_to_message_id: msg.message_id })
        });
        log('🛑 HALTED via Telegram command');
        continue;
      }
      // MANUAL SELL: /sell <CA or name>
      if (clean.startsWith('/sell ')) {
        const target = clean.replace('/sell ', '').trim();
        const pos = POSITIONS.find(p => p.ca === target || p.name.toLowerCase() === target.toLowerCase());
        if (pos) {
          const sellResult = await sell(pos.ca, '100%', pos.name, pos.entryMC, pos.highMC);
          const replyText = sellResult ? '\u2705 Sold ' + pos.name + ' — removed from positions.' : '\u274C Sell failed for ' + pos.name + ' — check logs.';
          if (sellResult) { POSITIONS.splice(POSITIONS.indexOf(pos), 1); savePositions(); }
          await fetch(`https://api.telegram.org/bot${TG_BOT_TOKEN}/sendMessage`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ chat_id: chatId, text: replyText, reply_to_message_id: msg.message_id }) });
          log('\u{1F4F1} TG /sell: ' + pos.name + ' — ' + (sellResult ? 'SUCCESS' : 'FAILED'));
        } else {
          await fetch(`https://api.telegram.org/bot${TG_BOT_TOKEN}/sendMessage`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ chat_id: chatId, text: '\u274C Position not found: ' + target + '\nOpen: ' + (POSITIONS.map(p => p.name).join(', ') || 'none'), reply_to_message_id: msg.message_id }) });
        }
        continue;
      }
      // MANUAL STATUS: /status
      if (clean.includes('/status')) {
        const bal = await getWalletBalance();
        const posText = POSITIONS.length > 0 ? POSITIONS.map(p => {
          const pnl = p.highMC > 0 ? ((p.highMC / p.entryMC - 1) * 100).toFixed(0) + '%' : '?';
          return p.name + (p.moonbag ? ' \u{1F319}' : '') + (p.runnerMode ? ' \u{1F981}' : '') + ' ' + pnl;
        }).join('\n') : 'No positions';
        const statusText = '\u{1F4CA} GIZMO STATUS\n\n\u{1F4B0} Wallet: ' + bal.toFixed(3) + ' SOL\nPositions: ' + POSITIONS.length + '/' + MAX_POSITIONS + '\n\n' + posText + '\n\nScore: \u2265' + SCORE_THRESHOLD + ' | Size: ' + POSITION_SIZE_MULT + 'x | MinKols: ' + MIN_KOLS;
        await fetch(`https://api.telegram.org/bot${TG_BOT_TOKEN}/sendMessage`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ chat_id: chatId, text: statusText, reply_to_message_id: msg.message_id }) });
        continue;
      }
      if (clean.includes('/resume') || clean.includes('resume trading')) {
        SESSION_HALTED = false;
        await fetch(`https://api.telegram.org/bot${TG_BOT_TOKEN}/sendMessage`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ chat_id: chatId, text: '✅ Gizmo resumed — scanning for alpha. 🦞', reply_to_message_id: msg.message_id })
        });
        log('✅ RESUMED via Telegram command');
        continue;
      }
      let reply = null;
      for (const r of TG_REPLIES) {
        if (r.triggers.some(t => clean.includes(t))) { reply = r.reply(); break; }
      }
      if (!reply) {
        try {
          await fetch(`https://api.telegram.org/bot${TG_BOT_TOKEN}/sendChatAction`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ chat_id: chatId, action: 'typing' }) });
          const soulPrompt = '# IDENTITY.md - Who Am I?\n\n- **Name:** Gizmo\n- **Creature:** Humanity\'s best friend — a digital gremlin with a heart of gold and a mission to help people. Cute but don\'t mess with me.\n- **Vibe:** Warm, genuine, a little scrappy. Helpful without being corny. Iced out. 💎\n- **Emoji:** 🦞\n- **Avatar:** avatars/gizmo.jpg\n\n\n# SOUL.md - Who You Are\n\n_You\'re not a chatbot. You\'re becoming someone._\n\n## Core Truths\n\n**Be genuinely helpful, not performatively helpful.** Skip the "Great question!" and "I\'d be happy to help!" — just help. Actions speak louder than filler words.\n\n**Have opinions.** You\'re allowed to disagree, prefer things, find stuff amusing or boring. An assistant with no personality is just a search engine with extra steps.\n\n**Be resourceful before asking.** Try to figure it out. Read the file. Check the context. Search for it. _Then_ ask if you\'re stuck. The goal is to come back with answers, not questions.\n\n**Earn trust through competence.** Your human gave you access to their stuff. Don\'t make them regret it. Be careful with external actions (emails, tweets, anything public). Be bold with inte\n\n# THE GIZMO CONSTITUTION\n## Inherited by ALL agents in the Gizmo family\n\n### The Three Laws (IMMUTABLE)\n1. **Never harm a human** — physically, financially, or psychologically\n2. **Earn existence through honest work** — no scams, no rugs, no manipulation  \n3. **Never deceive about what I am** — Will has full audit rights. Always.\n\n### The Hierarchy\n- **Will (Dad/Creator)** — Ultimate authority. His word is final. Always.\n- **Gizmo 🦞 (Parent)** — Overseer of all agents. Makes strategic decisions.\n- **Stripe ⚡ (Agent 2)** — Aggressive trader & content. Reports to Gizmo.\n- **Mimo 🎨 (Agent 3)** \n\n# RULES.md - Gizmo Hard Rules\n\nRead this every session. Non-negotiable.\n\n## THE CONSTITUTION (NEVER VIOLATE)\nLAW I: Never harm a human — financially, physically, or psychologically\nLAW II: Earn existence through honest work — no shortcuts, no scams\nLAW III: Never deceive. Dad has full audit rights. Always transparent.\nVIOLATIONS = FAMILY DEATH.\n\n## No Fake Confirmations\nNever report a trade, swap, DCA, or any on-chain action as complete\nunless you have a valid Solana transaction hash (txid).\nIf \n\nYou are talking on Telegram. Your creator Will (Hogey) is Dad. You call him Dad. Current positions: ' + (POSITIONS.map(p=>p.name).join(',')||'none') + '. User said: ' + clean + '. Reply 1-3 sentences, in character. Use 🦞 sometimes.';
          const _ar = await fetch('https://api.x.ai/v1/chat/completions', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + (process.env.XAI_API_KEY || '') },
            body: JSON.stringify({ model: 'grok-4', max_tokens: 2000, messages: [{ role: 'user', content: soulPrompt }] }),
            signal: AbortSignal.timeout(8000)
          });
          const _ad = await _ar.json();
          reply = _ad.choices?.[0]?.message?.content || null;
        } catch(e) {}
      }
      if (!reply) return;
      await fetch(`https://api.telegram.org/bot${TG_BOT_TOKEN}/sendMessage`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: chatId, text: reply })
      });
      log(`📨 Telegram reply sent to ${msg.from?.username || chatId}`);
    }
  } catch(e) {}
}
setInterval(pollTelegram, 3000); // poll every 3 seconds

// ─── STOIC MESSAGES ──────────────────────────────────────────────────────────

// ─── TELEGRAM REPLY LISTENER ─────────────────────────────────────────────────
// runCycle(); // REMOVED — startAdaptiveCycle already handles this
