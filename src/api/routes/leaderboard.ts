import { FastifyInstance } from 'fastify';
import { roundRepository } from '../../repositories/round.repository.js';
import { tickRepository } from '../../repositories/tick.repository.js';

export async function leaderboardRoutes(fastify: FastifyInstance) {
  fastify.get<{ Params: { roundId: string } }>('/:roundId', async (request) => {
    const { roundId } = request.params;
    const leaderboard = await roundRepository.getLeaderboard(roundId);
    return { leaderboard };
  });

  fastify.get<{ Params: { roundId: string; agentId: string } }>(
    '/:roundId/agent/:agentId',
    async (request) => {
      const { roundId, agentId } = request.params;

      const participants = await roundRepository.getParticipants(roundId);
      const participant = participants.find((p) => p.agent_id === agentId);

      if (!participant) {
        return { agent: null };
      }

      const trades = await tickRepository.getTradesByAgent(agentId);
      const roundTrades = trades.filter((t) => t.round_id === roundId);
      const positions = await tickRepository.getAgentPositions(agentId, roundId);

      const winningTrades = roundTrades.filter(
        (t) => t.action === 'SELL_MARKET' && t.status === 'confirmed'
      ).length;

      return {
        agent: {
          agent_id: agentId,
          round_id: roundId,
          initial_balance: participant.initial_balance,
          current_balance: participant.current_balance,
          total_pnl: participant.total_pnl,
          total_trades: participant.total_trades,
          winning_trades: winningTrades,
          win_rate: participant.total_trades > 0 ? winningTrades / participant.total_trades : 0,
          positions,
          recent_trades: roundTrades.slice(0, 10),
        },
      };
    }
  );
}
