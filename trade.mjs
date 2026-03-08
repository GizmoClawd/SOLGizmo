import { Connection, Keypair, VersionedTransaction, LAMPORTS_PER_SOL } from '@solana/web3.js';
import bs58 from 'bs58';
import fs from 'fs';

const walletData = JSON.parse(process.env.SOLANA_WALLET_JSON || fs.readFileSync(process.env.HOME + '/.gizmo/solana-wallet.json', 'utf-8'));
const keypair = Keypair.fromSecretKey(bs58.decode(walletData.secretKey));
// Fallback RPC chain: env override → Helius → PublicNode
const RPC_CHAIN = [
  process.env.RPC_URL,
  `https://mainnet.helius-rpc.com/?api-key=${process.env.HELIUS_API_KEY}`,
  'https://solana.publicnode.com'
].filter(Boolean);
let connection;
for (const rpc of RPC_CHAIN) {
  try {
    const c = new Connection(rpc);
    await c.getSlot(); // quick health check
    connection = c;
    break;
  } catch { continue; }
}
if (!connection) { console.error('All RPCs failed'); process.exit(1); }
const SOL_MINT = 'So11111111111111111111111111111111111111112';

const TOKEN = process.argv[2];
const AMOUNT_SOL = parseFloat(process.argv[3]);
const AMOUNT = Math.floor(AMOUNT_SOL * LAMPORTS_PER_SOL);

async function main() {
  console.log(`Swapping ${AMOUNT_SOL} SOL → ${TOKEN}...`);
  const quoteResp = await fetch(`https://lite-api.jup.ag/swap/v1/quote?inputMint=${SOL_MINT}&outputMint=${TOKEN}&amount=${AMOUNT}&slippageBps=3000`);
  const quote = await quoteResp.json();
  if (quote.error) throw new Error(quote.error);
  console.log(`Output: ${quote.outAmount} tokens | Impact: ${quote.priceImpactPct || '0'}%`);

  const swapResp = await fetch('https://lite-api.jup.ag/swap/v1/swap', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      quoteResponse: quote,
      userPublicKey: keypair.publicKey.toBase58(),
      wrapAndUnwrapSol: true,
      dynamicComputeUnitLimit: true,
      prioritizationFeeLamports: 10000
    })
  });
  if (!swapResp.ok) throw new Error('Swap failed: ' + await swapResp.text());
  const { swapTransaction } = await swapResp.json();

  const tx = VersionedTransaction.deserialize(Buffer.from(swapTransaction, 'base64'));
  tx.sign([keypair]);

  const txid = await connection.sendRawTransaction(tx.serialize(), { skipPreflight: true, maxRetries: 3 });
  console.log(`TX: https://solscan.io/tx/${txid}`);

  const conf = await connection.confirmTransaction(txid, 'confirmed');
  if (conf.value.err) console.log('❌ FAILED:', conf.value.err);
  else console.log('✅ CONFIRMED');
}

main().catch(e => console.error('Error:', e.message));
