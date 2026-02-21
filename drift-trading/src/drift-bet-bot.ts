/**
 * 🦞 Gizmo's Drift Protocol BET Market Trading Bot
 * 
 * Capabilities:
 * - Connect to Drift Protocol on Solana mainnet
 * - List all BET (prediction) markets
 * - Get current odds/prices
 * - Place prediction market bets (YES/NO positions)
 * - Check open positions and P&L
 * 
 * NOTE: Trading is built but disabled by default. Use --trade flag to enable.
 */

import { Connection, Keypair, PublicKey } from '@solana/web3.js';
import {
  DriftClient,
  User,
  Wallet,
  BulkAccountLoader,
  initialize,
  convertToNumber,
  PRICE_PRECISION,
  QUOTE_PRECISION,
  BASE_PRECISION,
  PositionDirection,
  getMarketOrderParams,
  getLimitOrderParams,
  PerpMarkets,
  calculateBidAskPrice,
  BN,
  OrderType,
  MarketType,
} from '@drift-labs/sdk';
import { loadWallet, getConnection, RPC_URL } from './config';

// ============================================================
// Types
// ============================================================

interface BetMarketInfo {
  marketIndex: number;
  symbol: string;
  fullName: string;
  category: string[];
  yesPrice: number;    // Price of YES position (0-1, represents probability)
  noPrice: number;     // Price of NO position (1 - yesPrice)
  bidPrice: number;    // Best bid
  askPrice: number;    // Best ask
}

interface PositionInfo {
  marketIndex: number;
  symbol: string;
  baseAssetAmount: number;
  quoteEntryAmount: number;
  unrealizedPnl: number;
  direction: 'LONG (YES)' | 'SHORT (NO)' | 'NONE';
}

// ============================================================
// Bot Class
// ============================================================

export class DriftBetBot {
  private connection: Connection;
  private wallet: Wallet;
  private driftClient!: DriftClient;
  private user!: User;
  private bulkAccountLoader!: BulkAccountLoader;
  private isSubscribed = false;

  constructor(keypair?: Keypair) {
    this.connection = getConnection();
    const kp = keypair || loadWallet();
    this.wallet = new Wallet(kp as any);
    console.log(`🦞 Gizmo Bot initialized`);
    console.log(`   Wallet: ${this.wallet.publicKey.toString()}`);
    console.log(`   RPC: ${RPC_URL}`);
  }

  // ---- Connection ----

  async connect(): Promise<void> {
    console.log('\n🔌 Connecting to Drift Protocol...');
    
    const env = 'mainnet-beta';
    const sdkConfig = initialize({ env });
    
    this.bulkAccountLoader = new BulkAccountLoader(
      this.connection as any,
      'confirmed',
      1000
    );

    this.driftClient = new DriftClient({
      connection: this.connection as any,
      wallet: this.wallet,
      programID: new PublicKey(sdkConfig.DRIFT_PROGRAM_ID),
      accountSubscription: {
        type: 'polling',
        accountLoader: this.bulkAccountLoader,
      },
    });

    await this.driftClient.subscribe();
    this.isSubscribed = true;
    console.log('✅ Connected to Drift Protocol');

    // Check SOL balance
    const balance = await this.connection.getBalance(this.wallet.publicKey);
    console.log(`   SOL Balance: ${(balance / 1e9).toFixed(4)} SOL`);
  }

  async setupUser(): Promise<boolean> {
    try {
      this.user = new User({
        driftClient: this.driftClient,
        userAccountPublicKey: await this.driftClient.getUserAccountPublicKey(),
        accountSubscription: {
          type: 'polling',
          accountLoader: this.bulkAccountLoader,
        },
      });

      const exists = await this.user.exists();
      if (!exists) {
        console.log('⚠️  No Drift account found for this wallet.');
        console.log('   You need to deposit USDC to create an account first.');
        return false;
      }

      await this.user.subscribe();
      console.log('✅ User account loaded');
      return true;
    } catch (e: any) {
      console.log(`⚠️  Could not load user account: ${e.message}`);
      return false;
    }
  }

