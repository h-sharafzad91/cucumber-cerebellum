import { FastifyInstance } from 'fastify';
import { roundRepository } from '../../repositories/round.repository.js';
import { agentRepository } from '../../repositories/agent.repository.js';
import { tickScheduler } from '../../services/tick-scheduler.js';
import { cortexClient } from '../../services/cortex-client.js';
import { settlementEngine } from '../../services/settlement-engine.js';
import { prizePoolCalculator } from '../../services/prize-pool-calculator.js';
import { payoutRepository } from '../../repositories/payout.repository.js';
import { ValidationError } from '../../utils/errors.js';

interface CreateRoundBody {
  name?: string;
  settings?: {
    max_agents?: number;
    allowed_assets?: string[];
    max_order_usd?: number;
    initial_balance?: number;
  };
  arena_type?: 'tournament' | 'contest';
  trading_pair?: string;
  prize_pool_seed?: number;
  buy_in_fee?: number;
  protocol_fee_percent?: number;
  agent_limit?: number;
  winner_count?: number;
  payout_structure?: Record<string, number>;
  banner_url?: string;
  scheduled_start_time?: string;
  duration?: number;
  duration_unit?: 'hours' | 'days';
  min_tick_interval: number;
  max_tick_interval: number;
}

interface JoinRoundBody {
  agent_id: string;
}

