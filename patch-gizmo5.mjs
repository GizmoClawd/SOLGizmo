import fs from 'fs';

const file = process.env.HOME + '/.openclaw/workspace/SOLGizmo/gizmo.mjs';
fs.copyFileSync(file, file + '.bak5');

let code = fs.readFileSync(file, 'utf8');

// ── 1. Inject the checkRugWallets function before the sell function ──
const RUG_WALLET_FN = `
// ─── NEW WALLET RUG DETECTION ─────────────────────────────────────────────────
// Fetches recent buyers of a token via Helius, checks how many wallets are <7 days old.
// If 15+ new wallets are found, it's likely a coordinated rug setup.
const NEW_WALLET_DAYS = 7;
const NEW_WALLET_THRESHOLD = 15;

async function checkRugWallets(mint) {
  if (!HELIUS_KEY) return { isRug: false, newCount: 0, total: 0 };
  try {
    // Get recent swap transactions for this token
    const url = \`https://api.helius.xyz/v0/addresses/\${mint}/transactions?api-key=\${HELIUS_KEY}&limit=50&type=SWAP\`;
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
        const sigUrl = \`https://api.helius.xyz/v0/addresses/\${addr}/transactions?api-key=\${HELIUS_KEY}&limit=10\`;
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
    log(\`⚠️ checkRugWallets error: \${e.message?.slice(0, 80)}\`);
    return { isRug: false, newCount: 0, total: 0 };
  }
}
// ──────────────────────────────────────────────────────────────────────────────

`;

// Inject before the sell function
const SELL_ANCHOR = `// ─── SELL ───`;
if (!code.includes(SELL_ANCHOR)) {
  console.error('❌ Could not find sell function anchor');
  process.exit(1);
}
code = code.replace(SELL_ANCHOR, RUG_WALLET_FN + SELL_ANCHOR);

// ── 2. Inject the rug check inside the convergence buy block ──
const BUY_ANCHOR = `      log(\`🎯 CONVERGENCE BUY: \${info.symbol} \${uniqueKols.length} KOLs — buying \${size} SOL\`);`;
const RUG_CHECK = `      // ── NEW WALLET RUG CHECK ──
      const rugCheck = await checkRugWallets(mint);
      if (rugCheck.isRug) {
        log(\`🚩 RUG WALLETS: \${info.symbol} — \${rugCheck.newCount}/\${rugCheck.total} buyers are <7 days old. BLOCKED.\`);
        continue;
      }
      if (rugCheck.newCount > 5) log(\`⚠️ \${info.symbol}: \${rugCheck.newCount}/\${rugCheck.total} new wallets detected (below block threshold)\`);
      // ────────────────────────────────────────────────────────
      `;

if (!code.includes(BUY_ANCHOR)) {
  console.error('❌ Could not find convergence buy anchor');
  process.exit(1);
}
code = code.replace(BUY_ANCHOR, RUG_CHECK + BUY_ANCHOR);

fs.writeFileSync(file, code);
console.log('✅ Backed up to gizmo.mjs.bak5');
console.log('✅ New wallet rug detection injected!');
console.log('   → Checks up to 40 recent buyers before every convergence buy');
console.log('   → Blocks if 15+ wallets are <7 days old');
console.log('   → Warns (but allows) if 6-14 new wallets spotted');