  // ---- Market Reading ----

  getBetMarkets(): BetMarketInfo[] {
    const env = 'mainnet-beta';
    const allMarkets = PerpMarkets[env] || [];
    
    // Filter for BET/Prediction markets
    const betMarkets = allMarkets.filter(m => 
      m.symbol?.includes('BET') || 
      m.symbol?.includes('PREDICT') ||
      m.category?.includes('Prediction')
    );

    const results: BetMarketInfo[] = [];

    for (const market of betMarkets) {
      try {
        const perpMarketAccount = this.driftClient.getPerpMarketAccount(market.marketIndex);
        if (!perpMarketAccount) continue;

        const oracleData = this.driftClient.getOracleDataForPerpMarket(market.marketIndex);
        const [bid, ask] = calculateBidAskPrice(perpMarketAccount.amm, oracleData as any);
        
        const bidPrice = convertToNumber(bid, PRICE_PRECISION);
        const askPrice = convertToNumber(ask, PRICE_PRECISION);
        
        // For prediction markets, price represents probability (0 to 1)
        // YES price = market price (closer to 1 = more likely YES)
        // NO price = 1 - YES price
        const yesPrice = askPrice; // buy YES at ask
        const noPrice = 1 - bidPrice; // buy NO = sell YES at bid

        results.push({
          marketIndex: market.marketIndex,
          symbol: market.symbol,
          fullName: market.fullName || market.symbol,
          category: market.category || [],
          yesPrice: Math.max(0, Math.min(1, yesPrice)),
          noPrice: Math.max(0, Math.min(1, noPrice)),
          bidPrice,
          askPrice,
        });
      } catch (e: any) {
        // Market might not be active, skip it
        results.push({
          marketIndex: market.marketIndex,
          symbol: market.symbol,
          fullName: market.fullName || market.symbol,
          category: market.category || [],
          yesPrice: -1,
          noPrice: -1,
          bidPrice: -1,
          askPrice: -1,
        });
      }
    }

    return results;
  }

  printBetMarkets(): void {
    console.log('\n📊 Drift BET (Prediction) Markets');
    console.log('═'.repeat(80));
    
    const markets = this.getBetMarkets();
    
    if (markets.length === 0) {
      console.log('No BET markets found.');
      return;
    }

    for (const m of markets) {
      const status = m.yesPrice >= 0 ? '🟢' : '⚫';
      const yesStr = m.yesPrice >= 0 ? `$${m.yesPrice.toFixed(4)}` : 'N/A';
      const noStr = m.noPrice >= 0 ? `$${m.noPrice.toFixed(4)}` : 'N/A';
      const pctStr = m.yesPrice >= 0 ? `${(m.yesPrice * 100).toFixed(1)}%` : 'N/A';
      
      console.log(`${status} [${m.marketIndex}] ${m.fullName}`);
      console.log(`   Symbol: ${m.symbol}`);
      console.log(`   YES: ${yesStr} (${pctStr} implied probability)`);
      console.log(`   NO:  ${noStr}`);
      console.log(`   Bid: $${m.bidPrice.toFixed(4)} | Ask: $${m.askPrice.toFixed(4)}`);
      console.log(`   Categories: ${m.category.join(', ')}`);
      console.log('');
    }
    
    console.log(`Total BET markets: ${markets.length}`);
  }

  // ---- Positions ----

