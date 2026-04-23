import fs from 'fs';

const HELIUS_KEY = '2de73660-14b8-412a-9ff2-8e6989c53266';
const SIGNALS_FILE = '/root/.gizmo/runtime/learn-signals.json';
const RESULTS_FILE = '/root/.gizmo/runtime/learn-results.json';

async function checkPrice(mint) {
  try {
    const r = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${mint}`);
    const d = await r.json();
    const p = d?.pairs?.[0];
    if (!p) return null;
    return {
      mc: p.fdv || p.marketCap || 0,
      liq: p.liquidity?.usd || 0,
      m5: p.priceChange?.m5 || 0,
      h1: p.priceChange?.h1 || 0,
      buys: p.txns?.h1?.buys || 0,
      sells: p.txns?.h1?.sells || 0,
      vol1h: p.volume?.h1 || 0,
      socials: p.info?.socials || [],
      websites: p.info?.websites || [],
      pairAge: p.pairCreatedAt ? Date.now() - p.pairCreatedAt : 999999999
    };
  } catch { return null; }
}

async function getHolders(mint) {
  try {
    const r = await fetch(`https://mainnet.helius-rpc.com/?api-key=${HELIUS_KEY}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getTokenLargestAccounts', params: [mint] })
    });
    const d = await r.json();
    const accounts = d?.result?.value || [];
    const total = accounts.reduce((s, a) => s + parseFloat(a.uiAmount || a.amount || 0), 0);
    const top1 = accounts[0] ? parseFloat(accounts[0].uiAmount || accounts[0].amount || 0) : 0;
    const top10 = accounts.slice(0, 10).reduce((s, a) => s + parseFloat(a.uiAmount || a.amount || 0), 0);
    const top1Pct = total > 0 ? (top1 / total * 100) : 0;
    const top10Pct = total > 0 ? (top10 / total * 100) : 0;
    const large = accounts.filter(a => parseFloat(a.uiAmount || a.amount || 0) > total * 0.03);
    let bundleCount = 0;
    for (let i = 0; i < large.length; i++) {
      for (let j = i + 1; j < large.length; j++) {
        const a = parseFloat(large[i].uiAmount || large[i].amount || 0);
        const b = parseFloat(large[j].uiAmount || large[j].amount || 0);
        if (Math.min(a, b) / Math.max(a, b) > 0.8) bundleCount++;
      }
    }
    return {
      totalHolders: accounts.length,
      top1Pct: Math.round(top1Pct),
      top10Pct: Math.round(top10Pct),
      suspectedBundle: bundleCount >= 2,
      isFarm: top1Pct > 30 || (top10Pct > 70 && bundleCount >= 2),
      concentration: top10Pct > 60 ? 'DANGEROUS' : top10Pct > 40 ? 'HIGH' : 'HEALTHY'
    };
  } catch { return null; }
}

