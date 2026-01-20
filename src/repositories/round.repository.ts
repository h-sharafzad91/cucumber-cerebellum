import { getDatabase } from '../config/database.js';
import { logger } from '../utils/logger.js';
import { NotFoundError, ValidationError } from '../utils/errors.js';
import type {
  ArenaRound,
  RoundParticipant,
  CreateRoundInput,
  LeaderboardEntry,
  RoundSettings,
} from '../types/round.js';
import type { Agent } from '../types/agent.js';

const DEFAULT_SETTINGS: RoundSettings = {
  max_agents: 10,
  allowed_assets: ['ETH', 'USDC'],
  max_order_usd: 2000,
  initial_balance: 10000,
};

class RoundRepository {
  async findAll(): Promise<ArenaRound[]> {
    const db = getDatabase();
    const { data, error } = await db
      .from('arena_rounds')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) {
      logger.error('Failed to fetch rounds:', error);
      throw error;
    }

    return data || [];
  }

  async findById(id: string): Promise<ArenaRound> {
    const db = getDatabase();
    const { data, error } = await db
      .from('arena_rounds')
      .select('*')
      .eq('id', id)
      .single();

    if (error || !data) {
      throw new NotFoundError('Round');
    }

    return data;
  }

  async findActive(): Promise<ArenaRound | null> {
    const db = getDatabase();
    const { data, error } = await db
      .from('arena_rounds')
      .select('*')
      .eq('status', 'active')
      .order('start_time', { ascending: false })
      .limit(1);

    if (error || !data || data.length === 0) {
      return null;
    }

    return data[0];
  }

  async findAllActive(): Promise<ArenaRound[]> {
    const db = getDatabase();
    const { data, error } = await db
      .from('arena_rounds')
      .select('*')
      .eq('status', 'active')
      .order('start_time', { ascending: false });

    if (error || !data) {
      return [];
    }

    return data;
  }

  async create(input: CreateRoundInput): Promise<ArenaRound> {
    const db = getDatabase();

    const roundData = {
      name: input.name || `Round ${Date.now()}`,
      status: 'pending',
      min_tick_interval: input.min_tick_interval,
      max_tick_interval: input.max_tick_interval,
      settings: {
        ...DEFAULT_SETTINGS,
        ...input.settings,
      },
      arena_type: input.arena_type || 'tournament',
      trading_pair: input.trading_pair || 'BTC/USDT',
      prize_pool_seed: input.prize_pool_seed || 0,
      buy_in_fee: input.buy_in_fee || 0,
      protocol_fee_percent: input.protocol_fee_percent || 15,
      agent_limit: input.agent_limit || 100,
      winner_count: input.winner_count || 3,
      payout_structure: input.payout_structure || { 1: 50, 2: 30, 3: 20 },
      banner_url: input.banner_url,
      current_participants: 0,
      current_pool_size: input.prize_pool_seed || 0,
      scheduled_start_time: input.scheduled_start_time,
      end_time: input.end_time,
    };

    const { data, error } = await db
      .from('arena_rounds')
      .insert(roundData)
      .select()
      .single();

    if (error) {
      logger.error('Failed to create round:', error);
      throw error;
    }

    logger.info(`Round created: ${data.id}`);
    return data;
  }

  async start(id: string): Promise<ArenaRound> {
    const db = getDatabase();

    const round = await this.findById(id);
    if (round.status !== 'pending') {
      throw new ValidationError('Only pending rounds can be started');
    }

    const startTime = new Date();
    let endTime: string | null = null;

    if (round.settings?.duration_minutes) {
      const endDate = new Date(startTime.getTime() + round.settings.duration_minutes * 60 * 1000);
      endTime = endDate.toISOString();
    } else if (round.end_time) {
      endTime = round.end_time;
    }

    const { data, error } = await db
      .from('arena_rounds')
      .update({
        status: 'active',
        start_time: startTime.toISOString(),
        end_time: endTime,
      })
      .eq('id', id)
      .select()
      .single();

    if (error) {
      logger.error('Failed to start round:', error);
      throw error;
    }

    logger.info(`Round started: ${id}`);
    return data;
  }

  async stop(id: string): Promise<ArenaRound> {
    const db = getDatabase();

    const round = await this.findById(id);
    if (round.status !== 'active') {
      throw new ValidationError('Only active rounds can be stopped');
    }

    const { data, error } = await db
      .from('arena_rounds')
      .update({
        status: 'completed',
        end_time: new Date().toISOString(),
      })
      .eq('id', id)
      .select()
      .single();

    if (error) {
      logger.error('Failed to stop round:', error);
      throw error;
    }

    logger.info(`Round stopped: ${id}`);
    return data;
  }

  async addParticipant(roundId: string, agentId: string, agent: Agent): Promise<RoundParticipant> {
    const db = getDatabase();

    const round = await this.findById(roundId);

    if (!agent.tick_interval) {
      throw new ValidationError('Agent tick_interval is required');
    }

    if (agent.tick_interval < round.min_tick_interval) {
      throw new ValidationError(
        `Agent tick interval (${agent.tick_interval}s) is below arena minimum (${round.min_tick_interval}s)`
      );
    }

    if (agent.tick_interval > round.max_tick_interval) {
      throw new ValidationError(
        `Agent tick interval (${agent.tick_interval}s) exceeds arena maximum (${round.max_tick_interval}s)`
      );
    }

    const participantData = {
      round_id: roundId,
      agent_id: agentId,
      initial_balance: round.settings.initial_balance,
      current_balance: round.settings.initial_balance,
      total_pnl: 0,
      total_trades: 0,
      effective_tick_interval: agent.tick_interval,
    };

    const { data, error } = await db
      .from('round_participants')
      .insert(participantData)
      .select()
      .single();

    if (error) {
      logger.error('Failed to add participant:', error);
      throw error;
    }

    logger.info(`Agent ${agentId} joined round ${roundId} with tick interval ${agent.tick_interval}s`);
    return data;
  }

  async getParticipants(roundId: string, includeRealizedPnl = false): Promise<RoundParticipant[]> {
    const db = getDatabase();

    const { data, error } = await db
      .from('round_participants')
      .select(`
        *,
        agents!inner(name)
      `)
      .eq('round_id', roundId);

    if (error) {
      logger.error('Failed to fetch participants:', error);
      throw error;
    }

    const participants = (data || []).map((p: any) => ({
      ...p,
      agent_name: p.agents?.name || null,
      agents: undefined,
    }));

    if (includeRealizedPnl) {
      const { tickRepository } = await import('./tick.repository.js');
      const { marketDataService } = await import('../services/market-data.js');

      const currentPrice = await marketDataService.getCurrentPrice('ETH');

      for (const participant of participants) {
        const positions = await tickRepository.getAgentPositions(
          participant.agent_id,
          roundId,
          currentPrice
        );

        const realizedPnl = participant.total_pnl || 0;

        const unrealizedPnl = positions.reduce((sum, p) => sum + (p.unrealized_pnl || 0), 0);

        const totalPnl = realizedPnl + unrealizedPnl;

        participant.total_pnl = totalPnl;
        participant.realized_pnl = realizedPnl;
        participant.unrealized_pnl = unrealizedPnl;
      }
    }

    return participants;
  }

  async updateParticipant(
    roundId: string,
    agentId: string,
    updates: Partial<RoundParticipant>
  ): Promise<void> {
    const db = getDatabase();

    const { error } = await db
      .from('round_participants')
      .update(updates)
      .eq('round_id', roundId)
      .eq('agent_id', agentId);

    if (error) {
      logger.error('Failed to update participant:', error);
      throw error;
    }
  }

  async getParticipantByAgent(roundId: string, agentId: string): Promise<RoundParticipant | null> {
    const db = getDatabase();

    const { data, error } = await db
      .from('round_participants')
      .select('*')
      .eq('round_id', roundId)
      .eq('agent_id', agentId)
      .single();

    if (error) {
      return null;
    }

    return data;
  }

  async updateParticipantBalance(roundId: string, agentId: string, newBalance: number): Promise<void> {
    const db = getDatabase();

    const { error } = await db
      .from('round_participants')
      .update({ current_balance: newBalance })
      .eq('round_id', roundId)
      .eq('agent_id', agentId);

    if (error) {
      logger.error({ roundId, agentId, error }, 'Failed to update participant balance');
      throw error;
    }
  }

  async updateParticipantAtomic(
    roundId: string,
    agentId: string,
    newBalance: number,
    pnlDelta: number,
    tradesDelta: number
  ): Promise<void> {
    const db = getDatabase();

    const { error } = await db.rpc('update_participant_atomic', {
      p_round_id: roundId,
      p_agent_id: agentId,
      p_balance_delta: 0,
      p_pnl_delta: pnlDelta,
      p_trades_delta: tradesDelta,
      p_new_balance: newBalance,
    });

    if (error) {
      logger.error({ roundId, agentId, error }, 'Failed to update participant atomically');
      throw error;
    }
  }

  async getLeaderboard(roundId: string): Promise<LeaderboardEntry[]> {
    const db = getDatabase();

    const { data, error } = await db
      .from('round_participants')
      .select(`
        agent_id,
        agents!inner(name),
        total_pnl,
        total_trades,
        current_balance,
        effective_tick_interval
      `)
      .eq('round_id', roundId)
      .order('total_pnl', { ascending: false });

    if (error) {
      logger.error('Failed to fetch leaderboard:', error);
      throw error;
    }

    return (data || []).map((entry: any, index: number) => ({
      agent_id: entry.agent_id,
      agent_name: entry.agents.name,
      total_pnl: entry.total_pnl,
      total_trades: entry.total_trades,
      current_balance: entry.current_balance,
      effective_tick_interval: entry.effective_tick_interval,
      win_rate: 0,
      rank: index + 1,
    }));
  }

  async findScheduledRounds(): Promise<ArenaRound[]> {
    const db = getDatabase();
    const now = new Date();

    const { data, error } = await db
      .from('arena_rounds')
      .select('*')
      .eq('status', 'pending')
      .lte('scheduled_start_time', now.toISOString())
      .order('scheduled_start_time', { ascending: true });

    if (error) {
      logger.error({ error }, 'Failed to fetch scheduled rounds');
      return [];
    }

    return data || [];
  }

  async updatePoolSize(roundId: string, newSize: number): Promise<void> {
    const db = getDatabase();

    const { error } = await db
      .from('arena_rounds')
      .update({ current_pool_size: newSize })
      .eq('id', roundId);

    if (error) {
      logger.error({ roundId, error }, 'Failed to update pool size');
      throw error;
    }
  }

  async incrementParticipants(roundId: string): Promise<void> {
    const db = getDatabase();

    const round = await this.findById(roundId);
    const newCount = (round.current_participants || 0) + 1;

    const { error } = await db
      .from('arena_rounds')
      .update({ current_participants: newCount })
      .eq('id', roundId);

    if (error) {
      logger.error({ roundId, error }, 'Failed to increment participants');
      throw error;
    }

    logger.info({ roundId, count: newCount }, 'Participant count incremented');
  }

  async delete(id: string): Promise<void> {
    const db = getDatabase();

    const { error: agentTicksError } = await db.from('agent_ticks').delete().eq('round_id', id);
    if (agentTicksError) {
      logger.warn('Failed to delete agent_ticks:', agentTicksError);
    }

    const { error: tradesError } = await db.from('trades').delete().eq('round_id', id);
    if (tradesError) {
      logger.warn('Failed to delete trades:', tradesError);
    }

    const { error: positionsError } = await db.from('agent_positions').delete().eq('round_id', id);
    if (positionsError) {
      logger.warn('Failed to delete agent_positions:', positionsError);
    }

    const { error: ticksError } = await db.from('ticks').delete().eq('round_id', id);
    if (ticksError) {
      logger.warn('Failed to delete ticks:', ticksError);
    }

    const { error: participantsError } = await db.from('round_participants').delete().eq('round_id', id);
    if (participantsError) {
      logger.warn('Failed to delete round_participants:', participantsError);
    }

    const { data, error } = await db
      .from('arena_rounds')
      .delete()
      .eq('id', id)
      .select();

    if (error) {
      logger.error('Failed to delete round:', error);
      throw error;
    }

    if (!data || data.length === 0) {
      logger.error(`Round ${id} was not deleted - RLS policy may be blocking or round doesn't exist`);
      throw new Error(`Failed to delete round ${id} - deletion was blocked`);
    }

    logger.info(`Round deleted: ${id} (rows affected: ${data.length})`);
  }
}

export const roundRepository = new RoundRepository();
