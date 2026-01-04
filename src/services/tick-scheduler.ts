import { v4 as uuidv4 } from 'uuid';
import { config } from '../config/index.js';
import { publishAgentTick } from '../config/redis.js';
import { marketDataService } from './market-data.js';
import { roundRepository } from '../repositories/round.repository.js';
import { tickRepository } from '../repositories/tick.repository.js';
import { riskMonitor } from './risk-monitor.js';
import { broadcastTick, broadcastLeaderboard } from '../api/websocket.js';
import { logger } from '../utils/logger.js';
import { ticksProcessed, tickLatency, activeParticipants } from './metrics.js';
import type { TickPayload, Portfolio } from '../types/tick.js';

interface AgentTimer {
  agentId: string;
  roundId: string;
  intervalMs: number;
  timerId: NodeJS.Timeout | null;
  tickNumber: number;
  isActive: boolean;
}

export class TickScheduler {
  private agentTimers: Map<string, Map<string, AgentTimer>> = new Map();
  private roundActive: Map<string, boolean> = new Map();

  async startRound(roundId: string): Promise<void> {
    if (this.roundActive.get(roundId)) {
      logger.warn(`Tick scheduler already running for round ${roundId}`);
      return;
    }

    this.roundActive.set(roundId, true);
    this.agentTimers.set(roundId, new Map());

    const participants = await roundRepository.getParticipants(roundId);

    for (const participant of participants) {
      if (participant.effective_tick_interval) {
        await this.startAgentTimer(roundId, participant.agent_id, participant.effective_tick_interval);
      }
    }

    logger.info(`Tick scheduler started for round ${roundId} with ${participants.length} agents`);
  }

  async startAgentTimer(roundId: string, agentId: string, tickIntervalSeconds: number): Promise<void> {
    const roundTimers = this.agentTimers.get(roundId);
    if (!roundTimers) {
      logger.error(`Cannot start agent timer - round ${roundId} not active`);
      return;
    }

    if (roundTimers.has(agentId)) {
      logger.warn(`Timer already exists for agent ${agentId} in round ${roundId}`);
      return;
    }

    const intervalMs = tickIntervalSeconds * 1000;

    const agentTimer: AgentTimer = {
      agentId,
      roundId,
      intervalMs,
      timerId: null,
      tickNumber: 0,
      isActive: true,
    };

    agentTimer.timerId = setInterval(() => {
      this.tickAgent(roundId, agentId).catch((error) => {
        logger.error({ agentId, error }, 'Tick error for agent');
      });
    }, intervalMs);

    roundTimers.set(agentId, agentTimer);

    const existingTicks = await tickRepository.getAgentTicksByRound(agentId, roundId);
    if (existingTicks.length === 0) {
      this.tickAgent(roundId, agentId).catch((error) => {
        logger.error({ agentId, error }, 'Initial tick error for agent');
      });
    }

    logger.info(`Started timer for agent ${agentId} with interval ${tickIntervalSeconds}s`);
  }

  stopAgentTimer(roundId: string, agentId: string): void {
    const roundTimers = this.agentTimers.get(roundId);
    if (!roundTimers) return;

    const timer = roundTimers.get(agentId);
    if (timer?.timerId) {
      clearInterval(timer.timerId);
      timer.isActive = false;
      roundTimers.delete(agentId);
      logger.info(`Stopped timer for agent ${agentId} in round ${roundId}`);
    }
  }

  stopRound(roundId: string): void {
    const roundTimers = this.agentTimers.get(roundId);
    if (!roundTimers) return;

    for (const [, timer] of roundTimers) {
      if (timer.timerId) {
        clearInterval(timer.timerId);
      }
    }

    roundTimers.clear();
    this.agentTimers.delete(roundId);
    this.roundActive.set(roundId, false);

    logger.info(`All timers stopped for round ${roundId}`);
  }

