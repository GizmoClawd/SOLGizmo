import fs from 'fs';

const file = process.env.HOME + '/.openclaw/workspace/SOLGizmo/gizmo.mjs';
fs.copyFileSync(file, file + '.bak-blacklist');

let code = fs.readFileSync(file, 'utf8');

// Inject blacklist check right after loadPositions() is called
const anchor = `const POSITIONS = loadPositions();`;
const injection = `
// ── DEAD POOL BLACKLIST ───────────────────────────────────────────────────────
// Strip any previously rugged tokens from positions on every startup
const DEAD_POOL_FILE = BASE_DIR + '/dead-pools.json';
function loadDeadPools() {
  try { return new Set(JSON.parse(fs.readFileSync(DEAD_POOL_FILE, 'utf8'))); } catch { return new Set(); }
}
function saveDeadPool(ca) {
  try {
    const pools = loadDeadPools();
    pools.add(ca);
    fs.writeFileSync(DEAD_POOL_FILE, JSON.stringify([...pools], null, 2));
  } catch {}
}
const DEAD_POOLS = loadDeadPools();
// Remove any blacklisted positions on startup
const deadOnLoad = POSITIONS.filter(p => DEAD_POOLS.has(p.ca));
if (deadOnLoad.length > 0) {
  deadOnLoad.forEach(p => {
    POSITIONS.splice(POSITIONS.indexOf(p), 1);
    console.log('[STARTUP] 💀 Removed blacklisted dead pool: ' + p.name + ' (' + p.ca + ')');
  });
  fs.writeFileSync(process.env.HOME + '/.openclaw/workspace/SOLGizmo/../../../tmp/gizmo-trade/positions.json', JSON.stringify(POSITIONS, null, 2));
}
// ─────────────────────────────────────────────────────────────────────────────
`;

if (!code.includes(anchor)) {
  console.error('❌ Could not find POSITIONS anchor');
  process.exit(1);
}

code = code.replace(anchor, anchor + injection);

// Also update the dead pool handler to call saveDeadPool
const oldDeadPool = `          POSITIONS.splice(idx, 1);
          savePositions();
          log(\`🗑️ DEAD POOL: \${posName} removed from POSITIONS. No more retries.\`);`;

const newDeadPool = `          POSITIONS.splice(idx, 1);
          savePositions();
          saveDeadPool(ca); // blacklist so it never comes back after restart
          log(\`🗑️ DEAD POOL: \${posName} removed from POSITIONS and blacklisted permanently.\`);`;

if (code.includes(oldDeadPool)) {
  code = code.replace(oldDeadPool, newDeadPool);
  console.log('✅ Dead pool handler now saves to blacklist');
}

fs.writeFileSync(file, code);
console.log('✅ Backed up to gizmo.mjs.bak-blacklist');
console.log('✅ Dead pool blacklist active — POV will never come back after restart');
