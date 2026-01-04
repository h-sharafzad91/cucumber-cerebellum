import { getDatabase } from '../config/database.js';
import { logger } from '../utils/logger.js';
import { NotFoundError, ValidationError } from '../utils/errors.js';
import { prizePoolCalculator } from './prize-pool-calculator.js';
import type { ArenaRound } from '../types/round.js';

interface RankedAgent {
  agentId: string;
  userId: string | null;
  agentName: string;
  rank: number;
  finalPnl: number;
  finalBalance: number;
  totalTrades: number;
}

interface SettlementResult {
  roundId: string;
  status: 'settled' | 'failed';
  totalPrizePool: number;
  winnerCount: number;
  payouts: Array<{
    rank: number;
    agentId: string;
    amount: number;
    percentage: number;
  }>;
  protocolRevenue: number;
  settledAt: Date;
  error?: string;
}

export class SettlementEngine {
  async freezeArenaTrading(roundId: string): Promise<void> {
    const db = getDatabase();

    const { data: round, error: roundError } = await db
      .from('arena_rounds')
      .select('*')
      .eq('id', roundId)
      .single();

    if (roundError || !round) {
      throw new NotFoundError('Round');
    }

    if (round.status !== 'active') {
      throw new ValidationError('Only active rounds can be frozen');
    }

    const { error } = await db
      .from('arena_rounds')
      .update({ status: 'settling' })
      .eq('id', roundId);

    if (error) {
      logger.error({ roundId, error }, 'Failed to freeze arena');
      throw error;
    }

    logger.info({ roundId }, 'Arena frozen for settlement');
  }

  async calculateFinalRankings(roundId: string): Promise<RankedAgent[]> {
    const db = getDatabase();

    const { data: participants, error } = await db
      .from('round_participants')
      .select(
        `
        agent_id,
        agents!inner(name, user_id),
        current_balance,
        total_pnl,
        total_trades
      `
      )
      .eq('round_id', roundId)
      .order('total_pnl', { ascending: false });

    if (error) {
      logger.error({ roundId, error }, 'Failed to fetch participants for ranking');
      throw error;
    }

    if (!participants || participants.length === 0) {
      logger.warn({ roundId }, 'No participants found for settlement');
      return [];
    }

    const rankings: RankedAgent[] = participants.map((p: any, index: number) => ({
      agentId: p.agent_id,
      userId: p.agents.user_id,
      agentName: p.agents.name,
      rank: index + 1,
      finalPnl: parseFloat(p.total_pnl),
      finalBalance: parseFloat(p.current_balance),
      totalTrades: p.total_trades,
    }));

    logger.info({
      roundId,
      participantCount: rankings.length,
      winner: rankings[0]?.agentName,
    }, 'Rankings calculated');

    return rankings;
  }

  async markAllPositionsToMarket(roundId: string): Promise<void> {
    const db = getDatabase();

    const { data: openPositions, error: fetchError } = await db
      .from('positions')
      .select('*')
      .eq('round_id', roundId);

    if (fetchError) {
      logger.error({ roundId, error: fetchError }, 'Failed to fetch open positions');
      throw fetchError;
    }

    if (!openPositions || openPositions.length === 0) {
      logger.info({ roundId }, 'No open positions to close');
      return;
    }

    logger.info({
      roundId,
      positionCount: openPositions.length,
    }, 'Closing all open positions');

    const { error: deleteError } = await db
      .from('positions')
      .delete()
      .eq('round_id', roundId);

    if (deleteError) {
      logger.error({ roundId, error: deleteError }, 'Failed to close positions');
      throw deleteError;
    }

    logger.info({ roundId }, 'All positions marked to market');
  }

