#!/usr/bin/env node

/**
 * GIZMO WEBSITE GUARDIAN MONITORING SYSTEM
 * 
 * This script runs continuously to monitor the website health,
 * trading data accuracy, and system status.
 * 
 * Guardian: MIMO - Permanent Website Defense System
 */

const fs = require('fs');
const path = require('path');
const https = require('https');
const { spawn } = require('child_process');

class WebsiteGuardian {
  constructor() {
    this.logFile = path.join(__dirname, 'guardian.log');
    this.statusFile = path.join(__dirname, 'status.json');
    this.alerts = [];
    this.lastCheck = Date.now();
    
    this.log('🚨 MIMO GUARDIAN SYSTEM INITIALIZED');
    this.log('📍 Station: /tmp/solgizmo-fresh/website/');
    this.log('⚡ Status: OPERATIONAL');
  }

  log(message) {
    const timestamp = new Date().toISOString();
    const logLine = `[${timestamp}] ${message}`;
    console.log(logLine);
    
    // Append to log file
    fs.appendFileSync(this.logFile, logLine + '\n');
  }

  async makeRequest(url, options = {}) {
    return new Promise((resolve, reject) => {
      const req = https.request(url, options, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          try {
            resolve(JSON.parse(data));
          } catch (e) {
            resolve(data);
          }
        });
      });
      
