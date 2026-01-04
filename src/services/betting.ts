import { getDatabase } from '../config/database.js';
import { logger } from '../utils/logger.js';

interface Bet {
  id: string;
  round_id: string;
  user_id: string;
  agent_id: string;
  amount: number;
  potential_payout: number;
  status: 'pending' | 'won' | 'lost';
  created_at: string;
}

interface BetPool {
  round_id: string;
  total_pool: number;
  agent_pools: Record<string, number>;
}

class BettingService {
  async placeBet(roundId: string, userId: string, agentId: string, amount: number): Promise<Bet> {
    const db = getDatabase();

    const odds = await this.getOdds(roundId, agentId);
    const potentialPayout = amount * odds;

    const { data: bet, error } = await db
      .from('bets')
      .insert({
        round_id: roundId,
        user_id: userId,
        agent_id: agentId,
        amount,
        potential_payout: potentialPayout,
        status: 'pending',
      })
      .select()
      .single();

    if (error) {
      logger.error({ error }, 'Failed to place bet');
      throw new Error('Failed to place bet');
    }

    logger.info({ roundId, userId, agentId, amount }, 'Bet placed');
    return bet;
  }

  async getOdds(roundId: string, agentId: string): Promise<number> {
    const pool = await this.getPool(roundId);

    if (pool.total_pool === 0) {
      return 2.0;
    }

    const agentPool = pool.agent_pools[agentId] || 0;
    if (agentPool === 0) {
      return pool.total_pool > 0 ? 10.0 : 2.0;
    }

    return pool.total_pool / agentPool;
  }

  async getAllOdds(roundId: string): Promise<Record<string, number>> {
    const db = getDatabase();

    const { data: participants } = await db
      .from('round_participants')
      .select('agent_id')
      .eq('round_id', roundId);

    if (!participants) return {};

    const odds: Record<string, number> = {};
    for (const p of participants) {
      odds[p.agent_id] = await this.getOdds(roundId, p.agent_id);
    }

    return odds;
  }

  async getPool(roundId: string): Promise<BetPool> {
    const db = getDatabase();

    const { data: bets } = await db
      .from('bets')
      .select('agent_id, amount')
      .eq('round_id', roundId)
      .eq('status', 'pending');

    const agentPools: Record<string, number> = {};
    let totalPool = 0;

    for (const bet of bets || []) {
      agentPools[bet.agent_id] = (agentPools[bet.agent_id] || 0) + bet.amount;
      totalPool += bet.amount;
    }

    return { round_id: roundId, total_pool: totalPool, agent_pools: agentPools };
  }

  async getUserBets(userId: string, roundId?: string): Promise<Bet[]> {
    const db = getDatabase();

    let query = db.from('bets').select('*').eq('user_id', userId);

    if (roundId) {
      query = query.eq('round_id', roundId);
    }

    const { data: bets } = await query.order('created_at', { ascending: false });
    return bets || [];
  }

  async settleBets(roundId: string, winnerId: string): Promise<void> {
    const db = getDatabase();

    await db
      .from('bets')
      .update({ status: 'won' })
      .eq('round_id', roundId)
      .eq('agent_id', winnerId)
      .eq('status', 'pending');

    await db
      .from('bets')
      .update({ status: 'lost' })
      .eq('round_id', roundId)
      .neq('agent_id', winnerId)
      .eq('status', 'pending');

    logger.info({ roundId, winnerId }, 'Bets settled');
  }
}

export const bettingService = new BettingService();
