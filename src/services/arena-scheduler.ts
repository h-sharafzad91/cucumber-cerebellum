import cron from 'node-cron';
import { roundRepository } from '../repositories/round.repository.js';
import { cortexClient } from './cortex-client.js';
import { tickScheduler } from './tick-scheduler.js';
import { logger } from '../utils/logger.js';

class ArenaScheduler {
  private cronJob: cron.ScheduledTask | null = null;
  private endCheckInterval: NodeJS.Timeout | null = null;

  start(): void {
    if (this.cronJob) {
      logger.warn('Arena scheduler already running');
      return;
    }

    this.cronJob = cron.schedule('* * * * *', async () => {
      await this.checkScheduledArenas();
    });

    this.endCheckInterval = setInterval(async () => {
      await this.endScheduledArenas();
    }, 10000);

    logger.info('Arena scheduler started - checking for scheduled arenas every minute, end times every 10 seconds');

    this.checkScheduledArenas().catch((error) => {
      logger.error({ error }, 'Failed to check scheduled arenas on startup');
    });
  }

  stop(): void {
    if (this.cronJob) {
      this.cronJob.stop();
      this.cronJob = null;
    }
    if (this.endCheckInterval) {
      clearInterval(this.endCheckInterval);
      this.endCheckInterval = null;
    }
    logger.info('Arena scheduler stopped');
  }

  private async checkScheduledArenas(): Promise<void> {
    try {
      await this.startScheduledArenas();

      await this.endScheduledArenas();
    } catch (error) {
      logger.error({ error }, 'Error checking scheduled arenas');
    }
  }

  private async startScheduledArenas(): Promise<void> {
    try {
      const scheduledRounds = await roundRepository.findScheduledRounds();

      if (scheduledRounds.length === 0) {
        return;
      }

      logger.info({ count: scheduledRounds.length }, 'Found arenas ready to start');

      for (const round of scheduledRounds) {
        try {
          logger.info({ roundId: round.id, name: round.name }, 'Auto-starting scheduled arena');

          await roundRepository.start(round.id);

          const participants = await roundRepository.getParticipants(round.id);
          const agentIds = participants.map((p) => p.agent_id);

          if (agentIds.length > 0) {
            try {
              await cortexClient.subscribeToRound(round.id, agentIds);
              logger.info({ roundId: round.id, agentCount: agentIds.length }, 'Subscribed agents to Cortex');
            } catch (err) {
              logger.warn({ roundId: round.id, error: err }, 'Failed to subscribe to Cortex (non-blocking)');
            }
          }

          await tickScheduler.startRound(round.id);

          logger.info({ roundId: round.id, name: round.name }, 'Arena auto-started successfully');
        } catch (error) {
          logger.error({ roundId: round.id, error }, 'Failed to auto-start arena');
        }
      }
    } catch (error) {
      logger.error({ error }, 'Failed to find scheduled arenas');
    }
  }

  private async endScheduledArenas(): Promise<void> {
    try {
      const now = new Date();

      const allRounds = await roundRepository.findAll();
      const roundsToEnd = allRounds.filter((round) => {
        if (round.status !== 'active') return false;

        if (round.end_time) {
          return new Date(round.end_time) <= now;
        }

        if (round.start_time && round.settings?.duration_minutes) {
          const startTime = new Date(round.start_time);
          const calculatedEndTime = new Date(startTime.getTime() + round.settings.duration_minutes * 60 * 1000);
          return calculatedEndTime <= now;
        }

        return false;
      });

      if (roundsToEnd.length === 0) {
        return;
      }

      logger.info({ count: roundsToEnd.length }, 'Found arenas ready to end');

      for (const round of roundsToEnd) {
        try {
          logger.info({ roundId: round.id, name: round.name }, 'Auto-stopping arena at scheduled end time');

          await roundRepository.stop(round.id);

          if (tickScheduler.isRoundRunning(round.id)) {
            tickScheduler.stopRound(round.id);
          }

          try {
            await cortexClient.unsubscribe();
          } catch (err) {
            logger.warn({ roundId: round.id, error: err }, 'Failed to unsubscribe from Cortex (non-blocking)');
          }

          logger.info({ roundId: round.id, name: round.name }, 'Arena auto-stopped successfully');
        } catch (error) {
          logger.error({ roundId: round.id, error }, 'Failed to auto-stop arena');
        }
      }
    } catch (error) {
      logger.error({ error }, 'Failed to check for arenas to end');
    }
  }
}

export const arenaScheduler = new ArenaScheduler();