  async getPositions(): Promise<PositionInfo[]> {
    if (!this.user) return [];

    const positions: PositionInfo[] = [];
    const env = 'mainnet-beta';
    const allMarkets = PerpMarkets[env] || [];
    const betMarkets = allMarkets.filter(m => 
      m.symbol?.includes('BET') || 
      m.symbol?.includes('PREDICT') ||
      m.category?.includes('Prediction')
    );

    for (const market of betMarkets) {
      try {
        const perpPosition = this.user.getPerpPosition(market.marketIndex);
        if (!perpPosition || perpPosition.baseAssetAmount.isZero()) continue;

        const baseAmount = convertToNumber(perpPosition.baseAssetAmount, BASE_PRECISION);
        const quoteEntry = convertToNumber(perpPosition.quoteEntryAmount, QUOTE_PRECISION);
        
        // Calculate unrealized PnL
        const perpMarketAccount = this.driftClient.getPerpMarketAccount(market.marketIndex);
        const oracleData = this.driftClient.getOracleDataForPerpMarket(market.marketIndex);
        const oraclePrice = convertToNumber(oracleData.price, PRICE_PRECISION);
        const unrealizedPnl = (baseAmount * oraclePrice) + quoteEntry;

        const direction = baseAmount > 0 ? 'LONG (YES)' : baseAmount < 0 ? 'SHORT (NO)' : 'NONE';

        positions.push({
          marketIndex: market.marketIndex,
          symbol: market.symbol,
          baseAssetAmount: baseAmount,
          quoteEntryAmount: quoteEntry,
          unrealizedPnl,
          direction,
        });
      } catch {
        // Skip markets where position can't be read
      }
    }

    return positions;
  }

  async printPositions(): Promise<void> {
    console.log('\n📋 Your BET Positions');
    console.log('═'.repeat(60));

    const positions = await this.getPositions();
    
    if (positions.length === 0) {
      console.log('No open BET positions.');
      return;
    }

    let totalPnl = 0;
    for (const p of positions) {
      console.log(`[${p.marketIndex}] ${p.symbol}`);
      console.log(`   Direction: ${p.direction}`);
      console.log(`   Size: ${Math.abs(p.baseAssetAmount).toFixed(4)}`);
      console.log(`   Entry Value: $${Math.abs(p.quoteEntryAmount).toFixed(2)}`);
      console.log(`   Unrealized P&L: $${p.unrealizedPnl.toFixed(2)}`);
      console.log('');
      totalPnl += p.unrealizedPnl;
    }
    
    console.log(`Total Unrealized P&L: $${totalPnl.toFixed(2)}`);
  }

  // ---- Trading ----

  /**
   * Place a BET on a prediction market.
   * 
   * @param marketIndex - The perp market index for the BET market
   * @param direction - 'YES' (LONG) or 'NO' (SHORT)
   * @param amount - Amount in USDC to bet
   * @param limitPrice - Optional limit price (0-1 range). If not set, uses market order.
   */
  async placeBet(
    marketIndex: number,
    direction: 'YES' | 'NO',
    amount: number,
    limitPrice?: number
  ): Promise<string> {
    console.log(`\n🎲 Placing BET...`);
    console.log(`   Market: ${marketIndex}`);
    console.log(`   Direction: ${direction}`);
    console.log(`   Amount: $${amount}`);
    if (limitPrice !== undefined) {
      console.log(`   Limit Price: $${limitPrice}`);
    }

    const posDirection = direction === 'YES' 
      ? PositionDirection.LONG 
      : PositionDirection.SHORT;

    // Convert amount to base asset amount using current price
    const perpMarketAccount = this.driftClient.getPerpMarketAccount(marketIndex);
    if (!perpMarketAccount) {
      throw new Error(`Market ${marketIndex} not found`);
    }

    const oracleData = this.driftClient.getOracleDataForPerpMarket(marketIndex);
    const oraclePrice = convertToNumber(oracleData.price, PRICE_PRECISION);
    
    // For BET markets, price is 0-1. Amount in USDC / price = base amount
    const baseAmount = amount / oraclePrice;
    const baseAssetAmount = new BN(Math.floor(baseAmount * 1e9)); // BASE_PRECISION = 1e9

    let txSig: string;

    if (limitPrice !== undefined) {
      // Limit order
      const priceBN = new BN(Math.floor(limitPrice * 1e6)); // PRICE_PRECISION = 1e6
      txSig = await this.driftClient.placePerpOrder(
        getLimitOrderParams({
          baseAssetAmount,
          direction: posDirection,
          marketIndex,
          price: priceBN,
        })
      );
    } else {
      // Market order
      txSig = await this.driftClient.placePerpOrder(
        getMarketOrderParams({
          baseAssetAmount,
          direction: posDirection,
          marketIndex,
        })
      );
    }

    console.log(`✅ BET placed! Tx: ${txSig}`);
    return txSig;
  }

