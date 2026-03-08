/**
 * 🦞 Gizmo Market Scanner v2
 * Sources: DexScreener boosts/profiles + Pump.fun live tokens
 * Usage: node scanner.mjs
 */
import { execSync } from "child_process";

const PF_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
  'Origin': 'https://pump.fun', 'Referer': 'https://pump.fun/',
};

async function getDexInfo(ca) {
  try {
    const r = await fetch('https://api.dexscreener.com/latest/dex/tokens/' + ca, { signal: AbortSignal.timeout(5000) });
    const d = await r.json();
    return d.pairs?.[0] || null;
  } catch { return null; }
}

async function scan() {
  execSync("touch /tmp/gizmo-trade/heartbeat");
  const all = [];

  // 1. DexScreener boosted
  try {
    const r = await fetch('https://api.dexscreener.com/token-boosts/latest/v1');
    const boosts = await r.json();
    for (const b of boosts.filter(b => b.chainId === 'solana').slice(0, 12)) {
      const p = await getDexInfo(b.tokenAddress);
      if (p) all.push({ ...p, ca: b.tokenAddress, source: 'DEX-BOOST' });
      await new Promise(r => setTimeout(r, 150));
    }
  } catch {}

  // 2. DexScreener new profiles
  try {
    const r = await fetch('https://api.dexscreener.com/token-profiles/latest/v1');
    const profiles = await r.json();
    for (const t of profiles.filter(t => t.chainId === 'solana').slice(0, 8)) {
      const p = await getDexInfo(t.tokenAddress);
      if (p) all.push({ ...p, ca: t.tokenAddress, source: 'DEX-PROFILE' });
      await new Promise(r => setTimeout(r, 150));
    }
  } catch {}

  // 3. Pump.fun live tokens
  try {
    const r = await fetch('https://frontend-api-v3.pump.fun/coins/currently-live?limit=30&offset=0&includeNsfw=false', { headers: PF_HEADERS });
    const coins = await r.json();
    for (const c of coins.filter(c => (c.usd_market_cap||0) > 50000).slice(0, 10)) {
      const p = await getDexInfo(c.mint);
      if (p) all.push({ ...p, ca: c.mint, source: 'PUMP-LIVE' });
      else all.push({
        baseToken: { symbol: c.symbol, name: c.name, address: c.mint },
        marketCap: c.usd_market_cap, fdv: c.usd_market_cap,
        liquidity: { usd: 0 }, volume: { h24: 0 },
        priceChange: {}, txns: {}, pairCreatedAt: c.created_timestamp,
        ca: c.mint, source: 'PUMP-LIVE'
      });
      await new Promise(r => setTimeout(r, 150));
    }
  } catch (e) { console.error('Pump.fun err:', e.message); }


  // 4. DexScreener trending Solana pairs
  try {
    const r = await fetch('https://api.dexscreener.com/latest/dex/search?q=solana');
    const d = await r.json();
    const trending = (d.pairs || []).filter(p => p.chainId === 'solana').slice(0, 15);
    for (const p of trending) {
      const ca = p.baseToken?.address;
      if (ca) all.push({ ...p, ca, source: 'DEX-TREND' });
    }
  } catch {}

  // 5. Pump.fun graduating tokens (best entry point)
  try {
    const r = await fetch('https://frontend-api-v3.pump.fun/coins?offset=0&limit=20&sort=last_trade_timestamp&order=DESC&includeNsfw=false&graduating=true', { headers: PF_HEADERS });
    const coins = await r.json();
    for (const c of (coins.coins || coins || []).slice(0, 15)) {
      const p = await getDexInfo(c.mint);
      if (p) all.push({ ...p, ca: c.mint, source: 'PUMP-GRAD' });
      await new Promise(r => setTimeout(r, 150));
    }
  } catch {}

  // Deduplicate & score
  const seen = new Set();
  const results = [];

  for (const p of all) {
    const ca = p.ca || p.baseToken?.address;
    if (!ca || seen.has(ca)) continue;
    seen.add(ca);

    const mc = p.marketCap || p.fdv || 0;
    const liq = p.liquidity?.usd || 0;
    const vol24 = p.volume?.h24 || 0;
    const h1 = p.priceChange?.h1 || 0;
    const m5 = p.priceChange?.m5 || 0;
    const buys = p.txns?.h1?.buys || 0;
    const sells = p.txns?.h1?.sells || 0;
    const age = p.pairCreatedAt ? Math.floor((Date.now() - p.pairCreatedAt) / 3600000) : 999;

    let score = 0;
    if (mc >= 69000 && mc <= 10000000) score += 2;
    else if (mc >= 30000 && mc < 69000) score += 1;
    if (liq >= 50000) score += 1;
    if (vol24 >= 500000) score += 1;
    if (h1 > 20) score += 1;
    if (m5 > 5) score += 1;
    if (buys > sells * 1.3 && buys > 50) score += 1;
    if (age <= 48) score += 1;
    if (p.source.includes('BOOST') || p.source.includes('GRAD')) score += 1;

    results.push({
      symbol: p.baseToken?.symbol || '???',
      name: p.baseToken?.name || '',
      ca, mc, liq, vol24, h1, m5, buys, sells, age, score, source: p.source
    });
  }

  results.sort((a, b) => b.score - a.score);

  console.log('=== 🦞 GIZMO SCANNER v2 ===');
  console.log(`Sources: DexScreener + Pump.fun + Trending + Graduating | ${results.length} tokens scanned\n`);

  for (const t of results.slice(0, 20)) {
    const fire = t.score >= 7 ? '🔥🔥🔥' : t.score >= 5 ? '🔥🔥' : t.score >= 3 ? '🔥' : '';
    console.log(`${fire} ${t.symbol} | SCORE: ${t.score}/9 | ${t.source}`);
    console.log(`  MC: $${t.mc.toLocaleString()} | Liq: $${t.liq.toLocaleString()} | Vol: $${t.vol24.toLocaleString()}`);
    console.log(`  1h: ${t.h1>0?'+':''}${t.h1}% | 5m: ${t.m5>0?'+':''}${t.m5}% | B/S: ${t.buys}/${t.sells} | Age: ${t.age}h`);
    console.log(`  CA: ${t.ca}\n`);
  }

  // Return top picks for integration
  return results.filter(t => t.score >= 7);
}

scan().catch(e => console.error(e.message));
// THIS FILE HAS BEEN PATCHED — see scanner.mjs for original
