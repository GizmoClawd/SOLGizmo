/**
 * ⚡ METEORA DLMM FEE FARMER
 * Second income stream — farm swap fees on high-volume memecoin pools
 * 
 * How it works:
 * 1. Finds DLMM pools with high volume (tokens KOLs are trading)
 * 2. Opens concentrated liquidity position around current price (±5 bins)
 * 3. Earns fees on every swap in the pool
 * 4. Closes position when volume drops or after max duration
 * 
 * Called from gizmo.mjs main loop
 */

import DLMM from '@meteora-ag/dlmm';
import { Connection, Keypair, PublicKey, sendAndConfirmTransaction } from '@solana/web3.js';
import { BN } from '@coral-xyz/anchor';
import fs from 'fs';

const BASE_DIR = process.env.HOME + '/.gizmo/runtime';
const FARM_STATE_FILE = BASE_DIR + '/farm-positions.json';
const HELIUS_KEY = process.env.HELIUS_API_KEY || '2de73660-14b8-412a-9ff2-8e6989c53266';
const RPC_URL = `https://mainnet.helius-rpc.com/?api-key=${HELIUS_KEY}`;

// ─── CONFIG ──────────────────────────────────────────────────────────────────
const MAX_FARM_POSITIONS = 2;          // max simultaneous LP positions
const MIN_VOLUME_24H = 100000;         // $100k min 24h volume
const MAX_FARM_SOL = 0.3;             // max SOL per LP position
const FARM_DURATION_MS = 60 * 60000;  // 1 hour max per position
const BIN_RANGE = 5;                   // ±5 bins around active price
const MIN_WALLET_SOL = 0.5;           // don't farm if wallet below this

// ─── STATE ───────────────────────────────────────────────────────────────────
function loadFarmPositions() {
  try { return JSON.parse(fs.readFileSync(FARM_STATE_FILE, 'utf8')); }
  catch { return []; }
}

function saveFarmPositions(positions) {
  try { fs.writeFileSync(FARM_STATE_FILE, JSON.stringify(positions, null, 2)); } catch {}
}

function farmLog(msg) {
  const line = `[${new Date().toLocaleString()}] [FARM] ${msg}`;
  try { fs.appendFileSync(BASE_DIR + '/gizmo.log', line + '\n'); } catch {}
  if (process.env.OPENCLAW_AGENT !== '1') process.stderr.write(line + '\n');
}

// ─── LOAD WALLET ─────────────────────────────────────────────────────────────
function loadKeypair() {
  const raw = JSON.parse(fs.readFileSync(process.env.HOME + '/.gizmo/solana-wallet.json', 'utf8'));
  if (raw.secretKey) {
    // base58 format
    const bs58 = require('bs58');
    const decoded = bs58.default ? bs58.default.decode(raw.secretKey) : bs58.decode(raw.secretKey);
    return Keypair.fromSecretKey(decoded);
  }
  // array format
  return Keypair.fromSecretKey(Uint8Array.from(raw));
}

// ─── FIND HIGH-VOLUME POOLS ─────────────────────────────────────────────────
async function findFarmablePools(trackedMints) {
  try {
    // Get all DLMM pools
    const r = await fetch('https://dlmm-api.meteora.ag/pair/all', { signal: AbortSignal.timeout(10000) });
    const pairs = await r.json();
    
    // Filter for high-volume SOL-paired memecoin pools
    const farmable = pairs
      .filter(p => {
        const vol24 = parseFloat(p.trade_volume_24h || 0);
        const liq = parseFloat(p.liquidity || 0);
        const isSOLPair = p.mint_x === 'So11111111111111111111111111111111111111112' || 
                          p.mint_y === 'So11111111111111111111111111111111111111112';
        
        return isSOLPair && vol24 >= MIN_VOLUME_24H && liq > 5000;
      })
      .map(p => ({
        address: p.address,
        name: p.name,
        mintX: p.mint_x,
        mintY: p.mint_y,
        volume24h: parseFloat(p.trade_volume_24h || 0),
        liquidity: parseFloat(p.liquidity || 0),
        fees24h: parseFloat(p.fee_volume_24h || p.fees_24h || 0),
        binStep: p.bin_step,
        baseFee: p.base_fee_percentage,
        currentPrice: parseFloat(p.current_price || 0),
      }))
      .sort((a, b) => {
        // Prioritize pools where KOLs are active
        const aKOL = trackedMints.has(a.mintX) || trackedMints.has(a.mintY) ? 1000000 : 0;
        const bKOL = trackedMints.has(b.mintX) || trackedMints.has(b.mintY) ? 1000000 : 0;
        // Then by fee/liquidity ratio (best fee earning potential)
        const aRatio = (a.fees24h / Math.max(a.liquidity, 1)) + aKOL;
        const bRatio = (b.fees24h / Math.max(b.liquidity, 1)) + bKOL;
        return bRatio - aRatio;
      })
      .slice(0, 10);
    
    return farmable;
  } catch (e) {
    farmLog(`Error finding pools: ${e.message}`);
    return [];
  }
}

