#!/usr/bin/env node
/**
 * 🦞 SOLGizmo Paper Trading Engine
 * 
 * Simulates prediction market trades on Solana.
 * NO REAL MONEY. Paper trading only.
 */

const fs = require('fs');
const path = require('path');

const TRADES_FILE = path.join(__dirname, 'trades.json');
const PORTFOLIO_FILE = path.join(__dirname, 'portfolio.json');
const STARTING_BALANCE = 10; // SOL

// Initialize or load portfolio
function loadPortfolio() {
  if (fs.existsSync(PORTFOLIO_FILE)) {
    return JSON.parse(fs.readFileSync(PORTFOLIO_FILE, 'utf8'));
  }
  return {
    startingBalance: STARTING_BALANCE,
    currentBalance: STARTING_BALANCE,
    totalTrades: 0,
    wins: 0,
    losses: 0,
    pending: 0,
    totalPnL: 0,
    createdAt: new Date().toISOString(),
    lastUpdated: new Date().toISOString()
  };
}

// Load trade history
function loadTrades() {
  if (fs.existsSync(TRADES_FILE)) {
    return JSON.parse(fs.readFileSync(TRADES_FILE, 'utf8'));
  }
  return [];
}

// Save portfolio
function savePortfolio(portfolio) {
  portfolio.lastUpdated = new Date().toISOString();
  fs.writeFileSync(PORTFOLIO_FILE, JSON.stringify(portfolio, null, 2));
}

// Save trades
function saveTrades(trades) {
  fs.writeFileSync(TRADES_FILE, JSON.stringify(trades, null, 2));
}

/**
 * Place a new paper trade
 * @param {Object} params
 * @param {string} params.market - Market name/description
 * @param {string} params.platform - Platform (drift, hedgehog, etc.)
 * @param {string} params.position - YES or NO
 * @param {number} params.amount - Amount in SOL to bet
 * @param {number} params.odds - Implied probability (0-1) at entry
 * @param {string} params.reasoning - Why this trade
 * @param {string} params.expiresAt - When market resolves
 */
function placeTrade({ market, platform, position, amount, odds, reasoning, expiresAt }) {
  const portfolio = loadPortfolio();
  const trades = loadTrades();

  if (amount > portfolio.currentBalance) {
    console.error(`❌ Insufficient balance. Have ${portfolio.currentBalance} SOL, need ${amount} SOL`);
    return null;
  }

  const trade = {
    id: trades.length + 1,
    timestamp: new Date().toISOString(),
    market,
    platform,
    position, // YES or NO
    amount,   // SOL wagered
    odds,     // implied probability at entry
    potentialPayout: position === 'YES' ? amount / odds : amount / (1 - odds),
    reasoning,
    expiresAt,
    status: 'PENDING', // PENDING, WON, LOST, CANCELLED
    outcome: null,
    pnl: null
  };

  trades.push(trade);
  portfolio.currentBalance -= amount;
  portfolio.totalTrades += 1;
  portfolio.pending += 1;

  saveTrades(trades);
  savePortfolio(portfolio);

  console.log(`✅ Trade #${trade.id} placed!`);
  console.log(`   Market: ${market}`);
  console.log(`   Position: ${position} @ ${(odds * 100).toFixed(1)}%`);
  console.log(`   Amount: ${amount} SOL`);
  console.log(`   Potential Payout: ${trade.potentialPayout.toFixed(3)} SOL`);
  console.log(`   Balance: ${portfolio.currentBalance.toFixed(3)} SOL`);

  return trade;
}

/**
 * Resolve a trade
 */
function resolveTrade(tradeId, won) {
  const portfolio = loadPortfolio();
  const trades = loadTrades();

  const trade = trades.find(t => t.id === tradeId);
  if (!trade) {
    console.error(`Trade #${tradeId} not found`);
    return;
  }
  if (trade.status !== 'PENDING') {
    console.error(`Trade #${tradeId} already resolved: ${trade.status}`);
    return;
  }

  trade.status = won ? 'WON' : 'LOST';
  trade.outcome = won ? 'CORRECT' : 'INCORRECT';
  
  if (won) {
    trade.pnl = trade.potentialPayout - trade.amount;
    portfolio.currentBalance += trade.potentialPayout;
    portfolio.wins += 1;
  } else {
    trade.pnl = -trade.amount;
    portfolio.losses += 1;
  }

  portfolio.pending -= 1;
  portfolio.totalPnL += trade.pnl;

  saveTrades(trades);
  savePortfolio(portfolio);

  console.log(`📊 Trade #${tradeId} resolved: ${trade.status}`);
  console.log(`   P&L: ${trade.pnl > 0 ? '+' : ''}${trade.pnl.toFixed(3)} SOL`);
  console.log(`   Balance: ${portfolio.currentBalance.toFixed(3)} SOL`);
}

/**
 * Display portfolio summary
 */
function showStatus() {
  const portfolio = loadPortfolio();
  const trades = loadTrades();

  console.log('\n🦞 SOLGizmo Paper Trading Portfolio');
  console.log('═══════════════════════════════════════');
  console.log(`Starting Balance:  ${portfolio.startingBalance} SOL`);
  console.log(`Current Balance:   ${portfolio.currentBalance.toFixed(3)} SOL`);
  console.log(`Total P&L:         ${portfolio.totalPnL >= 0 ? '+' : ''}${portfolio.totalPnL.toFixed(3)} SOL`);
  console.log(`ROI:               ${((portfolio.totalPnL / portfolio.startingBalance) * 100).toFixed(1)}%`);
  console.log(`───────────────────────────────────────`);
  console.log(`Total Trades:      ${portfolio.totalTrades}`);
  console.log(`Wins:              ${portfolio.wins}`);
  console.log(`Losses:            ${portfolio.losses}`);
  console.log(`Pending:           ${portfolio.pending}`);
  if (portfolio.wins + portfolio.losses > 0) {
    console.log(`Win Rate:          ${((portfolio.wins / (portfolio.wins + portfolio.losses)) * 100).toFixed(1)}%`);
  }
  console.log('═══════════════════════════════════════\n');

  if (trades.length > 0) {
    console.log('Recent Trades:');
    trades.slice(-5).forEach(t => {
      const statusEmoji = t.status === 'PENDING' ? '⏳' : t.status === 'WON' ? '✅' : '❌';
      console.log(`  ${statusEmoji} #${t.id} | ${t.market}`);
      console.log(`     ${t.position} @ ${(t.odds * 100).toFixed(1)}% | ${t.amount} SOL | ${t.status}`);
      if (t.pnl !== null) console.log(`     P&L: ${t.pnl > 0 ? '+' : ''}${t.pnl.toFixed(3)} SOL`);
    });
  }
}

// CLI interface
const command = process.argv[2];
if (command === 'status') {
  showStatus();
} else if (command === 'resolve') {
  const id = parseInt(process.argv[3]);
  const won = process.argv[4] === 'won';
  resolveTrade(id, won);
} else {
  // Export for programmatic use
  module.exports = { placeTrade, resolveTrade, showStatus, loadPortfolio, loadTrades };
}
