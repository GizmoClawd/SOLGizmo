import { Connection, Keypair, VersionedTransaction } from '@solana/web3.js';
import bs58 from 'bs58';

const secret = 'bwZgmKabpudnZdxrmMR4JEc92hGPYFp94ZZwVgYNKcGEkptz7SPFsYygFL7RvmyrN2cj6sDy4HhhqdK5ybbF9sL';
const keypair = Keypair.fromSecretKey(bs58.decode(secret));

const connection = new Connection('https://api.mainnet-beta.solana.com', 'confirmed');

const TOKEN_MINT = '6RxB1KdzVMXrrYn7nQWvaGgh5e2EpbA1FcEFtq74pump';
const AMOUNT_SOL = 0.3;
const AMOUNT_LAMPORTS = AMOUNT_SOL * 1000000000;

async function main() {
  const body = {
    "publicKey": keypair.publicKey.toBase58(),
    "action": "buy",
    "mint": TOKEN_MINT,
    "amount": AMOUNT_SOL,
    "denominatedInSol": "true",
    "slippage": 10,
    "priorityFee": 0.0005,
    "pool": "pump"
  };

  const response = await fetch('https://pumpportal.fun/api/trade-local', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    throw new Error(`HTTP error! status: ${response.status}`);
  }

  const txBuffer = Buffer.from(await response.arrayBuffer());
  const tx = VersionedTransaction.deserialize(txBuffer);
  tx.sign([keypair]);

  const sig = await connection.sendRawTransaction(tx.serialize(), { skipPreflight: true, maxRetries: 3 });
  await connection.confirmTransaction(sig, 'confirmed');

  console.log('Success, sig:', sig);
}

main().catch(e => console.error('Error:', e.message));