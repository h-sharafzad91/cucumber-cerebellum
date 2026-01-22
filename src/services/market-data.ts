import { logger } from '../utils/logger.js';
import type { MarketData, Candle, PricePoint } from '../types/tick.js';

const PYTH_HERMES_URL = 'https://hermes.pyth.network';
const BINANCE_API_URL = 'https://api.binance.com';

const MAX_PRICE_HISTORY = 20;

// Pyth Network Feed IDs for various assets
const PYTH_FEED_IDS: Record<string, string> = {
  'BTC': '0xe62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43',
  'ETH': '0xff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace',
  'SOL': '0xef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d',
  'AVAX': '0x93da3352f9f1d105fdfe4971cfa80e9dd777bfc5d0f683ebb6e1294b92137bb7',
  'MATIC': '0x5de33440f2db45e65e7c7a4a146b59fe6a004b5eff1b8d5d5f5e5e8d5e5e5e5e',
  'LINK': '0x8ac0c70fff57e9aefdf5edf44b51d62c2d433653cbb2cf5cc06bb115af04d221',
  'UNI': '0x78d185a741d07edb3412b09008b7c5cfb9bbbd7d568bf00ba737b456ba171501',
  'AAVE': '0x2b9ab1e972a281585084148ba1389800799bd4be63b957507db1349314e47445',
  'DOT': '0xca3eed9b267293f6595901c734c7525ce8ef49adafe8284f0b5f0e4cc6634ef0',
  'ATOM': '0xb00b60f88b03a6a625a8d1c048c3f66653edf217439983d037e7222c4e612819',
  'XRP': '0xec5d399846a9209f3fe5881d70aae9268c94339ff9817e8d18ff19fa05eea1c8',
  'ADA': '0x2a01deaec9e51a579277b34b122399984d0bbf57e2458a7e42fecd2829867a0d',
  'DOGE': '0xdcef50dd0a4cd2dcc17e45df1676dcb336a11a61c69df7a0299b0150c672d25c',
  'SHIB': '0xf0d57deca57b3da2fe63a493f4c25925fdfd8edf834b20f93e1f84dbd1504d4a',
};

// Convert trading pair to Binance symbol (e.g., "BTC/USDT" -> "BTCUSDT")
function tradingPairToBinanceSymbol(tradingPair: string): string {
  return tradingPair.replace('/', '');
}

// Extract base asset from trading pair (e.g., "BTC/USDT" -> "BTC")
function getBaseAsset(tradingPair: string): string {
  return tradingPair.split('/')[0];
}

export class MarketDataService {
  private priceHistoryByPair: Map<string, PricePoint[]> = new Map();

  // Get current price for a trading pair (e.g., "BTC/USDT")
  async getPriceForPair(tradingPair: string): Promise<number> {
    const baseAsset = getBaseAsset(tradingPair);
    const { price } = await this.fetchPrice(baseAsset, tradingPair);
    return price;
  }

  // Legacy method for backward compatibility
  async getCurrentPrice(asset: string): Promise<number> {
    if (asset === 'USDC' || asset === 'USDT') {
      return 1.0;
    }
    const { price } = await this.fetchPrice(asset, `${asset}/USDT`);
    return price;
  }

  // Get market snapshot for a specific trading pair
  async getSnapshotForPair(tradingPair: string = 'BTC/USDT'): Promise<MarketData> {
    const baseAsset = getBaseAsset(tradingPair);
    const binanceSymbol = tradingPairToBinanceSymbol(tradingPair);
    const pairKey = tradingPair.replace('/', '_');

    const [priceData, candles] = await Promise.all([
      this.fetchPrice(baseAsset, tradingPair),
      this.getCandlesForSymbol(binanceSymbol),
    ]);

    this.addPriceToHistory(pairKey, priceData.price);

    return {
      [pairKey]: {
        ...priceData,
        price_history: [...(this.priceHistoryByPair.get(pairKey) || [])],
      },
      candles: {
        [pairKey]: candles,
      },
      trading_pair: tradingPair,
    };
  }

