import { FastifyInstance } from 'fastify';
import { bettingService } from '../../services/betting.js';

interface PlaceBetBody {
  user_id: string;
  agent_id: string;
  amount: number;
}

export async function bettingRoutes(fastify: FastifyInstance) {
  fastify.post<{ Params: { roundId: string }; Body: PlaceBetBody }>(
    '/:roundId/bet',
    async (request) => {
      const { roundId } = request.params;
      const { user_id, agent_id, amount } = request.body;

      if (amount <= 0) {
        return { error: 'Amount must be positive' };
      }

      const bet = await bettingService.placeBet(roundId, user_id, agent_id, amount);
      return { bet };
    }
  );

  fastify.get<{ Params: { roundId: string } }>('/:roundId/odds', async (request) => {
    const { roundId } = request.params;
    const odds = await bettingService.getAllOdds(roundId);
    return { odds };
  });

  fastify.get<{ Params: { roundId: string } }>('/:roundId/pool', async (request) => {
    const { roundId } = request.params;
    const pool = await bettingService.getPool(roundId);
    return { pool };
  });

  fastify.get<{ Querystring: { user_id: string; round_id?: string } }>(
    '/my-bets',
    async (request) => {
      const { user_id, round_id } = request.query;
      const bets = await bettingService.getUserBets(user_id, round_id);
      return { bets };
    }
  );
}