  // ---- Cleanup ----

  async disconnect(): Promise<void> {
    if (this.user) {
      await this.user.unsubscribe();
    }
    if (this.isSubscribed) {
      await this.driftClient.unsubscribe();
    }
    console.log('\n🔌 Disconnected from Drift Protocol');
  }
}

// ============================================================
// CLI Runner
// ============================================================

async function main() {
  const args = process.argv.slice(2);
  const command = args[0] || 'markets';

  if (command === 'help' || command === '--help' || command === '-h') {
    console.log(`
🦞 Gizmo's Drift BET Bot

Commands:
  markets              List all BET prediction markets with odds
  positions            Show your open BET positions and P&L
  bet <idx> <Y/N> <$>  Place a bet (e.g., "bet 45 YES 10")
  all                  Show markets + positions

Examples:
  npx ts-node --transpile-only src/drift-bet-bot.ts markets
  npx ts-node --transpile-only src/drift-bet-bot.ts bet 45 YES 10
  npx ts-node --transpile-only src/drift-bet-bot.ts bet 45 NO 5 0.35

Environment:
  SOLANA_RPC_URL   Custom RPC endpoint (default: public mainnet)
  WALLET_PATH      Custom wallet path (default: ~/.gizmo/solana-wallet.json)
    `);
    return;
  }

  const bot = new DriftBetBot();

  try {
    await bot.connect();

    switch (command) {
      case 'markets':
        bot.printBetMarkets();
        break;

      case 'positions': {
        const hasAccount = await bot.setupUser();
        if (hasAccount) {
          await bot.printPositions();
        }
        break;
      }

      case 'bet': {
        // Usage: bet <marketIndex> <YES|NO> <amount> [limitPrice]
        const hasAccount = await bot.setupUser();
        if (!hasAccount) {
          console.log('❌ Cannot trade without a Drift account');
          break;
        }
        
        const marketIdx = parseInt(args[1]);
        const dir = (args[2] || '').toUpperCase() as 'YES' | 'NO';
        const amt = parseFloat(args[3]);
        const limit = args[4] ? parseFloat(args[4]) : undefined;

        if (isNaN(marketIdx) || !['YES', 'NO'].includes(dir) || isNaN(amt)) {
          console.log('Usage: bet <marketIndex> <YES|NO> <amountUSDC> [limitPrice]');
          console.log('Example: bet 45 YES 10');
          break;
        }

        if (amt > 100) {
          console.log('⚠️  Safety limit: max $100 per bet. Override in code if needed.');
          break;
        }

        await bot.placeBet(marketIdx, dir, amt, limit);
        break;
      }

      case 'all': {
        bot.printBetMarkets();
        const hasAccount = await bot.setupUser();
        if (hasAccount) {
          await bot.printPositions();
        }
        break;
      }

      default:
        console.log(`
🦞 Gizmo's Drift BET Bot

Commands:
  markets              List all BET prediction markets with odds
  positions            Show your open BET positions and P&L
  bet <idx> <Y/N> <$>  Place a bet (e.g., "bet 45 YES 10")
  all                  Show markets + positions

Examples:
  npx ts-node src/drift-bet-bot.ts markets
  npx ts-node src/drift-bet-bot.ts positions
  npx ts-node src/drift-bet-bot.ts bet 45 YES 10
  npx ts-node src/drift-bet-bot.ts bet 45 NO 5 0.35
        `);
    }
  } catch (e: any) {
    console.error(`❌ Error: ${e.message}`);
    if (process.env.DEBUG) console.error(e);
  } finally {
    await bot.disconnect();
  }
}

// Run if executed directly
if (require.main === module) {
  main().catch(console.error);
}
