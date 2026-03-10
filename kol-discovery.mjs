/**
 * 🦞 GIZMO KOL DISCOVERY ENGINE
 * Runs daily to find top performing Solana wallets from GMGN
 * Adds them as trial KOLs, promotes/demotes based on performance
 * 
 * Usage: node kol-discovery.mjs
 * Add to crontab: 0 6 * * * cd /Users/younghogey/.openclaw/workspace/SOLGizmo && node kol-discovery.mjs
 */

import fs from 'fs';

const WORKSPACE = '/Users/younghogey/.openclaw/workspace/SOLGizmo';
const BASE_DIR = '/Users/younghogey/.gizmo/runtime';
const KOL_DISCOVERY_FILE = BASE_DIR + '/discovered-kols.json';
const KOL_PERFORMANCE_FILE = BASE_DIR + '/kol-performance.json';
const TRADES_FILE = WORKSPACE + '/trades.json';
const GIZMO_FILE = WORKSPACE + '/gizmo.mjs';

// ─── LOGGING ──────────────────────────────────────────────────────────────────
function log(msg) {
  const line = `[${new Date().toLocaleString()}] [KOL-DISCOVERY] ${msg}`;
  console.log(line);
  try { fs.appendFileSync(BASE_DIR + '/kol-discovery.log', line + '\n'); } catch {}
}

// ─── LOAD/SAVE DISCOVERED KOLS ───────────────────────────────────────────────
function loadDiscovered() {
  try {
    if (fs.existsSync(KOL_DISCOVERY_FILE)) return JSON.parse(fs.readFileSync(KOL_DISCOVERY_FILE, 'utf8'));
  } catch {}
  return { wallets: [], lastUpdated: null };
}

function saveDiscovered(data) {
  fs.writeFileSync(KOL_DISCOVERY_FILE, JSON.stringify(data, null, 2));
}

function loadPerformance() {
  try {
    if (fs.existsSync(KOL_PERFORMANCE_FILE)) return JSON.parse(fs.readFileSync(KOL_PERFORMANCE_FILE, 'utf8'));
  } catch {}
  return {};
}

function savePerformance(data) {
  fs.writeFileSync(KOL_PERFORMANCE_FILE, JSON.stringify(data, null, 2));
}

// ─── GMGN SMART MONEY FETCH ───────────────────────────────────────────────────
// GMGN has Cloudflare protection. We try multiple endpoints.
// If all fail, falls back to Helius-based discovery from Gizmo's own trade history.
async function fetchGMGNTopWallets() {
  const endpoints = [
    // Unofficial GMGN rank endpoint — works with browser-like headers
    'https://gmgn.ai/defi/quotation/v1/rank/sol/swaps/24h?orderby=pnl&direction=desc&filters[]=not_honeypot',
    // Alternate sort by win rate
    'https://gmgn.ai/defi/quotation/v1/rank/sol/swaps/24h?orderby=winrate&direction=desc&filters[]=not_honeypot',
  ];

  const headers = {
    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
    'Accept': 'application/json, text/plain, */*',
    'Accept-Language': 'en-US,en;q=0.9',
    'Referer': 'https://gmgn.ai/',
    'Origin': 'https://gmgn.ai',
    'sec-ch-ua': '"Not A(Brand";v="99", "Google Chrome";v="121", "Chromium";v="121"',
    'sec-ch-ua-mobile': '?0',
    'sec-ch-ua-platform': '"macOS"',
  };

  for (const url of endpoints) {
    try {
      log(`Trying GMGN endpoint: ${url.slice(0, 80)}...`);
      const r = await fetch(url, { headers, signal: AbortSignal.timeout(10000) });
      if (!r.ok) { log(`GMGN returned ${r.status} — trying next`); continue; }
      const data = await r.json();
      
      // GMGN returns { code: 0, data: { rank: [...] } }
      const rank = data?.data?.rank || data?.rank || [];
      if (!rank.length) { log('GMGN returned empty rank list'); continue; }
      
      log(`✅ GMGN returned ${rank.length} wallets`);
      return rank.map(w => ({
        address: w.address || w.wallet_address,
        pnl: w.realized_profit || w.pnl || 0,
        winRate: w.winrate || 0,
        trades: w.buy_30d || w.txns || 0,
        source: 'gmgn'
      })).filter(w => w.address);

    } catch (e) {
      log(`GMGN fetch failed: ${e.message?.slice(0, 80)}`);
    }
  }

  log('⚠️ All GMGN endpoints failed (likely Cloudflare). Using fallback discovery.');
  return null;
}

