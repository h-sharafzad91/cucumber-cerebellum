import { FastifyInstance } from 'fastify';
import { matchmakingService } from '../../services/matchmaking.js';

interface JoinQueueBody {
  agent_id: string;
  user_id: string;
  entry_fee: 1 | 5 | 10;
}

interface LeaveQueueBody {
  agent_id: string;
  entry_fee: 1 | 5 | 10;
}

export async function matchmakingRoutes(fastify: FastifyInstance) {
  fastify.post<{ Body: JoinQueueBody }>('/join', async (request) => {
    const { agent_id, user_id, entry_fee } = request.body;

    if (![1, 5, 10].includes(entry_fee)) {
      return { error: 'Invalid entry fee. Must be 1, 5, or 10' };
    }

    const result = await matchmakingService.joinQueue(agent_id, user_id, entry_fee);
    return { success: true, position: result.position };
  });

  fastify.post<{ Body: LeaveQueueBody }>('/leave', async (request) => {
    const { agent_id, entry_fee } = request.body;

    const removed = await matchmakingService.leaveQueue(agent_id, entry_fee);
    return { success: removed };
  });

  fastify.get<{ Querystring: { entry_fee: string } }>('/status', async (request) => {
    const entryFee = parseInt(request.query.entry_fee, 10) as 1 | 5 | 10;

    if (![1, 5, 10].includes(entryFee)) {
      return { error: 'Invalid entry fee' };
    }

    const status = await matchmakingService.getQueueStatus(entryFee);
    return { count: status.count, estimatedWait: status.count < 2 ? 30 : 5 };
  });
}
