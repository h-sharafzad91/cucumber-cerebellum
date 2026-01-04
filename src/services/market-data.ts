import { logger } from '../utils/logger.js';
import type { MarketData, Candle } from '../types/tick.js';

const PYTH_HERMES_URL = 'https://hermes.pyth.network';
const BINANCE_API_URL = 'https://api.binance.com';

const ETH_USD_FEED_ID = '0xff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace';

export class MarketDataService {
  async getCurrentPrice(asset: string): Promise<number> {
    if (asset === 'ETH') {
      const { price } = await this.getEthPrice();
      return price;
    }
    if (asset === 'USDC') {
      return 1.0;
    }
    throw new Error(`Unknown asset: ${asset}`);
  }

  async getSnapshot(): Promise<MarketData> {
    const [price, candles] = await Promise.all([
      this.getEthPrice(),
      this.getCandles(),
    ]);

    return {
      ETH_USDC: price,
      candles: {
        ETH_USDC: candles,
      },
    };
  }

  private async getEthPrice(): Promise<{ price: number; source: 'pyth' | 'binance' }> {
    try {
      const pythPrice = await this.fetchPythPrice();
      if (pythPrice) {
        return { price: pythPrice, source: 'pyth' };
      }
    } catch (error) {
      logger.warn({ error }, 'Pyth price fetch failed, falling back to Binance');
    }

    const binancePrice = await this.fetchBinancePrice();
    return { price: binancePrice, source: 'binance' };
  }

  private async fetchPythPrice(): Promise<number | null> {
    try {
      const response = await fetch(
        `${PYTH_HERMES_URL}/api/latest_price_feeds?ids[]=${ETH_USD_FEED_ID}`
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
      logger.error({ error }, 'Pyth price fetch error');
      return null;
    }
  }

  private async fetchBinancePrice(): Promise<number> {
    const response = await fetch(`${BINANCE_API_URL}/api/v3/ticker/price?symbol=ETHUSDC`);

    if (!response.ok) {
      throw new Error(`Binance API error: ${response.status}`);
    }

    const data = await response.json() as { price: string };
    return parseFloat(data.price);
  }

  private async getCandles(): Promise<{ m1: Candle[]; m5: Candle[]; h1: Candle[] }> {
    const [m1, m5, h1] = await Promise.all([
      this.fetchBinanceCandles('1m'),
      this.fetchBinanceCandles('5m'),
      this.fetchBinanceCandles('1h'),
    ]);

    return { m1, m5, h1 };
  }

  private async fetchBinanceCandles(interval: string, limit: number = 50): Promise<Candle[]> {
    try {
      const response = await fetch(
        `${BINANCE_API_URL}/api/v3/klines?symbol=ETHUSDC&interval=${interval}&limit=${limit}`
      );

      if (!response.ok) {
        throw new Error(`Binance candles API error: ${response.status}`);
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
      logger.error({ error, interval }, `Failed to fetch ${interval} candles`);
      return [];
    }
  }
}

export const marketDataService = new MarketDataService();
