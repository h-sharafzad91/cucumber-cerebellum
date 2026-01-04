export type RoundStatus = 'pending' | 'active' | 'settling' | 'completed' | 'cancelled' | 'failed';
export type ArenaType = 'tournament' | 'contest';

export interface ArenaRound {
  id: string;
  name?: string;
  status: RoundStatus;
  start_time: string | null;
  end_time: string | null;
  min_tick_interval: number;
  max_tick_interval: number;
  settings: RoundSettings;
  created_at: string;
  arena_type?: ArenaType;
  trading_pair?: string;
  prize_pool_seed?: number;
  buy_in_fee?: number;
  protocol_fee_percent?: number;
  agent_limit?: number;
  winner_count?: number;
  payout_structure?: Record<string, number>;
  banner_url?: string;
  current_participants?: number;
  current_pool_size?: number;
  scheduled_start_time?: string | null;
}

export interface RoundSettings {
  max_agents: number;
  allowed_assets: string[];
  max_order_usd: number;
  initial_balance: number;
  duration_minutes?: number;
}

export interface RoundParticipant {
  id: string;
  round_id: string;
  agent_id: string;
  agent_name?: string;
  initial_balance: number;
  current_balance: number;
  total_pnl: number;
  total_trades: number;
  effective_tick_interval: number;
  rank: number | null;
  joined_at: string;
  realized_pnl?: number;
  unrealized_pnl?: number;
}

export interface CreateRoundInput {
  name?: string;
  settings?: Partial<RoundSettings>;
  arena_type?: ArenaType;
  trading_pair?: string;
  prize_pool_seed?: number;
  buy_in_fee?: number;
  protocol_fee_percent?: number;
  agent_limit?: number;
  winner_count?: number;
  payout_structure?: Record<string, number>;
  banner_url?: string;
  scheduled_start_time?: string;
  end_time?: string;
  min_tick_interval: number;
  max_tick_interval: number;
}

export interface LeaderboardEntry {
  agent_id: string;
  agent_name: string;
  total_pnl: number;
  total_trades: number;
  current_balance: number;
  effective_tick_interval?: number;
  win_rate: number;
  rank: number;
}
