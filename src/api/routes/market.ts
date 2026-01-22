import { FastifyInstance } from 'fastify';
import { marketDataService } from '../../services/market-data.js';

interface PriceQuery {
  trading_pair?: string;
}

export async function marketRoutes(fastify: FastifyInstance) {
  // Get price for a specific trading pair
  fastify.get<{ Querystring: PriceQuery }>('/price', async (request) => {
    const tradingPair = request.query.trading_pair || 'BTC/USDT';
    const pairKey = tradingPair.replace('/', '_');

    const snapshot = await marketDataService.getSnapshotForPair(tradingPair);
    const priceData = snapshot[pairKey] as { price: number; source: string };

    return {
      price: priceData?.price || 0,
      source: priceData?.source || 'unknown',
      trading_pair: tradingPair,
      timestamp: new Date().toISOString(),
    };
  });

  // Get full market snapshot for a specific trading pair
  fastify.get<{ Querystring: PriceQuery }>('/snapshot', async (request) => {
    const tradingPair = request.query.trading_pair || 'BTC/USDT';
    const snapshot = await marketDataService.getSnapshotForPair(tradingPair);

    return {
      market: snapshot,
      trading_pair: tradingPair,
      timestamp: new Date().toISOString(),
    };
  });
}
