const DLMM = require('@meteora-ag/dlmm');
const {Connection,PublicKey,Keypair,sendAndConfirmTransaction} = require('@solana/web3.js');
const {BN} = require('@coral-xyz/anchor');
const bs58 = require('bs58');
const fs = require('fs');

const BASE = (process.env.HOME||'/root') + '/.gizmo/runtime';
const HELIUS = '2de73660-14b8-412a-9ff2-8e6989c53266';
const conn = new Connection('https://mainnet.helius-rpc.com/?api-key='+HELIUS,'confirmed');
const STATE_FILE = BASE + '/lp-positions.json';
const MAX_POSITIONS = 2;
const MAX_SOL = 0.3;
const BIN_RANGE = 5;
const CYCLE_MS = 5 * 60000;
const MAX_AGE_MS = 60 * 60000;

function log(m){const l='['+new Date().toLocaleString()+'] [LP] '+m;console.log(l);try{fs.appendFileSync(BASE+'/gizmo.log',l+'\n')}catch{}}
function loadKP(){const r=JSON.parse(fs.readFileSync((process.env.HOME||'/root')+'/.gizmo/solana-wallet.json'));return Keypair.fromSecretKey(bs58.decode(r.secretKey))}
function loadState(){try{return JSON.parse(fs.readFileSync(STATE_FILE))}catch{return[]}}
function saveState(s){fs.writeFileSync(STATE_FILE,JSON.stringify(s,null,2))}

async function getBal(){return(await conn.getBalance(loadKP().publicKey))/1e9}

async function findBestPool(){
  const r=await fetch('https://dlmm-api.meteora.ag/pair/all');
  const pairs=await r.json();
  const sol='So11111111111111111111111111111111111111112';
  return pairs.filter(p=>{
    const v=parseFloat(p.trade_volume_24h||0);
    const l=parseFloat(p.liquidity||0);
    return(p.mint_x===sol||p.mint_y===sol)&&v>50000&&l>5000;
  }).map(p=>{
    const f=parseFloat(p.fees_24h||p.fee_volume_24h||0);
    const l=parseFloat(p.liquidity||0);
    return{address:p.address,name:p.name,apr:l>0?Math.round(f*365/l*100):0,fees:Math.round(f),vol:Math.round(parseFloat(p.trade_volume_24h||0)/1000)};
  }).sort((a,b)=>b.apr-a.apr).slice(0,5);
}

async function openPosition(poolAddr,solAmt){
  const kp=loadKP();
  const d=await DLMM.create(conn,new PublicKey(poolAddr));
  const ab=await d.getActiveBin();
  const minB=ab.binId-BIN_RANGE,maxB=ab.binId+BIN_RANGE;
  const isSolX=d.tokenX.publicKey.toBase58()==='So11111111111111111111111111111111111111112';
  const amt=new BN(Math.floor(solAmt*1e9));
  const np=Keypair.generate();
  const tx=await d.initializePositionAndAddLiquidityByStrategy({
    positionPubKey:np.publicKey,user:kp.publicKey,
    totalXAmount:isSolX?amt:new BN(0),
    totalYAmount:isSolX?new BN(0):amt,
    strategy:{maxBinId:maxB,minBinId:minB,strategyType:0}
  });
  const h=await sendAndConfirmTransaction(conn,tx,[kp,np],{commitment:'confirmed'});
  log('LP OPENED: '+poolAddr.slice(0,12)+' | '+solAmt+' SOL | TX: '+h.slice(0,20));
  return{poolAddress:poolAddr,positionPubKey:np.publicKey.toBase58(),solDeposited:solAmt,openTime:Date.now(),minBinId:minB,maxBinId:maxB};
}

async function closePosition(pos){
  const kp=loadKP();
  const d=await DLMM.create(conn,new PublicKey(pos.poolAddress));
  const{userPositions}=await d.getPositionsByUserAndLbPair(kp.publicKey);
  const mp=userPositions.find(p=>p.publicKey.toBase58()===pos.positionPubKey);
  if(!mp){log('Position gone: '+pos.positionPubKey.slice(0,8));return true}
  const tx=await d.removeLiquidity({
    position:mp.publicKey,user:kp.publicKey,
    fromBinId:mp.positionData.lowerBinId,
    toBinId:mp.positionData.upperBinId,
    bps:new BN(10000),shouldClaimAndClose:true
  });
  const txs=Array.isArray(tx)?tx:[tx];
  for(const t of txs){
    const h=await sendAndConfirmTransaction(conn,t,[kp],{commitment:'confirmed'});
    log('LP CLOSED: '+pos.poolAddress.slice(0,12)+' | TX: '+h.slice(0,20));
  }
  return true;
}

async function checkPosition(pos){
  try{
    const d=await DLMM.create(conn,new PublicKey(pos.poolAddress));
    const ab=await d.getActiveBin();
    const inRange=ab.binId>=pos.minBinId&&ab.binId<=pos.maxBinId;
    const age=Date.now()-pos.openTime;
    return{inRange,expired:age>MAX_AGE_MS,age:Math.round(age/60000)};
  }catch(e){return{inRange:false,expired:true,age:0}}
}

async function cycle(){
  log('=== LP CYCLE ===');
  const bal=await getBal();
  log('Wallet: '+bal.toFixed(3)+' SOL');
  if(bal<0.5){log('Too low for LP');return}

  let state=loadState();

  // Check existing — close if expired or out of range
  for(let i=state.length-1;i>=0;i--){
    const s=await checkPosition(state[i]);
    log('Position '+state[i].poolAddress.slice(0,8)+': '+s.age+'min | '+(s.inRange?'IN RANGE':'OUT OF RANGE'));
    if(s.expired||!s.inRange){
      log('Closing: '+(s.expired?'expired':'out of range'));
      try{await closePosition(state[i]);state.splice(i,1);saveState(state)}catch(e){log('Close err: '+e.message.slice(0,80))}
    }
  }

  // Open new if slots available
  if(state.length<MAX_POSITIONS){
    const pools=await findBestPool();
    const active=new Set(state.map(s=>s.poolAddress));
    const best=pools.find(p=>!active.has(p.address)&&p.apr>500);
    if(best){
      const amt=Math.min(MAX_SOL,bal*0.15);
      log('Opening: '+best.name+' APR:'+best.apr+'% | '+amt.toFixed(3)+' SOL');
      try{
        const pos=await openPosition(best.address,amt);
        pos.poolName=best.name;pos.apr=best.apr;
        state.push(pos);saveState(state);
      }catch(e){log('Open err: '+e.message.slice(0,80))}
    }else{log('No pools above 500% APR')}
  }

  const newBal=await getBal();
  log('Balance after cycle: '+newBal.toFixed(3)+' SOL');
}

// Run forever
log('LP AUTO-FARMER STARTED');
(async()=>{
  await cycle();
  setInterval(cycle,CYCLE_MS);
})();
