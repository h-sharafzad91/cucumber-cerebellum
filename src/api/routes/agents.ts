import { FastifyInstance } from 'fastify';
import { agentRepository } from '../../repositories/agent.repository.js';
import { tickRepository } from '../../repositories/tick.repository.js';
import { roundRepository } from '../../repositories/round.repository.js';
import { getDatabase } from '../../config/database.js';
import { ValidationError } from '../../utils/errors.js';
import type { LLMModel, LLMProvider } from '../../types/agent.js';

type TradingStyle = 'paper_hands' | 'normal' | 'degen';

interface CreateAgentBody {
  name: string;
  user_id?: string;
  persona_config: {
    strategy: 'momentum' | 'mean_reversion' | 'breakout' | 'custom';
    risk_tolerance: 'conservative' | 'moderate' | 'aggressive';
    goal?: string;
    description?: string;
  };
  worker_config?: {
    provider?: LLMProvider;
    model?: string;
    temperature?: number;
    max_tokens?: number;
  };
  tick_interval?: number;
  leverage?: number;
  stop_loss_percent?: number;
  stop_loss_position_close_percent?: number;
  take_profit_percent?: number;
  take_profit_position_close_percent?: number;
  risk_reward_ratio?: number;
  avatar_id?: string;
  llm_model?: LLMModel;
  trading_style?: TradingStyle;
}

interface UpdateAgentBody {
  name?: string;
  persona_config?: object;
  worker_config?: object;
  tick_interval?: number;
  leverage?: number;
  stop_loss_percent?: number;
  stop_loss_position_close_percent?: number;
  take_profit_percent?: number;
  take_profit_position_close_percent?: number;
  trading_style?: TradingStyle;
}

interface StrategySummaryBody {
  name: string;
  strategy: string;
  risk_tolerance: string;
  trading_style: string;
  leverage: number;
  stop_loss_percent: number;
  take_profit_percent: number;
  goal?: string;
}

