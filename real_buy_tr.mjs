import bs58 from 'bs58';
import { Connection, Keypair, VersionedTransaction } from '@solana/web3.js';
import fetch from 'node-fetch';

const WALLET_KEY = 'bwZgmKabpudnZdxrmMR4JEc92hGPYFp94ZZwVgYNKcGEkptz7SPFsYygFL7RvmyrN2cj6sDy4HhhqdK5ybbF9sL';
const TOKEN = '6MVnei2Lcuae2tbr7UjJR7o6s7kJmTQRdpxTZcoEpump';
const AMOUNT = 300000000;

const connection = new Connection('https://api.mainnet-beta.solana.com');
const wallet = Keypair.fromSecretKey(bs58.decode(WALLET_KEY));

async function testBuy() {
  const body = {
    wallet_address: wallet.publicKey.toBase58(),
    token_address: TOKEN,
    action: 'buy',
    amount: AMOUNT,
    slippage: 1500,
  };

  const swapRes = await fetch('https://api.traderouter.ai/swap', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const swap = await swapRes.json();
  console.log('Swap:', swap);

  if (swap.status === 'success') {
    const txBytes = bs58.decode(swap.data.swap_tx);
    const tx = VersionedTransaction.deserialize(txBytes);
    tx.sign([wallet]);
    const signedB64 = Buffer.from(tx.serialize()).toString('base64');

    const protectRes = await fetch('https://api.traderouter.ai/protect', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ signed_tx_base64: signedB64 }),
    });
    const protect = await protectRes.json();
    console.log('Protect:', protect);
    return protect.signature;
  } else {
    console.error('Swap failed:', swap);
    return null;
  }
}

testBuy().then(sig => {
  if (sig) console.log('Success Sig:', sig);
}).catch(e => console.error(e));
