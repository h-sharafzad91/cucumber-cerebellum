// Cerebellum
import * as Sentry from '@sentry/node';
import { createServer } from './api/server.js';
import { initWebSocket } from './api/websocket.js';
import { initDatabase } from './config/database.js';
import { initRedis, getRedis } from './config/redis.js';
import { config } from './config/index.js';
import { logger } from './utils/logger.js';
import { roundRepository } from './repositories/round.repository.js';
import { tickScheduler } from './services/tick-scheduler.js';
import { cortexClient } from './services/cortex-client.js';
import { arenaScheduler } from './services/arena-scheduler.js';
import { matchmakingService } from './services/matchmaking.js';

async function main() {
  if (config.sentry.dsn) {
    Sentry.init({
      dsn: config.sentry.dsn,
      environment: config.nodeEnv,
      tracesSampleRate: config.isProd ? 0.1 : 1.0,
    });
    logger.info('Sentry initialized');
  }

  logger.info('Starting Cucumber Cerebellum...');

  initDatabase();
  logger.info('Database initialized');

  await initRedis();
  logger.info('Redis connected');

  const server = await createServer();

  const httpServer = server.server;
  initWebSocket(httpServer);
  logger.info('WebSocket initialized');

  await server.listen({ port: config.port, host: '0.0.0.0' });
  logger.info(`Server running on port ${config.port}`);

  arenaScheduler.start();
  matchmakingService.start();

  try {
    const activeRound = await roundRepository.findActive();
    if (activeRound) {
      logger.info(`Found active round: ${activeRound.id}, auto-resuming...`);

      const participants = await roundRepository.getParticipants(activeRound.id);
      const agentIds = participants.map((p) => p.agent_id);

      try {
        await cortexClient.subscribeToRound(activeRound.id, agentIds);
        logger.info(`Subscribed ${agentIds.length} agents to Cortex`);
      } catch (err) {
        logger.warn('Failed to subscribe to Cortex on startup:', err);
      }

      await tickScheduler.start(activeRound.id);
      logger.info(`Auto-resumed round ${activeRound.id} with ${participants.length} participants`);
    } else {
      logger.info('No active round found, scheduler not started');
    }
  } catch (err) {
    logger.warn('Failed to auto-resume active round:', err);
  }

  const shutdown = async () => {
    logger.info('Shutting down...');

    arenaScheduler.stop();
    matchmakingService.stop();

    if (tickScheduler.isRunning()) {
      tickScheduler.stop();
    }

    const redis = getRedis();
    if (redis) {
      await redis.quit();
    }

    await server.close();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((error) => {
  Sentry.captureException(error);
  console.error('Failed to start:', error);
  logger.error({ err: error }, 'Failed to start');
  process.exit(1);
});
