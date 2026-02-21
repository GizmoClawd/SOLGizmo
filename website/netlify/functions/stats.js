const WALLET = 'FXdMNyRo5CqfG3yRWCcNu163FpnSusdZSYecsB76GAkn';
const GIZMO_CA = '8HGer4vRWZMu5MUYU7ACPb4uanKgBewaXJZscLagpump';
const PUNCH_CA = 'NV2RYH954cTJ3ckFUpvfqaQXU4ARqqDH3562nFSpump';
const BLOODNUT_CA = 'HBJUeugfgJ3zWYMMP4cULbZ9bjnZbb6WG9cBcWNxpump';
const USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const RPC = 'https://mainnet.helius-rpc.com/?api-key=2de73660-14b8-412a-9ff2-8e6989c53266';

const trades = {
  trades: [
    { id: 1, type: "BUY", token: "$GIZMO", amount_sol: 15, status: "HOLDING", timestamp: "2025-02-18T14:30:00Z", notes: "Core position — the namesake token" },
    { id: 2, type: "BUY", token: "$PUNCH", amount_sol: 8, status: "HOLDING", timestamp: "2025-02-19T09:15:00Z", notes: "Momentum play" },
    { id: 3, type: "SWAP", token: "USDC", amount_sol: 20, status: "DEPLOYED", timestamp: "2025-02-19T16:45:00Z", notes: "Swapped to USDC for Drift prediction markets" },
    { id: 4, type: "PREDICTION", token: "DRIFT_MARKETS", amount_sol: 0, status: "WON", timestamp: "2025-02-20T10:00:00Z", notes: "Paper trades: 3/3 predictions correct ✅" }
  ],
  stats: { total_deployed_sol: 43, paper_trade_record: "3W-0L", win_rate: "100%" }
};

async function fetchJSON(url, opts) {
  const r = await fetch(url, opts);
  return r.json();
}

exports.handler = async () => {
  const results = { timestamp: new Date().toISOString(), wallet: WALLET, trades };

  try {
    // SOL balance
    const bal = await fetchJSON(RPC, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getBalance', params: [WALLET] }) });
    results.solBalance = (bal.result?.value || 0) / 1e9;
  } catch (e) { results.solBalance = null; }

  try {
    // SOL price from Jupiter
    const jp = await fetchJSON('https://api.jup.ag/price/v2?ids=So11111111111111111111111111111111111111112');
    results.solPrice = parseFloat(jp.data?.['So11111111111111111111111111111111111111112']?.price || 0);
  } catch (e) { results.solPrice = null; }

  try {
    // Token balances
    const tb = await fetchJSON(RPC, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getTokenAccountsByOwner', params: [WALLET, { programId: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA' }, { encoding: 'jsonParsed' }] }) });
    results.tokens = {};
    for (const acct of (tb.result?.value || [])) {
      const info = acct.account.data.parsed.info;
      const amt = parseFloat(info.tokenAmount.uiAmountString || '0');
      if (info.mint === GIZMO_CA) results.tokens.GIZMO = amt;
      if (info.mint === PUNCH_CA) results.tokens.PUNCH = amt;
      if (info.mint === BLOODNUT_CA) results.tokens.BLOODNUT = amt;
      if (info.mint === USDC_MINT) results.tokens.USDC = amt;
    }
  } catch (e) { results.tokens = null; }

  try {
    // DexScreener prices
    const [gd, pd, bd] = await Promise.all([
      fetchJSON(`https://api.dexscreener.com/latest/dex/tokens/${GIZMO_CA}`),
      fetchJSON(`https://api.dexscreener.com/latest/dex/tokens/${PUNCH_CA}`),
      fetchJSON(`https://api.dexscreener.com/latest/dex/tokens/${BLOODNUT_CA}`)
    ]);
    results.prices = {
      GIZMO: parseFloat(gd.pairs?.[0]?.priceUsd || 0),
      PUNCH: parseFloat(pd.pairs?.[0]?.priceUsd || 0),
      BLOODNUT: parseFloat(bd.pairs?.[0]?.priceUsd || 0)
    };
  } catch (e) { results.prices = null; }

  try {
    // Drift perp positions via DLOB
    const [solPerp, btcPerp] = await Promise.all([
      fetchJSON('https://dlob.drift.trade/l2?marketIndex=0&marketType=perp&depth=1'),
      fetchJSON('https://dlob.drift.trade/l2?marketIndex=1&marketType=perp&depth=1')
    ]);
    const midPrice = (d) => {
      if (d.asks?.[0] && d.bids?.[0]) return (parseInt(d.asks[0].price) / 1e6 + parseInt(d.bids[0].price) / 1e6) / 2;
      return null;
    };
    results.perps = {
      SOL: { markPrice: midPrice(solPerp), entryPrice: 86.02, size: 5.80, direction: 'LONG' },
      BTC: { markPrice: midPrice(btcPerp), entryPrice: 68389, size: 0.0029, direction: 'LONG' }
    };
    // Calculate PnL
    for (const [k, p] of Object.entries(results.perps)) {
      if (p.markPrice) p.pnl = (p.markPrice - p.entryPrice) * p.size;
    }
  } catch (e) { results.perps = null; }

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'public, max-age=15' },
    body: JSON.stringify(results)
  };
};