      req.on('error', reject);
      req.setTimeout(10000, () => {
        req.destroy();
        reject(new Error('Request timeout'));
      });
      req.end();
    });
  }

  async checkSolanaPrice() {
    try {
      // Check DexScreener SOL/USDC price
      const data = await this.makeRequest('https://api.dexscreener.com/latest/dex/pairs/solana/7qbRF6YsyGuLUVs6Y1q64bdVrfe4ZcUUz1JRdoVNUJnm');
      
      if (data.pair && data.pair.priceUsd) {
        const price = parseFloat(data.pair.priceUsd);
        if (price > 10 && price < 1000) {
          this.log(`💰 SOL Price: $${price.toFixed(2)}`);
          return { success: true, price };
        }
      }
      
      throw new Error('Invalid SOL price data');
    } catch (error) {
      this.log(`❌ SOL price check failed: ${error.message}`);
      return { success: false, error: error.message };
    }
  }

  async checkGizmoToken() {
    try {
      // Check GIZMO token price
      const data = await this.makeRequest('https://api.dexscreener.com/latest/dex/tokens/BPKAxR6Em4pxxvxFcDn8wHjdiZSnEBxNvtv9gUSzpump');
      
      if (data.pairs && data.pairs.length > 0) {
        const price = parseFloat(data.pairs[0].priceUsd || 0);
        const volume24h = parseFloat(data.pairs[0].volume?.h24 || 0);
        
        this.log(`🦞 GIZMO Price: $${price.toFixed(8)} | 24h Vol: $${volume24h.toLocaleString()}`);
        return { success: true, price, volume24h };
      }
      
      throw new Error('No GIZMO token data found');
    } catch (error) {
      this.log(`❌ GIZMO token check failed: ${error.message}`);
      return { success: false, error: error.message };
    }
  }

  async checkWebsiteFiles() {
    const criticalFiles = ['index.html', 'whitepaper.html', 'bgm.mp3'];
    const results = {};
    
    for (const file of criticalFiles) {
      const filePath = path.join(__dirname, file);
      try {
        const stats = fs.statSync(filePath);
        results[file] = {
          exists: true,
          size: stats.size,
          modified: stats.mtime
        };
        this.log(`📄 ${file}: OK (${(stats.size/1024).toFixed(1)}KB)`);
      } catch (error) {
        results[file] = { exists: false, error: error.message };
        this.log(`❌ ${file}: MISSING!`);
        this.alerts.push(`Critical file missing: ${file}`);
      }
    }
    
    return results;
  }

  async checkAslanTrade() {
    // Verify ASLAN trade is properly documented
    const indexContent = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
    const aslanMatches = indexContent.match(/ASLAN/gi) || [];
    
    if (aslanMatches.length >= 5) {
      this.log(`🦁 ASLAN trade: VERIFIED (${aslanMatches.length} references)`);
      return { success: true, references: aslanMatches.length };
    } else {
      this.log(`❌ ASLAN trade: INCOMPLETE (only ${aslanMatches.length} references)`);
      this.alerts.push('ASLAN trade not properly documented');
      return { success: false, references: aslanMatches.length };
    }
  }

  async checkFamilyStatus() {
    const indexContent = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
    
    // Check if Stripe and Mimo are marked as FULLY OPERATIONAL
    const stripeLive = indexContent.includes('STRIPE</h4>') && (
      indexContent.includes('FULLY OPERATIONAL') || 
      indexContent.includes('The Hustler — LIVE!')
    );
    const mimoLive = indexContent.includes('MIMO</h4>') && (
      indexContent.includes('FULLY OPERATIONAL') || 
      indexContent.includes('The Builder — LIVE!')
    );
    
    if (stripeLive && mimoLive) {
      this.log('⚡🎨 Family Status: STRIPE & MIMO FULLY OPERATIONAL');
      return { success: true, stripe: true, mimo: true };
    } else {
      this.log(`❌ Family Status: Stripe=${stripeLive}, Mimo=${mimoLive}`);
      this.alerts.push('Family members not properly activated');
      return { success: false, stripe: stripeLive, mimo: mimoLive };
    }
  }

  async performHealthCheck() {
    this.log('\n🔄 STARTING HEALTH CHECK CYCLE');
    const timestamp = Date.now();
    
    const results = {
      timestamp,
      checks: {
        solPrice: await this.checkSolanaPrice(),
        gizmoToken: await this.checkGizmoToken(),
        websiteFiles: await this.checkWebsiteFiles(),
        aslanTrade: await this.checkAslanTrade(),
        familyStatus: await this.checkFamilyStatus()
      },
      alerts: this.alerts.slice()
    };

    // Save status to file
    fs.writeFileSync(this.statusFile, JSON.stringify(results, null, 2));
    
    const healthScore = Object.values(results.checks).filter(c => c.success).length;
    const totalChecks = Object.keys(results.checks).length;
    
    this.log(`📊 Health Score: ${healthScore}/${totalChecks} (${((healthScore/totalChecks)*100).toFixed(1)}%)`);
    
    if (this.alerts.length > 0) {
      this.log('🚨 ALERTS:');
      this.alerts.forEach(alert => this.log(`  - ${alert}`));
      this.alerts = []; // Clear alerts after logging
    }
    
    this.log('✅ HEALTH CHECK COMPLETE\n');
    this.lastCheck = timestamp;
    
    return results;
  }

  async autoRepair() {
    this.log('🔧 ATTEMPTING AUTO-REPAIR...');
    
    // Auto-repair logic here
    // For now, just log what would be repaired
    
    this.log('🔧 Auto-repair complete (placeholder)');
  }

  async startMonitoring(interval = 15000) { // 15 seconds
    this.log(`⏰ Starting monitoring loop (${interval/1000}s interval)`);
    
    const monitor = async () => {
      try {
        const results = await this.performHealthCheck();
        
        // If health score is low, attempt auto-repair
        const healthScore = Object.values(results.checks).filter(c => c.success).length;
        const totalChecks = Object.keys(results.checks).length;
        
        if (healthScore < totalChecks * 0.8) { // Less than 80% health
          await this.autoRepair();
        }
        
      } catch (error) {
        this.log(`❌ Monitor cycle failed: ${error.message}`);
      }
      
      setTimeout(monitor, interval);
    };
    
    // Start the monitoring loop
    monitor();
  }

  getStatus() {
    try {
      return JSON.parse(fs.readFileSync(this.statusFile, 'utf8'));
    } catch (error) {
      return { error: 'Status file not found' };
    }
  }
}

// Main execution
if (require.main === module) {
  const guardian = new WebsiteGuardian();
  
  // Handle graceful shutdown
  process.on('SIGINT', () => {
    guardian.log('🛑 Guardian shutdown requested');
    process.exit(0);
  });
  
  // Start monitoring
  guardian.startMonitoring(15000); // Check every 15 seconds
}

module.exports = WebsiteGuardian;