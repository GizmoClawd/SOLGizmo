const DLMM = require('@meteora-ag/dlmm');
const {Connection,PublicKey,Keypair,sendAndConfirmTransaction} = require('@solana/web3.js');
const {BN} = require('@coral-xyz/anchor');
const bs58 = require('bs58');
const fs = require('fs');
const raw = JSON.parse(fs.readFileSync('/root/.gizmo/solana-wallet.json'));
const kp = Keypair.fromSecretKey(bs58.decode(raw.secretKey));
const conn = new Connection('https://mainnet.helius-rpc.com/?api-key=2de73660-14b8-412a-9ff2-8e6989c53266','confirmed');
const poolAddr = '3oEjfjRDWyg1ZUzp7ob49dffk2i2iEd8WSQFJ5rbJ2HP';
(async()=>{
  const d = await DLMM.create(conn, new PublicKey(poolAddr));
  const {userPositions} = await d.getPositionsByUserAndLbPair(kp.publicKey);
  console.log(userPositions.length, 'positions found');
  for (const pos of userPositions) {
    console.log('Closing', pos.publicKey.toBase58());
    try {
      const tx = await d.removeLiquidity({
        position: pos.publicKey,
        user: kp.publicKey,
        fromBinId: pos.positionData.lowerBinId,
        toBinId: pos.positionData.upperBinId,
        bps: new BN(10000),
        shouldClaimAndClose: true,
      });
      const txs = Array.isArray(tx) ? tx : [tx];
      for (const t of txs) {
        const h = await sendAndConfirmTransaction(conn, t, [kp], {commitment:'confirmed'});
        console.log('CLOSED:', h);
      }
    } catch(e) { console.log('Error:', e.message.slice(0,120)); }
  }
  const bal = await conn.getBalance(kp.publicKey);
  console.log('Balance:', (bal/1e9).toFixed(4), 'SOL');
})();
