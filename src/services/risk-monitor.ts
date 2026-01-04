import { v4 as uuidv4 } from 'uuid';
import { stopLossEngine } from './stop-loss-engine.js';
import { takeProfitEngine } from './take-profit-engine.js';
import { leverageCalculator } from './leverage-calculator.js';
import { agentRepository } from '../repositories/agent.repository.js';
import { tickRepository } from '../repositories/tick.repository.js';
import { roundRepository } from '../repositories/round.repository.js';
import { broadcastTrade, broadcastPositionUpdate } from '../api/websocket.js';
import { logger } from '../utils/logger.js';
import type { Position } from '../types/tick.js';
import type { Agent } from '../types/agent.js';

interface RiskCheckResult {
  stopLossTriggered: boolean;
  takeProfitTriggered: boolean;
  liquidated: boolean;
  actions: RiskAction[];
}

interface RiskAction {
  type: 'STOP_LOSS' | 'TAKE_PROFIT' | 'LIQUIDATION';
  position: Position;
  closeSize: number;
  triggerPrice: number;
  currentPrice: number;
}

export class RiskMonitor {
  async checkPositionRisks(
    agentId: string,
    roundId: string,
    positions: Position[],
    currentPrices: Record<string, number>
  ): Promise<RiskCheckResult> {
    const agent = await agentRepository.findById(agentId);
    const actions: RiskAction[] = [];
    let stopLossTriggered = false;
    let takeProfitTriggered = false;
    let liquidated = false;

    for (const position of positions) {
      if (position.size === 0) continue;

      const currentPrice = currentPrices[position.asset];
      if (!currentPrice) continue;

      const positionDirection = position.size > 0 ? 'long' : 'short';

      if (agent.leverage && agent.leverage > 1) {
        const liqCheck = leverageCalculator.checkLiquidation(
          position.entry_price,
          currentPrice,
          agent.leverage,
          positionDirection
        );

        if (liqCheck.isLiquidated) {
          liquidated = true;
          actions.push({
            type: 'LIQUIDATION',
            position,
            closeSize: Math.abs(position.size),
            triggerPrice: liqCheck.liquidationPrice,
            currentPrice,
          });
          logger.warn(
            {
              agent_id: agentId,
              asset: position.asset,
              entry_price: position.entry_price,
              current_price: currentPrice,
              leverage: agent.leverage,
              liquidation_price: liqCheck.liquidationPrice,
            },
            'Position liquidated'
          );
          continue;
        }
      }

      if (agent.stop_loss_percent) {
        const slCheck = stopLossEngine.checkStopLoss(
          position,
          currentPrice,
          agent.stop_loss_percent
        );

        if (slCheck.shouldTrigger) {
          stopLossTriggered = true;
          const closeSize = stopLossEngine.calculateCloseSize(
            Math.abs(position.size),
            agent.stop_loss_position_close_percent || 100
          );

          actions.push({
            type: 'STOP_LOSS',
            position,
            closeSize,
            triggerPrice: slCheck.triggerPrice,
            currentPrice,
          });

          stopLossEngine.logStopLossExecution(
            agentId,
            position.asset,
            position.entry_price,
            currentPrice,
            agent.stop_loss_percent,
            agent.stop_loss_position_close_percent || 100
          );
        }
      }

      if (agent.take_profit_percent) {
        const tpCheck = takeProfitEngine.checkTakeProfit(
          position,
          currentPrice,
          agent.take_profit_percent
        );

        if (tpCheck.shouldTrigger) {
          takeProfitTriggered = true;
          const closeSize = takeProfitEngine.calculateCloseSize(
            Math.abs(position.size),
            agent.take_profit_position_close_percent || 50
          );

          actions.push({
            type: 'TAKE_PROFIT',
            position,
            closeSize,
            triggerPrice: tpCheck.triggerPrice,
            currentPrice,
          });

          takeProfitEngine.logTakeProfitExecution(
            agentId,
            position.asset,
            position.entry_price,
            currentPrice,
            agent.take_profit_percent,
            agent.take_profit_position_close_percent || 50
          );
        }
      }
    }

    return {
      stopLossTriggered,
      takeProfitTriggered,
      liquidated,
      actions,
    };
  }

