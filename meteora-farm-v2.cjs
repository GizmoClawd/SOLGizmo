/**
 * ⚡ METEORA LP — Node 20 compatible
 * Usage:
 *   node meteora-LP pool-v2.mjs scan          — find best pools
 *   node meteora-LP pool-v2.mjs open <pool> <sol>  — open LP position
 *   node meteora-LP pool-v2.mjs status        — check open positions + fees
 *   node meteora-LP pool-v2.mjs close         — close all positions, collect fees
 *   node meteora-LP pool-v2.mjs auto          — full auto: scan, open, monitor, close
 */

const { Connection, Keypair, PublicKey, sendAndConfirmTransaction } = require('@solana/web3.js');
const DLMM = require('@meteora-ag/dlmm');
const { BN } = require('@coral-xyz/anchor');
const fs = require('fs');

const BASE_DIR = (process.env.HOME || '/root') + '/.gizmo/runtime';
const LP_FILE = BASE_DIR + '/farm-positions.json';
const HELIUS_KEY = process.env.HELIUS_API_KEY || '2de73660-14b8-412a-9ff2-8e6989c53266';
const RPC = `https://mainnet.helius-rpc.com/?api-key=${HELIUS_KEY}`;
const connection = new Connection(RPC, 'confirmed');

// Config
const BIN_RANGE = 5;
const MAX_LP_SOL = 0.3;
const LP_DURATION_MS = 60 * 60000; // 1 hour

function log(msg) {
  const line = `[${new Date().toLocaleString()}] [LP] ${msg}`;
  console.log(line);
  try { fs.appendFileSync(BASE_DIR + '/gizmo.log', line + '\n'); } catch {}
}

function loadKeypair() {
  const raw = JSON.parse(fs.readFileSync((process.env.HOME || '/root') + '/.gizmo/solana-wallet.json', 'utf8'));
  if (raw.secretKey) {
    const bs58 = require('bs58');
    const decoded = bs58.default ? bs58.default.decode(raw.secretKey) : bs58.decode(raw.secretKey);
    return Keypair.fromSecretKey(decoded);
  }
  return Keypair.fromSecretKey(Uint8Array.from(raw));
}

function loadFarmState() {
  try { return JSON.parse(fs.readFileSync(LP_FILE, 'utf8')); }
  catch { return []; }
}

function saveFarmState(s) {
  fs.writeFileSync(LP_FILE, JSON.stringify(s, null, 2));
}

// ═══════════════════════════════════════════════════════════════════════════
// SCAN — find best pools
// ═══════════════════════════════════════════════════════════════════════════
async function scan() {
  log('Scanning Meteora DLMM pools...');
  const r = await fetch('https://dlmm-api.meteora.ag/pair/all');
  const pairs = await r.json();
  const sol = 'So11111111111111111111111111111111111111112';

  const pools = pairs
    .filter(p => {
      const v = parseFloat(p.trade_volume_24h || 0);
      const l = parseFloat(p.liquidity || 0);
      const isSol = p.mint_x === sol || p.mint_y === sol;
      return isSol && v > 50000 && l > 5000;
    })
    .map(p => {
      const fees = parseFloat(p.fees_24h || p.fee_volume_24h || 0);
      const liq = parseFloat(p.liquidity || 0);
      const apr = liq > 0 ? Math.round(fees * 365 / liq * 100) : 0;
      return {
        address: p.address,
        name: p.name,
        volume24h: Math.round(parseFloat(p.trade_volume_24h || 0)),
        fees24h: Math.round(fees),
        liquidity: Math.round(liq),
        apr,
        binStep: p.bin_step,
        mintX: p.mint_x,
        mintY: p.mint_y,
      };
    })
    .sort((a, b) => b.apr - a.apr)
    .slice(0, 15);

  log(`Found ${pools.length} LP poolable pools:`);
  pools.forEach((p, i) => {
    log(`  ${i + 1}. ${p.name} | Vol:$${Math.round(p.volume24h/1000)}K | Fees:$${p.fees24h} | Liq:$${Math.round(p.liquidity/1000)}K | APR:${p.apr}% | ${p.address.slice(0,8)}`);
  });

  return pools;
}