  private async tickAgent(roundId: string, agentId: string): Promise<void> {
    const roundTimers = this.agentTimers.get(roundId);
    if (!roundTimers || !this.roundActive.get(roundId)) {
      return;
    }

    const agentTimer = roundTimers.get(agentId);
    if (!agentTimer || !agentTimer.isActive) {
      return;
    }

    const startTime = Date.now();
    agentTimer.tickNumber++;
    const tickId = uuidv4();
    const timestamp = new Date().toISOString();

    logger.info(`Tick #${agentTimer.tickNumber} for agent ${agentId} in round ${roundId}`);

    try {
      const market = await marketDataService.getSnapshot();
      const participant = await roundRepository.getParticipantByAgent(roundId, agentId);

      if (!participant) {
        logger.warn(`Agent ${agentId} no longer in round ${roundId}, stopping timer`);
        this.stopAgentTimer(roundId, agentId);
        return;
      }

      const currentPrices: Record<string, number> = {
        ETH_USDC: market.ETH_USDC.price,
      };

      const currentPrice = market.ETH_USDC.price;
      const positions = await tickRepository.getAgentPositions(agentId, roundId, currentPrice);

      const riskCheck = await riskMonitor.checkPositionRisks(agentId, roundId, positions, currentPrices);

      if (riskCheck.actions.length > 0) {
        await riskMonitor.executeRiskActions(agentId, roundId, tickId, riskCheck.actions);
      }

      const updatedPositions = await tickRepository.getAgentPositions(agentId, roundId, currentPrice);
      const updatedParticipant = await roundRepository.getParticipantByAgent(roundId, agentId);

      const portfolio: Portfolio = {
        balance_usd: updatedParticipant?.current_balance || participant.current_balance,
        positions: updatedPositions,
      };

      const tickPayload: TickPayload = {
        tick_id: tickId,
        round_id: roundId,
        agent_id: agentId,
        tick_number: agentTimer.tickNumber,
        timestamp,
        market,
        portfolio,
        constraints: {
          max_usd_order: config.arena.maxOrderUsd,
          allowed_assets: [...config.arena.allowedAssets],
        },
      };

      await publishAgentTick(roundId, agentId, tickPayload);

      await tickRepository.storeTick({
        id: tickId,
        round_id: roundId,
        agent_id: agentId,
        tick_number: agentTimer.tickNumber,
        timestamp,
        market_snapshot: market,
      });

      broadcastTick(roundId, {
        round_id: roundId,
        agent_id: agentId,
        tick_number: agentTimer.tickNumber,
        timestamp,
        market_price: market.ETH_USDC.price,
      });

      const leaderboard = await roundRepository.getLeaderboard(roundId);
      broadcastLeaderboard(roundId, leaderboard);

      ticksProcessed.inc({ round_id: roundId });
      tickLatency.observe((Date.now() - startTime) / 1000);

      const participants = await roundRepository.getParticipants(roundId);
      activeParticipants.set(participants.length);

      logger.info({ tick: agentTimer.tickNumber, agentId }, 'Agent tick completed');
    } catch (error) {
      logger.error({ tick: agentTimer.tickNumber, agentId, error }, 'Agent tick failed');
    }
  }

  async addAgentToActiveRound(roundId: string, agentId: string, tickInterval: number): Promise<void> {
    if (!this.roundActive.get(roundId)) {
      logger.info(`Round ${roundId} not active, skipping timer start for agent ${agentId}`);
      return;
    }

    await this.startAgentTimer(roundId, agentId, tickInterval);
  }

  async triggerAgentTick(roundId: string, agentId: string): Promise<void> {
    return this.tickAgent(roundId, agentId);
  }

  isRoundRunning(roundId: string): boolean {
    return this.roundActive.get(roundId) || false;
  }

  getTimerInfo(roundId: string): Map<string, AgentTimer> | undefined {
    return this.agentTimers.get(roundId);
  }

  // Backward compatibility methods
  async start(roundId: string): Promise<void> {
    return this.startRound(roundId);
  }

  stop(): void {
    // Stop all active rounds
    for (const roundId of this.roundActive.keys()) {
      this.stopRound(roundId);
    }
  }

  isRunning(): boolean {
    // Check if any round is running
    for (const isActive of this.roundActive.values()) {
      if (isActive) return true;
    }
    return false;
  }

  async triggerTick(): Promise<void> {
    // Trigger ticks for all agents in all active rounds
    for (const [roundId, isActive] of this.roundActive.entries()) {
      if (!isActive) continue;
      const roundTimers = this.agentTimers.get(roundId);
      if (!roundTimers) continue;
      for (const agentId of roundTimers.keys()) {
        await this.tickAgent(roundId, agentId);
      }
    }
  }
}

export const tickScheduler = new TickScheduler();
