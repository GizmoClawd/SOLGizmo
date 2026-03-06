import { Connection, Keypair, VersionedTransaction, LAMPORTS_PER_SOL } from '@solana/web3.js';
import bs58 from 'bs58';

// Provided wallet
const secret = 'bwZgmKabpudnZdxrmMR4JEc92hGPYFp94ZZwVgYNKcGEkptz7SPFsYygFL7RvmyrN2cj6sDy4HhhqdK5ybbF9sL';
const keypair = Keypair.fromSecretKey(bs58.decode(secret));
console.log('Wallet:', keypair.publicKey.toBase58());

// Config
const TOKEN_MINT = '7fXtJpfnFNgtLw4RQPT7oC8k2WtMWat6o5hgpVnhpump';
const SOL_MINT = 'So11111111111111111111111111111111111111112';
const AMOUNT_SOL = 0.3;
const AMOUNT_LAMPORTS = AMOUNT_SOL * LAMPORTS_PER_SOL;
const SLIPPAGE_BPS = 500; // 5% slippage

const connection = new Connection('https://api.mainnet-beta.solana.com');

async function main() {
  // 1. Get quote from Jupiter
  console.log(`Getting quote: ${AMOUNT_SOL} SOL → Token...`);
  const quoteUrl = `https://quote-api.jup.ag/v6/quote?inputMint=${SOL_MINT}&outputMint=${TOKEN_MINT}&amount=${AMOUNT_LAMPORTS}&slippageBps=${SLIPPAGE_BPS}`;
  const quoteResp = await fetch(quoteUrl);
  const quote = await quoteResp.json();
  if (quote.error) {
    throw new Error(`Quote error: ${quote.error}`);
  }
  console.log('Quote received:');
  console.log(`  Output: ${quote.outAmount / (10 ** 6)} tokens`); // Assuming 6 decimals

  // 2. Get swap transaction
  const swapResp = await fetch('https://quote-api.jup.ag/v6/swap', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      quoteResponse: quote,
      userPublicKey: keypair.publicKey.toBase58(),
      wrapAndUnwrapSol: true,
      dynamicComputeUnitLimit: true,
      prioritizationFeeLamports: { autoMultiplier: 3 }
    })
  });
  const { swapTransaction } = await swapResp.json();
  if (!swapTransaction) {
    throw new Error('Failed to get swap transaction');
  }

  // 3. Deserialize and sign
  const tx = VersionedTransaction.deserialize(Buffer.from(swapTransaction, 'base64'));
  tx.sign([keypair]);

  // 4. Send
  const txid = await connection.sendRawTransaction(tx.serialize(), { skipPreflight: true, maxRetries: 3 });
  console.log(`TX: https://solscan.io/tx/${txid}`);

  // 5. Confirm
  await connection.confirmTransaction(txid, 'confirmed');
  console.log('Confirmed!');

  return txid;
}

main().then(txid => console.log('Success, sig:', txid)).catch(e => console.error('Error:', e.message));