  async distributePrizes(
    roundId: string,
    rankings: RankedAgent[],
    round: ArenaRound
  ): Promise<SettlementResult['payouts']> {
    const db = getDatabase();

    const poolInfo = prizePoolCalculator.calculateDynamicPool(
      round.prize_pool_seed || 0,
      round.current_participants || 0,
      round.buy_in_fee || 0,
      round.protocol_fee_percent || 15
    );

    const winnerCount = Math.min(round.winner_count || 3, rankings.length);
    const winners = rankings.slice(0, winnerCount).map((r) => ({
      rank: r.rank,
      agentId: r.agentId,
    }));

    const payoutStructure = round.payout_structure || { 1: 50, 2: 30, 3: 20 };

    const payouts = prizePoolCalculator.calculatePayouts(
      poolInfo.totalPrizePool,
      payoutStructure,
      winners
    );

    const payoutRecords = payouts.map((payout) => {
      const rankedAgent = rankings.find((r) => r.agentId === payout.agentId);
      return {
        round_id: roundId,
        agent_id: payout.agentId,
        user_id: rankedAgent?.userId,
        rank: payout.rank,
        prize_amount: payout.amount,
        payout_percent: payout.percentage,
        payment_status: 'completed',
        payment_method: 'internal',
        paid_at: new Date().toISOString(),
      };
    });

    const { error: payoutError } = await db
      .from('arena_payouts')
      .insert(payoutRecords);

    if (payoutError) {
      logger.error({ roundId, error: payoutError }, 'Failed to record payouts');
      throw payoutError;
    }

    logger.info({
      roundId,
      totalPool: poolInfo.totalPrizePool,
      winnerCount: payouts.length,
    }, 'Prizes distributed');

    return payouts;
  }

  async settleArena(roundId: string): Promise<SettlementResult> {
    try {
      logger.info({ roundId }, 'Starting arena settlement');

      await this.freezeArenaTrading(roundId);

      const db = getDatabase();
      const { data: round, error: roundError } = await db
        .from('arena_rounds')
        .select('*')
        .eq('id', roundId)
        .single();

      if (roundError || !round) {
        throw new NotFoundError('Round');
      }

      await this.markAllPositionsToMarket(roundId);

      const rankings = await this.calculateFinalRankings(roundId);

      if (rankings.length === 0) {
        await db
          .from('arena_rounds')
          .update({ status: 'completed', end_time: new Date().toISOString() })
          .eq('id', roundId);

        return {
          roundId,
          status: 'settled',
          totalPrizePool: 0,
          winnerCount: 0,
          payouts: [],
          protocolRevenue: 0,
          settledAt: new Date(),
        };
      }

      const payouts = await this.distributePrizes(roundId, rankings, round);

      const poolInfo = prizePoolCalculator.calculateDynamicPool(
        round.prize_pool_seed || 0,
        round.current_participants || 0,
        round.buy_in_fee || 0,
        round.protocol_fee_percent || 15
      );

      const { error: completeError } = await db
        .from('arena_rounds')
        .update({
          status: 'completed',
          end_time: new Date().toISOString(),
        })
        .eq('id', roundId);

      if (completeError) {
        logger.error({ roundId, error: completeError }, 'Failed to mark arena as completed');
        throw completeError;
      }

      logger.info({
        roundId,
        totalPrizePool: poolInfo.totalPrizePool,
        winnerCount: payouts.length,
      }, 'Arena settlement completed');

      return {
        roundId,
        status: 'settled',
        totalPrizePool: poolInfo.totalPrizePool,
        winnerCount: payouts.length,
        payouts,
        protocolRevenue: poolInfo.protocolRevenue,
        settledAt: new Date(),
      };
    } catch (error) {
      logger.error({ roundId, error }, 'Settlement failed');

      const db = getDatabase();
      await db
        .from('arena_rounds')
        .update({ status: 'failed' })
        .eq('id', roundId);

      return {
        roundId,
        status: 'failed',
        totalPrizePool: 0,
        winnerCount: 0,
        payouts: [],
        protocolRevenue: 0,
        settledAt: new Date(),
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  async findScheduledRoundsForSettlement(): Promise<ArenaRound[]> {
    const db = getDatabase();
    const now = new Date();

    const { data: rounds, error } = await db
      .from('arena_rounds')
      .select('*')
      .eq('status', 'active')
      .lte('end_time', now.toISOString());

    if (error) {
      logger.error({ error }, 'Failed to find scheduled rounds for settlement');
      return [];
    }

    return rounds || [];
  }
}

export const settlementEngine = new SettlementEngine();
