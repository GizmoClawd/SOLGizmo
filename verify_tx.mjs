import { Connection } from '@solana/web3.js';

const connection = new Connection('https://api.mainnet-beta.solana.com', 'confirmed');

async function verify() {
  const sig = '4XyWoKfhF6ohJcKtKFsv1Wg8nAbranufB7qj6FU7pUcYabJBQLWpVjDKGxxBn296WjFZypx1bsWicAqGCr6JBzix';
  const status = await connection.getSignatureStatus(sig);
  console.log(status);
}

verify().catch(e => console.error(e));
