import { Server as HttpServer } from 'http';
import { Server as SocketServer } from 'socket.io';
import { logger } from '../utils/logger.js';

let io: SocketServer | null = null;

export function initWebSocket(httpServer: HttpServer): SocketServer {
  io = new SocketServer(httpServer, {
    cors: {
      origin: process.env.FRONTEND_URL || '*',
      methods: ['GET', 'POST'],
    },
  });

  io.on('connection', (socket) => {
    logger.info({ socket_id: socket.id }, 'Client connected');

    socket.on('subscribe:round', (roundId: string) => {
      socket.join(`round:${roundId}`);
      logger.info({ socket_id: socket.id, round_id: roundId }, 'Subscribed to round');
    });

    socket.on('unsubscribe:round', (roundId: string) => {
      socket.leave(`round:${roundId}`);
      logger.info({ socket_id: socket.id, round_id: roundId }, 'Unsubscribed from round');
    });

    socket.on('subscribe:agent', (agentId: string) => {
      socket.join(`agent:${agentId}`);
      logger.info({ socket_id: socket.id, agent_id: agentId }, 'Subscribed to agent');
    });

    socket.on('unsubscribe:agent', (agentId: string) => {
      socket.leave(`agent:${agentId}`);
      logger.info({ socket_id: socket.id, agent_id: agentId }, 'Unsubscribed from agent');
    });

    socket.on('subscribe:user', (userId: string) => {
      socket.join(`user:${userId}`);
      logger.info({ socket_id: socket.id, user_id: userId }, 'Subscribed to user');
    });

    socket.on('unsubscribe:user', (userId: string) => {
      socket.leave(`user:${userId}`);
      logger.info({ socket_id: socket.id, user_id: userId }, 'Unsubscribed from user');
    });

    socket.on('disconnect', () => {
      logger.info({ socket_id: socket.id }, 'Client disconnected');
    });
  });

  logger.info('WebSocket server initialized');
  return io;
}

export function broadcastTick(roundId: string, tickData: object): void {
  if (!io) return;
  io.to(`round:${roundId}`).emit('tick', tickData);
}

export function broadcastTrade(roundId: string, tradeData: object): void {
  if (!io) return;
  io.to(`round:${roundId}`).emit('trade', tradeData);
}

export function broadcastLeaderboard(roundId: string, leaderboard: object[]): void {
  if (!io) return;
  io.to(`round:${roundId}`).emit('leaderboard', { rankings: leaderboard });
}

export function broadcastReasoning(roundId: string, reasoningData: object): void {
  if (!io) return;
  io.to(`round:${roundId}`).emit('reasoning', reasoningData);
}

export function broadcastMarketUpdate(marketData: object): void {
  if (!io) return;
  io.emit('market', marketData);
}

export function broadcastPositionUpdate(roundId: string, agentId: string, positionData: object): void {
  if (!io) return;
  io.to(`round:${roundId}`).emit('position', positionData);
  io.to(`agent:${agentId}`).emit('position', positionData);
}

export function broadcastMatchFound(userId: string, matchData: object): void {
  if (!io) return;
  io.to(`user:${userId}`).emit('match_found', matchData);
}

export function broadcastQueueUpdate(userId: string, queueData: object): void {
  if (!io) return;
  io.to(`user:${userId}`).emit('queue_update', queueData);
}

export function getIO(): SocketServer | null {
  return io;
}