// ─── FALLBACK: DISCOVER FROM GIZMO'S OWN WIN HISTORY ─────────────────────────
// Look at tokens Gizmo won big on, find the early buyers = likely smart money
async function fallbackDiscovery() {
  log('🔍 Fallback: scanning Gizmo win history for co-buyers...');
  const HELIUS_KEY = process.env.HELIUS_API_KEY || '';
  if (!HELIUS_KEY) { log('No Helius key — skipping fallback'); return []; }

  try {
    const trades = JSON.parse(fs.readFileSync(TRADES_FILE, 'utf8'));
    // Find big wins (>50% PnL)
    const bigWins = trades.filter(t => {
      if (t.action !== 'SELL') return false;
      const pnl = parseFloat((t.pnl || '0').replace('+','').replace(' SOL',''));
      return pnl > 0.1; // won more than 0.1 SOL
    }).slice(0, 5);

    if (!bigWins.length) { log('No big wins yet to learn from'); return []; }

    const candidates = new Map();

    for (const win of bigWins) {
      if (!win.ca) continue;
      log(`Scanning early buyers of ${win.token} (${win.pnl})...`);
      try {
        // Get early transactions on this token
        const url = `https://api.helius.xyz/v0/addresses/${win.ca}/transactions?api-key=${HELIUS_KEY}&limit=20&type=SWAP`;
        const r = await fetch(url, { signal: AbortSignal.timeout(8000) });
        if (!r.ok) continue;
        const txs = await r.json();

        // Get earliest buyers (first 10 swaps)
        const earlyBuyers = txs.slice(-10).map(tx => tx.feePayer).filter(Boolean);
        for (const addr of earlyBuyers) {
          if (!candidates.has(addr)) candidates.set(addr, { count: 0, wins: 0 });
          candidates.get(addr).count++;
          candidates.get(addr).wins++;
        }
      } catch (e) { log(`Scan failed for ${win.token}: ${e.message?.slice(0, 50)}`); }
    }

    // Return wallets that appeared in multiple winning tokens
    return [...candidates.entries()]
      .filter(([_, v]) => v.count >= 2)
      .map(([address, v]) => ({ address, pnl: v.wins * 100, winRate: v.wins / v.count, trades: v.count, source: 'gizmo-wins' }));

  } catch (e) { log(`Fallback error: ${e.message}`); return []; }
}

// ─── FILTER QUALITY WALLETS ───────────────────────────────────────────────────
// Only keep wallets that look like real traders, not bots or one-hit wonders
function filterQualityWallets(wallets) {
  return wallets.filter(w => {
    if (!w.address || w.address.length < 32) return false;
    if (w.trades < 5) return false;       // needs trading history
    if (w.winRate < 0.45) return false;   // at least 45% win rate
    return true;
  });
}

// ─── UPDATE KOL PERFORMANCE FROM GIZMO TRADES ────────────────────────────────
function updateKolPerformance() {
  log('📊 Updating KOL performance from trade history...');
  try {
    const trades = JSON.parse(fs.readFileSync(TRADES_FILE, 'utf8'));
    const perf = loadPerformance();

    // Extract KOL names from buy trade results
    for (const trade of trades) {
      if (trade.action !== 'BUY') continue;
      const kolMatch = (trade.result || '').match(/KOL convergence: (.+)/);
      if (!kolMatch) continue;
      const kols = kolMatch[1].split(', ');
      
      // Find the corresponding sell
      const sell = trades.find(t => t.action === 'SELL' && t.ca === trade.ca && t.ts > trade.ts);
      if (!sell) continue;
      
      const pnl = parseFloat((sell.pnl || '0').replace('+','').replace(' SOL',''));
      const win = pnl > 0;

      for (const kol of kols) {
        if (!perf[kol]) perf[kol] = { wins: 0, losses: 0, totalPnl: 0, weight: 1 };
        if (win) perf[kol].wins++; else perf[kol].losses++;
        perf[kol].totalPnl += pnl;
      }
    }

    // Auto-adjust weights based on performance
    for (const [kol, stats] of Object.entries(perf)) {
      const total = stats.wins + stats.losses;
      if (total < 3) continue; // need at least 3 trades to judge
      const wr = stats.wins / total;
      
      if (wr >= 0.65) { stats.weight = 3; stats.tier = 'ELITE'; }
      else if (wr >= 0.50) { stats.weight = 2; stats.tier = 'GOOD'; }
      else if (wr >= 0.35) { stats.weight = 1; stats.tier = 'AVERAGE'; }
      else { stats.weight = 0; stats.tier = 'DEMOTED'; }

      log(`📊 ${kol}: WR ${(wr*100).toFixed(0)}% (${stats.wins}W/${stats.losses}L) → weight ${stats.weight} [${stats.tier}]`);
    }

    savePerformance(perf);
    return perf;
  } catch (e) { log(`Performance update error: ${e.message}`); return {}; }
}

