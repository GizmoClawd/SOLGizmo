import { Connection, Keypair, VersionedTransaction, LAMPORTS_PER_SOL } from '@solana/web3.js';
import bs58 from 'bs58';

const secret = 'bwZgmKabpudnZdxrmMR4JEc92hGPYFp94ZZwVgYNKcGEkptz7SPFsYygFL7RvmyrN2cj6sDy4HhhqdK5ybbF9sL';
const keypair = Keypair.fromSecretKey(bs58.decode(secret));

const TOKEN = '6RxB1KdzVMXrrYn7nQWvaGgh5e2EpbA1FcEFtq74pump';
const SOL_MINT = 'So11111111111111111111111111111111111111112';
const AMOUNT = 0.3 * LAMPORTS_PER_SOL;
const connection = new Connection('https://api.mainnet-beta.solana.com', 'confirmed');

async function buy() {
  console.log('Getting quote: 0.3 SOL → Token...');
  const quoteResp = await fetch(`https://quote-api.jup.ag/v6/quote?inputMint=${SOL_MINT}&outputMint=${TOKEN}&amount=${AMOUNT}&slippageBps=1500`);
  const quote = await quoteResp.json();
  console.log(`Output: ~${(Number(quote.outAmount) / 1e6).toFixed(0)} tokens`);

  console.log('Building swap...');
  const swapResp = await fetch('https://quote-api.jup.ag/v6/swap', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      quoteResponse: quote,
      userPublicKey: keypair.publicKey.toBase58(),
      wrapAndUnwrapSol: true,
      computeUnitPriceMicroLamports: 50000
    })
  });

  if (!swapResp.ok) throw new Error('Swap failed: ' + await swapResp.text());
  const { swapTransaction } = await swapResp.json();

  const tx = VersionedTransaction.deserialize(Buffer.from(swapTransaction, 'base64'));
  tx.sign([keypair]);

  console.log('Sending...');
  const txid = await connection.sendRawTransaction(tx.serialize(), { skipPreflight: true, maxRetries: 3 });
  console.log(`TX: https://solscan.io/tx/${txid}`);

  console.log('Confirming...');
  const conf = await connection.confirmTransaction({signature: txid, commitment: 'confirmed'});
  if (conf.value.err) console.log('FAILED:', conf.value.err);
  else console.log('✅ CONFIRMED!');
  return txid;
}

buy().then(sig => console.log('Sig:', sig)).catch(e => console.error(e));
