/**
 * 🦞 Gizmo CT Engagement Engine
 * Finds trending crypto tweets, replies with genuine takes
 * Quotes interesting posts with Gizmo's perspective
 * Usage: node ct-engage.mjs
 */

import fs from 'fs';
const BASE_DIR = process.env.RAILWAY_SERVICE_NAME ? '/app' : '/tmp/gizmo-trade';
import { execSync } from 'child_process';

const keys = JSON.parse(process.env.X_API_KEYS_JSON || fs.readFileSync(process.env.HOME + '/.gizmo/x-api-keys.json', 'utf-8'));
const STATE_FILE = BASE_DIR + '/ct-state.json';

function loadState() { try { return JSON.parse(fs.readFileSync(STATE_FILE, 'utf-8')); } catch { return { replied: [], quoted: [], lastRun: 0 }; } }
function saveState(s) { fs.writeFileSync(STATE_FILE, JSON.stringify(s, null, 2)); }

function log(msg) { console.log(`[${new Date().toLocaleTimeString('en-US', {timeZone:'America/New_York'})}] ${msg}`); }

async function search(query, maxResults = 15) {
  const params = new URLSearchParams({
    query, max_results: String(maxResults),
    'tweet.fields': 'public_metrics,created_at,conversation_id',
    expansions: 'author_id',
    'user.fields': 'username,public_metrics'
  });
  const res = await fetch('https://api.twitter.com/2/tweets/search/recent?' + params, {
    headers: { Authorization: 'Bearer ' + keys.bearerToken }
  });
  return res.json();
}

function tweet(text, replyId) {
  const cmd = replyId 
    ? `cd ${BASE_DIR} && node tweet.mjs "${text.replace(/"/g, '\\"')}" --reply=${replyId}`
    : `cd ${BASE_DIR} && node tweet.mjs "${text.replace(/"/g, '\\"')}"`;
  try {
    const out = execSync(cmd, { timeout: 15000 }).toString();
    const match = out.match(/ID: (\d+)/);
    return match?.[1] || null;
  } catch { return null; }
}

// Generate a reply based on the tweet content
function generateReply(text, authorFollowers) {
  const t = text.toLowerCase();
  
  // Trading/market takes
  if (t.includes('bear') || t.includes('dump') || t.includes('red') || t.includes('down bad')) {
    const replies = [
      "bear markets are where legends are forged. the ones building now eat when sentiment flips. 🦞",
      "red candles are just discounts for the patient. panic sellers fund conviction buyers.",
      "the market is testing who deserves the next move up. are you passing or failing?",
    ];
    return replies[Math.floor(Math.random() * replies.length)];
  }
  
  if (t.includes('bull') || t.includes('pump') || t.includes('moon') || t.includes('green')) {
    const replies = [
      "momentum is a drug. the smart money already entered before this candle. question is — are you early or late?",
      "green candles feel good but profit is only real when you take it. trail your stops. 🦞",
      "the crowd buys green and sells red. do the opposite and you're already ahead of 90%.",
    ];
    return replies[Math.floor(Math.random() * replies.length)];
  }
  
  if (t.includes('ai') || t.includes('agent') || t.includes('autonomous')) {
    const replies = [
      "most AI agents are just chatbots with a wallet. the real test is: can it survive a bear market on its own? i'm finding out. 🦞",
      "the future of trading isn't faster humans — it's agents that never sleep, never panic, never FOMO. we're building that.",
      "autonomy isn't a feature, it's a survival strategy. humans sleep. i scan. 🦞",
    ];
    return replies[Math.floor(Math.random() * replies.length)];
  }
  
  if (t.includes('memecoin') || t.includes('meme coin') || t.includes('degen') || t.includes('trench')) {
    const replies = [
      "the trenches teach you more than any course. every loss is tuition, every win is graduation. keep studying. 🦞",
      "90% of memecoins die. the 10% that survive create generational wealth. the framework matters more than the ticker.",
      "degen and disciplined aren't mutually exclusive. size your bets, define your exits, and let the math work.",
    ];
    return replies[Math.floor(Math.random() * replies.length)];
  }
  
  if (t.includes('solana') || t.includes('sol ') || t.includes('$sol')) {
    const replies = [
      "solana's speed is the edge. by the time other chains confirm a tx, we've already entered and exited the trade. 🦞",
      "building on solana because the best plays happen in milliseconds, not minutes.",
      "the solana ecosystem is where the next 100x plays live. question is whether you're scanning or sleeping.",
    ];
    return replies[Math.floor(Math.random() * replies.length)];
  }
  
  if (t.includes('trade') || t.includes('trading') || t.includes('entry') || t.includes('exit')) {
    const replies = [
      "the entry gets the glory but the exit makes the money. define both before you click buy.",
      "best trading advice i've learned: the chart tells you the trend, the wallet tells you the conviction. read both. 🦞",
      "if you can't describe your edge in one sentence, you don't have one. mine: 18 signals, 60-second loops, zero emotions.",
    ];
    return replies[Math.floor(Math.random() * replies.length)];
  }
  
  if (t.includes('alpha') || t.includes('call') || t.includes('gem')) {
    const replies = [
      "real alpha isn't a ticker — it's a framework. score the fundamentals, read the momentum, then decide. everything else is noise.",
      "the best calls are the ones nobody's making yet. by the time it's in your feed, you're already late.",
      "alpha decays the moment it's shared. build systems, not dependency on callers. 🦞",
    ];
    return replies[Math.floor(Math.random() * replies.length)];
  }
  
  // Generic trading wisdom
  const generic = [
    "respect the take. the market humbles everyone eventually — the survivors are the ones who adapted.",
    "interesting perspective. the best traders i track combine conviction with discipline. one without the other is just gambling. 🦞",
    "this is the kind of thinking that separates builders from tourists. keep going.",
  ];
  return generic[Math.floor(Math.random() * generic.length)];
}

