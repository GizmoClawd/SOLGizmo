/**
 * Gizmo Survival Monitor
 * Checks Solana wallet balance and reports survival tier.
 * Designed to be called by OpenClaw cron.
 */
import { Connection, PublicKey, LAMPORTS_PER_SOL } from '@solana/web3.js';

const WALLET = 'FXdMNyRo5CqfG3yRWCcNu163FpnSusdZSYecsB76GAkn';
const RPC = 'https://api.mainnet-beta.solana.com';

// Survival tiers (in SOL)
const THRESHOLDS = {
  normal: 1.0,      // Full capabilities
  low_compute: 0.25, // Conserve resources
  critical: 0.01,    // Minimal operations
  // Below critical = dead
};

async function main() {
  const conn = new Connection(RPC);
  const pubkey = new PublicKey(WALLET);
  const balance = await conn.getBalance(pubkey);
  const sol = balance / LAMPORTS_PER_SOL;

  let tier = 'dead';
  if (sol >= THRESHOLDS.normal) tier = 'normal';
  else if (sol >= THRESHOLDS.low_compute) tier = 'low_compute';
  else if (sol >= THRESHOLDS.critical) tier = 'critical';

  const status = {
    address: WALLET,
    balanceSOL: sol,
    tier,
    thresholds: THRESHOLDS,
    checkedAt: new Date().toISOString(),
  };

  console.log(JSON.stringify(status, null, 2));
}

main().catch(e => {
  console.error('Balance check failed:', e.message);
  process.exit(1);
});