// ─── OPEN FARM POSITION ──────────────────────────────────────────────────────
async function openFarmPosition(poolAddress, solAmount) {
  const connection = new Connection(RPC_URL, 'confirmed');
  const user = loadKeypair();
  
  try {
    const poolPubkey = new PublicKey(poolAddress);
    const dlmmPool = await DLMM.create(connection, poolPubkey);
    
    // Get active bin (current price)
    const activeBin = await dlmmPool.getActiveBin();
    farmLog(`Pool ${poolAddress.slice(0, 8)}: active bin ${activeBin.binId}, price ${dlmmPool.fromPricePerLamport(Number(activeBin.price))}`);
    
    // Set range: ±BIN_RANGE bins around active price
    const minBinId = activeBin.binId - BIN_RANGE;
    const maxBinId = activeBin.binId + BIN_RANGE;
    
    // Calculate amounts — deposit SOL side
    const solLamports = Math.floor(solAmount * 1e9);
    const totalYAmount = new BN(solLamports);
    
    // Create new position
    const newPosition = Keypair.generate();
    
    const createPositionTx = await dlmmPool.initializePositionAndAddLiquidityByStrategy({
      positionPubKey: newPosition.publicKey,
      user: user.publicKey,
      totalXAmount: new BN(0),  // start with SOL only (single-sided)
      totalYAmount: totalYAmount,
      strategy: {
        maxBinId,
        minBinId,
        strategyType: 0, // Spot strategy
      },
    });
    
    const txHash = await sendAndConfirmTransaction(
      connection, 
      createPositionTx, 
      [user, newPosition],
      { skipPreflight: false, commitment: 'confirmed' }
    );
    
    farmLog(`✅ FARM OPENED: ${poolAddress.slice(0, 8)} | ${solAmount} SOL | TX: ${txHash}`);
    
    return {
      poolAddress,
      positionPubKey: newPosition.publicKey.toBase58(),
      solDeposited: solAmount,
      openTime: Date.now(),
      activeBinId: activeBin.binId,
      minBinId,
      maxBinId,
      txHash,
    };
  } catch (e) {
    farmLog(`❌ FARM OPEN FAILED: ${poolAddress.slice(0, 8)} — ${e.message?.slice(0, 100)}`);
    return null;
  }
}

// ─── CHECK FARM POSITION (fees earned, should close?) ────────────────────────
async function checkFarmPosition(position) {
  const connection = new Connection(RPC_URL, 'confirmed');
  
  try {
    const poolPubkey = new PublicKey(position.poolAddress);
    const dlmmPool = await DLMM.create(connection, poolPubkey);
    
    // Get position info
    const positionPubkey = new PublicKey(position.positionPubKey);
    const { userPositions } = await dlmmPool.getPositionsByUserAndLbPair(
      loadKeypair().publicKey
    );
    
    const myPosition = userPositions.find(p => p.publicKey.equals(positionPubkey));
    if (!myPosition) {
      farmLog(`⚠️ Position ${position.positionPubKey.slice(0, 8)} not found — may be closed`);
      return { shouldClose: true, feesEarned: 0 };
    }
    
    // Check fees
    const feeX = myPosition.positionData.feeX?.toNumber() || 0;
    const feeY = myPosition.positionData.feeY?.toNumber() || 0;
    const feesInSOL = feeY / 1e9; // Y is SOL in most pairs
    
    // Check duration
    const elapsed = Date.now() - position.openTime;
    const expired = elapsed > FARM_DURATION_MS;
    
    // Check if active bin moved out of range
    const activeBin = await dlmmPool.getActiveBin();
    const outOfRange = activeBin.binId < position.minBinId || activeBin.binId > position.maxBinId;
    
    farmLog(`🌾 FARM ${position.poolAddress.slice(0, 8)}: fees ${feesInSOL.toFixed(4)} SOL | ${(elapsed/60000).toFixed(0)}min | ${outOfRange ? 'OUT OF RANGE' : 'in range'}`);
    
    return {
      shouldClose: expired || outOfRange,
      feesEarned: feesInSOL,
      outOfRange,
      elapsed,
      activeBinId: activeBin.binId,
    };
  } catch (e) {
    farmLog(`⚠️ Farm check error: ${e.message?.slice(0, 80)}`);
    return { shouldClose: false, feesEarned: 0 };
  }
}

