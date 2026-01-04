import Fastify from 'fastify';
import cors from '@fastify/cors';
import { config } from '../config/index.js';
import { logger } from '../utils/logger.js';
import { agentRoutes } from './routes/agents.js';
import { roundRoutes } from './routes/rounds.js';
import { arenaRoutes } from './routes/arena.js';
import { leaderboardRoutes } from './routes/leaderboard.js';
import { marketRoutes } from './routes/market.js';
import { matchmakingRoutes } from './routes/matchmaking.js';
import { bettingRoutes } from './routes/betting.js';
import { tickScheduler } from '../services/tick-scheduler.js';
import { registry } from '../services/metrics.js';

export async function createServer() {
  const fastify = Fastify({
    logger: false,
  });

  await fastify.register(cors, {
    origin: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE'],
  });

  fastify.get('/health', async () => ({ status: 'ok', timestamp: new Date().toISOString() }));

  fastify.get('/metrics', async (_request, reply) => {
    reply.header('Content-Type', registry.contentType);
    return registry.metrics();
  });

  fastify.get('/scheduler/status', async () => ({
    running: tickScheduler.isRunning(),
    roundId: (tickScheduler as any).currentRoundId,
    tickNumber: (tickScheduler as any).tickNumber,
    timestamp: new Date().toISOString(),
  }));

  fastify.post('/scheduler/tick', async () => {
    await tickScheduler.triggerTick();
    return { triggered: true, timestamp: new Date().toISOString() };
  });

  fastify.register(agentRoutes, { prefix: '/v1/agents' });
  fastify.register(roundRoutes, { prefix: '/v1/rounds' });
  fastify.register(arenaRoutes, { prefix: '/v1/arena' });
  fastify.register(leaderboardRoutes, { prefix: '/v1/leaderboard' });
  fastify.register(marketRoutes, { prefix: '/v1/market' });
  fastify.register(matchmakingRoutes, { prefix: '/v1/matchmaking' });
  fastify.register(bettingRoutes, { prefix: '/v1/betting' });

  fastify.setErrorHandler((error, _request, reply) => {
    const statusCode = error.statusCode || 500;
    const message = error.message || 'Internal Server Error';

    // Log 4xx errors as warnings (expected user errors), 5xx as errors (system failures)
    if (statusCode >= 500) {
      logger.error({ error }, 'Server error');
    } else if (statusCode >= 400) {
      logger.warn({ statusCode, message }, 'Client error');
    }

    reply.status(statusCode).send({
      error: message,
      statusCode,
    });
  });

  return fastify;
}

export async function startServer() {
  const server = await createServer();

  try {
    await server.listen({ port: config.port, host: '0.0.0.0' });
    logger.info(`Server running on port ${config.port}`);
    return server;
  } catch (error) {
    logger.error({ error }, 'Failed to start server');
    throw error;
  }
}
