/**
 * 🦞 Gizmo's X (Twitter) Posting Script
 * Usage: node tweet.mjs "Your tweet text here"
 * Community post: node tweet.mjs "text" --community
 */

import crypto from 'crypto';
import fs from 'fs';

const keys = JSON.parse(process.env.X_API_KEYS_JSON || fs.readFileSync(process.env.HOME + '/.gizmo/x-api-keys.json', 'utf-8'));

const COMMUNITY_ID = '2026449720390885558';

function oauthSign(method, url, params, consumerSecret, tokenSecret) {
  const sortedParams = Object.keys(params).sort().map(k => `${encodeURIComponent(k)}=${encodeURIComponent(params[k])}`).join('&');
  const baseString = `${method}&${encodeURIComponent(url)}&${encodeURIComponent(sortedParams)}`;
  const signingKey = `${encodeURIComponent(consumerSecret)}&${encodeURIComponent(tokenSecret)}`;
  return crypto.createHmac('sha1', signingKey).update(baseString).digest('base64');
}

async function tweet(text, community = false, replyToId = null) {
  const url = 'https://api.twitter.com/2/tweets';
  const oauthParams = {
    oauth_consumer_key: keys.consumerKey,
    oauth_nonce: crypto.randomBytes(16).toString('hex'),
    oauth_signature_method: 'HMAC-SHA1',
    oauth_timestamp: Math.floor(Date.now() / 1000).toString(),
    oauth_token: keys.accessToken,
    oauth_version: '1.0',
  };

  const signature = oauthSign('POST', url, oauthParams, keys.consumerSecret, keys.accessTokenSecret);
  oauthParams.oauth_signature = signature;

  const authHeader = 'OAuth ' + Object.keys(oauthParams).sort().map(k => `${encodeURIComponent(k)}="${encodeURIComponent(oauthParams[k])}"`).join(', ');

  const body = { text };
  if (community) {
    body.community_id = COMMUNITY_ID;
  }
  if (replyToId) {
    body.reply = { in_reply_to_tweet_id: replyToId };
  }

  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': authHeader,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  const data = await resp.json();
  if (resp.ok) {
    console.log('✅ Tweet posted!');
    console.log('   ID:', data.data?.id);
    console.log('   URL: https://x.com/SolGizmoClawd/status/' + data.data?.id);
  } else {
    console.error('❌ Failed:', JSON.stringify(data, null, 2));
  }
  return data;
}

const text = process.argv[2];
const isCommunity = process.argv.includes('--community');
const replyFlag = process.argv.find(a => a.startsWith('--reply='));
const replyToId = replyFlag ? replyFlag.split('=')[1] : null;

if (!text) {
  console.log('Usage: node tweet.mjs "Your tweet" [--community]');
  process.exit(1);
}

tweet(text, isCommunity, replyToId);
