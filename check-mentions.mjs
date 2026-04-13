/**
 * Check recent mentions for @SolGizmoClawd
 * List unreplied ones
 */

import fs from 'fs';
import fetch from 'node-fetch'; // Note: node18+ has undici fetch, but ensure available

const BASE_DIR = '/Users/younghogey/.openclaw/workspace/SOLGizmo';
const keys = JSON.parse(fs.readFileSync(process.env.HOME + '/.gizmo/x-api-keys.json', 'utf-8'));
const STATE_FILE = BASE_DIR + '/mentions-state.json';

async function loadState() { 
  try { return JSON.parse(fs.readFileSync(STATE_FILE, 'utf-8')); } 
  catch { return { replied: [], lastRun: 0 }; } 
}
async function saveState(s) { 
  fs.writeFileSync(STATE_FILE, JSON.stringify(s, null, 2)); 
}

async function searchMentions() {
  const params = new URLSearchParams({
    'query': '@SolGizmoClawd -from:SolGizmoClawd lang:en -is:retweet',
    'max_results': '20',
    'tweet.fields': 'id,text,public_metrics,created_at,conversation_id,author_id,in_reply_to_tweet_id,in_reply_to_user_id',
    'expansions': 'author_id',
    'user.fields': 'username,public_metrics'
  });
  const res = await fetch('https://api.twitter.com/2/tweets/search/recent?' + params, {
    headers: { Authorization: 'Bearer ' + keys.bearerToken }
  });
  return await res.json();
}

async function run() {
  const state = await loadState();
  const data = await searchMentions();
  if (!data.data) {
    console.log('No mentions found');
    return [];
  }

  const users = {};
  (data.includes?.users || []).forEach(u => users[u.id] = u);

  const unreplied = data.data.filter(t => !state.replied.includes(t.id)).slice(0, 5);
  
  console.log('Recent unreplied mentions:');
  unreplied.forEach(t => {
    const author = users[t.author_id];
    console.log(`- ID: ${t.id}`);
    console.log(`  Author: @${author?.username || 'unknown'} (${author?.public_metrics?.followers_count || 0} followers)`);
    console.log(`  Text: ${t.text}`);
    console.log(`  Likes: ${t.public_metrics?.like_count || 0}`);
    console.log('');
  });

  await saveState({...state, lastRun: Date.now()});
  return unreplied;
}

run().catch(console.error);