  async executeRiskActions(
    agentId: string,
    roundId: string,
    tickId: string,
    actions: RiskAction[]
  ): Promise<void> {
    if (actions.length === 0) return;

    for (const action of actions) {
      await this.executeCloseTrade(
        agentId,
        roundId,
        tickId,
        action.position.asset,
        action.closeSize,
        action.currentPrice,
        action.type
      );
    }
  }

  private async executeCloseTrade(
    agentId: string,
    roundId: string,
    tickId: string,
    asset: string,
    size: number,
    price: number,
    reason: 'STOP_LOSS' | 'TAKE_PROFIT' | 'LIQUIDATION'
  ): Promise<void> {
    const participant = await roundRepository.getParticipantByAgent(roundId, agentId);
    if (!participant) {
      logger.error({ agent_id: agentId, round_id: roundId }, 'Participant not found for risk action');
      return;
    }

    const positions = await tickRepository.getAgentPositions(agentId, roundId);
    const position = positions.find((p) => p.asset === asset);

    if (!position || position.size === 0) {
      logger.warn({ agent_id: agentId, asset }, 'No position to close for risk action');
      return;
    }

    const isLong = position.size > 0;
    const closeSize = Math.min(size, Math.abs(position.size));
    const pnl = (price - position.entry_price) * (isLong ? closeSize : -closeSize);
    const newBalance = participant.current_balance + (closeSize * price) + pnl;

    const newSize = isLong ? position.size - closeSize : position.size + closeSize;
    const updatedPositions = newSize !== 0
      ? positions.map((p) =>
          p.asset === asset
            ? { ...p, size: newSize, current_price: price }
            : p
        )
      : positions.filter((p) => p.asset !== asset);

    await tickRepository.updatePositions(agentId, roundId, updatedPositions);

    await roundRepository.updateParticipantAtomic(
      roundId,
      agentId,
      newBalance,
      pnl,
      1
    );

    const tradeResult = {
      trade_id: uuidv4(),
      agent_id: agentId,
      round_id: roundId,
      tick_id: tickId,
      action: 'SELL_MARKET' as const,
      asset,
      size_usd: closeSize * price,
      size_asset: closeSize,
      execution_price: price,
      slippage: 0,
      gas_used: 0,
      tx_hash: null,
      status: 'confirmed',
      error_message: null,
      created_at: new Date().toISOString(),
      confirmed_at: new Date().toISOString(),
      metadata: { reason },
    };

    await tickRepository.storeTrade(tradeResult);

    broadcastTrade(roundId, {
      round_id: roundId,
      agent_id: agentId,
      trade_id: tradeResult.trade_id,
      action: 'SELL_MARKET',
      asset,
      size_usd: closeSize * price,
      execution_price: price,
      timestamp: new Date().toISOString(),
      metadata: { reason },
    });

    const currentPositions = await tickRepository.getAgentPositions(agentId, roundId);
    const totalValue = participant.current_balance + currentPositions.reduce((sum, p) =>
      sum + (p.size * (p.current_price || p.entry_price)), 0
    );

    broadcastPositionUpdate(roundId, agentId, {
      round_id: roundId,
      agent_id: agentId,
      positions: currentPositions,
      total_value: totalValue,
      unrealized_pnl: currentPositions.reduce((sum, p) => sum + (p.unrealized_pnl || 0), 0),
    });

    logger.info(
      {
        agent_id: agentId,
        asset,
        size: closeSize,
        price,
        pnl,
        reason,
      },
      'Risk action executed'
    );
  }
}

export const riskMonitor = new RiskMonitor();
