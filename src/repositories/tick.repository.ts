import { getDatabase } from '../config/database.js';
import { logger } from '../utils/logger.js';
import type { StoredTick, Position } from '../types/tick.js';
import type { TradeResult } from '../types/action.js';

interface TickMetadata {
  id: string;
  round_id: string;
  agent_id?: string;
  tick_number: number;
  timestamp: string;
  market_snapshot: object;
}

class TickRepository {
  async storeTick(tick: TickMetadata): Promise<void> {
    const db = getDatabase();

    const { error } = await db.from('ticks').insert({
      id: tick.id,
      round_id: tick.round_id,
      agent_id: tick.agent_id,
      tick_number: tick.tick_number,
      timestamp: tick.timestamp,
      market_snapshot: tick.market_snapshot,
    });

    if (error) {
      logger.error('Failed to store tick:', error);
      throw error;
    }
  }

  async getTicksByRound(roundId: string): Promise<TickMetadata[]> {
    const db = getDatabase();

    const { data, error } = await db
      .from('ticks')
      .select('*')
      .eq('round_id', roundId)
      .order('tick_number', { ascending: true });

    if (error) {
      logger.error('Failed to fetch ticks:', error);
      return [];
    }

    return data || [];
  }

  async getAgentTicksByRound(agentId: string, roundId: string): Promise<TickMetadata[]> {
    const db = getDatabase();

    const { data, error } = await db
      .from('ticks')
      .select('*')
      .eq('round_id', roundId)
      .eq('agent_id', agentId)
      .order('tick_number', { ascending: true });

    if (error) {
      logger.error('Failed to fetch agent ticks:', error);
      return [];
    }

    return data || [];
  }

  async storeAgentTick(
    tickId: string,
    roundId: string,
    agentId: string,
    stateSnapshot: object,
    actionTaken: object,
    rawReasoning: string,
    pnlImpact: number
  ): Promise<void> {
    const db = getDatabase();

    const { error } = await db.from('agent_ticks').insert({
      round_id: roundId,
      agent_id: agentId,
      tick_timestamp: new Date().toISOString(),
      state_snapshot: stateSnapshot,
      action_taken: actionTaken,
      raw_reasoning: rawReasoning,
      pnl_impact: pnlImpact,
    });

    if (error) {
      logger.error('Failed to store agent tick:', error);
      throw error;
    }
  }

  async storeTrade(trade: TradeResult): Promise<void> {
    const db = getDatabase();

    const { error } = await db.from('trades').insert({
      id: trade.trade_id,
      agent_id: trade.agent_id,
      round_id: trade.round_id,
      tick_id: trade.tick_id,
      action: trade.action,
      asset: trade.asset,
      size_usd: trade.size_usd,
      size_asset: trade.size_asset,
      execution_price: trade.execution_price,
      slippage: trade.slippage,
      gas_used: trade.gas_used,
      tx_hash: trade.tx_hash,
      status: trade.status,
      error_message: trade.error_message,
      created_at: trade.created_at,
      confirmed_at: trade.confirmed_at,
    });

    if (error) {
      logger.error('Failed to store trade:', error);
      throw error;
    }
  }

  async getAgentPositions(agentId: string, roundId: string, currentPrice?: number): Promise<Position[]> {
    const db = getDatabase();

    const { data, error } = await db
      .from('positions')
      .select('*')
      .eq('agent_id', agentId)
      .eq('round_id', roundId);

    if (error) {
      logger.error('Failed to fetch positions:', error);
      return [];
    }

    return (data || []).map((p: any) => {
      const price = currentPrice || p.current_price;
      const unrealized = p.size * (price - p.entry_price);

      return {
        asset: p.asset,
        size: p.size,
        entry_price: p.entry_price,
        current_price: price,
        unrealized_pnl: unrealized,
      };
    });
  }

  async updatePositions(
    agentId: string,
    roundId: string,
    positions: Position[]
  ): Promise<void> {
    const db = getDatabase();

    await db
      .from('positions')
      .delete()
      .eq('agent_id', agentId)
      .eq('round_id', roundId);

    if (positions.length > 0) {
      const { error } = await db.from('positions').insert(
        positions.map((p) => ({
          agent_id: agentId,
          round_id: roundId,
          asset: p.asset,
          size: p.size,
          entry_price: p.entry_price,
          current_price: p.current_price,
          unrealized_pnl: p.unrealized_pnl,
        }))
      );

      if (error) {
        logger.error('Failed to update positions:', error);
        throw error;
      }
    }
  }

  async getTradesByRound(roundId: string): Promise<TradeResult[]> {
    const db = getDatabase();

    const { data, error } = await db
      .from('trades')
      .select('*')
      .eq('round_id', roundId)
      .order('created_at', { ascending: false });

    if (error) {
      logger.error('Failed to fetch trades:', error);
      throw error;
    }

    return data || [];
  }

  async getTradesByAgent(agentId: string): Promise<TradeResult[]> {
    const db = getDatabase();

    const { data, error } = await db
      .from('trades')
      .select('*')
      .eq('agent_id', agentId)
      .order('created_at', { ascending: false });

    if (error) {
      logger.error('Failed to fetch agent trades:', error);
      throw error;
    }

    return data || [];
  }

  async getAgentReasoning(agentId: string, roundId: string, limit: number = 20): Promise<any[]> {
    const db = getDatabase();

    const { data, error } = await db
      .from('agent_ticks')
      .select('*')
      .eq('agent_id', agentId)
      .eq('round_id', roundId)
      .order('tick_timestamp', { ascending: false })
      .limit(limit);

    if (error) {
      logger.error('Failed to fetch agent reasoning:', error);
      return [];
    }

    return (data || []).map((tick: any) => {
      const actionObj = tick.action_taken || {};
      return {
        agent_id: tick.agent_id,
        timestamp: tick.tick_timestamp,
        action: actionObj.action || 'HOLD',
        reasoning: tick.raw_reasoning || actionObj.reasoning || '',
        asset: actionObj.asset,
        size_usd: actionObj.size_usd,
        pnl_impact: tick.pnl_impact,
      };
    });
  }

  async getAgentPerformanceHistory(agentId: string, roundId: string, initialBalance: number): Promise<any[]> {
    const db = getDatabase();

    const { data, error } = await db
      .from('agent_ticks')
      .select('*')
      .eq('agent_id', agentId)
      .eq('round_id', roundId)
      .order('tick_timestamp', { ascending: true });

    if (error) {
      logger.error('Failed to fetch agent performance history:', error);
      return [];
    }

    let cumulativePnl = 0;
    return (data || []).map((tick: any, index: number) => {
      const pnlImpact = tick.pnl_impact || 0;
      cumulativePnl += pnlImpact;
      const stateSnapshot = tick.state_snapshot || {};
      const actionTaken = tick.action_taken || {};

      return {
        tick_number: index + 1,
        timestamp: tick.tick_timestamp,
        realized_pnl: cumulativePnl,
        pnl_impact: pnlImpact,
        balance: stateSnapshot.balance || initialBalance + cumulativePnl,
        portfolio_value: stateSnapshot.balance || initialBalance + cumulativePnl,
        action: actionTaken.action || 'HOLD',
        asset: actionTaken.asset,
        size_usd: actionTaken.size_usd,
      };
    });
  }
}

export const tickRepository = new TickRepository();