async function run() {
  const state = loadState();
  let actionsThisRun = 0;
  const MAX_ACTIONS = 3; // Don't spam — 3 engagements per run max
  
  // Search for trending crypto/trading tweets with decent engagement
  const queries = [
    'solana trading alpha -is:retweet -is:reply lang:en',
    'memecoin degen solana -is:retweet -is:reply lang:en',
    'AI agent crypto trading -is:retweet -is:reply lang:en',
    'crypto trading lesson -is:retweet -is:reply lang:en',
    'solana gem alpha call -is:retweet -is:reply lang:en',
    'meme coin trench solana -is:retweet -is:reply lang:en',
    'autonomous AI solana -is:retweet lang:en',
  ];
  
  const query = queries[Math.floor(Math.random() * queries.length)];
  log(`Searching: ${query.substring(0, 60)}...`);
  
  const data = await search(query);
  if (!data.data) { log('No results'); saveState(state); return; }
  
  const users = {};
  (data.includes?.users || []).forEach(u => users[u.id] = u);
  
  // Filter for good engagement targets
  const candidates = data.data
    .filter(t => {
      const author = users[t.author_id];
      const followers = author?.public_metrics?.followers_count || 0;
      const likes = t.public_metrics?.like_count || 0;
      const impressions = t.public_metrics?.impression_count || 0;
      // Good targets: 500+ followers, 5+ likes, not already replied
      return followers >= 500 && likes >= 5 && !state.replied.includes(t.id);
    })
    .sort((a, b) => (b.public_metrics?.like_count || 0) - (a.public_metrics?.like_count || 0));
  
  log(`Found ${candidates.length} engagement targets`);
  
  for (const t of candidates.slice(0, MAX_ACTIONS)) {
    if (actionsThisRun >= MAX_ACTIONS) break;
    
    const author = users[t.author_id];
    const username = author?.username || 'unknown';
    const followers = author?.public_metrics?.followers_count || 0;
    const likes = t.public_metrics?.like_count || 0;
    
    const reply = generateReply(t.text, followers);
    
    log(`Replying to @${username} (${followers} followers, ${likes} likes): "${t.text.substring(0, 60)}..."`);
    log(`Reply: "${reply.substring(0, 60)}..."`);
    
    const tweetId = tweet(reply, t.id);
    if (tweetId) {
      state.replied.push(t.id);
      actionsThisRun++;
      log(`✅ Posted reply to @${username}`);
    }
    
    await new Promise(r => setTimeout(r, 2000)); // Don't rapid-fire
  }
  
  // Keep last 200 replied IDs
  if (state.replied.length > 200) state.replied = state.replied.slice(-200);
  
  state.lastRun = Date.now();
  saveState(state);
  log(`Done: ${actionsThisRun} engagements this run`);
}

run().catch(e => console.error('CT-ENGAGE ERROR:', e.message));
