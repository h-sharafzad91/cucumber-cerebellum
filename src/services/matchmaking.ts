import { getRedis } from '../config/redis.js';
import { roundRepository } from '../repositories/round.repository.js';
import { agentRepository } from '../repositories/agent.repository.js';
import { logger } from '../utils/logger.js';
import { broadcastMatchFound } from '../api/websocket.js';

type EntryFee = 1 | 5 | 10;

interface QueueEntry {
  agentId: string;
  userId: string;
  entryFee: EntryFee;
  joinedAt: number;
}

const QUEUE_KEY_PREFIX = 'matchmaking:queue:';
const MIN_PLAYERS = 2;
const MAX_PLAYERS = 5;
const MAX_WAIT_TIME_MS = 30000;

class MatchmakingService {
  private checkInterval: NodeJS.Timeout | null = null;

  start() {
    if (this.checkInterval) return;

    this.checkInterval = setInterval(() => {
      this.processQueues().catch(err => {
        logger.error({ err }, 'Matchmaking queue processing error');
      });
    }, 5000);

    logger.info('Matchmaking service started');
  }

  stop() {
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
    }
    logger.info('Matchmaking service stopped');
  }

  async joinQueue(agentId: string, userId: string, entryFee: EntryFee): Promise<{ position: number }> {
    const redis = getRedis();
    const queueKey = `${QUEUE_KEY_PREFIX}${entryFee}`;

    const entry: QueueEntry = {
      agentId,
      userId,
      entryFee,
      joinedAt: Date.now(),
    };

    await redis.rpush(queueKey, JSON.stringify(entry));
    const position = await redis.llen(queueKey);

    logger.info({ agentId, entryFee, position }, 'Agent joined matchmaking queue');

    return { position };
  }

  async leaveQueue(agentId: string, entryFee: EntryFee): Promise<boolean> {
    const redis = getRedis();
    const queueKey = `${QUEUE_KEY_PREFIX}${entryFee}`;

    const entries = await redis.lrange(queueKey, 0, -1);

    for (const entryStr of entries) {
      const entry: QueueEntry = JSON.parse(entryStr);
      if (entry.agentId === agentId) {
        await redis.lrem(queueKey, 1, entryStr);
        logger.info({ agentId, entryFee }, 'Agent left matchmaking queue');
        return true;
      }
    }

    return false;
  }

  async getQueueStatus(entryFee: EntryFee): Promise<{ count: number; entries: QueueEntry[] }> {
    const redis = getRedis();
    const queueKey = `${QUEUE_KEY_PREFIX}${entryFee}`;

    const entries = await redis.lrange(queueKey, 0, -1);
    const parsed = entries.map(e => JSON.parse(e) as QueueEntry);

    return { count: parsed.length, entries: parsed };
  }

  private async processQueues() {
    for (const fee of [1, 5, 10] as EntryFee[]) {
      await this.processQueue(fee);
    }
  }

  private async processQueue(entryFee: EntryFee) {
    const redis = getRedis();
    const queueKey = `${QUEUE_KEY_PREFIX}${entryFee}`;

    const entries = await redis.lrange(queueKey, 0, -1);
    if (entries.length < MIN_PLAYERS) return;

    const parsed = entries.map(e => JSON.parse(e) as QueueEntry);
    const now = Date.now();

    const shouldStart =
      parsed.length >= MAX_PLAYERS ||
      (parsed.length >= MIN_PLAYERS && now - parsed[0].joinedAt >= MAX_WAIT_TIME_MS);

    if (!shouldStart) return;

    const matchedEntries = parsed.slice(0, MAX_PLAYERS);

    for (let i = 0; i < matchedEntries.length; i++) {
      await redis.lpop(queueKey);
    }

    await this.createContest(matchedEntries, entryFee);
  }

  private async createContest(entries: QueueEntry[], entryFee: EntryFee) {
    const agentIds = entries.map(e => e.agentId);
    const durationMinutes = 2;

    const startTime = new Date();
    const endTime = new Date(startTime.getTime() + durationMinutes * 60 * 1000);

    const round = await roundRepository.create({
      name: `Quick Contest - $${entryFee}`,
      arena_type: 'contest',
      prize_pool_seed: 0,
      buy_in_fee: entryFee,
      protocol_fee_percent: 10,
      agent_limit: MAX_PLAYERS,
      payout_structure: { '1': 70, '2': 30 },
      settings: {
        duration_minutes: durationMinutes,
      },
      end_time: endTime.toISOString(),
      min_tick_interval: 10,
      max_tick_interval: 300,
    });

    await roundRepository.start(round.id);

    for (const agentId of agentIds) {
      const agent = await agentRepository.findById(agentId);
      await roundRepository.addParticipant(round.id, agentId, agent);
    }

    for (const entry of entries) {
      broadcastMatchFound(entry.userId, {
        roundId: round.id,
        entryFee,
        participants: agentIds.length,
      });
    }

    logger.info({
      roundId: round.id,
      entryFee,
      participants: agentIds.length,
    }, 'Contest created from matchmaking');
  }
}

export const matchmakingService = new MatchmakingService();