// ─── INJECT DISCOVERED KOLS INTO GIZMO ───────────────────────────────────────
function updateGizmoWallets(newWallets, performance) {
  try {
    let code = fs.readFileSync(GIZMO_FILE, 'utf8');
    
    // Find the WALLETS array and update weights based on performance
    for (const [kolName, stats] of Object.entries(performance)) {
      if (stats.tier === 'DEMOTED') {
        // Comment out demoted KOLs
        const regex = new RegExp(`(  \\{ name: "${kolName}",[^}]+\\},?)`, 'g');
        code = code.replace(regex, `  // DEMOTED (WR too low): $1`);
        log(`🔴 Demoted ${kolName} from active tracking`);
      } else if (stats.weight) {
        // Update weight
        const regex = new RegExp(`(name: "${kolName}",[^,]+, weight: )\\d+`);
        if (code.match(regex)) {
          code = code.replace(regex, `$1${stats.weight}`);
          log(`🔄 Updated ${kolName} weight → ${stats.weight}`);
        }
      }
    }

    // Add newly discovered wallets as trial KOLs
    const discovered = loadDiscovered();
    const existingAddresses = new Set((code.match(/address: "[^"]+"/g) || []).map(m => m.replace('address: "','').replace('"','')));
    
    const toAdd = newWallets
      .filter(w => !existingAddresses.has(w.address))
      .slice(0, 5); // max 5 new wallets per day

    if (toAdd.length > 0) {
      const newEntries = toAdd.map((w, i) => 
        `  { name: "smart_${w.source}_${i+1}", address: "${w.address}", weight: 1 }, // auto-discovered WR:${(w.winRate*100).toFixed(0)}%`
      ).join('\n');

      // Inject before closing bracket of WALLETS array
      code = code.replace(
        /(\{ name: "Pain"[^}]+\},?\s*\];)/,
        `$1\n  // ── AUTO-DISCOVERED SMART MONEY (${new Date().toDateString()}) ──\n${newEntries}\n`
      );
      
      // Update discovered list
      discovered.wallets = [...(discovered.wallets || []), ...toAdd.map(w => w.address)];
      discovered.lastUpdated = new Date().toISOString();
      saveDiscovered(discovered);
      
      log(`✅ Added ${toAdd.length} new smart money wallets to tracking`);
    }

    fs.copyFileSync(GIZMO_FILE, GIZMO_FILE + '.bak-kol');
    fs.writeFileSync(GIZMO_FILE, code);
    log('✅ gizmo.mjs updated with latest KOL weights + new wallets');

  } catch (e) { log(`❌ Failed to update gizmo.mjs: ${e.message}`); }
}

// ─── PRINT LEADERBOARD ────────────────────────────────────────────────────────
function printLeaderboard(performance) {
  const sorted = Object.entries(performance)
    .filter(([_, s]) => s.wins + s.losses >= 1)
    .sort((a, b) => {
      const wrA = a[1].wins / (a[1].wins + a[1].losses);
      const wrB = b[1].wins / (b[1].wins + b[1].losses);
      return wrB - wrA;
    });

  if (!sorted.length) { log('No performance data yet — need more closed trades'); return; }

  log('');
  log('═══════════════════════════════════════');
  log('🏆 KOL PERFORMANCE LEADERBOARD');
  log('═══════════════════════════════════════');
  for (const [name, stats] of sorted) {
    const total = stats.wins + stats.losses;
    const wr = (stats.wins / total * 100).toFixed(0);
    const pnl = stats.totalPnl > 0 ? `+${stats.totalPnl.toFixed(3)}` : stats.totalPnl.toFixed(3);
    const tier = stats.tier || '?';
    log(`${tier === 'ELITE' ? '🥇' : tier === 'GOOD' ? '🥈' : tier === 'DEMOTED' ? '🔴' : '⚪'} ${name.padEnd(16)} WR:${wr}% (${stats.wins}W/${stats.losses}L) PnL:${pnl} SOL → weight ${stats.weight}`);
  }
  log('═══════════════════════════════════════');
  log('');
}

// ─── MAIN ─────────────────────────────────────────────────────────────────────
async function main() {
  log('🚀 Starting KOL Discovery Engine...');

  // 1. Update performance scores from trade history
  const performance = updateKolPerformance();
  printLeaderboard(performance);

  // 2. Fetch new smart money wallets from GMGN
  log('🌐 Fetching top wallets from GMGN...');
  let newWallets = await fetchGMGNTopWallets();
  
  if (!newWallets || newWallets.length === 0) {
    newWallets = await fallbackDiscovery();
  }

  const quality = filterQualityWallets(newWallets || []);
  log(`Found ${quality.length} quality wallets after filtering`);

  // 3. Update gizmo.mjs with new weights + new wallets
  updateGizmoWallets(quality, performance);

  log('✅ KOL Discovery complete. Restart gizmo to apply changes.');
}

main().catch(e => {
  log(`❌ Fatal error: ${e.message}`);
  process.exit(1);
});
