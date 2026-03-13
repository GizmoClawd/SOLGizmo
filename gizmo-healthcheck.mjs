#!/usr/bin/env node

/**
 * Gizmo Cron Health Monitor
 * -------------------------
 * Run this on a separate cron schedule (e.g. every 5 min).
 * If the main scanner hasn't produced a heartbeat file recently,
 * it fires a Telegram alert.
 *
 * Setup:
 *   1. Set your env vars (or hardcode below for testing)
 *   2. In your main scan loop, call: touch /tmp/gizmo-trade/heartbeat
 *   3. Add to crontab: */5 * * * * node /path/to/gizmo-healthcheck.mjs >> /tmp/gizmo-healthcheck.log 2>&1
 */

import fs from "fs";
import https from "https";

// ── Config ────────────────────────────────────────────────────────────────────
const HEARTBEAT_FILE  = "/tmp/gizmo-trade/heartbeat";   // touched by main scanner
const MAX_SILENCE_MS  = 5 * 60 * 1000;                  // alert if no heartbeat for 5 min
const TELEGRAM_TOKEN  = process.env.TELEGRAM_BOT_TOKEN; // your bot token
const TELEGRAM_CHAT   = process.env.TELEGRAM_CHAT_ID;   // your chat/group ID
const LOG_FILE        = "/tmp/gizmo-trade/healthcheck.log";

// ── Helpers ───────────────────────────────────────────────────────────────────
function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}`;
  console.log(line);
  try { fs.appendFileSync(LOG_FILE, line + "\n"); } catch {}
}

function sendTelegram(text) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ chat_id: TELEGRAM_CHAT, text, parse_mode: "Markdown" });
    const req = https.request({
      hostname: "api.telegram.org",
      path: `/bot${TELEGRAM_TOKEN}/sendMessage`,
      method: "POST",
      headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) },
    }, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => resolve(JSON.parse(data)));
    });
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

// ── State file (prevents duplicate alerts) ────────────────────────────────────
const STATE_FILE = "/tmp/gizmo-trade/healthcheck-state.json";

function loadState() {
  try { return JSON.parse(fs.readFileSync(STATE_FILE, "utf8")); }
  catch { return { alertedAt: null }; }
}

function saveState(state) {
  try { fs.writeFileSync(STATE_FILE, JSON.stringify(state)); } catch {}
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  if (!TELEGRAM_TOKEN || !TELEGRAM_CHAT) {
    log("❌ Missing TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID — set env vars.");
    process.exit(1);
  }

  const state = loadState();
  const now = Date.now();

  // Check heartbeat file exists
  if (!fs.existsSync(HEARTBEAT_FILE)) {
    log("⚠️  Heartbeat file not found — scanner may never have run or path is wrong.");

    if (!state.alertedAt) {
      await sendTelegram(
        `⚠️ *Gizmo Health Alert*\nHeartbeat file missing — scanner may be down.\n\`${HEARTBEAT_FILE}\` does not exist.`
      );
      state.alertedAt = now;
      saveState(state);
    }
    return;
  }

  // Check how stale the heartbeat is
  const stat = fs.statSync(HEARTBEAT_FILE);
  const ageMs = now - stat.mtimeMs;
  const ageMins = (ageMs / 60000).toFixed(1);

  log(`💓 Heartbeat age: ${ageMins} min`);

  if (ageMs > MAX_SILENCE_MS) {
    // Only alert once per outage (don't spam)
    if (!state.alertedAt || now - state.alertedAt > 30 * 60 * 1000) {
      log(`🚨 Scanner silent for ${ageMins} min — sending alert`);
      await sendTelegram(
        `🚨 *Gizmo Scanner Down*\nNo heartbeat for *${ageMins} minutes*.\nLast seen: ${stat.mtime.toLocaleTimeString()}\n\nCheck cron + RPC health.`
      );
      state.alertedAt = now;
      saveState(state);
    } else {
      log(`🔕 Already alerted at ${new Date(state.alertedAt).toISOString()} — skipping duplicate`);
    }
  } else {
    // Scanner is healthy — clear any previous alert state
    if (state.alertedAt) {
      log("✅ Scanner recovered — sending all-clear");
      await sendTelegram(`✅ *Gizmo Scanner Recovered*\nHeartbeat resumed. Age: ${ageMins} min.`);
      state.alertedAt = null;
      saveState(state);
    } else {
      log("✅ Scanner healthy");
    }
  }
}

main().catch((err) => log(`💥 Healthcheck error: ${err.message}`));