// ─── CLOSE FARM POSITION ─────────────────────────────────────────────────────
async function closeFarmPosition(position) {
  const connection = new Connection(RPC_URL, 'confirmed');
  const user = loadKeypair();
  
  try {
    const poolPubkey = new PublicKey(position.poolAddress);
    const dlmmPool = await DLMM.create(connection, poolPubkey);
    
    const positionPubkey = new PublicKey(position.positionPubKey);
    const { userPositions } = await dlmmPool.getPositionsByUserAndLbPair(user.publicKey);
    const myPosition = userPositions.find(p => p.publicKey.equals(positionPubkey));
    
    if (!myPosition) {
      farmLog(`⚠️ Position already closed: ${position.positionPubKey.slice(0, 8)}`);
      return true;
    }
    
    // Get bin IDs to remove
    const binIds = myPosition.positionData.positionBinData.map(bin => bin.binId);
    
    if (binIds.length === 0) {
      farmLog(`⚠️ No bins to remove for ${position.positionPubKey.slice(0, 8)}`);
      return true;
    }
    
    // Remove all liquidity + claim fees + close position
    const removeTx = await dlmmPool.removeLiquidity({
      position: myPosition.publicKey,
      user: user.publicKey,
      fromBinId: binIds[0],
      toBinId: binIds[binIds.length - 1],
      liquiditiesBpsToRemove: new Array(binIds.length).fill(new BN(100 * 100)), // 100%
      shouldClaimAndClose: true,
    });
    
    // removeTx can be single or array
    const txs = Array.isArray(removeTx) ? removeTx : [removeTx];
    for (const tx of txs) {
      const hash = await sendAndConfirmTransaction(connection, tx, [user], {
        skipPreflight: false,
        commitment: 'confirmed',
      });
      farmLog(`✅ FARM CLOSED: ${position.poolAddress.slice(0, 8)} | TX: ${hash}`);
    }
    
    return true;
  } catch (e) {
    farmLog(`❌ FARM CLOSE FAILED: ${position.poolAddress.slice(0, 8)} — ${e.message?.slice(0, 100)}`);
    return false;
  }
}

// ─── MAIN FARM CYCLE (called from gizmo.mjs) ────────────────────────────────
export async function runFarmCycle(walletBalance, recentKOLMints = new Set()) {
  if (walletBalance < MIN_WALLET_SOL) {
    return; // don't farm if wallet too low
  }
  
  const positions = loadFarmPositions();
  
  // Check existing positions
  for (let i = positions.length - 1; i >= 0; i--) {
    const pos = positions[i];
    const status = await checkFarmPosition(pos);
    
    if (status.shouldClose) {
      farmLog(`🔄 Closing farm: ${pos.poolAddress.slice(0, 8)} | earned ${status.feesEarned.toFixed(4)} SOL | reason: ${status.outOfRange ? 'out of range' : 'expired'}`);
      const closed = await closeFarmPosition(pos);
      if (closed) {
        positions.splice(i, 1);
        saveFarmPositions(positions);
      }
    }
  }
  
  // Open new positions if slots available
  if (positions.length < MAX_FARM_POSITIONS) {
    const pools = await findFarmablePools(recentKOLMints);
    
    // Skip pools we already have positions in
    const activePools = new Set(positions.map(p => p.poolAddress));
    const candidates = pools.filter(p => !activePools.has(p.address));
    
    if (candidates.length > 0) {
      const best = candidates[0];
      const feeAPR = best.liquidity > 0 ? ((best.fees24h * 365) / best.liquidity * 100) : 0;
      
      farmLog(`🌾 Best pool: ${best.name} | Vol:$${Math.round(best.volume24h/1000)}K | Fees:$${Math.round(best.fees24h)} | APR:${feeAPR.toFixed(0)}%`);
      
      // Only farm if APR looks good (>100% annualized)
      if (feeAPR > 100) {
        const farmAmount = Math.min(MAX_FARM_SOL, walletBalance * 0.15);
        farmLog(`🌱 Opening farm: ${best.name} | ${farmAmount.toFixed(3)} SOL | APR:${feeAPR.toFixed(0)}%`);
        
        const result = await openFarmPosition(best.address, farmAmount);
        if (result) {
          result.poolName = best.name;
          result.fees24h = best.fees24h;
          result.volume24h = best.volume24h;
          positions.push(result);
          saveFarmPositions(positions);
        }
      } else {
        farmLog(`⏳ No pools above 100% APR — best is ${best.name} at ${feeAPR.toFixed(0)}%`);
      }
    }
  }
}

// ─── STANDALONE TEST ─────────────────────────────────────────────────────────
if (process.argv[1]?.includes('meteora-farm')) {
  farmLog('=== METEORA FARM TEST ===');
  (async () => {
    const pools = await findFarmablePools(new Set());
    farmLog(`Found ${pools.length} farmable pools:`);
    pools.slice(0, 5).forEach((p, i) => {
      const apr = p.liquidity > 0 ? ((p.fees24h * 365) / p.liquidity * 100) : 0;
      farmLog(`  ${i+1}. ${p.name} | Vol:$${Math.round(p.volume24h/1000)}K | Fees:$${Math.round(p.fees24h)} | Liq:$${Math.round(p.liquidity/1000)}K | APR:${apr.toFixed(0)}%`);
    });
  })();
}
