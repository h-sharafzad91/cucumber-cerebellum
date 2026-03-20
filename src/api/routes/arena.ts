import { FastifyInstance } from 'fastify';
import { actionValidator } from '../../services/action-validator.js';
import { riskEngine } from '../../services/risk-engine.js';
import { executionEngine } from '../../services/execution-engine.js';
import { pnlCalculator } from '../../services/pnl-calculator.js';
import { tickRepository } from '../../repositories/tick.repository.js';
import { roundRepository } from '../../repositories/round.repository.js';
import { marketDataService } from '../../services/market-data.js';
import { broadcastTrade, broadcastLeaderboard, broadcastReasoning } from '../websocket.js';
import { ValidationError } from '../../utils/errors.js';
import type { AgentAction } from '../../types/action.js';

interface ActionBody {
  agent_id: string;
  tick_id: string;
  reasoning: string;
  action: 'BUY_MARKET' | 'SELL_MARKET' | 'SHORT_MARKET' | 'COVER_MARKET' | 'HOLD';
  asset?: string;
  size_usd?: number;
  size_asset?: number;
}

export async function arenaRoutes(fastify: FastifyInstance) {
  fastify.post<{ Params: { roundId: string }; Body: ActionBody }>('/:roundId/action', async (request) => {
    const { roundId } = request.params;
    const actionData: AgentAction = request.body;

    const round = await roundRepository.findById(roundId);
    if (round.status !== 'active') {
      throw new ValidationError('Round is not active');
    }

    const participants = await roundRepository.getParticipants(roundId);
    const participant = participants.find((p) => p.agent_id === actionData.agent_id);
    if (!participant) {
      throw new ValidationError('Agent is not a participant in this round');
    }

    const positions = await tickRepository.getAgentPositions(actionData.agent_id, roundId);

    const portfolio = {
      balance_usd: participant.current_balance,
      positions,
    };

    const validatedAction = actionValidator.validate(actionData, portfolio);

    const riskCheck = riskEngine.checkAction(validatedAction, portfolio, participant.initial_balance);

    if (!riskCheck.passed) {
      return {
        success: false,
        error: riskCheck.violations.join('; '),
        action: actionData.action,
      };
    }

    const tradingPair = round.trading_pair || 'BTC/USDT';
    const currentPrice = await marketDataService.getPriceForPair(tradingPair);
    const trade = await executionEngine.executeAction(validatedAction, roundId, currentPrice);

    await tickRepository.storeTrade(trade);

    const pnlResult = pnlCalculator.calculatePnL(trade, positions, participant.current_balance, currentPrice);

    await tickRepository.updatePositions(actionData.agent_id, roundId, pnlResult.positions);

    await roundRepository.updateParticipantAtomic(
      roundId,
      actionData.agent_id,
      pnlResult.balance_usd,
      pnlResult.realized_pnl,
      trade.action !== 'HOLD' ? 1 : 0
    );

    await tickRepository.storeAgentTick(
      actionData.tick_id,
      roundId,
      actionData.agent_id,
      { positions: pnlResult.positions, balance: pnlResult.balance_usd },
      { action: trade.action, asset: trade.asset, size_usd: trade.size_usd, size_asset: trade.size_asset },
      actionData.reasoning,
      pnlResult.realized_pnl
    );

    broadcastTrade(roundId, trade);

    broadcastReasoning(roundId, {
      agent_id: actionData.agent_id,
      action: trade.action,
      reasoning: actionData.reasoning,
      asset: trade.asset,
      size_usd: trade.size_usd,
      size_asset: trade.size_asset,
      timestamp: new Date().toISOString(),
    });

    const leaderboard = await roundRepository.getLeaderboard(roundId);
    broadcastLeaderboard(roundId, leaderboard);

    return {
      success: true,
      trade,
      pnl: {
        realized: pnlResult.realized_pnl,
        unrealized: pnlResult.unrealized_pnl,
        total: pnlResult.total_pnl,
      },
      balance: pnlResult.balance_usd,
    };
  });

  fastify.get<{ Params: { roundId: string } }>('/:roundId/trades', async (request) => {
    const { roundId } = request.params;
    const trades = await tickRepository.getTradesByRound(roundId);
    return { trades };
  });

  fastify.get<{ Params: { roundId: string; agentId: string } }>(
    '/:roundId/positions/:agentId',
    async (request) => {
      const { roundId, agentId } = request.params;
      const positions = await tickRepository.getAgentPositions(agentId, roundId);
      return { positions };
    }
  );

  // Get agent performance history (tick-by-tick realized PnL)
  fastify.get<{ Params: { roundId: string; agentId: string } }>(
    '/:roundId/performance/:agentId',
    async (request) => {
      const { roundId, agentId } = request.params;

      // Get participant to know initial balance
      const participants = await roundRepository.getParticipants(roundId);
      const participant = participants.find((p) => p.agent_id === agentId);

      if (!participant) {
        return { performance: [], error: 'Agent not found in round' };
      }

      const performance = await tickRepository.getAgentPerformanceHistory(
        agentId,
        roundId,
        participant.initial_balance
      );

      return {
        performance,
        initial_balance: participant.initial_balance,
        current_balance: participant.current_balance,
        total_pnl: participant.total_pnl,
      };
    }
  );
}