  // Legacy method - defaults to ETH/USDC for backward compatibility
  async getSnapshot(): Promise<MarketData> {
    return this.getSnapshotForPair('ETH/USDC');
  }

  private addPriceToHistory(pairKey: string, price: number): void {
    let history = this.priceHistoryByPair.get(pairKey);
    if (!history) {
      history = [];
      this.priceHistoryByPair.set(pairKey, history);
    }

    history.push({
      price,
      timestamp: new Date().toISOString(),
    });

    if (history.length > MAX_PRICE_HISTORY) {
      history.shift();
    }
  }

  private async fetchPrice(baseAsset: string, tradingPair: string): Promise<{ price: number; source: 'pyth' | 'binance' }> {
    // Try Pyth first
    try {
      const pythPrice = await this.fetchPythPrice(baseAsset);
      if (pythPrice) {
        return { price: pythPrice, source: 'pyth' };
      }
    } catch (error) {
      logger.warn({ error, baseAsset }, 'Pyth price fetch failed, falling back to Binance');
    }

    // Fall back to Binance
    const binanceSymbol = tradingPairToBinanceSymbol(tradingPair);
    const binancePrice = await this.fetchBinancePrice(binanceSymbol);
    return { price: binancePrice, source: 'binance' };
  }

  private async fetchPythPrice(baseAsset: string): Promise<number | null> {
    const feedId = PYTH_FEED_IDS[baseAsset];
    if (!feedId) {
      logger.warn({ baseAsset }, 'No Pyth feed ID for asset');
      return null;
    }

    try {
      const response = await fetch(
        `${PYTH_HERMES_URL}/api/latest_price_feeds?ids[]=${feedId}`
      );

      if (!response.ok) {
        throw new Error(`Pyth API error: ${response.status}`);
      }

      const data = await response.json();
      const priceFeed = data[0];

      if (!priceFeed?.price?.price) {
        return null;
      }

      const price = Number(priceFeed.price.price);
      const expo = priceFeed.price.expo;
      return price * Math.pow(10, expo);
    } catch (error) {
      logger.error({ error, baseAsset }, 'Pyth price fetch error');
      return null;
    }
  }

  private async fetchBinancePrice(symbol: string): Promise<number> {
    const response = await fetch(`${BINANCE_API_URL}/api/v3/ticker/price?symbol=${symbol}`);

    if (!response.ok) {
      throw new Error(`Binance API error: ${response.status}`);
    }

    const data = await response.json() as { price: string };
    return parseFloat(data.price);
  }

  private async getCandlesForSymbol(symbol: string): Promise<{ m1: Candle[]; m5: Candle[]; h1: Candle[] }> {
    const [m1, m5, h1] = await Promise.all([
      this.fetchBinanceCandles(symbol, '1m'),
      this.fetchBinanceCandles(symbol, '5m'),
      this.fetchBinanceCandles(symbol, '1h'),
    ]);

    return { m1, m5, h1 };
  }

  private async fetchBinanceCandles(symbol: string, interval: string, limit: number = 50): Promise<Candle[]> {
    try {
      const response = await fetch(
        `${BINANCE_API_URL}/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`
      );

      if (!response.ok) {
        const text = await response.text();
        throw new Error(`Binance candles API error: ${response.status} - ${text}`);
      }

      const data = await response.json() as any[];

      return data.map((candle: any[]) => ({
        timestamp: new Date(candle[0]).toISOString(),
        open: parseFloat(candle[1]),
        high: parseFloat(candle[2]),
        low: parseFloat(candle[3]),
        close: parseFloat(candle[4]),
        volume: parseFloat(candle[5]),
      }));
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error({ error: errorMessage, symbol, interval }, `Failed to fetch ${interval} candles`);
      return [];
    }
  }
}

export const marketDataService = new MarketDataService();
