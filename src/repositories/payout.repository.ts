import { getDatabase } from '../config/database.js';
import { logger } from '../utils/logger.js';

export type PaymentStatus = 'pending' | 'processing' | 'completed' | 'failed';
export type PaymentMethod = 'internal' | 'usdt_contract';

export interface ArenaPayout {
  id: string;
  round_id: string;
  agent_id: string;
  user_id: string | null;
  rank: number;
  prize_amount: number;
  payout_percent: number;
  payment_status: PaymentStatus;
  payment_method: PaymentMethod;
  transaction_hash: string | null;
  paid_at: string | null;
  created_at: string;
}

export interface CreatePayoutInput {
  round_id: string;
  agent_id: string;
  user_id?: string | null;
  rank: number;
  prize_amount: number;
  payout_percent: number;
  payment_method?: PaymentMethod;
}

class PayoutRepository {
  async createPayout(input: CreatePayoutInput): Promise<ArenaPayout> {
    const db = getDatabase();

    const payoutData = {
      round_id: input.round_id,
      agent_id: input.agent_id,
      user_id: input.user_id,
      rank: input.rank,
      prize_amount: input.prize_amount,
      payout_percent: input.payout_percent,
      payment_status: 'pending' as PaymentStatus,
      payment_method: input.payment_method || ('internal' as PaymentMethod),
    };

    const { data, error } = await db
      .from('arena_payouts')
      .insert(payoutData)
      .select()
      .single();

    if (error) {
      logger.error({ error }, 'Failed to create payout');
      throw error;
    }

    logger.info({
      payoutId: data.id,
      roundId: input.round_id,
      agentId: input.agent_id,
      amount: input.prize_amount,
    }, 'Payout record created');

    return data;
  }

  async getArenaPayouts(roundId: string): Promise<ArenaPayout[]> {
    const db = getDatabase();

    const { data, error } = await db
      .from('arena_payouts')
      .select('*')
      .eq('round_id', roundId)
      .order('rank', { ascending: true });

    if (error) {
      logger.error({ roundId, error }, 'Failed to fetch arena payouts');
      throw error;
    }

    return data || [];
  }

  async getUserPayouts(userId: string): Promise<ArenaPayout[]> {
    const db = getDatabase();

    const { data, error } = await db
      .from('arena_payouts')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false });

    if (error) {
      logger.error({ userId, error }, 'Failed to fetch user payouts');
      throw error;
    }

    return data || [];
  }

  async updatePaymentStatus(
    payoutId: string,
    status: PaymentStatus,
    transactionHash?: string
  ): Promise<void> {
    const db = getDatabase();

    const updates: any = {
      payment_status: status,
    };

    if (status === 'completed') {
      updates.paid_at = new Date().toISOString();
    }

    if (transactionHash) {
      updates.transaction_hash = transactionHash;
    }

    const { error } = await db
      .from('arena_payouts')
      .update(updates)
      .eq('id', payoutId);

    if (error) {
      logger.error({ payoutId, error }, 'Failed to update payment status');
      throw error;
    }

    logger.info({ payoutId, status }, 'Payment status updated');
  }

  async getPendingPayouts(): Promise<ArenaPayout[]> {
    const db = getDatabase();

    const { data, error } = await db
      .from('arena_payouts')
      .select('*')
      .eq('payment_status', 'pending')
      .order('created_at', { ascending: true });

    if (error) {
      logger.error({ error }, 'Failed to fetch pending payouts');
      return [];
    }

    return data || [];
  }

  async getTotalPayoutsByUser(userId: string): Promise<number> {
    const db = getDatabase();

    const { data, error } = await db
      .from('arena_payouts')
      .select('prize_amount')
      .eq('user_id', userId)
      .eq('payment_status', 'completed');

    if (error) {
      logger.error({ userId, error }, 'Failed to calculate total payouts');
      return 0;
    }

    if (!data || data.length === 0) {
      return 0;
    }

    return data.reduce((total, payout) => total + parseFloat(payout.prize_amount), 0);
  }
}

export const payoutRepository = new PayoutRepository();
