import { Connection, Keypair, VersionedTransaction, LAMPORTS_PER_SOL, PublicKey } from '@solana/web3.js';
import bs58 from 'bs58';
import fs from 'fs';

const walletData = JSON.parse(process.env.SOLANA_WALLET_JSON || fs.readFileSync(process.env.HOME + '/.gizmo/solana-wallet.json', 'utf-8'));
const keypair = Keypair.fromSecretKey(bs58.decode(walletData.secretKey));
// Fallback RPC chain: env override → Helius → PublicNode
const RPC_CHAIN = [
  process.env.RPC_URL,
  process.env.HELIUS_API_KEY ? `https://mainnet.helius-rpc.com/?api-key=${process.env.HELIUS_API_KEY}` : null,
  'https://api.mainnet-beta.solana.com',
  'https://rpc.ankr.com/solana',
  'https://solana.publicnode.com'
].filter(Boolean);
let connection;
for (const rpc of RPC_CHAIN) {
  try {
    const c = new Connection(rpc);
    await c.getSlot();
    connection = c;
    break;
  } catch { continue; }
}
if (!connection) { console.error('All RPCs failed'); process.exit(1); }
const SOL_MINT = 'So11111111111111111111111111111111111111112';

const TOKEN = process.argv[2];
const AMOUNT_ARG = process.argv[3]; // e.g. "100%" or "500000"

if (!TOKEN || !AMOUNT_ARG) {
  console.log('Usage: node sell.mjs <TOKEN_CA> <amount|100%>');
  process.exit(1);
}

async function getTokenBalance(mint) {
  const tokenAccounts = await connection.getParsedTokenAccountsByOwner(keypair.publicKey, { mint: new PublicKey(mint) });
  if (!tokenAccounts.value.length) return { amount: 0n, decimals: 0, uiAmount: 0 };
  const info = tokenAccounts.value[0].account.data.parsed.info;
  return {
    amount: BigInt(info.tokenAmount.amount),
    decimals: info.tokenAmount.decimals,
    uiAmount: info.tokenAmount.uiAmount
  };
}

async function main() {
  const balance = await getTokenBalance(TOKEN);
  console.log(`Token balance: ${balance.uiAmount} (raw: ${balance.amount})`);
  
  if (balance.amount === 0n) {
    console.log('❌ No tokens to sell');
    process.exit(1);
  }

  let sellAmount;
  if (AMOUNT_ARG.endsWith('%')) {
    const pct = parseFloat(AMOUNT_ARG) / 100;
    sellAmount = BigInt(Math.floor(Number(balance.amount) * pct));
  } else {
    sellAmount = BigInt(Math.floor(parseFloat(AMOUNT_ARG) * (10 ** balance.decimals)));
  }

  console.log(`Selling ${sellAmount} tokens (${Number(sellAmount) / (10 ** balance.decimals)} units) → SOL...`);

  const quoteResp = await fetch(`https://lite-api.jup.ag/swap/v1/quote?inputMint=${TOKEN}&outputMint=${SOL_MINT}&amount=${sellAmount}&slippageBps=1500`, { headers: { 'User-Agent': 'Mozilla/5.0' } });
  const quote = await quoteResp.json();
  if (quote.error) throw new Error(quote.error);
  
  const outSol = Number(quote.outAmount) / LAMPORTS_PER_SOL;
  console.log(`Output: ~${outSol.toFixed(4)} SOL | Impact: ${quote.priceImpactPct || '0'}%`);

  const swapResp = await fetch('https://lite-api.jup.ag/swap/v1/swap', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'User-Agent': 'Mozilla/5.0' },
    body: JSON.stringify({
      quoteResponse: quote,
      userPublicKey: keypair.publicKey.toBase58(),
      wrapAndUnwrapSol: true,
      dynamicComputeUnitLimit: true,
      prioritizationFeeLamports: { autoMultiplier: 3 }
    })
  });
  const swapText = await swapResp.text();
  if (!swapText.includes('swapTransaction')) throw new Error('Swap failed: ' + swapText.slice(0,200));
  const { swapTransaction } = JSON.parse(swapText);

  const tx = VersionedTransaction.deserialize(Buffer.from(swapTransaction, 'base64'));
  tx.sign([keypair]);

  const txid = await connection.sendRawTransaction(tx.serialize(), { skipPreflight: true, maxRetries: 3 });
  console.log(`TX: https://solscan.io/tx/${txid}`);

  const conf = await connection.confirmTransaction(txid, 'confirmed');
  if (conf.value.err) console.log('❌ FAILED:', conf.value.err);
  else console.log('✅ CONFIRMED — sold for ~' + outSol.toFixed(4) + ' SOL');
}

main().catch(e => console.error('Error:', e.message));