// ═══════════════════════════════════════════════════════════════════════════
// OPEN — create LP position
// ═══════════════════════════════════════════════════════════════════════════
async function open(poolAddress, solAmount) {
  const user = loadKeypair();
  log(`Opening LP pool: pool ${poolAddress.slice(0, 12)} | ${solAmount} SOL`);

  const poolPubkey = new PublicKey(poolAddress);
  const DLMMClass = DLMM.default || DLMM;
  const dlmmPool = await DLMMClass.create(connection, poolPubkey);

  // Get active bin
  const activeBin = await dlmmPool.getActiveBin();
  const price = dlmmPool.fromPricePerLamport(Number(activeBin.price));
  log(`Active bin: ${activeBin.binId} | Price: ${price}`);

  const minBinId = activeBin.binId - BIN_RANGE;
  const maxBinId = activeBin.binId + BIN_RANGE;

  // Determine which side is SOL
  const mintInfo = dlmmPool.tokenX.publicKey.toBase58() === 'So11111111111111111111111111111111111111112' ? 'X' : 'Y';
  const solLamports = new BN(Math.floor(solAmount * 1e9));

  const newPosition = Keypair.generate();

  log(`Creating position: bins ${minBinId} to ${maxBinId} | SOL on ${mintInfo} side`);

  let tx;
  if (mintInfo === 'X') {
    tx = await dlmmPool.initializePositionAndAddLiquidityByStrategy({
      positionPubKey: newPosition.publicKey,
      user: user.publicKey,
      totalXAmount: solLamports,
      totalYAmount: new BN(0),
      strategy: { maxBinId, minBinId, strategyType: DLMM.StrategyType?.Spot || 0 },
    });
  } else {
    tx = await dlmmPool.initializePositionAndAddLiquidityByStrategy({
      positionPubKey: newPosition.publicKey,
      user: user.publicKey,
      totalXAmount: new BN(0),
      totalYAmount: solLamports,
      strategy: { maxBinId, minBinId, strategyType: DLMM.StrategyType?.Spot || 0 },
    });
  }

  const hash = await sendAndConfirmTransaction(connection, tx, [user, newPosition], {
    skipPreflight: false,
    commitment: 'confirmed',
  });

  log(`✅ LP OPENED | Pool: ${poolAddress.slice(0, 12)} | ${solAmount} SOL | TX: ${hash}`);

  // Save state
  const state = loadFarmState();
  state.push({
    poolAddress,
    positionPubKey: newPosition.publicKey.toBase58(),
    solDeposited: solAmount,
    openTime: Date.now(),
    activeBinId: activeBin.binId,
    minBinId,
    maxBinId,
    txHash: hash,
    solSide: mintInfo,
  });
  saveFarmState(state);

  return hash;
}

