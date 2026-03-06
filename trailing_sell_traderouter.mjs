import WebSocket from 'ws';
import bs58 from 'bs58';
import nacl from 'tweetnacl';
import { Keypair, VersionedTransaction } from '@solana/web3.js';
import fetch from 'node-fetch';

const WALLET_KEY = process.argv[2];
const TOKEN = process.argv[3];
const TRAIL_BPS = parseInt(process.argv[4]) || 1000;
const HOLDINGS_PCT = 10000;
const SLIPPAGE = 1500;
const EXPIRY_HOURS = 24;

const wallet = Keypair.fromSecretKey(bs58.decode(WALLET_KEY));

const ws = new WebSocket('wss://api.traderouter.ai/ws');

ws.on('open', () => {
  console.log('Connected');
});

ws.on('message', async (data) => {
  const msg = JSON.parse(data.toString());
  console.log('Received:', msg);

  if (msg.type === 'challenge') {
    const nonceBytes = Buffer.from(msg.nonce, 'utf-8');
    const sigBytes = nacl.sign.detached(nonceBytes, wallet.secretKey);
    const sig = bs58.encode(sigBytes);
    ws.send(JSON.stringify({
      action: 'register',
      wallet_address: wallet.publicKey.toBase58(),
      signature: sig
    }));
  } else if (msg.type === 'registered' && msg.authenticated) {
    console.log('Authenticated, placing order');
    ws.send(JSON.stringify({
      action: 'trailing_sell',
      token_address: TOKEN,
      holdings_percentage: HOLDINGS_PCT,
      trail: TRAIL_BPS,
      slippage: SLIPPAGE,
      expiry_hours: EXPIRY_HOURS
    }));
  } else if (msg.type === 'order_created') {
    console.log('Order created:', msg.order_id);
  } else if (msg.type === 'order_filled') {
    console.log('Fill received:', msg);
    if (msg.already_dispatched) {
      console.log('Already dispatched, skipping');
      return;
    }
    // TODO: Verify server_signature

    let retries = 3;
    while (retries > 0) {
      try {
        const txBytes = bs58.decode(msg.data.swap_tx);
        const tx = VersionedTransaction.deserialize(txBytes);
        tx.sign([wallet]);
        const signedB64 = Buffer.from(tx.serialize()).toString('base64');

        const protectRes = await fetch('https://api.traderouter.ai/protect', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ signed_tx_base64: signedB64 }),
        });
        const protect = await protectRes.json();
        console.log('Sold:', protect);
        if (protect.status === 'success') {
          console.log('Sell Sig:', protect.signature);
          break;
        } else {
          console.error('Protect failed:', protect);
        }
      } catch (e) {
        console.error('Error in sell:', e);
      }
      retries--;
      console.log('Retrying...', retries);
      await new Promise(r => setTimeout(r, 5000)); // wait 5s
    }
  }
});

ws.on('close', () => {
  console.log('Disconnected');
});

ws.on('error', (err) => {
  console.error('WS Error:', err);
});

// Keep running
process.on('SIGINT', () => ws.close());
