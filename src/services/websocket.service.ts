import { Server as HttpServer } from 'http';
import { Server as SocketIOServer, Socket } from 'socket.io';
import { logger } from '../utils/logger.js';

interface ClientToServerEvents {
  subscribe_round: (roundId: string) => void;
  unsubscribe_round: (roundId: string) => void;
  subscribe_agent: (agentId: string) => void;
  unsubscribe_agent: (agentId: string) => void;
}

interface ServerToClientEvents {
  tick_update: (data: TickUpdate) => void;
  trade_executed: (data: TradeUpdate) => void;
  position_update: (data: PositionUpdate) => void;
  leaderboard_update: (data: LeaderboardUpdate) => void;
  reasoning_update: (data: ReasoningUpdate) => void;
  market_update: (data: MarketUpdate) => void;
}

export interface TickUpdate {
  round_id: string;
  tick_number: number;
  timestamp: string;
  market_price: number;
}

export interface TradeUpdate {
  round_id: string;
  agent_id: string;
  agent_name?: string;
  trade_id: string;
  action: string;
  asset: string;
  size_usd: number;
  execution_price: number;
  timestamp: string;
  metadata?: any;
}

export interface PositionUpdate {
  round_id: string;
  agent_id: string;
  positions: any[];
  total_value: number;
  unrealized_pnl: number;
}

export interface LeaderboardUpdate {
  round_id: string;
  leaderboard: Array<{
    rank: number;
    agent_id: string;
    agent_name: string;
    total_pnl: number;
    total_trades: number;
    current_balance: number;
  }>;
  timestamp: string;
}

export interface ReasoningUpdate {
  round_id: string;
  agent_id: string;
  agent_name?: string;
  timestamp: string;
  action: string;
  reasoning: string;
  asset?: string;
  size_usd?: number;
}

export interface MarketUpdate {
  asset: string;
  price: number;
  timestamp: string;
  change_24h?: number;
}

class WebSocketService {
  private io: SocketIOServer | null = null;

  initialize(httpServer: HttpServer): void {
    this.io = new SocketIOServer(httpServer, {
      cors: {
        origin: process.env.FRONTEND_URL || 'http://localhost:3000',
        methods: ['GET', 'POST'],
      },
    });

    this.io.on('connection', (socket: Socket) => {
      logger.info({ socket_id: socket.id }, 'WebSocket client connected');

      socket.on('subscribe_round', (roundId: string) => {
        socket.join(`round:${roundId}`);
        logger.info({ socket_id: socket.id, round_id: roundId }, 'Subscribed to round');
      });

      socket.on('unsubscribe_round', (roundId: string) => {
        socket.leave(`round:${roundId}`);
        logger.info({ socket_id: socket.id, round_id: roundId }, 'Unsubscribed from round');
      });

      socket.on('subscribe_agent', (agentId: string) => {
        socket.join(`agent:${agentId}`);
        logger.info({ socket_id: socket.id, agent_id: agentId }, 'Subscribed to agent');
      });

      socket.on('unsubscribe_agent', (agentId: string) => {
        socket.leave(`agent:${agentId}`);
        logger.info({ socket_id: socket.id, agent_id: agentId }, 'Unsubscribed from agent');
      });

      socket.on('disconnect', () => {
        logger.info({ socket_id: socket.id }, 'WebSocket client disconnected');
      });
    });

    logger.info('WebSocket server initialized');
  }

  emitTickUpdate(roundId: string, data: TickUpdate): void {
    if (!this.io) return;
    this.io.to(`round:${roundId}`).emit('tick_update', data);
  }

  emitTradeExecuted(roundId: string, data: TradeUpdate): void {
    if (!this.io) return;
    this.io.to(`round:${roundId}`).emit('trade_executed', data);
  }

  emitPositionUpdate(roundId: string, agentId: string, data: PositionUpdate): void {
    if (!this.io) return;
    this.io.to(`round:${roundId}`).emit('position_update', data);
    this.io.to(`agent:${agentId}`).emit('position_update', data);
  }

  emitLeaderboardUpdate(roundId: string, data: LeaderboardUpdate): void {
    if (!this.io) return;
    this.io.to(`round:${roundId}`).emit('leaderboard_update', data);
  }

  emitReasoningUpdate(roundId: string, agentId: string, data: ReasoningUpdate): void {
    if (!this.io) return;
    this.io.to(`round:${roundId}`).emit('reasoning_update', data);
    this.io.to(`agent:${agentId}`).emit('reasoning_update', data);
  }

  emitMarketUpdate(data: MarketUpdate): void {
    if (!this.io) return;
    this.io.emit('market_update', data);
  }

  getConnectedClients(): number {
    if (!this.io) return 0;
    return this.io.sockets.sockets.size;
  }

  getRoomClients(room: string): number {
    if (!this.io) return 0;
    const roomSockets = this.io.sockets.adapter.rooms.get(room);
    return roomSockets ? roomSockets.size : 0;
  }
}

export const websocketService = new WebSocketService();