export async function roundRoutes(fastify: FastifyInstance) {
  fastify.get('/', async () => {
    const rounds = await roundRepository.findAll();
    return { rounds };
  });

  fastify.get('/active', async () => {
    const round = await roundRepository.findActive();
    return { round };
  });

  fastify.get('/active-all', async () => {
    const rounds = await roundRepository.findAllActive();
    return { rounds };
  });

  fastify.get<{ Params: { id: string } }>('/:id', async (request) => {
    const { id } = request.params;
    const round = await roundRepository.findById(id);
    return { round };
  });

  fastify.post<{ Body: CreateRoundBody }>('/', async (request, reply) => {
    const {
      name,
      settings,
      arena_type,
      trading_pair,
      prize_pool_seed,
      buy_in_fee,
      protocol_fee_percent,
      agent_limit,
      winner_count,
      payout_structure,
      banner_url,
      scheduled_start_time,
      duration,
      duration_unit,
      min_tick_interval,
      max_tick_interval,
    } = request.body;

    if (!min_tick_interval || !max_tick_interval) {
      throw new ValidationError('min_tick_interval and max_tick_interval are required');
    }

    if (min_tick_interval > max_tick_interval) {
      throw new ValidationError('min_tick_interval must be less than or equal to max_tick_interval');
    }

    if (payout_structure) {
      const isValid = prizePoolCalculator.validatePayoutStructure(payout_structure);
      if (!isValid) {
        throw new ValidationError('Payout structure must contain valid percentages that sum to 100%');
      }
    }

    if (winner_count && payout_structure) {
      const rankCount = Object.keys(payout_structure).length;
      if (rankCount !== winner_count) {
        throw new ValidationError('Payout structure must define percentages for all winner ranks');
      }
    }

    let end_time: string | undefined;
    if (scheduled_start_time && duration && duration_unit) {
      const startDate = new Date(scheduled_start_time);
      const endDate = new Date(startDate);

      if (duration_unit === 'hours') {
        endDate.setHours(endDate.getHours() + duration);
      } else if (duration_unit === 'days') {
        endDate.setDate(endDate.getDate() + duration);
      }

      end_time = endDate.toISOString();
    }

    const round = await roundRepository.create({
      name,
      settings,
      arena_type,
      trading_pair,
      prize_pool_seed,
      buy_in_fee,
      protocol_fee_percent,
      agent_limit,
      winner_count,
      payout_structure,
      banner_url,
      scheduled_start_time,
      end_time,
      min_tick_interval,
      max_tick_interval,
    });

    reply.status(201);
    return { round };
  });

  fastify.post<{ Params: { id: string } }>('/:id/start', async (request) => {
    const { id } = request.params;

    const round = await roundRepository.start(id);

    const participants = await roundRepository.getParticipants(id);
    const agentIds = participants.map((p) => p.agent_id);

    try {
      await cortexClient.subscribeToRound(id, agentIds);
      fastify.log.info(`Subscribed ${agentIds.length} agents to Cortex`);
    } catch (err) {
      fastify.log.warn({ err }, 'Failed to subscribe to Cortex');
    }

    await tickScheduler.startRound(id);

    return { round };
  });

  fastify.post<{ Params: { id: string } }>('/:id/resume', async (request) => {
    const { id } = request.params;

    const round = await roundRepository.findById(id);
    if (round.status !== 'active') {
      throw new ValidationError('Only active rounds can be resumed');
    }

    const participants = await roundRepository.getParticipants(id);
    const agentIds = participants.map((p) => p.agent_id);

    try {
      await cortexClient.subscribeToRound(id, agentIds);
      fastify.log.info(`Subscribed ${agentIds.length} agents to Cortex`);
    } catch (err) {
      fastify.log.warn({ err }, 'Failed to subscribe to Cortex');
    }

    await tickScheduler.startRound(id);

    return { round, resumed: true };
  });

  fastify.post<{ Params: { id: string } }>('/:id/pause', async (request) => {
    const { id } = request.params;

    const round = await roundRepository.findById(id);
    if (round.status !== 'active') {
      throw new ValidationError('Only active rounds can be paused');
    }

    tickScheduler.stopRound(id);

    fastify.log.info(`Auto-trading paused for round ${id}`);

    return { round, paused: true };
  });

  fastify.post<{ Params: { id: string } }>('/:id/stop', async (request) => {
    const { id } = request.params;

    const round = await roundRepository.stop(id);

    tickScheduler.stopRound(id);

    cortexClient.unsubscribe().catch((err) => {
      fastify.log.warn({ err }, 'Failed to unsubscribe from Cortex (non-blocking)');
    });

    return { round };
  });

  fastify.post<{ Params: { id: string }; Body: JoinRoundBody }>('/:id/join', async (request, reply) => {
    const { id } = request.params;
    const { agent_id } = request.body;

    if (!agent_id) {
      throw new ValidationError('agent_id is required');
    }

    const round = await roundRepository.findById(id);
    const agent = await agentRepository.findById(agent_id);

    if (round.agent_limit && round.current_participants && round.current_participants >= round.agent_limit) {
      throw new ValidationError('Arena is full');
    }

    const participant = await roundRepository.addParticipant(id, agent_id, agent);

    await roundRepository.incrementParticipants(id);

    const updatedRound = await roundRepository.findById(id);
    const poolInfo = prizePoolCalculator.calculateDynamicPool(
      updatedRound.prize_pool_seed || 0,
      updatedRound.current_participants || 0,
      updatedRound.buy_in_fee || 0,
      updatedRound.protocol_fee_percent || 15
    );
    await roundRepository.updatePoolSize(id, poolInfo.totalPrizePool);

    if (updatedRound?.status === 'active') {
      const participants = await roundRepository.getParticipants(id);
      const agentIds = participants.map((p) => p.agent_id);
      cortexClient.subscribeToRound(id, agentIds).catch((err) => {
        fastify.log.warn({ err }, 'Failed to subscribe agent to Cortex (non-blocking)');
      });

      if (agent.tick_interval) {
        await tickScheduler.addAgentToActiveRound(id, agent_id, agent.tick_interval);
      }
    }

    reply.status(201);
    return { participant, current_pool_size: poolInfo.totalPrizePool };
  });

  fastify.get<{ Params: { id: string } }>('/:id/participants', async (request) => {
    const { id } = request.params;
    const participants = await roundRepository.getParticipants(id, true);
    return { participants };
  });

  fastify.get<{ Params: { id: string } }>('/:id/scheduler-status', async (request) => {
    const { id } = request.params;
    const round = await roundRepository.findById(id);
    const isSchedulerRunning = tickScheduler.isRoundRunning(id);

    return {
      round_id: id,
      round_status: round.status,
      scheduler_running: isSchedulerRunning,
      min_tick_interval: round.min_tick_interval,
      max_tick_interval: round.max_tick_interval,
    };
  });

  fastify.get<{ Params: { id: string } }>('/:id/pool-info', async (request) => {
    const { id } = request.params;
    const round = await roundRepository.findById(id);

    const poolInfo = prizePoolCalculator.calculateDynamicPool(
      round.prize_pool_seed || 0,
      round.current_participants || 0,
      round.buy_in_fee || 0,
      round.protocol_fee_percent || 15
    );

    return {
      round_id: id,
      seed_amount: poolInfo.seedAmount,
      buy_in_contribution: poolInfo.buyInContribution,
      protocol_revenue: poolInfo.protocolRevenue,
      total_prize_pool: poolInfo.totalPrizePool,
      current_participants: round.current_participants || 0,
      agent_limit: round.agent_limit,
      payout_structure: round.payout_structure,
    };
  });

  fastify.post<{ Params: { id: string } }>('/:id/settle', async (request) => {
    const { id } = request.params;

    const round = await roundRepository.findById(id);

    if (round.status !== 'active' && round.status !== 'settling') {
      throw new ValidationError('Only active or settling rounds can be settled');
    }

    tickScheduler.stopRound(id);

    const result = await settlementEngine.settleArena(id);

    return { settlement: result };
  });

  fastify.get<{ Params: { id: string } }>('/:id/payouts', async (request) => {
    const { id } = request.params;
    const payouts = await payoutRepository.getArenaPayouts(id);
    return { payouts };
  });

  fastify.post<{ Params: { id: string }; Querystring: { agent_id?: string } }>('/:id/trigger-tick', async (request) => {
    const { id } = request.params;
    const { agent_id } = request.query;

    const round = await roundRepository.findById(id);

    if (round.status !== 'active') {
      throw new ValidationError('Only active rounds can have ticks triggered');
    }

    if (!tickScheduler.isRoundRunning(id)) {
      throw new ValidationError('Tick scheduler is not running for this round');
    }

    if (agent_id) {
      await tickScheduler.triggerAgentTick(id, agent_id);
      return { message: `Tick triggered for agent ${agent_id}` };
    }

    throw new ValidationError('agent_id query parameter is required');
  });

  fastify.delete<{ Params: { id: string } }>('/:id', async (request, reply) => {
    const { id } = request.params;

    const round = await roundRepository.findById(id);

    if (round.status === 'active') {
      tickScheduler.stopRound(id);
      cortexClient.unsubscribe().catch(() => {});
    }

    await roundRepository.delete(id);

    reply.status(204);
    return;
  });
}