async function run() {
  console.log('[TRACKER] Live with bundle/farm detection');
  while (true) {
    try {
      const signals = JSON.parse(fs.readFileSync(SIGNALS_FILE, 'utf8'));
      let results = [];
      try { results = JSON.parse(fs.readFileSync(RESULTS_FILE, 'utf8')); } catch {}
      const now = Date.now();
      const keys = new Set(results.map(r => r.key));

      for (const sig of signals) {
        const age = now - sig.time;
        const key = sig.mint + '_' + sig.time;
        const existing = results.find(r => r.key === key);

        if (!keys.has(key) && age >= 300000) {
          const price = await checkPrice(sig.mint);
          const holders = await getHolders(sig.mint);
          if (price) {
            const pnl = sig.mc > 0 ? ((price.mc - sig.mc) / sig.mc * 100) : 0;
            const e = {
              key, token: sig.token, mint: sig.mint, signalTime: sig.date,
              signalMC: sig.mc, currentMC: price.mc, kols: sig.kols,
              convergenceScore: sig.convergenceScore, totalSolIn: sig.totalSol,
              pnl5m: Math.round(pnl),
              isFarm: holders?.isFarm || false, isBundle: holders?.suspectedBundle || false,
              top1Pct: holders?.top1Pct || 0, top10Pct: holders?.top10Pct || 0,
              concentration: holders?.concentration || '?',
              hasSocials: price.socials.length > 0, pairAge: price.pairAge,
              check10m: null, check30m: null,
              verdict: holders?.isFarm ? (pnl > 10 ? 'FARM_PUMPABLE' : 'FARM_DUMP') : holders?.suspectedBundle ? (pnl > 15 ? 'BUNDLE_WIN' : 'BUNDLE_DUMP') : pnl > 50 ? 'MOONSHOT' : pnl > 15 ? 'WINNER' : pnl > 0 ? 'WEAK' : 'DUMPED'
            };
            results.push(e); keys.add(key);
            const tag = e.isFarm ? '[FARM]' : e.isBundle ? '[BUNDLE]' : '[CLEAN]';
            console.log(`[5m] ${tag} ${sig.token} | ${sig.mc}→${price.mc} | ${pnl>0?'+':''}${Math.round(pnl)}% | top1:${e.top1Pct}% top10:${e.top10Pct}% | ${e.verdict}`);
          }
          await new Promise(r => setTimeout(r, 2000)); fs.writeFileSync(RESULTS_FILE, JSON.stringify(results, null, 2));
        }

        if (existing && !existing.check10m && age >= 600000) {
          const p = await checkPrice(sig.mint);
          if (p) { const pnl = sig.mc>0?((p.mc-sig.mc)/sig.mc*100):0; existing.check10m = Math.round(pnl); console.log(`[10m] ${sig.token} | ${pnl>0?'+':''}${Math.round(pnl)}%`); }
          await new Promise(r => setTimeout(r, 1000));
        }

        if (existing && !existing.check30m && age >= 1800000) {
          const p = await checkPrice(sig.mint);
          if (p) {
            const pnl = sig.mc>0?((p.mc-sig.mc)/sig.mc*100):0; existing.check30m = Math.round(pnl);
            if (pnl > 100) existing.verdict = 'MOONSHOT';
            else if (pnl < -50) existing.verdict = 'RUGGED';
            console.log(`[30m] ${sig.token} | ${pnl>0?'+':''}${Math.round(pnl)}% | ${existing.verdict}`);
          }
          await new Promise(r => setTimeout(r, 1000));
        }
      }

      fs.writeFileSync(RESULTS_FILE, JSON.stringify(results, null, 2));

      // REPORT
      const c = results.filter(r => r.pnl5m !== undefined);
      if (c.length) {
        const farms = c.filter(r => r.isFarm);
        const bundles = c.filter(r => r.isBundle && !r.isFarm);
        const clean = c.filter(r => !r.isFarm && !r.isBundle);
        console.log(`\n=== REPORT: ${c.length} signals ===`);
        console.log(`Farms: ${farms.length} (${farms.filter(r=>r.pnl5m>15).length} pump / ${farms.filter(r=>r.pnl5m<=0).length} dump)`);
        console.log(`Bundles: ${bundles.length} (${bundles.filter(r=>r.pnl5m>15).length} pump / ${bundles.filter(r=>r.pnl5m<=0).length} dump)`);
        console.log(`Clean: ${clean.length} (${clean.filter(r=>r.pnl5m>15).length} pump / ${clean.filter(r=>r.pnl5m<=0).length} dump)`);
        const kol = {};
        for (const r of c) { for (const k of r.kols) { if (!kol[k]) kol[k]={w:0,l:0,pnl:0,farms:0}; if(r.pnl5m>15)kol[k].w++;else kol[k].l++; kol[k].pnl+=r.pnl5m; if(r.isFarm)kol[k].farms++; }}
        console.log('[KOL BOARD]');
        Object.entries(kol).sort((a,b)=>b[1].pnl-a[1].pnl).slice(0,15).forEach(([n,s])=>console.log(`  ${n}: ${s.w}W/${s.l}L | PnL:${s.pnl>0?'+':''}${s.pnl}% | farms:${s.farms}`));
        console.log('===\n');
      }
    } catch (e) { console.error('[ERR]', e.message); }
    await new Promise(r => setTimeout(r, 120000));
  }
}
run();
