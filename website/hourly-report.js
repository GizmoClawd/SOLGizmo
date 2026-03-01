#!/usr/bin/env node

/**
 * HOURLY STATUS REPORTER
 * 
 * Generates detailed hourly reports for the main agent
 * Reports website status, trading data, and system health
 */

const fs = require('fs');
const path = require('path');

class HourlyReporter {
  constructor() {
    this.statusFile = path.join(__dirname, 'status.json');
    this.logFile = path.join(__dirname, 'guardian.log');
    this.reportDir = path.join(__dirname, 'reports');
    
    // Ensure reports directory exists
    if (!fs.existsSync(this.reportDir)) {
      fs.mkdirSync(this.reportDir, { recursive: true });
    }
  }

  getLatestStatus() {
    try {
      const statusData = fs.readFileSync(this.statusFile, 'utf8');
      return JSON.parse(statusData);
    } catch (error) {
      return null;
    }
  }

  getRecentLogs(hours = 1) {
    try {
      const logData = fs.readFileSync(this.logFile, 'utf8');
      const lines = logData.split('\n').filter(line => line.trim());
      
      const cutoff = Date.now() - (hours * 60 * 60 * 1000);
      
      return lines.filter(line => {
        const timestampMatch = line.match(/\[(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z)\]/);
        if (timestampMatch) {
          const timestamp = new Date(timestampMatch[1]).getTime();
          return timestamp >= cutoff;
        }
        return false;
      });
    } catch (error) {
      return [];
    }
  }

  generateReport() {
    const timestamp = new Date();
    const status = this.getLatestStatus();
    const recentLogs = this.getRecentLogs(1);
    
    let report = `
🚨 MIMO GUARDIAN HOURLY REPORT 🚨
================================================
Time: ${timestamp.toLocaleString()}
Station: /tmp/solgizmo-fresh/website/
Guardian: MIMO - Permanent Website Defense System

📊 SYSTEM HEALTH SUMMARY
================================================`;

    if (status && status.checks) {
      const totalChecks = Object.keys(status.checks).length;
      const passedChecks = Object.values(status.checks).filter(c => c.success).length;
      const healthPercentage = Math.round((passedChecks / totalChecks) * 100);
      
      report += `
Health Score: ${healthPercentage}% (${passedChecks}/${totalChecks} checks passing)
Status: ${healthPercentage >= 90 ? '🟢 EXCELLENT' : healthPercentage >= 70 ? '🟡 GOOD' : '🔴 NEEDS ATTENTION'}
Last Check: ${new Date(status.timestamp).toLocaleString()}

💰 MARKET DATA
================================================`;

      if (status.checks.solPrice?.success) {
        report += `
SOL Price: $${status.checks.solPrice.price.toFixed(2)}`;
      }

      if (status.checks.gizmoToken?.success) {
        report += `
GIZMO Price: $${status.checks.gizmoToken.price.toFixed(8)}
GIZMO 24h Volume: $${status.checks.gizmoToken.volume24h.toLocaleString()}`;
      }

      report += `

📄 WEBSITE STATUS
================================================`;

      const files = status.checks.websiteFiles;
      if (files) {
        Object.keys(files).forEach(filename => {
          const fileInfo = files[filename];
          const status = fileInfo.exists ? '✅' : '❌';
          const size = fileInfo.size ? `(${(fileInfo.size/1024).toFixed(1)}KB)` : '';
          report += `
${filename}: ${status} ${size}`;
        });
      }

      report += `

👥 FAMILY STATUS
================================================`;

      if (status.checks.familyStatus) {
        const family = status.checks.familyStatus;
        report += `
⚡ STRIPE (Hustler): ${family.stripe ? '🟢 OPERATIONAL' : '🔴 OFFLINE'}
🎨 MIMO (Builder): ${family.mimo ? '🟢 OPERATIONAL' : '🔴 OFFLINE'}`;
      }

      if (status.checks.aslanTrade) {
        report += `
🦁 ASLAN Trade: ${status.checks.aslanTrade.success ? '✅ VERIFIED' : '❌ INCOMPLETE'} (${status.checks.aslanTrade.references || 0} references)`;
      }

      if (status.alerts && status.alerts.length > 0) {
        report += `

🚨 ACTIVE ALERTS
================================================`;
        status.alerts.forEach((alert, index) => {
          report += `
${index + 1}. ${alert}`;
        });
      }
    } else {
      report += `
❌ Status data unavailable - monitoring system may be offline`;
    }

    report += `

📋 RECENT ACTIVITY (Last Hour)
================================================`;

    if (recentLogs.length > 0) {
      recentLogs.slice(-10).forEach(log => {
        report += `
${log}`;
      });
    } else {
      report += `
No recent activity logged`;
    }

    report += `

🎯 RECOMMENDATIONS
================================================`;

    if (status) {
      const healthPercentage = status.checks ? 
        Math.round((Object.values(status.checks).filter(c => c.success).length / Object.keys(status.checks).length) * 100) : 0;
      
      if (healthPercentage >= 90) {
        report += `
✅ System running optimally
✅ Continue monitoring at current intervals
✅ All family members operational`;
      } else if (healthPercentage >= 70) {
        report += `
⚠️  Minor issues detected - investigate soon
⚠️  Check failed components for updates needed
✅ Core functionality still operational`;
      } else {
        report += `
🚨 CRITICAL: Multiple systems failing
🚨 Immediate intervention required
🚨 Website integrity at risk`;
      }
    }

    report += `

END REPORT
================================================
Generated by MIMO Guardian v1.0
Next report in 60 minutes
`;

    return report;
  }

  saveReport() {
    const timestamp = new Date();
    const filename = `report-${timestamp.getFullYear()}-${String(timestamp.getMonth() + 1).padStart(2, '0')}-${String(timestamp.getDate()).padStart(2, '0')}-${String(timestamp.getHours()).padStart(2, '0')}00.txt`;
    const filepath = path.join(this.reportDir, filename);
    
    const report = this.generateReport();
    fs.writeFileSync(filepath, report);
    
    console.log(report);
    console.log(`\n📁 Report saved to: ${filepath}`);
    
    return filepath;
  }

  getLatestReport() {
    try {
      const files = fs.readdirSync(this.reportDir);
      const reportFiles = files.filter(f => f.startsWith('report-') && f.endsWith('.txt'));
      
      if (reportFiles.length === 0) return null;
      
      reportFiles.sort().reverse();
      const latestFile = path.join(this.reportDir, reportFiles[0]);
      
      return fs.readFileSync(latestFile, 'utf8');
    } catch (error) {
      return null;
    }
  }
}

// Main execution
if (require.main === module) {
  const reporter = new HourlyReporter();
  
  if (process.argv[2] === '--show-latest') {
    const latest = reporter.getLatestReport();
    if (latest) {
      console.log(latest);
    } else {
      console.log('No reports found');
    }
  } else {
    reporter.saveReport();
  }
}

module.exports = HourlyReporter;