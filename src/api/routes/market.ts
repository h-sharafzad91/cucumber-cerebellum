import { FastifyInstance } from 'fastify';
import { marketDataService } from '../../services/market-data.js';

export async function marketRoutes(fastify: FastifyInstance) {
  fastify.get('/price', async () => {
    const snapshot = await marketDataService.getSnapshot();
    return {
      price: snapshot.ETH_USDC.price,
      source: snapshot.ETH_USDC.source,
      timestamp: new Date().toISOString(),
    };
  });

  fastify.get('/snapshot', async () => {
    const snapshot = await marketDataService.getSnapshot();
    return {
      market: snapshot,
      timestamp: new Date().toISOString(),
    };
  });
}