// ═══════════════════════════════════════════════════════════════════════════
// STATUS — check positions and fees
// ═══════════════════════════════════════════════════════════════════════════
async function status() {
  const state = loadFarmState();
  if (state.length === 0) { log('No open LP pool positions'); return; }

  const user = loadKeypair();
  const DLMMClass = DLMM.default || DLMM;

  for (const pos of state) {
    try {
      const pool = await DLMMClass.create(connection, new PublicKey(pos.poolAddress));
      const { userPositions } = await pool.getPositionsByUserAndLbPair(user.publicKey);
      const myPos = userPositions.find(p => p.publicKey.toBase58() === pos.positionPubKey);

      if (!myPos) { log(`⚠️ Position ${pos.positionPubKey.slice(0, 8)} not found`); continue; }

      const feeX = myPos.positionData.feeX?.toNumber?.() || 0;
      const feeY = myPos.positionData.feeY?.toNumber?.() || 0;
      const elapsed = Math.round((Date.now() - pos.openTime) / 60000);

      const activeBin = await pool.getActiveBin();
      const inRange = activeBin.binId >= pos.minBinId && activeBin.binId <= pos.maxBinId;

      log(`🌾 ${pos.poolAddress.slice(0, 8)} | Deposited: ${pos.solDeposited} SOL | FeeX: ${feeX} | FeeY: ${feeY / 1e9} SOL | ${elapsed}min | ${inRange ? 'IN RANGE' : 'OUT OF RANGE'}`);
    } catch (e) {
      log(`⚠️ Status check error: ${e.message?.slice(0, 80)}`);
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// CLOSE — remove all liquidity + claim fees
// ═══════════════════════════════════════════════════════════════════════════
async function close(posIndex) {
  const state = loadFarmState();
  if (state.length === 0) { log('No positions to close'); return; }

  const user = loadKeypair();
  const DLMMClass = DLMM.default || DLMM;
  const toClose = posIndex !== undefined ? [state[posIndex]] : state;

  for (const pos of toClose) {
    try {
      const pool = await DLMMClass.create(connection, new PublicKey(pos.poolAddress));
      const { userPositions } = await pool.getPositionsByUserAndLbPair(user.publicKey);
      const myPos = userPositions.find(p => p.publicKey.toBase58() === pos.positionPubKey);

      if (!myPos) { log(`Position ${pos.positionPubKey.slice(0, 8)} already closed`); continue; }

      const binIds = myPos.positionData.positionBinData.map(b => b.binId);
      if (binIds.length === 0) { log('No bins'); continue; }

      const removeTx = await pool.removeLiquidity({
        position: myPos.publicKey,
        user: user.publicKey,
        fromBinId: binIds[0],
        toBinId: binIds[binIds.length - 1],
        liquiditiesBpsToRemove: new Array(binIds.length).fill(new BN(10000)),
        shouldClaimAndClose: true,
      });

      const txs = Array.isArray(removeTx) ? removeTx : [removeTx];
      for (const tx of txs) {
        const hash = await sendAndConfirmTransaction(connection, tx, [user], {
          skipPreflight: false,
          commitment: 'confirmed',
        });
        log(`✅ LP CLOSED | ${pos.poolAddress.slice(0, 8)} | TX: ${hash}`);
      }
    } catch (e) {
      log(`❌ Close failed: ${e.message?.slice(0, 100)}`);
    }
  }

  // Clear state
  if (posIndex !== undefined) {
    state.splice(posIndex, 1);
  } else {
    state.length = 0;
  }
  saveFarmState(state);
}

// ═══════════════════════════════════════════════════════════════════════════
// AUTO — full autonomous cycle
// ═══════════════════════════════════════════════════════════════════════════
async function auto() {
  log('=== METEORA AUTO-LP CYCLE ===');

  // Check wallet balance
  const bal = await connection.getBalance(loadKeypair().publicKey);
  const solBal = bal / 1e9;
  log(`Wallet: ${solBal.toFixed(3)} SOL`);

  if (solBal < 0.5) { log('Wallet too low for LP pooling'); return; }

  // Check/manage existing positions
  const state = loadFarmState();
  for (let i = state.length - 1; i >= 0; i--) {
    const pos = state[i];
    const elapsed = Date.now() - pos.openTime;
    if (elapsed > LP_DURATION_MS) {
      log(`Position ${pos.poolAddress.slice(0, 8)} expired (${Math.round(elapsed/60000)}min) — closing`);
      await close(i);
    }
  }

  // Open new if slots available
  const current = loadFarmState();
  if (current.length < 2) {
    const pools = await scan();
    if (pools.length > 0 && pools[0].apr > 100) {
      const best = pools[0];
      const amount = Math.min(MAX_LP_SOL, solBal * 0.15);
      log(`Auto-opening: ${best.name} | APR:${best.apr}% | ${amount.toFixed(3)} SOL`);
      try {
        await open(best.address, amount);
      } catch (e) {
        log(`Auto-open failed: ${e.message?.slice(0, 100)}`);
      }
    }
  }

  // Show status
  await status();
}

// ═══════════════════════════════════════════════════════════════════════════
// CLI
// ═══════════════════════════════════════════════════════════════════════════
const cmd = process.argv[2];
(async () => {
  try {
    if (cmd === 'scan') await scan();
    else if (cmd === 'open') await open(process.argv[3], parseFloat(process.argv[4]));
    else if (cmd === 'status') await status();
    else if (cmd === 'close') await close();
    else if (cmd === 'auto') await auto();
    else {
      console.log('Usage:');
      console.log('  node meteora-LP pool-v2.mjs scan');
      console.log('  node meteora-LP pool-v2.mjs open <poolAddress> <solAmount>');
      console.log('  node meteora-LP pool-v2.mjs status');
      console.log('  node meteora-LP pool-v2.mjs close');
      console.log('  node meteora-LP pool-v2.mjs auto');
    }
  } catch (e) {
    log(`Fatal: ${e.message}`);
    console.error(e);
  }
})();