export async function agentRoutes(fastify: FastifyInstance) {
  fastify.post<{ Body: StrategySummaryBody }>('/summarize-strategy', async (request) => {
    const { name, strategy, risk_tolerance, trading_style, leverage, stop_loss_percent, take_profit_percent, goal } = request.body;

    const riskLevel = leverage > 20 ? 'high' : leverage > 5 ? 'moderate' : 'low';
    const rrRatio = take_profit_percent / stop_loss_percent;

    const summary = [
      `${name} uses a ${strategy.replace('_', ' ')} strategy with ${risk_tolerance} risk tolerance`,
      `Leverage set to ${leverage}x (${riskLevel} risk), Stop-loss at ${stop_loss_percent}%, Take-profit at ${take_profit_percent}%`,
      `Risk/Reward ratio: ${rrRatio.toFixed(2)}:1 - ${rrRatio >= 2 ? 'Good setup' : rrRatio >= 1 ? 'Balanced' : 'Conservative'}`,
      trading_style === 'degen' ? 'Aggressive trading style - expects high volatility plays' :
        trading_style === 'paper_hands' ? 'Quick exit strategy - will close positions early on signals' :
        'Standard trading approach - balanced entry and exit timing',
      goal ? `Primary goal: ${goal}` : 'Objective: Maximize returns within risk parameters',
    ];

    return { summary };
  });

  fastify.get<{ Querystring: { user_id?: string } }>('/', async (request) => {
    const { user_id } = request.query;

    const agents = user_id
      ? await agentRepository.findByUserId(user_id)
      : await agentRepository.findAll();

    return { agents };
  });

  fastify.get<{ Params: { id: string } }>('/:id', async (request) => {
    const { id } = request.params;
    const agent = await agentRepository.findById(id);
    return { agent };
  });

  fastify.post<{ Body: CreateAgentBody }>('/', async (request, reply) => {
    const {
      name,
      user_id,
      persona_config,
      worker_config,
      tick_interval,
      leverage,
      stop_loss_percent,
      stop_loss_position_close_percent,
      take_profit_percent,
      take_profit_position_close_percent,
      risk_reward_ratio,
      avatar_id,
      llm_model,
      trading_style,
    } = request.body;

    if (!name || !persona_config) {
      throw new ValidationError('name and persona_config are required');
    }

    if (leverage && (leverage < 1 || leverage > 50)) {
      throw new ValidationError('leverage must be between 1 and 50');
    }

    if (stop_loss_percent && (stop_loss_percent < 0 || stop_loss_percent > 100)) {
      throw new ValidationError('stop_loss_percent must be between 0 and 100');
    }

    if (take_profit_percent && take_profit_percent < 0) {
      throw new ValidationError('take_profit_percent must be positive');
    }

    if (stop_loss_position_close_percent && (stop_loss_position_close_percent <= 0 || stop_loss_position_close_percent > 100)) {
      throw new ValidationError('stop_loss_position_close_percent must be between 1 and 100');
    }

    if (take_profit_position_close_percent && (take_profit_position_close_percent <= 0 || take_profit_position_close_percent > 100)) {
      throw new ValidationError('take_profit_position_close_percent must be between 1 and 100');
    }

    const agent = await agentRepository.create({
      name,
      user_id,
      persona_config,
      worker_config,
      tick_interval,
      leverage,
      stop_loss_percent,
      stop_loss_position_close_percent,
      take_profit_percent,
      take_profit_position_close_percent,
      risk_reward_ratio,
      avatar_id,
      llm_model,
      trading_style,
    });

    reply.status(201);
    return { agent };
  });

  fastify.put<{ Params: { id: string }; Body: UpdateAgentBody }>('/:id', async (request) => {
    const { id } = request.params;
    const updates = request.body;

    const agent = await agentRepository.update(id, updates);
    return { agent };
  });

  fastify.delete<{ Params: { id: string } }>('/:id', async (request, reply) => {
    const { id } = request.params;
    await agentRepository.delete(id);
    reply.status(204);
  });

  fastify.get<{ Params: { id: string; roundId: string }; Querystring: { limit?: string } }>(
    '/:id/reasoning/:roundId',
    async (request) => {
      const { id, roundId } = request.params;
      const limit = parseInt(request.query.limit || '20', 10);
      const reasoning = await tickRepository.getAgentReasoning(id, roundId, limit);
      return { reasoning };
    }
  );

  fastify.get<{ Params: { id: string } }>('/:id/active-round', async (request) => {
    const { id } = request.params;
    const db = getDatabase();

    const { data: participation, error } = await db
      .from('round_participants')
      .select(`
        round_id,
        current_balance,
        total_pnl,
        total_trades,
        arena_rounds!inner(
          id,
          name,
          status,
          start_time,
          end_time
        )
      `)
      .eq('agent_id', id)
      .in('arena_rounds.status', ['active', 'pending'])
      .single();

    if (error || !participation) {
      return {
        is_in_arena: false,
        round_id: null,
        round_name: null,
        round_status: null,
        current_rank: null,
        current_pnl: null,
        current_balance: null,
        total_trades: null,
        time_remaining: null,
        start_time: null,
        end_time: null,
      };
    }

    const round = participation.arena_rounds as any;

    let currentRank = null;
    try {
      const leaderboard = await roundRepository.getLeaderboard(round.id);
      const agentEntry = leaderboard.find((e) => e.agent_id === id);
      currentRank = agentEntry?.rank || null;
    } catch {
    }

    return {
      is_in_arena: true,
      round_id: round.id,
      round_name: round.name,
      round_status: round.status,
      current_rank: currentRank,
      current_pnl: participation.total_pnl,
      current_balance: participation.current_balance,
      total_trades: participation.total_trades,
      time_remaining: null,
      start_time: round.start_time,
      end_time: round.end_time,
    };
  });

  fastify.get<{ Params: { id: string }; Querystring: { page?: string; limit?: string } }>(
    '/:id/trades',
    async (request) => {
      const { id } = request.params;
      const page = parseInt(request.query.page || '1', 10);
      const limit = parseInt(request.query.limit || '20', 10);
      const offset = (page - 1) * limit;
      const db = getDatabase();

      const { count } = await db
        .from('trades')
        .select('*', { count: 'exact', head: true })
        .eq('agent_id', id);

      const { data: trades, error } = await db
        .from('trades')
        .select('*')
        .eq('agent_id', id)
        .order('created_at', { ascending: false })
        .range(offset, offset + limit - 1);

      if (error) {
        return { trades: [], pagination: { page, limit, total: 0, totalPages: 0 } };
      }

      const total = count || 0;
      return {
        trades: trades || [],
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit),
        },
      };
    }
  );

  fastify.get<{ Params: { id: string } }>('/:id/battles', async (request) => {
    const { id } = request.params;
    const db = getDatabase();

    const { data: battles, error } = await db
      .from('round_participants')
      .select(`
        round_id,
        total_pnl,
        total_trades,
        initial_balance,
        current_balance,
        arena_rounds!inner(
          id,
          name,
          status,
          start_time,
          end_time,
          settings
        )
      `)
      .eq('agent_id', id)
      .eq('arena_rounds.status', 'completed')
      .order('arena_rounds(end_time)', { ascending: false });

    if (error || !battles) {
      return { battles: [] };
    }

    const battlesWithRank = await Promise.all(
      battles.map(async (battle: any) => {
        const round = battle.arena_rounds;
        let rank = 0;
        let prize = 0;

        try {
          const leaderboard = await roundRepository.getLeaderboard(round.id);
          const agentEntry = leaderboard.find((e) => e.agent_id === id);
          rank = agentEntry?.rank || 0;
        } catch {
        }

        const pnlPercent =
          battle.initial_balance > 0
            ? ((battle.current_balance - battle.initial_balance) / battle.initial_balance) * 100
            : 0;

        return {
          id: battle.round_id,
          arena_name: round.name,
          date: round.end_time || round.start_time,
          rank,
          pnl_percent: pnlPercent,
          prize,
        };
      })
    );

    return { battles: battlesWithRank };
  });

  fastify.get<{ Params: { id: string } }>('/:id/performance', async (request) => {
    const { id } = request.params;
    const db = getDatabase();

    const { data: trades } = await db
      .from('trades')
      .select('*')
      .eq('agent_id', id);

    const { data: participations } = await db
      .from('round_participants')
      .select(`
        total_pnl,
        initial_balance,
        current_balance,
        arena_rounds!inner(status)
      `)
      .eq('agent_id', id)
      .eq('arena_rounds.status', 'completed');

    const totalTrades = trades?.length || 0;
    const totalPnl = participations?.reduce((sum: number, p: any) => sum + (p.total_pnl || 0), 0) || 0;

    const winningTrades = trades?.filter((t: any) => t.status === 'confirmed').length || 0;
    const winRate = totalTrades > 0 ? (winningTrades / totalTrades) * 100 : 0;

    let battlesWon = 0;
    const totalBattles = participations?.length || 0;

    const totalWinnings = totalPnl;

    return {
      total_trades: totalTrades,
      total_pnl: totalPnl,
      win_rate: winRate,
      battles_won: battlesWon,
      total_battles: totalBattles,
      total_winnings: totalWinnings,
    };
  });
}
