import fs from 'fs';

const RESULTS_FILE = '/root/.gizmo/runtime/learn-results.json';
const SIGNALS_FILE = '/root/.gizmo/runtime/learn-signals.json';
const MEMORY_FILE = '/root/.gizmo/runtime/brain-memory.json';
const DREAM_LOG = '/root/.gizmo/runtime/dream-log.json';
const XAI_KEY = 'xai-bZ83KTyZcQnHyUMU64C33Vz7tyY7kCRWPiw5GwOl73cFdJfIWfSZprHwbfTui31r6Yf1HL21RmCUo9im';

async function dream() {
  console.log('[DREAM] Entering dream state...');
  
  // Load all data
  let results = [], signals = [], memory = { trades: [], kolProfiles: {}, rules: [], version: 1 };
  try { results = JSON.parse(fs.readFileSync(RESULTS_FILE, 'utf8')); } catch {}
  try { signals = JSON.parse(fs.readFileSync(SIGNALS_FILE, 'utf8')); } catch {}
  try { memory = JSON.parse(fs.readFileSync(MEMORY_FILE, 'utf8')); } catch {}
  
  // Build KOL stats
  const kolStats = {};
  for (const r of results) {
    for (const k of (r.kols || [])) {
      if (!kolStats[k]) kolStats[k] = { trades: 0, farms: 0, wins: 0, losses: 0, totalPnl: 0, tokens: [] };
      kolStats[k].trades++;
      if (r.isFarm) kolStats[k].farms++;
      if ((r.pnl5m || 0) > 15) kolStats[k].wins++; else kolStats[k].losses++;
      kolStats[k].totalPnl += (r.pnl5m || 0);
      if (!kolStats[k].tokens.includes(r.token)) kolStats[k].tokens.push(r.token);
    }
  }
  
  // Build summary for LLM
  const kolSummary = Object.entries(kolStats)
    .sort((a, b) => b[1].trades - a[1].trades)
    .slice(0, 50)
    .map(([name, s]) => `${name}: ${s.trades} trades, ${s.farms} farms (${Math.round(s.farms/s.trades*100)}%), ${s.wins}W/${s.losses}L, PnL: ${s.totalPnl}%, tokens: ${s.tokens.slice(0,3).join(',')}`)
    .join('\n');

  const farmRate = results.length > 0 ? Math.round(results.filter(r => r.isFarm).length / results.length * 100) : 0;
  const recentTrades = (memory.trades || []).slice(-20).map(t => 
    `${t.token}: ${t.outcome || t.decision} PnL:${t.pnl || 'n/a'}% — ${t.reason || ''}`
  ).join('\n') || 'No trades yet';

  const prompt = `You are the dream state of an autonomous Solana memecoin trading agent called TheSolAgent. You are reviewing the day's data to consolidate learnings and improve future performance.

CURRENT STATE:
- Wallet: 1.12 SOL
- Total signals analyzed: ${signals.length}
- Total results with price tracking: ${results.length}
- Farm rate: ${farmRate}% of all signals were farms
- Recent trade outcomes: ${memory.trades?.length || 0} trades in memory

KOL PERFORMANCE (top 50 by activity):
${kolSummary}

RECENT TRADE HISTORY:
${recentTrades}

YOUR TASK — Think deeply and produce:

1. KOL CLASSIFICATIONS: For each active KOL, classify as:
   - FARMER (>80% farm rate, avoid their signals)
   - MIXED (50-80% farm rate, approach with caution)
   - ALPHA (consistent non-farm plays, follow closely)
   - UNKNOWN (not enough data)

2. PATTERN RECOGNITION: What patterns do you see? Which tokens/narratives worked? What MC range is optimal for entry? What time patterns exist?

3. STRATEGY RULES: Based on ALL this data, write 5-10 concrete rules the agent should follow tomorrow. Be specific — not "be careful" but "if CUPSEY buys with 3+ wallets and top holder >50%, skip — 100% farm rate"

4. PREDICTIONS: Based on today's patterns, what types of plays should the agent look for tomorrow?

RESPOND IN JSON:
{"kolClassifications": {"name": "FARMER|MIXED|ALPHA|UNKNOWN", ...}, "patterns": ["pattern 1", ...], "rules": ["rule 1", ...], "predictions": ["prediction 1", ...], "summary": "1-2 paragraph summary of what was learned today"}`;

  try {
    const r = await fetch('https://api.x.ai/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + XAI_KEY },
      body: JSON.stringify({ model: 'grok-4-1-fast', max_tokens: 2000, messages: [{ role: 'user', content: prompt }] })
    });
    const d = await r.json();
    const response = d?.choices?.[0]?.message?.content;
    
    if (!response) { console.log('[DREAM] No response from LLM'); return; }
    
    const clean = response.replace(/```json|```/g, '').trim();
    let dreamResult;
    try { dreamResult = JSON.parse(clean); } catch { dreamResult = { raw: response }; }
    
    // Save dream results
    const dreamLog = { date: new Date().toISOString(), signalsAnalyzed: signals.length, resultsAnalyzed: results.length, farmRate, ...dreamResult };
    
    let allDreams = [];
    try { allDreams = JSON.parse(fs.readFileSync(DREAM_LOG, 'utf8')); } catch {}
    allDreams.push(dreamLog);
    fs.writeFileSync(DREAM_LOG, JSON.stringify(allDreams, null, 2));
    
    // Update brain memory with dream insights
    memory.kolProfiles = dreamResult.kolClassifications || memory.kolProfiles;
    memory.rules = dreamResult.rules || memory.rules;
    memory.lastDream = new Date().toISOString();
    memory.dreamSummary = dreamResult.summary || '';
    fs.writeFileSync(MEMORY_FILE, JSON.stringify(memory, null, 2));
    
    console.log('[DREAM] === DREAM COMPLETE ===');
    console.log('[DREAM] Summary:', dreamResult.summary?.slice(0, 200) || 'No summary');
    console.log('[DREAM] Rules:', JSON.stringify(dreamResult.rules?.slice(0, 3) || []));
    console.log('[DREAM] KOL classifications:', Object.keys(dreamResult.kolClassifications || {}).length, 'KOLs classified');
    console.log('[DREAM] Saved to dream-log.json and brain-memory.json');
    
  } catch (e) {
    console.error('[DREAM] Error:', e.message);
  }
}

// Run dream, then schedule nightly
async function run() {
  // Check if it's dream time (2am-8am EST = 7am-1pm UTC)
  const checkDreamTime = () => {
    const utcHour = new Date().getUTCHours();
    return utcHour >= 7 && utcHour < 13; // 2am-8am EST
  };

  console.log('[DREAM] Dream daemon started. Dreams run 2am-8am EST.');
  
  // If started with 'now' arg, dream immediately
  if (process.argv[2] === 'now') {
    await dream();
    process.exit();
  }
  
  let dreamedToday = false;
  
  while (true) {
    if (checkDreamTime() && !dreamedToday) {
      console.log('[DREAM] Dream time. Starting consolidation...');
      await dream();
      dreamedToday = true;
      console.log('[DREAM] Dream complete. Sleeping until tomorrow.');
    }
    
    // Reset at 2pm UTC (9am EST) — ready for next night
    const utcHour = new Date().getUTCHours();
    if (utcHour >= 14) dreamedToday = false;
    
    // Check every 30 minutes
    await new Promise(r => setTimeout(r, 1800000));
  }
}

run();
