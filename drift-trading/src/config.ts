import { Connection, Keypair } from '@solana/web3.js';
import bs58 from 'bs58';
import * as fs from 'fs';
import * as path from 'path';

export const RPC_URL = process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com';

export function loadWallet(): Keypair {
  const walletPath = process.env.WALLET_PATH || path.join(
    process.env.HOME || '~',
    '.gizmo',
    'solana-wallet.json'
  );
  
  const walletData = JSON.parse(fs.readFileSync(walletPath, 'utf-8'));
  
  // bs58-encoded secret key string
  if (walletData.secretKey && typeof walletData.secretKey === 'string') {
    const secretKey = bs58.decode(walletData.secretKey);
    return Keypair.fromSecretKey(secretKey);
  }

  // Array of numbers (Uint8Array-like)
  if (walletData.secretKey && Array.isArray(walletData.secretKey)) {
    return Keypair.fromSecretKey(Uint8Array.from(walletData.secretKey));
  }
  
  // Raw array format (solana-keygen output)
  if (Array.isArray(walletData)) {
    return Keypair.fromSecretKey(Uint8Array.from(walletData));
  }
  
  throw new Error('Unsupported wallet format');
}

export function getConnection(): Connection {
  return new Connection(RPC_URL, { commitment: 'confirmed' });
}
